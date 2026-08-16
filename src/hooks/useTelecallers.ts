import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Who can be named as the telecaller on a call record.
 *
 * This was ['Dolly', 'Nisha', 'Diksha'] typed into PatientOverview as component
 * state, which had two faults. The names shipped to anybody who opened the
 * site, because that page is in the eager bundle. And "Add telecaller" only
 * pushed onto the local array, so a name added on Monday was gone on Tuesday
 * and had to be typed again — or typed slightly differently, which is how one
 * person becomes two in a report.
 *
 * The names now come from the call records themselves, so anyone who has ever
 * been recorded stays selectable however their name was spelled, and from
 * active staff, so somebody new can be picked without editing code.
 *
 * Deliberately the same shape as useBillingExecutives: the two answer the same
 * question about different columns, and a second pattern for it would be a
 * second thing to keep right.
 */

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Case-insensitive de-duplication that keeps the spelling already recorded. */
const merge = (preferred: string[], extra: string[]): string[] => {
  const seen = new Map<string, string>();
  for (const name of preferred) {
    if (name) seen.set(name.toLowerCase(), name);
  }
  for (const name of extra) {
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
};

export function useTelecallers() {
  const query = useQuery({
    // Namespaced for the same reason as useBillingExecutives: this hook
    // returns an object, and a bare noun is exactly the key a page is likely
    // to have already used for a plain list.
    queryKey: ['telecaller-options'],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<{ inUse: string[]; all: string[] }> => {
      const [records, users] = await Promise.all([
        (supabase as any)
          .from('patient_call_records')
          .select('telecaller_name')
          .not('telecaller_name', 'is', null)
          .limit(5000),
        (supabase as any)
          .from('User')
          .select('full_name, is_active')
          .not('full_name', 'is', null)
          .limit(500),
      ]);
      if (records.error) throw new Error(records.error.message);

      const inUse = merge(
        [...new Set((records.data ?? []).map((r: any) => clean(r.telecaller_name)).filter(Boolean))],
        [],
      );

      // A failure to read staff must not empty the list — the names already on
      // call records are enough to carry on with.
      const staff = users.error
        ? []
        : (users.data ?? [])
            .filter((u: any) => u.is_active !== false)
            .map((u: any) => clean(u.full_name))
            .filter(Boolean);

      return { inUse, all: merge(inUse, staff) };
    },
  });

  return {
    inUse: query.data?.inUse ?? [],
    all: query.data?.all ?? [],
    isLoading: query.isLoading,
  };
}
