import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';

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

export interface NamedPatient {
  patientsId: string | null;
  name: string;
}

/**
 * Every patient keyed by their name normalised, so a claim with no ESIC UHID on
 * any visit can still be placed. Names that more than one patient carries keep
 * all of them: that a name is shared is the answer, not a problem to resolve by
 * picking the first.
 *
 * The whole table is ~5,500 rows of two columns. Paged through once and cached,
 * because the alternative is a query per row of the worklist.
 */
export function usePatientNameIndex() {
  return useQuery<Map<string, NamedPatient[]>>({
    queryKey: ['patient-name-index'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const rows = await fetchAllRows<{ name: string | null; patients_id: string | null }>(
        (from, to) =>
          supabase.from('patients').select('name, patients_id').range(from, to),
      );
      const index = new Map<string, NamedPatient[]>();
      rows.forEach(r => {
        const key = normalizeName(r.name);
        if (!key) return;
        const list = index.get(key) || [];
        list.push({ patientsId: r.patients_id, name: r.name || '' });
        index.set(key, list);
      });
      return index;
    },
  });
}

/** Look one claim up in an already-loaded index. No query of its own. */
export const lookupPatientsByName = (
  index: Map<string, NamedPatient[]> | undefined,
  patientName: string | null | undefined,
): NamedPatient[] => {
  const key = normalizeName(patientName);
  if (!key || !index) return [];
  return index.get(key) || [];
};

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
  const { data: nameIndex, isLoading: namesLoading } = usePatientNameIndex();

  const query = useQuery<ClaimPatientMatch>({
    queryKey: ['claim-patient-match', uhid, patientName, Boolean(index), Boolean(nameIndex)],
    enabled: Boolean(index) && Boolean(nameIndex) && Boolean(uhid || patientName),
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
      const named = lookupPatientsByName(nameIndex, patientName);
      if (named.length === 1) {
        return {
          ...NOT_FOUND,
          status: 'possible',
          matchedOn: 'name',
          patientName: named[0].name,
          patientsId: named[0].patientsId,
        };
      }
      if (named.length > 1) {
        return { ...NOT_FOUND, status: 'ambiguous', matchedOn: 'name', sharedBy: named.length };
      }
      return NOT_FOUND;
    },
  });

  return { ...query, isLoading: indexLoading || namesLoading || query.isLoading };
}
