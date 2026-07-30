import { supabase } from '@/integrations/supabase/client';
import type { DialysisCharge } from './dialysisData';

/** A dialysis patient must be billed once every this many cycles. */
export const CYCLES_PER_BILL = 6;
/** A dialysis patient must have a fresh lab report at least this often. */
export const LAB_REPORT_INTERVAL_DAYS = 30;

export interface DialysisTrackerRow {
  key: string;                 // patients_id, or 'name:<name>' when the ID is missing
  patientName: string;
  patientsId: string | null;
  patientUuid: string | null;
  totalCycles: number;
  billedCycles: number;
  unbilledCycles: number;
  billsDue: number;            // how many whole blocks of 6 are waiting to be billed
  lastSessionDate: string;     // YYYY-MM-DD
  lastLabDate: string | null;  // YYYY-MM-DD of their most recent lab report
  daysSinceLab: number | null; // null when they have never had one
  labDue: boolean;
  daysUntilLabDue: number;     // 0 once it is due
}

export function patientKey(c: Pick<DialysisCharge, 'patientsId' | 'patientName'>): string {
  return c.patientsId ?? `name:${c.patientName}`;
}

function daysBetween(from: string, to: Date): number {
  const start = new Date(`${from}T00:00:00`).getTime();
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.floor((end - start) / 86_400_000);
}

/** How many cycles each patient has already been billed for. */
export async function fetchBilledCycles(hospitalName: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('dialysis_cycle_billing')
    .select('patient_key, billed_cycles')
    .eq('hospital_name', hospitalName);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.patient_key as string, Number(r.billed_cycles) || 0]));
}

/** The date of each patient's most recent lab report. */
export async function fetchLastLabDates(patientUuids: readonly string[]): Promise<Map<string, string>> {
  if (patientUuids.length === 0) return new Map();
  const { data, error } = await supabase
    .from('lab_results')
    .select('created_at, visits!inner(patient_id)')
    .in('visits.patient_id', [...patientUuids])
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) throw error;
  const latest = new Map<string, string>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const visit = (row.visits ?? {}) as Record<string, unknown>;
    const uuid = visit.patient_id as string | undefined;
    const created = row.created_at as string | undefined;
    if (!uuid || !created) continue;
    const day = created.slice(0, 10);
    const seen = latest.get(uuid);
    if (!seen || day > seen) latest.set(uuid, day);
  }
  return latest;
}

/** Record that everything up to `billedCycles` has now been put on a bill. */
export async function markCyclesBilled(
  hospitalName: string,
  row: DialysisTrackerRow,
  billedCycles: number
): Promise<void> {
  const { error } = await supabase.from('dialysis_cycle_billing').upsert(
    {
      hospital_name: hospitalName,
      patient_key: row.key,
      patient_name: row.patientName,
      billed_cycles: billedCycles,
      last_billed_on: new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'hospital_name,patient_key' }
  );
  if (error) throw error;
}

/**
 * One row per dialysis patient across all time: cycles done, cycles still to be
 * billed, and when their next monthly lab report is due.
 */
export function buildTrackerRows(
  charges: readonly DialysisCharge[],
  billed: ReadonlyMap<string, number>,
  lastLabDates: ReadonlyMap<string, string>,
  today: Date = new Date()
): DialysisTrackerRow[] {
  const byPatient = new Map<string, { name: string; patientsId: string | null; uuid: string | null; cycles: number; last: string }>();
  for (const c of charges) {
    const key = patientKey(c);
    const existing = byPatient.get(key);
    if (existing) {
      existing.cycles += c.sessions;
      if (c.visitDate > existing.last) existing.last = c.visitDate;
      if (!existing.uuid && c.patientUuid) existing.uuid = c.patientUuid;
    } else {
      byPatient.set(key, {
        name: c.patientName,
        patientsId: c.patientsId,
        uuid: c.patientUuid,
        cycles: c.sessions,
        last: c.visitDate,
      });
    }
  }

  const rows: DialysisTrackerRow[] = [];
  for (const [key, p] of byPatient) {
    const billedCycles = billed.get(key) ?? 0;
    const unbilledCycles = Math.max(0, p.cycles - billedCycles);
    const lastLabDate = p.uuid ? lastLabDates.get(p.uuid) ?? null : null;
    const daysSinceLab = lastLabDate ? daysBetween(lastLabDate, today) : null;
    rows.push({
      key,
      patientName: p.name,
      patientsId: p.patientsId,
      patientUuid: p.uuid,
      totalCycles: p.cycles,
      billedCycles,
      unbilledCycles,
      billsDue: Math.floor(unbilledCycles / CYCLES_PER_BILL),
      lastSessionDate: p.last,
      lastLabDate,
      daysSinceLab,
      labDue: daysSinceLab === null || daysSinceLab >= LAB_REPORT_INTERVAL_DAYS,
      daysUntilLabDue: daysSinceLab === null ? 0 : Math.max(0, LAB_REPORT_INTERVAL_DAYS - daysSinceLab),
    });
  }

  // Anything needing action first, then the busiest patients.
  return rows.sort((a, b) => {
    const aAction = (a.billsDue > 0 ? 2 : 0) + (a.labDue ? 1 : 0);
    const bAction = (b.billsDue > 0 ? 2 : 0) + (b.labDue ? 1 : 0);
    if (aAction !== bAction) return bAction - aAction;
    return b.unbilledCycles - a.unbilledCycles;
  });
}
