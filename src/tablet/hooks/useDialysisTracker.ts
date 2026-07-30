import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { loadDialysisTracker, type DialysisTrackerRow } from "@/lib/nephroplus/dialysisTracker";

export const DIALYSIS_QUERY_KEY = "tablet-dialysis";

/**
 * Every dialysis patient for the active hospital, with how many cycles are
 * waiting to be billed and whether their 30-day lab report is overdue.
 * Shared by the Dialysis tile badge and the Dialysis module.
 */
export function useDialysisTracker() {
  const { hospitalConfig } = useAuth();
  const query = useQuery({
    queryKey: [DIALYSIS_QUERY_KEY, hospitalConfig.name],
    queryFn: () => loadDialysisTracker(hospitalConfig.name),
    staleTime: 60_000,
  });

  const rows: DialysisTrackerRow[] = useMemo(() => query.data ?? [], [query.data]);

  const counts = useMemo(() => {
    const billsDue = rows.filter((r) => r.billsDue > 0).length;
    const labsDue = rows.filter((r) => r.labDue).length;
    return {
      billsDue,
      labsDue,
      // Patients needing either — what the home-screen badge shows.
      actionCount: rows.filter((r) => r.billsDue > 0 || r.labDue).length,
    };
  }, [rows]);

  return {
    rows,
    ...counts,
    loading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
