import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Answers one question about a claim off the ESIC portal: is this our patient?
//
// The ESIC sheet identifies a beneficiary by their ESIC UHID (MH01.0019512652)
// and a name. Neither is our own patient ID — patients.patients_id is the
// hospital's own number (UHHO25F28014) and never equals the ESIC one. The only
// place the ESIC UHID is recorded on our side is visits.esic_uh_id.
//
// WHY A NAME IS ONLY EVER A "POSSIBLE" MATCH
// esic_uh_id is filled in on a minority of visits, so most claims will not match
// on it, and the temptation is to fall back to the name. But a name is not an
// identifier: this database holds several patients who share one. A confident
// match on a name would attach an ESIC query to the wrong person's record, so a
// name hit is reported as possible and never as found, and a name shared by more
// than one patient is reported as ambiguous rather than resolved by picking.

export type ClaimMatchStatus = 'found' | 'possible' | 'ambiguous' | 'none';

export interface ClaimPatientMatch {
  status: ClaimMatchStatus;
  /** How the match was made, for the label shown to the user. */
  matchedOn: 'uhid' | 'name' | null;
  patientName: string | null;
  /** The hospital's own patient number, e.g. UHHO25F28014. */
  patientsId: string | null;
  visitId: string | null;
  admissionDate: string | null;
  dischargeDate: string | null;
  /** How many patients share the name, when that is why it is ambiguous. */
  sharedBy: number;
}

const NOT_FOUND: ClaimPatientMatch = {
  status: 'none',
  matchedOn: null,
  patientName: null,
  patientsId: null,
  visitId: null,
  admissionDate: null,
  dischargeDate: null,
  sharedBy: 0,
};

// Stored ESIC UHIDs are inconsistent — both "SOMN.0000058527" and
// "SOMN0000050606" occur — so compare them stripped of punctuation and case.
const normalizeUhid = (value: string | null | undefined) =>
  (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Names arrive with honorifics and stray punctuation: "Mr. Suraj Madhukar
// Thete ." on the sheet against "SURAJ MADHUKAR THETE" here.
const normalizeName = (value: string | null | undefined) =>
  (value || '')
    .toLowerCase()
    .replace(/^\s*(mr|mrs|ms|master|dr|smt|shri)\.?\s+/, '')
    .replace(/[^a-z]/g, '');

export interface EsicVisit {
  visitId: string | null;
  patientName: string | null;
  patientsId: string | null;
  admissionDate: string | null;
  dischargeDate: string | null;
}

/**
 * Every visit carrying an ESIC UHID, keyed by that UHID normalised.
 *
 * Loaded once and shared: the worklist asks this question for every row it
 * shows, and a query per row would be dozens of identical round trips for a
 * table that is only ~42 rows long in total.
 */
export function useEsicVisitIndex() {
  return useQuery<Map<string, EsicVisit>>({
    queryKey: ['esic-visit-index'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visits')
        .select('visit_id, esic_uh_id, admission_date, discharge_date, patients(name, patients_id)')
        .neq('esic_uh_id', '')
        .not('esic_uh_id', 'is', null)
        .limit(2000);
      if (error) throw error;

      const index = new Map<string, EsicVisit>();
      (data || []).forEach((v: any) => {
        const key = normalizeUhid(v.esic_uh_id);
        // Keyed on the normalised UHID because the stored values vary in
        // punctuation; there is no normalised column to match on.
        if (!key || index.has(key)) return;
        index.set(key, {
          visitId: v.visit_id ?? null,
          patientName: v.patients?.name ?? null,
          patientsId: v.patients?.patients_id ?? null,
          admissionDate: v.admission_date ?? null,
          dischargeDate: v.discharge_date ?? null,
        });
      });
      return index;
    },
  });
}

/** Look one claim up in an already-loaded index. No query of its own. */
export const lookupEsicVisit = (
  index: Map<string, EsicVisit> | undefined,
  uhid: string | null | undefined,
): EsicVisit | null => {
  const key = normalizeUhid(uhid);
  if (!key || !index) return null;
  return index.get(key) || null;
};

export function useClaimPatientMatch(
  uhid: string | null | undefined,
  patientName: string | null | undefined,
) {
  // Shares the index with the worklist, so opening a claim costs no extra
  // round trip for the UHID half of the answer.
  const { data: index, isLoading: indexLoading } = useEsicVisitIndex();

  const query = useQuery<ClaimPatientMatch>({
    queryKey: ['claim-patient-match', uhid, patientName, Boolean(index)],
    enabled: Boolean(index) && Boolean(uhid || patientName),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // 1. The ESIC UHID on a visit. Exact, so a hit here is stated plainly.
      const hit = lookupEsicVisit(index, uhid);
      if (hit) {
        return {
          status: 'found',
          matchedOn: 'uhid',
          patientName: hit.patientName,
          patientsId: hit.patientsId,
          visitId: hit.visitId,
          admissionDate: hit.admissionDate,
          dischargeDate: hit.dischargeDate,
          sharedBy: 0,
        };
      }

      // 2. The name. Only useful when exactly one patient carries it.
      const wantedName = normalizeName(patientName);
      if (!wantedName) return NOT_FOUND;

      // Match on the first and last word so middle names and spelling of the
      // patronymic do not have to agree exactly; the count below is what keeps
      // a loose match from being asserted.
      const words = (patientName || '').trim().split(/\s+/).filter(Boolean);
      const anchor = words[words.length - 1]?.replace(/[^A-Za-z]/g, '') || '';
      if (anchor.length < 3) return NOT_FOUND;

      const { data: patients, error } = await supabase
        .from('patients')
        .select('name, patients_id')
        .ilike('name', `%${anchor}%`)
        .limit(200);
      if (error) throw error;

      const exact = (patients || []).filter(
        (p: any) => normalizeName(p.name) === wantedName,
      );
      if (exact.length === 1) {
        return {
          ...NOT_FOUND,
          status: 'possible',
          matchedOn: 'name',
          patientName: exact[0].name,
          patientsId: exact[0].patients_id,
        };
      }
      if (exact.length > 1) {
        return { ...NOT_FOUND, status: 'ambiguous', matchedOn: 'name', sharedBy: exact.length };
      }
      return NOT_FOUND;
    },
  });

  return { ...query, isLoading: indexLoading || query.isLoading };
}
