import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const useSearchableMedication = () => {
  const [searchTerm, setSearchTerm] = useState('');

  const { data: medications = [], isLoading } = useQuery({
    queryKey: ['medications', searchTerm],
    queryFn: async () => {
      // Results are only shown while a term is typed; don't fetch the
      // whole 23k-row table for a hidden dropdown.
      if (!searchTerm) return [];

      const { data, error } = await supabase
        .from('medication')
        .select('*')
        .or(`name.ilike.%${searchTerm}%,generic_name.ilike.%${searchTerm}%,category.ilike.%${searchTerm}%`)
        .order('name')
        .limit(50);
      
      
      if (error) {
        console.error('Error fetching medications:', error);
        throw error;
      }
      
      return data;
    }
  });

  return {
    medications,
    isLoading,
    searchTerm,
    setSearchTerm
  };
};