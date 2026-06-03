import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Row counts for every Masters-section sidebar tab, so each shows how many
 * items its list holds. Keyed by the menu item title. Counts are exact
 * head-counts (no rows transferred) and fail safe to 0 like useCounts.
 *
 * Several of these tables are absent from the stale generated Supabase types,
 * so we query through an untyped client (same approach as useDirectorKpis).
 */
const sb = supabase as unknown as { from: (table: string) => any };

// Masters menu title -> the table whose rows it lists.
export const MASTER_TABLE_BY_TITLE: Record<string, string> = {
  'Lab Master': 'lab',
  'Radiology Master': 'radiology',
  'Surgery': 'cghs_surgery',
  'Implant Master': 'implants',
  'Diagnoses': 'diagnoses',
  'Complications': 'complications',
  'Mandatory Service': 'mandatory_services',
  'Clinical Services': 'clinical_services',
  'Referees': 'referees',
  'Relationship Manager': 'relationship_managers',
  'Hope Surgeons': 'hope_surgeons',
  'Hope Consultants': 'hope_consultants',
  'Hope Anaesthetists': 'hope_anaesthetists',
  'PMJAY / MJPJAY Master': 'pmjay_mjpjay_packages',
  'Ayushman Surgeons': 'ayushman_surgeons',
  'Ayushman Consultants': 'ayushman_consultants',
  'Ayushman Anaesthetists': 'ayushman_anaesthetists',
  'Hope RMOs': 'hope_rmos',
  'Ayushman RMOs': 'ayushman_rmos',
  'Corporate Master': 'corporate_master',
  'Location Master': 'corporate_areas',
  'User Management': 'User',
};

async function countTable(table: string): Promise<number> {
  try {
    const { count, error } = await sb
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error) {
      console.error(`Error counting ${table}:`, error);
      return 0;
    }
    return count || 0;
  } catch (error) {
    console.error(`Error in ${table} count query:`, error);
    return 0;
  }
}

export const useMasterCounts = (enabled: boolean = true): Record<string, number> => {
  const { data = {} } = useQuery<Record<string, number>>({
    queryKey: ['master-counts'],
    queryFn: async () => {
      const titles = Object.keys(MASTER_TABLE_BY_TITLE);
      const counts = await Promise.all(
        titles.map(title => countTable(MASTER_TABLE_BY_TITLE[title])),
      );
      const result: Record<string, number> = {};
      titles.forEach((title, i) => {
        result[title] = counts[i];
      });
      return result;
    },
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  return data;
};
