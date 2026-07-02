
// @ts-nocheck

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from 'use-debounce';
import { supabase } from '@/integrations/supabase/client';
import { useDiagnoses } from './useDiagnoses';
import { usePatientOperations } from './usePatientOperations';
import { transformPatientsData, groupVisitRowsByPatient } from '@/utils/patientDataTransformer';
import { useAuth } from '@/contexts/AuthContext';

const PATIENT_FIELDS = `
  id,
  name,
  age,
  gender,
  patients_id,
  insurance_person_no,
  hospital_name`;

const VISIT_FIELDS = `
  id,
  visit_id,
  visit_date,
  admission_date,
  surgery_date,
  discharge_date,
  sr_no,
  bunch_no,
  status,
  sst_treatment,
  intimation_done,
  cghs_code,
  package_amount,
  billing_executive,
  extension_taken,
  delay_waiver_intimation,
  surgical_approval,
  remark1,
  remark2`;

const VISIT_EMBEDS = `
  visit_surgeries(
    id,
    status,
    sanction_status,
    cghs_surgery(
      id,
      name,
      code,
      description,
      category
    )
  ),
  visit_complications(
    complications!complication_id(
      id,
      name
    )
  ),
  visit_esic_surgeons(
    esic_surgeons!surgeon_id(
      id,
      name
    )
  ),
  visit_referees(
    referees!referee_id(
      id,
      name
    )
  ),
  visit_hope_surgeons(
    hope_surgeons!surgeon_id(
      id,
      name
    )
  ),
  visit_hope_consultants(
    hope_consultants!consultant_id(
      id,
      name
    )
  ),
  visit_diagnoses(
    id,
    is_primary,
    diagnoses(
      id,
      name
    )
  )`;

// The original patients-first select shape, shared by the full-load branch and
// the all-dates search query.
const PATIENTS_WITH_VISITS_SELECT = `
  ${PATIENT_FIELDS},
  visits(
    ${VISIT_FIELDS},
    ${VISIT_EMBEDS}
  )`;

export interface PatientsDateRange {
  from: string; // 'yyyy-MM-dd'
  to?: string; // 'yyyy-MM-dd'; absent = open-ended
}

export interface UsePatientsOptions {
  // When set, only visits in this range (plus patients registered in-range
  // with no visits) are loaded. Undefined = original full load.
  dateRange?: PatientsDateRange;
  // Raw search input; debounced here. At >=2 chars an additional hospital-wide
  // search (all dates) is merged into the result so the date window never
  // hides a searched-for patient. Only active when dateRange is set.
  searchTerm?: string;
  // Set false when a consumer only needs diagnoses/mutations (skips the
  // patients list query entirely).
  listEnabled?: boolean;
}

export const usePatients = (options: UsePatientsOptions = {}) => {
  const { dateRange, searchTerm = '', listEnabled = true } = options;
  const { hospitalConfig } = useAuth();
  const {
    diagnoses,
    isLoading: diagnosesLoading,
    addDiagnosis,
    isAddingDiagnosis
  } = useDiagnoses();

  // Hospital filtering: map config name to DB hospital_name value
  const hospitalFilter = hospitalConfig.name === 'ayushman' ? 'ayushman' : 'hope';

  const rangeKey = dateRange ? `${dateRange.from}_${dateRange.to ?? 'open'}` : null;

  const { data: patients = [], isLoading: patientsLoading } = useQuery({
    // Same key as before when no range is set (Patients.tsx cache unchanged);
    // range-scoped loads get their own key. Both are prefix-invalidated by the
    // ['patients', hospitalFilter] invalidations in usePatientOperations.
    queryKey: rangeKey ? ['patients', hospitalFilter, rangeKey] : ['patients', hospitalFilter],
    enabled: listEnabled,
    queryFn: async () => {
      if (!dateRange) {
        // Original full load: every patient with all visits.
        let query = supabase
          .from('patients')
          .select(PATIENTS_WITH_VISITS_SELECT);

        // Apply hospital filtering based on hospital_name column.
        // Abort after 8s so a slow/unreachable DB fails fast instead of hanging ~20s+.
        query = query
          .eq('hospital_name', hospitalFilter)
          .order('name')
          .abortSignal(AbortSignal.timeout(8000));

        const { data, error } = await query;

        if (error) {
          console.error('Error fetching patients:', error);
          throw error;
        }

        return data;
      }

      // Date-scoped load, visits-first (same template as TodaysIpdDashboard):
      // only visits inside the range, with their patient via inner join.
      let visitsQuery = supabase
        .from('visits')
        .select(`${VISIT_FIELDS}, patients!inner(${PATIENT_FIELDS}), ${VISIT_EMBEDS}`)
        .eq('patients.hospital_name', hospitalFilter)
        .gte('visit_date', `${dateRange.from}T00:00:00`);
      if (dateRange.to) {
        visitsQuery = visitsQuery.lte('visit_date', `${dateRange.to}T23:59:59`);
      }
      visitsQuery = visitsQuery.abortSignal(AbortSignal.timeout(8000));

      // Patients registered in-range with no visits yet still get their
      // "No Surgery Assigned" card. created_at is timestamptz (UTC), so
      // convert local midnight to ISO — naive strings would miss anyone
      // registered between 00:00 and 05:30 IST.
      const fromIso = new Date(`${dateRange.from}T00:00:00`).toISOString();
      const toIso = dateRange.to
        ? new Date(`${dateRange.to}T23:59:59.999`).toISOString()
        : undefined;
      let newPatientsQuery = supabase
        .from('patients')
        .select(`${PATIENT_FIELDS}, visits(id)`)
        .eq('hospital_name', hospitalFilter)
        .gte('created_at', fromIso);
      if (toIso) {
        newPatientsQuery = newPatientsQuery.lte('created_at', toIso);
      }
      newPatientsQuery = newPatientsQuery.abortSignal(AbortSignal.timeout(8000));

      const [visitsRes, newPatientsRes] = await Promise.all([visitsQuery, newPatientsQuery]);
      if (visitsRes.error) {
        console.error('Error fetching visits for date range:', visitsRes.error);
        throw visitsRes.error;
      }
      if (newPatientsRes.error) {
        console.error('Error fetching new patients for date range:', newPatientsRes.error);
        throw newPatientsRes.error;
      }

      const grouped = groupVisitRowsByPatient(visitsRes.data || []);
      const groupedIds = new Set(grouped.map(p => p.id));
      const noVisitPatients = (newPatientsRes.data || [])
        .filter(p => (!p.visits || p.visits.length === 0) && !groupedIds.has(p.id))
        .map(p => ({ ...p, visits: [] }));

      return [...grouped, ...noVisitPatients];
    },
    // Don't retry a failing/timed-out query — retries multiply the wait time.
    retry: 0,
  });

  // All-dates search: lets staff find any patient by name/ID/phone even while
  // the list is date-scoped. Debounced so it fires once per typed term.
  const [debouncedSearch] = useDebounce(searchTerm.trim(), 500);
  // Strip PostgREST .or() delimiters so a typed comma/paren can't break the filter.
  const safeSearch = debouncedSearch.replace(/[,()]/g, '');
  const searchActive = listEnabled && !!dateRange && safeSearch.length >= 2;

  const { data: searchResults = [] } = useQuery({
    queryKey: ['patients', hospitalFilter, 'search', safeSearch],
    enabled: searchActive,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('patients')
        .select(PATIENTS_WITH_VISITS_SELECT)
        .eq('hospital_name', hospitalFilter)
        .or(`name.ilike.%${safeSearch}%,patients_id.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%`)
        .order('name')
        .limit(50)
        .abortSignal(AbortSignal.timeout(8000));

      if (error) {
        console.error('Error searching patients:', error);
        throw error;
      }

      return data || [];
    },
    retry: 0,
  });

  const {
    addPatient,
    updatePatient,
    deletePatient,
    isAddingPatient,
    isUpdatingPatient,
    isDeletingPatient
  } = usePatientOperations(diagnoses);

  // Merge search hits (full history) into the window, dedup by patient UUID —
  // search rows win since they carry all of the patient's visits. Then
  // transform to the original grouped-card structure.
  const patientsByDiagnosis = useMemo(() => {
    let merged = patients;
    if (searchActive && searchResults.length > 0) {
      const searchIds = new Set(searchResults.map(p => p.id));
      merged = [...searchResults, ...patients.filter(p => !searchIds.has(p.id))];
    }
    return transformPatientsData(merged);
  }, [patients, searchResults, searchActive]);

  return {
    diagnoses,
    patients: patientsByDiagnosis,
    isLoading: diagnosesLoading || patientsLoading,
    addPatient,
    updatePatient,
    deletePatient,
    addDiagnosis,
    isAddingPatient,
    isUpdatingPatient,
    isDeletingPatient,
    isAddingDiagnosis
  };
};
