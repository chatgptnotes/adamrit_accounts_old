import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// The marketing users who liaison relationship managers.
//
// Read through v_marketing_liaisons rather than the User table: the report
// that shows these names is opened across the office, and the lockdown on
// "User" is written and will land. The view exposes an id and a display name
// and nothing else.

export interface MarketingLiaison {
  id: string;
  name: string;
}

export function useMarketingLiaisons() {
  const query = useQuery({
    queryKey: ['marketing-liaisons'],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<MarketingLiaison[]> => {
      const { data, error } = await (supabase as any)
        .from('v_marketing_liaisons')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return (data || []) as MarketingLiaison[];
    },
  });
  return query.data ?? [];
}

/** id → name, for stamping a liaison onto report rows. */
export function useMarketingLiaisonNames(): Record<string, string> {
  const liaisons = useMarketingLiaisons();
  const map: Record<string, string> = {};
  for (const liaison of liaisons) map[liaison.id] = liaison.name;
  return map;
}
