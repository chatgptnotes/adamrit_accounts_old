import { supabase } from '@/integrations/supabase/client';

export type DialysisCategory = 'Private' | 'MJPJAY/Yojna' | 'Category Missing';

export const PRIVATE_DIALYSIS_RATE = 4000;
export const YOJNA_DIALYSIS_RATE = 1500;

export interface DialysisCharge {
  visitId?: string | null;
  amount: number;
  sessions: number;
  visitDate: string;
  patientName: string;
  patientsId: string | null;
  patientUuid: string | null;
  category: DialysisCategory;
  source: 'billing' | 'manual';
}

export interface PatientRow {
  key: string;
  patientName: string;
  patientsId: string | null;
  patientUuid: string | null;
  date: string;
  price: number;
  sessions: number;
  category: DialysisCategory;
}

export interface MonthRollup {
  month: string;
  collected: number;
  sessions: number;
  patients: number;
}

export const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function normalizeDialysisCategory(value: unknown): DialysisCategory {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return 'Category Missing';
  if (normalized === 'private') return 'Private';
  return 'MJPJAY/Yojna';
}

export function dialysisRate(category: DialysisCategory): number {
  return category === 'Private' ? PRIVATE_DIALYSIS_RATE : YOJNA_DIALYSIS_RATE;
}

export function patientCollection(charge: Pick<DialysisCharge, 'amount' | 'category'>): number {
  return charge.category === 'Private' ? charge.amount : 0;
}

export function governmentReceivable(charge: Pick<DialysisCharge, 'amount' | 'category'>): number {
  return charge.category === 'Private' ? 0 : charge.amount;
}

/** Pull billed dialysis charges, manual records, and reception-created visits. */
export async function fetchDialysisCharges(hospitalName = 'hope'): Promise<DialysisCharge[]> {
  const { data, error } = await supabase
    .from('visit_clinical_services')
    .select('amount, quantity, clinical_services!inner(service_name), visits!inner(id, visit_date, visit_type, dialysis_partner, patients(id, name, patients_id, corporate))')
    .ilike('clinical_services.service_name', '%dialy%')
    .eq('visits.patients.hospital_name', hospitalName)
    .limit(5000);
  if (error) throw error;

  const billedCharges = (data ?? [])
    .map((row: Record<string, unknown>) => {
      const visit = (row.visits ?? {}) as Record<string, unknown>;
      const patient = (visit.patients ?? {}) as Record<string, unknown>;
      const visitDate = (visit.visit_date as string) ?? '';
      if (!visitDate) return null;
      if (String(visit.visit_type ?? '').toLowerCase() !== 'dialysis') return null;
      if (String(visit.dialysis_partner ?? '').toLowerCase() !== 'nephroplus') return null;
      const category = normalizeDialysisCategory(patient.corporate);
      const sessions = Number(row.quantity) || 1;
      return {
        visitId: (visit.id as string) ?? null,
        amount: Number(row.amount) || sessions * dialysisRate(category),
        sessions,
        visitDate,
        patientName: (patient.name as string) ?? 'Unknown',
        patientsId: (patient.patients_id as string) ?? null,
        patientUuid: (patient.id as string) ?? null,
        category,
        source: 'billing',
      } as DialysisCharge;
    })
    .filter((c): c is DialysisCharge => c !== null);

  const { data: manualData, error: manualError } = await (supabase as any)
    .from('dialysis_sessions')
    .select('session_date, patient_id, patient_name, patients:patient_id(id, patients_id, corporate)')
    .eq('hospital_name', hospitalName)
    .eq('service_category', 'manual_session_record')
    .limit(5000);
  if (manualError) throw manualError;

  const manualCharges = ((manualData ?? []) as Record<string, unknown>[])
    .map((row) => {
      const patient = (row.patients ?? {}) as Record<string, unknown>;
      const sessionDate = (row.session_date as string) ?? '';
      if (!sessionDate) return null;
      const category = normalizeDialysisCategory(patient.corporate);
      return {
        amount: dialysisRate(category),
        sessions: 1,
        visitDate: sessionDate,
        patientName: (row.patient_name as string) ?? 'Unknown',
        patientsId: (patient.patients_id as string) ?? null,
        patientUuid: (row.patient_id as string) ?? ((patient.id as string) ?? null),
        category,
        source: 'manual',
      } as DialysisCharge;
    })
    .filter((c): c is DialysisCharge => c !== null);

  const { data: visitData, error: visitError } = await supabase
    .from('visits')
    .select('id, visit_date, visit_type, dialysis_partner, patients(id, name, patients_id, corporate)')
    .eq('visit_type', 'dialysis')
    .ilike('dialysis_partner', 'NephroPlus')
    .limit(5000);
  if (visitError) throw visitError;

  const billedVisitIds = new Set(billedCharges.map((charge) => charge.visitId).filter(Boolean));
  const registrationCharges = ((visitData ?? []) as Record<string, unknown>[])
    .map((row) => {
      if (billedVisitIds.has(row.id as string)) return null;
      const patient = (row.patients ?? {}) as Record<string, unknown>;
      const visitDate = (row.visit_date as string) ?? '';
      if (!visitDate) return null;
      const category = normalizeDialysisCategory(patient.corporate);
      return {
        visitId: (row.id as string) ?? null,
        amount: dialysisRate(category),
        sessions: 1,
        visitDate,
        patientName: (patient.name as string) ?? 'Unknown',
        patientsId: (patient.patients_id as string) ?? null,
        patientUuid: (patient.id as string) ?? null,
        category,
        source: 'manual',
      } as DialysisCharge;
    })
    .filter((c): c is DialysisCharge => c !== null);

  return [...billedCharges, ...manualCharges, ...registrationCharges];
}

export function ymKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function currentMonthKey(): string {
  return ymKey(new Date());
}

export function addMonths(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  return ymKey(new Date(y, (m - 1) + delta, 1));
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

export function isDue(month: string, payAfterMonths: number): boolean {
  return addMonths(month, payAfterMonths) <= currentMonthKey();
}

export function dueMonth(month: string, payAfterMonths: number): string {
  return addMonths(month, payAfterMonths);
}

export function groupByPatient(chargesInMonth: readonly DialysisCharge[]): PatientRow[] {
  const map = new Map<string, PatientRow>();
  for (const c of chargesInMonth) {
    const key = c.patientsId ?? `name:${c.patientName}`;
    const existing = map.get(key);
    if (existing) {
      existing.price += c.amount;
      existing.sessions += c.sessions;
      if (existing.category === 'Category Missing' && c.category !== 'Category Missing') existing.category = c.category;
      if (!existing.patientUuid && c.patientUuid) existing.patientUuid = c.patientUuid;
      if (c.visitDate < existing.date) existing.date = c.visitDate;
    } else {
      map.set(key, {
        key,
        patientName: c.patientName,
        patientsId: c.patientsId,
        patientUuid: c.patientUuid,
        date: c.visitDate,
        price: c.amount,
        sessions: c.sessions,
        category: c.category,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.price - a.price);
}