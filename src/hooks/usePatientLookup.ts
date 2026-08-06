import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from 'use-debounce';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Patient, SearchCriteria } from '@/components/PatientLookup/types/patientLookup';

/** Two letters is enough to start listing matches. */
const AUTO_SEARCH_MIN_CHARS = 2;

/**
 * Shared patient-search logic. Extracted verbatim from PatientLookupDialog so
 * the desktop dialog and the tablet patient picker run one query path.
 * The query is hospital-scoped (`hospital_name`) and kept in the query key.
 *
 * With `autoSearch`, typing runs the search itself once the term reaches two
 * characters — the button stays, but nobody has to reach for it.
 */
export function usePatientLookup(
  hospitalNameOverride?: string,
  options?: { autoSearch?: boolean },
) {
  const { hospitalConfig } = useAuth();
  const hospitalName = hospitalNameOverride || hospitalConfig.name;
  const [criteria, setCriteria] = useState<SearchCriteria>({
    mobile: '',
    name: '',
    patientId: '',
    aadhaar: '',
  });
  const [hasSearched, setHasSearched] = useState(false);
  const [debouncedCriteria] = useDebounce(criteria, 250);

  const autoTerm =
    debouncedCriteria.mobile ||
    debouncedCriteria.name ||
    debouncedCriteria.patientId ||
    debouncedCriteria.aadhaar ||
    '';
  const autoEnabled = !!options?.autoSearch && autoTerm.trim().length >= AUTO_SEARCH_MIN_CHARS;

  useEffect(() => {
    if (autoEnabled) setHasSearched(true);
  }, [autoEnabled, autoTerm]);

  const { data: patients = [], isLoading, refetch } = useQuery({
    queryKey: [
      'patient-lookup',
      debouncedCriteria.mobile,
      debouncedCriteria.name,
      debouncedCriteria.patientId,
      debouncedCriteria.aadhaar,
      hospitalName,
    ],
    queryFn: async (): Promise<Patient[]> => {
      const criteria = debouncedCriteria;
      if (!criteria.mobile && !criteria.name && !criteria.patientId && !criteria.aadhaar) {
        return [];
      }

      let query = supabase
        .from('patients')
        .select('*')
        .eq('hospital_name', hospitalName)
        .order('created_at', { ascending: false });

      if (criteria.mobile) {
        // Real phone-number search against the stored `phone` column
        // (digits only, partial match so a few digits still find the patient).
        const digits = criteria.mobile.replace(/\D/g, '');
        query = query.ilike('phone', `%${digits}%`);
      }
      if (criteria.name) {
        query = query.ilike('name', `%${criteria.name}%`);
      }
      if (criteria.patientId) {
        query = query.or(`patients_id.ilike.%${criteria.patientId}%`);
      }
      if (criteria.aadhaar) {
        // Search the dedicated column AND the legacy combined Aadhar/Passport
        // field so existing patients remain findable by their Aadhaar.
        const digits = criteria.aadhaar.replace(/\D/g, '');
        query = query.or(
          `aadhaar_number.ilike.%${digits}%,aadhar_passport.ilike.%${digits}%`
        );
      }

      const { data, error } = await query.limit(10);
      if (error) {
        console.error('Error searching patients:', error);
        throw error;
      }

      return (data || []) as Patient[];
    },
    // Runs itself while typing when autoSearch is on; otherwise search() only.
    enabled: autoEnabled,
  });

  const search = useCallback(() => {
    setHasSearched(true);
    refetch();
  }, [refetch]);

  const hasCriteria = !!(criteria.mobile || criteria.name || criteria.patientId || criteria.aadhaar);
  // While the debounce is still settling the results belong to the previous
  // keystroke, so "no results" would be answering a question not yet asked.
  const settled =
    criteria.mobile === debouncedCriteria.mobile &&
    criteria.name === debouncedCriteria.name &&
    criteria.patientId === debouncedCriteria.patientId &&
    criteria.aadhaar === debouncedCriteria.aadhaar;
  const showNoResults =
    hasSearched && patients.length === 0 && !isLoading && hasCriteria && settled;

  return {
    criteria,
    setCriteria,
    patients,
    isLoading,
    hasSearched,
    hasCriteria,
    showNoResults,
    search,
    refetch,
  };
}
