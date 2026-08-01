import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Company {
  id: string;
  company_key: string;
  company_name: string;
  company_type: string;
  owner_partners: string | null;
  address_line1: string | null;
  address_line2: string | null;
  is_active: boolean;
}

export const useCompanies = () => {
  return useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('companies')
        .select('*')
        .eq('is_active', true)
        .order('company_name');

      if (error) throw error;
      return (data || []) as Company[];
    },
    staleTime: 10 * 60 * 1000,
  });
};
