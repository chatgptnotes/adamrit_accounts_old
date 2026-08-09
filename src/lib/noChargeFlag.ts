import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// "Do not charge this patient" — set on the Vasooli (Gaurav) tile, read by
// every screen that takes money.
//
// Two situations share one flag. PACKAGE means the whole cost was already
// collected from the patient as a package, so charging again is charging
// twice. VIP means do not bill at all — the hospital may owe them.
//
// One active flag per patient, enforced by a partial unique index. Lifting
// deactivates rather than deletes, so the history of who allowed what stays
// answerable.

export type NoChargeReason = 'PACKAGE' | 'VIP';

export interface NoChargeFlag {
  id: string;
  patient_id: string;
  reason: NoChargeReason;
  note: string | null;
  authorised_by: string;
  created_at: string;
}

export const NO_CHARGE_REASON_LABEL: Record<NoChargeReason, string> = {
  PACKAGE: 'Collected as package',
  VIP: 'VIP — amount owed',
};

const COLUMNS = 'id, patient_id, reason, note, authorised_by, created_at';

/** The live flag for one patient, or null. */
export function useNoChargeFlag(patientId: string | null | undefined) {
  return useQuery({
    queryKey: ['no-charge-flag', patientId || 'none'],
    enabled: Boolean(patientId),
    staleTime: 60_000,
    queryFn: async (): Promise<NoChargeFlag | null> => {
      const { data, error } = await (supabase as any)
        .from('patient_no_charge_flags')
        .select(COLUMNS)
        .eq('patient_id', patientId)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      return (data as NoChargeFlag) ?? null;
    },
  });
}

/**
 * Flags for a whole list, as patient_id → flag. One query for the page rather
 * than one per row, so a 200-patient collection list does not fire 200
 * requests.
 */
export function useNoChargeFlags(patientIds: Array<string | null | undefined>) {
  const ids = [...new Set(patientIds.filter(Boolean) as string[])].sort();
  return useQuery({
    queryKey: ['no-charge-flags', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, NoChargeFlag>> => {
      const map: Record<string, NoChargeFlag> = {};
      // PostgREST caps a URL's length, so ask in batches rather than one
      // enormous in() list.
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await (supabase as any)
          .from('patient_no_charge_flags')
          .select(COLUMNS)
          .in('patient_id', ids.slice(i, i + 200))
          .eq('is_active', true);
        if (error) throw error;
        for (const row of (data || []) as NoChargeFlag[]) map[row.patient_id] = row;
      }
      return map;
    },
  });
}

/**
 * The same flag, found from the printed UHID instead of the row id.
 *
 * Pharmacy billing identifies a patient by patients_id (the UHID on the card)
 * and never holds the UUID, so resolving it here keeps that screen from
 * having to thread an id through every way a patient can be picked.
 */
export function useNoChargeFlagByUhid(uhid: string | null | undefined, hospitalName?: string) {
  const code = (uhid || '').trim();
  return useQuery({
    queryKey: ['no-charge-flag-uhid', code, hospitalName || 'any'],
    enabled: code.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<NoChargeFlag | null> => {
      let patientQuery = (supabase as any)
        .from('patients')
        .select('id')
        .eq('patients_id', code);
      if (hospitalName) patientQuery = patientQuery.eq('hospital_name', hospitalName);
      const { data: patient, error: patientError } = await patientQuery.maybeSingle();
      if (patientError) throw patientError;
      if (!patient?.id) return null;

      const { data, error } = await (supabase as any)
        .from('patient_no_charge_flags')
        .select(COLUMNS)
        .eq('patient_id', patient.id)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      return (data as NoChargeFlag) ?? null;
    },
  });
}

/** Raises the flag, replacing whatever was live for this patient. */
export async function setNoChargeFlag(input: {
  patientId: string;
  reason: NoChargeReason;
  note?: string | null;
  authorisedBy: string;
  actor?: string | null;
}): Promise<void> {
  const authorisedBy = input.authorisedBy.trim();
  if (!authorisedBy) throw new Error('Enter who authorised this');

  // Lift any live flag first — the partial unique index allows only one, and
  // replacing it should read as a new decision, not an edit of the old one.
  await liftNoChargeFlag(input.patientId, input.actor);

  const { error } = await (supabase as any).from('patient_no_charge_flags').insert({
    patient_id: input.patientId,
    reason: input.reason,
    note: input.note?.trim() || null,
    authorised_by: authorisedBy,
    created_by: input.actor || null,
  });
  if (error) throw new Error(error.message);
}

/** Lifts the live flag, if there is one. Safe to call when there is not. */
export async function liftNoChargeFlag(
  patientId: string,
  actor?: string | null,
): Promise<void> {
  const { error } = await (supabase as any)
    .from('patient_no_charge_flags')
    .update({ is_active: false, lifted_at: new Date().toISOString(), lifted_by: actor || null })
    .eq('patient_id', patientId)
    .eq('is_active', true);
  if (error) throw new Error(error.message);
}
