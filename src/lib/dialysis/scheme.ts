import { supabase } from '@/integrations/supabase/client';
import { markDialysisSessionBilled } from '@/lib/dialysisSessionBilling';

// Scheme-aware dialysis sessions.
//
// Builds on the existing dialysis_session_billing table (one row per billed
// dialysis visit) rather than a second one. What it adds is the Yojana: how
// many unbilled sessions a patient must reach before the hospital may claim
// differs by scheme, so a flat threshold sends half the patients too early
// and holds the other half too long.
//
//   PMJAY   — claim every 3 sessions
//   MJPJAY  — claim every 6 sessions
//
// Any other scheme (private, ESIC, a corporate) has no Yojana block rule, so
// it is shown as OTHER and treated as billable per session.

export type DialysisScheme = 'PMJAY' | 'MJPJAY' | 'OTHER';

export const SCHEME_BLOCK: Record<DialysisScheme, number> = {
  PMJAY: 3,
  MJPJAY: 6,
  OTHER: 1,
};

export const SCHEME_LABEL: Record<DialysisScheme, string> = {
  PMJAY: 'PMJAY',
  MJPJAY: 'MJPJAY',
  OTHER: 'Other / private',
};

/**
 * Which Yojana a patient belongs to, from the corporate recorded on them.
 * Matched on substrings because the master carries the full scheme titles
 * ("Ayushman Bharat - Pradhan Mantri Jan Arogya Yojna (PM-JAY)").
 */
export function dialysisScheme(corporate: string | null | undefined): DialysisScheme {
  const value = String(corporate || '').toLowerCase();
  if (!value) return 'OTHER';
  if (value.includes('mjpjay') || value.includes('jyotirao') || value.includes('jyotiba')) {
    return 'MJPJAY';
  }
  if (value.includes('pm-jay') || value.includes('pmjay') || value.includes('pradhan mantri')) {
    return 'PMJAY';
  }
  return 'OTHER';
}

export interface DialysisSession {
  visitId: string;
  visitCode: string | null;
  visitDate: string;
  registeredAt: string | null;
  billed: boolean;
}

export interface DialysisPatientSessions {
  patientId: string;
  patientName: string;
  patientsId: string | null;
  phone: string | null;
  corporate: string | null;
  scheme: DialysisScheme;
  /** Sessions to complete before the hospital may claim. */
  block: number;
  sessions: DialysisSession[];
  unbilledCount: number;
  /** True once enough unbilled sessions have piled up to raise a claim. */
  readyToBill: boolean;
  /** Newest session first — what "registered in the last 24 hours" keys on. */
  latestRegisteredAt: string | null;
}

/**
 * Every dialysis patient for the hospital with their session history and the
 * billed state of each session. One query for the visits, one for the billed
 * set — the same pair loadDialysisBillableSessions uses, plus the corporate.
 */
export async function loadDialysisPatients(
  hospitalName: string,
): Promise<DialysisPatientSessions[]> {
  const [visitsResult, billedResult] = await Promise.all([
    supabase
      .from('visits')
      .select(
        'id, visit_id, visit_date, created_at, patient_id, patients!inner(id, name, patients_id, phone, corporate, hospital_name)',
      )
      .eq('patient_type', 'Dialysis')
      .eq('patients.hospital_name', hospitalName)
      .order('visit_date', { ascending: false })
      .order('created_at', { ascending: false }),
    (supabase as any)
      .from('dialysis_session_billing')
      .select('dialysis_visit_id')
      .eq('hospital_name', hospitalName),
  ]);
  if (visitsResult.error) throw visitsResult.error;
  if (billedResult.error) throw billedResult.error;

  const billedIds = new Set((billedResult.data ?? []).map((r: any) => r.dialysis_visit_id));
  const byPatient = new Map<string, DialysisPatientSessions>();

  for (const visit of (visitsResult.data ?? []) as any[]) {
    const patient = Array.isArray(visit.patients) ? visit.patients[0] : visit.patients;
    if (!patient?.id) continue;
    let row = byPatient.get(patient.id);
    if (!row) {
      const scheme = dialysisScheme(patient.corporate);
      row = {
        patientId: patient.id,
        patientName: patient.name ?? 'Unknown patient',
        patientsId: patient.patients_id ?? null,
        phone: patient.phone ?? null,
        corporate: patient.corporate ?? null,
        scheme,
        block: SCHEME_BLOCK[scheme],
        sessions: [],
        unbilledCount: 0,
        readyToBill: false,
        latestRegisteredAt: null,
      };
      byPatient.set(patient.id, row);
    }
    row.sessions.push({
      visitId: visit.id,
      visitCode: visit.visit_id ?? null,
      visitDate: visit.visit_date,
      registeredAt: visit.created_at ?? null,
      billed: billedIds.has(visit.id),
    });
  }

  for (const row of byPatient.values()) {
    row.unbilledCount = row.sessions.filter((s) => !s.billed).length;
    row.readyToBill = row.unbilledCount >= row.block;
    row.latestRegisteredAt = row.sessions.reduce<string | null>((latest, s) => {
      const stamp = s.registeredAt ?? (s.visitDate ? `${s.visitDate}T00:00:00Z` : null);
      if (!stamp) return latest;
      return !latest || stamp > latest ? stamp : latest;
    }, null);
  }

  return Array.from(byPatient.values()).sort((a, b) =>
    (b.latestRegisteredAt ?? '').localeCompare(a.latestRegisteredAt ?? ''),
  );
}

/** Registered in the rolling 24 hours, on when the VISIT was made. */
export function registeredInLast24h(row: DialysisPatientSessions): boolean {
  if (!row.latestRegisteredAt) return false;
  return row.latestRegisteredAt >= new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Bill one whole block: the OLDEST unbilled sessions first, exactly `block`
 * of them, because a claim covers a block and the oldest sessions are the
 * ones that have been waiting.
 */
export async function billOneBlock(
  hospitalName: string,
  row: DialysisPatientSessions,
  billedBy?: string | null,
): Promise<number> {
  const oldestFirst = row.sessions
    .filter((s) => !s.billed)
    .sort((a, b) => a.visitDate.localeCompare(b.visitDate))
    .slice(0, row.block);
  if (oldestFirst.length === 0) return 0;
  for (const session of oldestFirst) {
    await markDialysisSessionBilled(
      hospitalName,
      { id: session.visitId, patientId: row.patientId, visitDate: session.visitDate },
      billedBy,
    );
  }
  return oldestFirst.length;
}
