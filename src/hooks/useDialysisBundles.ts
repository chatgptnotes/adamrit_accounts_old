import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { loadDialysisPatients } from '@/lib/dialysis/scheme';
import { fetchLastLabDates } from '@/lib/nephroplus/dialysisTracker';
import { buildBundleRows, type DialysisBundleRow } from '@/lib/dialysis/bundle';

export const DIALYSIS_BUNDLE_QUERY_KEY = 'dialysis-bundles';

/**
 * Every dialysis patient's bundle for the active hospital.
 *
 * Both halves come from the modules that already own them, so this adds no new
 * source of truth:
 *
 *   * sessions, scheme and billed state — loadDialysisPatients (scheme.ts),
 *     the same loader the dialysis billing and Rakesh tiles use;
 *   * the latest lab report — fetchLastLabDates, which reads lab_results and
 *     stitches it to the patient through visits by hand, because
 *     lab_results.visit_id carries no foreign key.
 */
export function useDialysisBundles() {
  const { hospitalConfig } = useAuth();

  const query = useQuery({
    queryKey: [DIALYSIS_BUNDLE_QUERY_KEY, hospitalConfig.name],
    staleTime: 60_000,
    queryFn: async (): Promise<DialysisBundleRow[]> => {
      const patients = await loadDialysisPatients(hospitalConfig.name);
      // A rejected lab read must not quietly become "no lab report on file" --
      // that would tell the desk to chase a report the patient already has.
      const lastLabDates = await fetchLastLabDates(patients.map((p) => p.patientId));
      return buildBundleRows(patients, lastLabDates);
    },
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);

  const counts = useMemo(
    () => ({
      total: rows.length,
      completed: rows.filter((r) => r.bundleComplete).length,
      inProgress: rows.filter((r) => r.status === 'In progress').length,
      awaitingBilling: rows.filter((r) => r.bundlesAwaitingBilling > 0).length,
      labsDue: rows.filter((r) => r.labDue).length,
      noBundle: rows.filter((r) => !r.hasBundle).length,
    }),
    [rows],
  );

  return {
    rows,
    ...counts,
    loading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
