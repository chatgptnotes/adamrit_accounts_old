import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { fetchAllByIn, fetchAllRows } from '@/utils/fetchAllRows';
import {
  VISIT_METRICS,
  getDateRange,
  type DateRange,
  type KpiPeriod,
} from '@/lib/director-metrics';
import type { HospitalType } from '@/types/hospital';

// Re-exported so existing callers keep importing these from here.
export { getDateRange };
export type { KpiPeriod };

export interface DirectorKpiData {
  admissions: number | null;
  discharges: number | null;
  opdVisits: number | null;
  collection: number | null;
  activeIpd: number | null;
  pendingApprovals: number | null;
}

// The generated Supabase types are stale — visits.is_discharged / patient_type and the
// advance_payment / final_payments tables are absent from them. Query through an untyped
// client, the way the rest of the app already does for these tables.
const sb = supabase as unknown as {
  from: (table: string) => any;
};

// A hospital-scoped exact-count query over visits (head:true → no rows transferred).
// The visits → patients !inner embed is proven (MarketingDashboard.tsx uses the same shape).
const visitCount = (hospitalType: string) =>
  sb
    .from('visits')
    .select('id, patients!inner(hospital_name)', { count: 'exact', head: true })
    .eq('patients.hospital_name', hospitalType);

async function fetchPeriodCounts(hospitalType: string, range: DateRange) {
  // Filters come from VISIT_METRICS so these counts and the drill lists that open when
  // a tile is tapped can never diverge.
  const [adm, dis, opd] = await Promise.all([
    VISIT_METRICS.admissions.apply(visitCount(hospitalType), range),
    VISIT_METRICS.discharges.apply(visitCount(hospitalType), range),
    VISIT_METRICS.opd.apply(visitCount(hospitalType), range),
  ]);
  if (adm.error) throw adm.error;
  if (dis.error) throw dis.error;
  if (opd.error) throw opd.error;

  return {
    admissions: adm.count ?? 0,
    discharges: dis.count ?? 0,
    opdVisits: opd.count ?? 0,
  };
}

/**
 * Of the payments given, the subset whose visit belongs to this hospital.
 *
 * advance_payment / final_payments have no usable PostgREST relationship to embed
 * through, so the hospital has to be resolved via visits. We look up only the visits the
 * period's payments actually reference — the reverse (pulling every visit for the
 * hospital) silently truncated at PostgREST's ~1000-row cap and under-reported the
 * Collection tile on any hospital with more visits than that.
 */
async function hospitalVisitIds(
  hospitalType: string,
  visitIds: string[],
): Promise<Set<string>> {
  const rows = await fetchAllByIn<{ visit_id: string }>(visitIds, (chunk) =>
    sb
      .from('visits')
      .select('visit_id, patients!inner(hospital_name)')
      .eq('patients.hospital_name', hospitalType)
      .in('visit_id', chunk)
      .order('visit_id', { ascending: true }),
  );
  return new Set(rows.map((r) => r.visit_id).filter(Boolean));
}

/**
 * Total money received in the period for the hospital = advance payments + final
 * payments. Both tables are queried plainly (no embeds — proven shapes from
 * DailyReconciliation.tsx and useFinancialSummary.ts) and then filtered to the
 * hospital's visits.
 */
async function fetchCollection(hospitalType: string, range: DateRange) {
  // Paged: a year-long period can exceed the 1000-row cap on either table.
  // `.order('id')` gives .range() a unique key so pages can't overlap or skip.
  const [advance, finalPay] = await Promise.all([
    fetchAllRows<{ advance_amount: number | null; visit_id: string | null }>(() =>
      sb
        .from('advance_payment')
        // The column is advance_amount — selecting a nonexistent `amount` fallback
        // 400s the whole request (42703) and blanks the Collection KPI.
        .select('advance_amount, visit_id')
        .eq('status', 'ACTIVE')
        .eq('is_refund', false)
        .gte('created_at', range.startISO)
        .lt('created_at', range.endISO)
        .order('id', { ascending: true }),
    ),
    fetchAllRows<{ amount: number | null; visit_id: string | null }>(() =>
      sb
        .from('final_payments')
        .select('amount, visit_id')
        .gte('created_at', range.startISO)
        .lt('created_at', range.endISO)
        .order('id', { ascending: true }),
    ),
  ]);

  const referenced = [...advance, ...finalPay]
    .map((r) => r.visit_id)
    .filter((v): v is string => !!v);
  if (referenced.length === 0) return 0;

  const owned = await hospitalVisitIds(hospitalType, referenced);

  const advanceTotal = advance
    .filter((r) => r.visit_id && owned.has(r.visit_id))
    .reduce((s, r) => s + (Number(r.advance_amount) || 0), 0);
  const finalTotal = finalPay
    .filter((r) => r.visit_id && owned.has(r.visit_id))
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);

  return advanceTotal + finalTotal;
}

async function fetchLiveKpis(hospitalType: string) {
  const [active, pending] = await Promise.all([
    // Same definition the "Currently Admitted" drill list uses. It is a live metric,
    // so its `apply` ignores the range it is handed.
    VISIT_METRICS.admitted.apply(visitCount(hospitalType), getDateRange('today', '')),
    // bills has no hospital column and no confirmed patients FK — this count is org-wide.
    sb
      .from('bills')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'PENDING_APPROVAL'),
  ]);
  if (active.error) throw active.error;
  if (pending.error) throw pending.error;

  return {
    activeIpd: active.count ?? 0,
    pendingApprovals: pending.count ?? 0,
  };
}

/**
 * Director Dashboard KPIs, scoped to a hospital. Defaults to the director's own
 * hospital; pass `hospitalOverride` to read another one (the both-hospitals
 * director view fetches Hope and Ayushman side by side).
 * Period-bound metrics (admissions/discharges/OPD/collection) refetch when `period`
 * changes; live metrics (active IPD, pending approvals) auto-refresh every 60s.
 */
export function useDirectorKpis(period: KpiPeriod, specificMonth: string, hospitalOverride?: HospitalType) {
  const { user } = useAuth();
  const hospitalType = hospitalOverride ?? user?.hospitalType;

  const countsQuery = useQuery({
    queryKey: ['director-kpis-counts', hospitalType, period, specificMonth],
    queryFn: () => fetchPeriodCounts(hospitalType as string, getDateRange(period, specificMonth)),
    enabled: !!hospitalType,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  // Collection is its own query: if it fails it must degrade only the Collection card —
  // not the whole strip.
  const collectionQuery = useQuery({
    queryKey: ['director-kpis-collection', hospitalType, period, specificMonth],
    queryFn: () => fetchCollection(hospitalType as string, getDateRange(period, specificMonth)),
    enabled: !!hospitalType,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const liveQuery = useQuery({
    queryKey: ['director-kpis-live', hospitalType],
    queryFn: () => fetchLiveKpis(hospitalType as string),
    enabled: !!hospitalType,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const data: DirectorKpiData = {
    admissions: countsQuery.data?.admissions ?? null,
    discharges: countsQuery.data?.discharges ?? null,
    opdVisits: countsQuery.data?.opdVisits ?? null,
    collection: collectionQuery.data ?? null,
    activeIpd: liveQuery.data?.activeIpd ?? null,
    pendingApprovals: liveQuery.data?.pendingApprovals ?? null,
  };

  return {
    data,
    isLoading: countsQuery.isLoading || liveQuery.isLoading,
    // Collection failures are intentionally not surfaced here — that card just shows
    // "—" while admissions/discharges/OPD/live stay visible.
    error: (countsQuery.error || liveQuery.error) as Error | null,
    refetch: () => {
      countsQuery.refetch();
      collectionQuery.refetch();
      liveQuery.refetch();
    },
  };
}
