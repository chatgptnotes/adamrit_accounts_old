import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { isMlUnlocked, ML_COMPANY_KEY, subscribeMlLock } from '@/lib/ml-lock';

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
  // M.L. Enterprises stays hidden from every company list until the super
  // admin unlocks it (F3 company list → its locked row asks the password).
  // Subscribed, so Lock/Unlock takes effect on the spot.
  const mlUnlocked = useSyncExternalStore(subscribeMlLock, isMlUnlocked);
  return useQuery({
    queryKey: ['companies', mlUnlocked],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('companies')
        .select('*')
        .eq('is_active', true)
        .order('company_name');

      if (error) throw error;
      const companies = (data || []) as Company[];
      return mlUnlocked
        ? companies
        : companies.filter((c) => c.company_key !== ML_COMPANY_KEY);
    },
    staleTime: 10 * 60 * 1000,
  });
};
