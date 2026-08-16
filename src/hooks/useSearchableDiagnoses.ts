
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const useSearchableDiagnoses = () => {
  const [searchTerm, setSearchTerm] = useState('');

  const { data: diagnoses = [], isLoading } = useQuery({
    queryKey: ['diagnoses', searchTerm],
    queryFn: async () => {
      let query = supabase
        .from('diagnoses')
        .select('*')
        .order('name');

      if (searchTerm) {
        // Also by ICD-11 code, so someone holding a coded referral or claim can
        // type the code and find the diagnosis it was mapped to. Diagnoses with
        // no code yet are unaffected — they still match on name as before.
        const term = searchTerm.replace(/[%,()]/g, '');
        query = query.or(`name.ilike.%${term}%,icd11_code.ilike.%${term}%`);
      }

      const { data, error } = await query;
      
      if (error) {
        console.error('Error fetching diagnoses:', error);
        throw error;
      }
      
      return data;
    }
  });

  return {
    diagnoses,
    isLoading,
    searchTerm,
    setSearchTerm
  };
};
