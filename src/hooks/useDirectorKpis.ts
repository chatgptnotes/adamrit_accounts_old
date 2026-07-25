import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { HospitalType } from '@/types/hospital';

export type KpiPeriod = 'today' | 'month' | 'year' | 'specific';

export interface DirectorKpiData {
  admissions: number | null;
  discharges: number | null;
  opdVisits: number | null;
  collection: number | null;
  activeIpd: number | null;
  pendingApprovals: number | null;
}

interface DateRange {
  startISO: string;
  endISO: string;
  startDate: string;
  endDate: string;
}

// The generated Supabase types are stale — visits.is_discharged / patient_type and the
// advance_payment / final_payments tables are absent from them. Query through an untyped
// client, the way the rest of the app already does for these tables.
const sb = supabase as unknown as {
  from: (table: string) => any;
};

const pad = (n: number) => String(n).padStart(2, '0');
const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Resolve a KpiPeriod into a half-open [start, end) range. Returns both a timestamp pair
 * (for created_at / admission_date / discharge_date) and a date-only pair (for visit_date).
 * Dates are built in local time — the app is single-region (India).
 */
export function getDateRange(period: KpiPeriod, specificMonth: string): DateRange {
  const now = new Date();
  let start: Date;
  let end: Date;

  if (period === 'today') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  } else if (period === 'year') {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear() + 1, 0, 1);
  } else if (period === 'specific' && /^\d{4}-\d{2}$/.test(specificMonth)) {
    const [y, m] = specificMonth.split('-').map(Number);
    start = new Date(y, m - 1, 1);
    end = new Date(y, m, 1);
  } else {
    // 'month', or 'specific' with no month picked yet → current month
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }

  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    startDate: toDateStr(start),
    endDate: toDateStr(end),
  };
}

// A hospital-scoped exact-count query over visits (head:true → no rows transferred).
// The visits → patients !inner embed is proven (MarketingDashboard.tsx uses the same shape).
const visitCount = (hospitalType: string) =>
  sb
    .from('visits')
    .select('id, patients!inner(hospital_name)', { count: 'exact', head: true })
    .eq('patients.hospital_name', hospitalType);

async function fetchPeriodCounts(hospitalType: string, range: DateRange) {
  const [adm, dis, opd] = await Promise.all([
    visitCount(hospitalType)
      .not('admission_date', 'is', null)
      .gte('admission_date', range.startISO)
      .lt('admission_date', range.endISO),
    visitCount(hospitalType)
      .not('discharge_date', 'is', null)
      .gte('discharge_date', range.startISO)
      .lt('discharge_date', range.endISO),
    visitCount(hospitalType)
      .eq('patient_type', 'OPD')
      .gte('visit_date', range.startDate)
      .lt('visit_date', range.endDate),
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
 * Every visit_id belonging to the hospital. Used to scope payments client-side:
 * advance_payment / final_payments have no usable PostgREST relationship to embed
 * through, so we can't filter them by a join. The visits → patients !inner embed,
 * however, is proven to work (it backs the count cards above).
 */
async function fetchHospitalVisitIds(hospitalType: string): Promise<Set<string>> {
  const { data, error } = await sb
    .from('visits')
    .select('visit_id, patients!inner(hospital_name)')
    .eq('patients.hospital_name', hospitalType);
  if (error) throw error;
  return new Set((data || []).map((v: any) => v.visit_id).filter(Boolean));
}

/**
 * Total money received in the period for the hospital = advance payments + final
 * payments. Both tables are queried plainly (no embeds — proven shapes from
 * DailyReconciliation.tsx and useFinancialSummary.ts) and then filtered to the
 * hospital's visits client-side.
 */
async function fetchCollection(range: DateRange, hospitalVisitIds: Set<string>) {
  const [advance, finalPay] = await Promise.all([
    sb
      .from('advance_payment')
      .select('advance_amount, visit_id')
      .eq('status', 'ACTIVE')
      .eq('is_refund', false)
      .gte('created_at', range.startISO)
      .lt('created_at', range.endISO),
    sb
      .from('final_payments')
      .select('amount, visit_id')
      .gte('created_at', range.startISO)
      .lt('created_at', range.endISO),
  ]);
  if (advance.error) throw advance.error;
  if (finalPay.error) throw finalPay.error;

  // The column is advance_amount — selecting a nonexistent `amount` fallback
  // 400s the whole request (42703) and blanks the Collection KPI.
  const advanceTotal = (advance.data || [])
    .filter((r: any) => hospitalVisitIds.has(r.visit_id))
    .reduce((s: number, r: any) => s + (Number(r.advance_amount) || 0), 0);
  const finalTotal = (finalPay.data || [])
    .filter((r: any) => hospitalVisitIds.has(r.visit_id))
    .reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);

  return advanceTotal + finalTotal;
}

async function fetchLiveKpis(hospitalType: string) {
  const [active, pending] = await Promise.all([
    visitCount(hospitalType)
      .not('admission_date', 'is', null)
      .is('discharge_date', null),
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

  // Hospital → visit_id set. Period-independent, so it is cached on its own key and
  // is NOT refetched when the period selector changes.
  const visitIdsQuery = useQuery({
    queryKey: ['director-hospital-visit-ids', hospitalType],
    queryFn: () => fetchHospitalVisitIds(hospitalType as string),
    enabled: !!hospitalType,
    staleTime: 5 * 60_000,
  });

  // Collection is its own query: it depends on the visit-id set, and if it fails it
  // must degrade only the Collection card — not the whole strip.
  const collectionQuery = useQuery({
    queryKey: ['director-kpis-collection', hospitalType, period, specificMonth],
    queryFn: () =>
      fetchCollection(getDateRange(period, specificMonth), visitIdsQuery.data as Set<string>),
    enabled: !!hospitalType && !!visitIdsQuery.data,
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
      visitIdsQuery.refetch();
      collectionQuery.refetch();
      liveQuery.refetch();
    },
  };
}
