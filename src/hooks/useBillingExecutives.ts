import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Who can be named as the billing executive on a visit.
 *
 * This was two identical arrays of 31 names typed into TodaysIpdDashboard, and
 * the trouble with a typed list is that it is wrong the day somebody joins and
 * nobody notices. It already was: "Neesha" is on 13 visits and was not in the
 * list at all, so the person who entered those visits could not pick her name
 * a second time — the list offered "Nisha" instead.
 *
 * Two different questions, so two lists:
 *
 *   inUse   the distinct names already recorded on visits. This is the right
 *           list for a FILTER, where offering a name nobody has been recorded
 *           against returns an empty screen, and where a name that exists in
 *           the data must always be selectable however it was spelled.
 *
 *   all     those names plus active staff, for the PICKER, so somebody who has
 *           never billed before can still be chosen without a code change.
 *
 * Names already in the data are never dropped, whatever the User table says.
 * Losing one would make historical visits unfilterable and quietly invite a
 * second spelling of the same person.
 */

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Case-insensitive de-duplication that keeps the spelling already in the data. */
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

export function useBillingExecutives() {
  const query = useQuery({
    queryKey: ['billing-executives'],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<{ inUse: string[]; all: string[] }> => {
      const [visits, users] = await Promise.all([
        (supabase as any)
          .from('visits')
          .select('billing_executive')
          .not('billing_executive', 'is', null)
          .limit(5000),
        (supabase as any)
          .from('User')
          .select('full_name, is_active')
          .not('full_name', 'is', null)
          .limit(500),
      ]);
      if (visits.error) throw new Error(visits.error.message);

      const inUse = merge(
        [...new Set((visits.data ?? []).map((v: any) => clean(v.billing_executive)).filter(Boolean))],
        [],
      );

      // A failure to read staff must not empty the picker — the names already
      // in the data are enough to keep working with.
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
