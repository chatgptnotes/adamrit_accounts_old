import { supabase } from '@/integrations/supabase/client';

export const DIALYSIS_SESSION_BILLING_QUERY_KEY = 'dialysis-session-billing';
export const DIALYSIS_BILLING_REMINDER_SESSIONS = 3;

export type DialysisBillableSession = {
  id: string;
  visitCode: string | null;
  visitDate: string;
  patientId: string;
  patientName: string;
  patientsId: string | null;
  phone: string | null;
  billed: boolean;
};

export async function loadDialysisBillableSessions(hospitalName: string): Promise<DialysisBillableSession[]> {
  const [visitsResult, billedResult] = await Promise.all([
    supabase
      .from('visits')
      .select('id, visit_id, visit_date, patient_id, patients!inner(id, name, patients_id, phone, hospital_name)')
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

  const billedIds = new Set((billedResult.data ?? []).map((row: any) => row.dialysis_visit_id));
  return ((visitsResult.data ?? []) as any[]).map((visit) => {
    const patient = Array.isArray(visit.patients) ? visit.patients[0] : visit.patients;
    return {
      id: visit.id,
      visitCode: visit.visit_id ?? null,
      visitDate: visit.visit_date,
      patientId: visit.patient_id,
      patientName: patient?.name ?? 'Unknown patient',
      patientsId: patient?.patients_id ?? null,
      phone: patient?.phone ?? null,
      billed: billedIds.has(visit.id),
    };
  });
}

export async function markDialysisSessionBilled(
  hospitalName: string,
  session: Pick<DialysisBillableSession, 'id' | 'patientId' | 'visitDate'>,
  billedBy?: string | null,
): Promise<void> {
  const { error } = await (supabase as any).from('dialysis_session_billing').upsert({
    hospital_name: hospitalName,
    dialysis_visit_id: session.id,
    patient_id: session.patientId,
    session_date: session.visitDate,
    billed_by: billedBy ?? null,
    billed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'hospital_name,dialysis_visit_id' });
  if (error) throw error;
}

export function pendingDialysisPatients(sessions: readonly DialysisBillableSession[]) {
  const byPatient = new Map<string, DialysisBillableSession[]>();
  for (const session of sessions) {
    if (session.billed) continue;
    const entries = byPatient.get(session.patientId) ?? [];
    entries.push(session);
    byPatient.set(session.patientId, entries);
  }
  return Array.from(byPatient.values())
    .filter((entries) => entries.length >= DIALYSIS_BILLING_REMINDER_SESSIONS)
    .sort((a, b) => b.length - a.length);
}
