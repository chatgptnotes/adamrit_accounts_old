import { supabase } from '@/integrations/supabase/client';

// One real dialysis charge from the hospital billing (visit_clinical_services).
export interface DialysisCharge {
  amount: number;       // price the patient paid for this charge
  sessions: number;     // quantity = number of dialysis sessions
  visitDate: string;    // YYYY-MM-DD (when the patient came)
  patientName: string;
  patientsId: string | null; // unique patient ID
  patientUuid: string | null; // patients.id, needed to find their lab reports
}

// One patient's dialysis for a given month (aggregated).
export interface PatientRow {
  key: string;
  patientName: string;
  patientsId: string | null;
  date: string;         // representative (earliest) visit date that month
  price: number;        // total paid
  sessions: number;     // total sessions
}

// One month's dialysis totals (for the year overview).
export interface MonthRollup {
  month: string;        // YYYY-MM
  collected: number;    // total price collected
  sessions: number;
  patients: number;
}

export const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** Pull every dialysis charge joined to its visit + patient, for one hospital. */
export async function fetchDialysisCharges(hospitalName: string): Promise<DialysisCharge[]> {
  const { data, error } = await supabase
    .from('visit_clinical_services')
    .select(
      'amount, quantity, clinical_services!inner(service_name), visits!inner(visit_date, patients!inner(id, name, patients_id, hospital_name))'
    )
    .ilike('clinical_services.service_name', '%dialy%')
    .eq('visits.patients.hospital_name', hospitalName)
    .limit(5000);
  if (error) throw error;
  return (data ?? [])
    .map((row: Record<string, unknown>) => {
      const visit = (row.visits ?? {}) as Record<string, unknown>;
      const patient = (visit.patients ?? {}) as Record<string, unknown>;
      const visitDate = (visit.visit_date as string) ?? '';
      if (!visitDate) return null;
      return {
        amount: Number(row.amount) || 0,
        sessions: Number(row.quantity) || 1,
        visitDate,
        patientName: (patient.name as string) ?? 'Unknown',
        patientsId: (patient.patients_id as string) ?? null,
        patientUuid: (patient.id as string) ?? null,
      } as DialysisCharge;
    })
    .filter((c): c is DialysisCharge => c !== null);
}

// ---- Month-key helpers ('YYYY-MM') ----

export function ymKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function currentMonthKey(): string {
  return ymKey(new Date());
}

export function addMonths(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, (m - 1) + delta, 1);
  return ymKey(d);
}

export function longLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

export function shortLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const name = new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short' });
  return `${name}-${String(y).slice(2)}`;
}

/** Roll every charge up into one row per month (most recent first). */
export function rollupByMonth(charges: readonly DialysisCharge[]): MonthRollup[] {
  const map = new Map<string, { collected: number; sessions: number; patients: Set<string> }>();
  for (const c of charges) {
    const month = c.visitDate.slice(0, 7);
    if (!month) continue;
    const r = map.get(month) ?? { collected: 0, sessions: 0, patients: new Set<string>() };
    r.collected += c.amount;
    r.sessions += c.sessions;
    r.patients.add(c.patientsId ?? `name:${c.patientName}`);
    map.set(month, r);
  }
  return Array.from(map.entries())
    .map(([month, r]) => ({ month, collected: r.collected, sessions: r.sessions, patients: r.patients.size }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

/** Is a visit-month already due for payment? (visit month + payAfter <= today). */
export function isDue(month: string, payAfterMonths: number): boolean {
  return addMonths(month, payAfterMonths) <= currentMonthKey();
}

/** The month payment is due (visit month + payAfter). */
export function dueMonth(month: string, payAfterMonths: number): string {
  return addMonths(month, payAfterMonths);
}

/** Aggregate one month's charges into one row per patient. */
export function groupByPatient(chargesInMonth: readonly DialysisCharge[]): PatientRow[] {
  const map = new Map<string, PatientRow>();
  for (const c of chargesInMonth) {
    const key = c.patientsId ?? `name:${c.patientName}`;
    const existing = map.get(key);
    if (existing) {
      existing.price += c.amount;
      existing.sessions += c.sessions;
      if (c.visitDate < existing.date) existing.date = c.visitDate;
    } else {
      map.set(key, {
        key,
        patientName: c.patientName,
        patientsId: c.patientsId,
        date: c.visitDate,
        price: c.amount,
        sessions: c.sessions,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.price - a.price);
}
