import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LogIn, LogOut, Stethoscope, Wallet, BedDouble, Clock } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows, fetchAllByIn } from '@/utils/fetchAllRows';
import {
  VISIT_METRICS,
  getDateRange,
  type DateRange,
  type KpiPeriod,
} from '@/lib/director-metrics';

// Hospital Overview, Hope vs Ayushman in the same frame (owner's spec,
// 2026-08-02): every tile shows both hospitals' figures, the Collection tile
// splits OPD/IPD per hospital, and clicking any tile opens the patient-level
// list behind the number — right here on the dashboard.

const sb = supabase as unknown as { from: (table: string) => any };

const HOSPITALS = [
  { key: 'hope', label: 'Hope' },
  { key: 'ayushman', label: 'Ayushman' },
] as const;
type HospitalKey = (typeof HOSPITALS)[number]['key'];

type Metric = 'admissions' | 'discharges' | 'opd' | 'collection' | 'admitted' | 'pending';

const PERIOD_LABELS: Record<Exclude<KpiPeriod, 'specific'>, string> = {
  today: 'Today',
  month: 'This month',
  year: 'This year',
};

const fmtMoney = (n: number): string => `₹${Math.round(n).toLocaleString('en-IN')}`;

interface SplitCounts {
  hope: number;
  ayushman: number;
}

interface CollectionSplit {
  hope: { opd: number; ipd: number };
  ayushman: { opd: number; ipd: number };
}

interface DrillRow {
  id: string;
  name: string;
  hospital: HospitalKey | string;
  detail: string; // date / bill no / corporate
  amount?: number;
  tag?: string; // OPD / IPD / bill status
}

/** Visit metric counts for both hospitals in two head-count queries. */
async function fetchVisitSplit(metric: 'admissions' | 'discharges' | 'opd' | 'admitted', range: DateRange): Promise<SplitCounts> {
  const def = VISIT_METRICS[metric === 'opd' ? 'opd' : metric];
  const countFor = async (hospital: HospitalKey) => {
    const { count, error } = await def.apply(
      sb
        .from('visits')
        .select('id, patients!inner(hospital_name)', { count: 'exact', head: true })
        .eq('patients.hospital_name', hospital),
      range,
    );
    if (error) throw error;
    return count ?? 0;
  };
  const [hope, ayushman] = await Promise.all([countFor('hope'), countFor('ayushman')]);
  return { hope, ayushman };
}

/** Payments in the period, resolved to hospital + OPD/IPD via their visits. */
async function fetchPayments(range: DateRange) {
  const [advance, finalPay] = await Promise.all([
    fetchAllRows<{ id: string; advance_amount: number | null; visit_id: string | null; patient_name: string | null; payment_mode: string | null; created_at: string }>(() =>
      sb
        .from('advance_payment')
        .select('id, advance_amount, visit_id, patient_name, payment_mode, created_at')
        .eq('status', 'ACTIVE')
        .eq('is_refund', false)
        .gte('created_at', range.startISO)
        .lt('created_at', range.endISO)
        .order('id', { ascending: true }),
    ),
    fetchAllRows<{ id: string; amount: number | null; visit_id: string | null; created_at: string }>(() =>
      sb
        .from('final_payments')
        .select('id, amount, visit_id, created_at')
        .gte('created_at', range.startISO)
        .lt('created_at', range.endISO)
        .order('id', { ascending: true }),
    ),
  ]);

  const visitIds = [...new Set([...advance, ...finalPay].map((r) => r.visit_id).filter(Boolean))] as string[];
  const visits = visitIds.length
    ? await fetchAllByIn<{ visit_id: string; patient_type: string | null; patients: { name: string | null; hospital_name: string | null } }>(
        visitIds,
        (chunk) =>
          sb
            .from('visits')
            .select('visit_id, patient_type, patients!inner(name, hospital_name)')
            .in('visit_id', chunk)
            .order('visit_id', { ascending: true }),
      )
    : [];
  const byVisit = new Map(visits.map((v) => [v.visit_id, v]));
  return { advance, finalPay, byVisit };
}

function collectionSplitOf(p: Awaited<ReturnType<typeof fetchPayments>>): CollectionSplit {
  const split: CollectionSplit = { hope: { opd: 0, ipd: 0 }, ayushman: { opd: 0, ipd: 0 } };
  const bump = (visitId: string | null, amount: number) => {
    const v = visitId ? p.byVisit.get(visitId) : undefined;
    const hosp = (v?.patients?.hospital_name || '') as HospitalKey;
    if (hosp !== 'hope' && hosp !== 'ayushman') return;
    const type = (v?.patient_type || '').toUpperCase() === 'OPD' ? 'opd' : 'ipd';
    split[hosp][type] += amount;
  };
  for (const r of p.advance) bump(r.visit_id, Number(r.advance_amount) || 0);
  for (const r of p.finalPay) bump(r.visit_id, Number(r.amount) || 0);
  return split;
}

/** Pending-approval bills resolved to hospital via the visit code they carry. */
async function fetchPendingBills() {
  const bills = await fetchAllRows<{ id: string; bill_no: string | null; visit_id: string | null; total_amount: number | null }>(() =>
    sb
      .from('bills')
      .select('id, bill_no, visit_id, total_amount')
      .eq('status', 'PENDING_APPROVAL')
      .order('id', { ascending: true }),
  );
  // bills.visit_id stores the printed visit CODE (never join it on visits.id)
  const codes = [...new Set(bills.map((b) => b.visit_id).filter(Boolean))] as string[];
  const visits = codes.length
    ? await fetchAllByIn<{ visit_id: string; patients: { name: string | null; hospital_name: string | null } }>(codes, (chunk) =>
        sb
          .from('visits')
          .select('visit_id, patients!inner(name, hospital_name)')
          .in('visit_id', chunk)
          .order('visit_id', { ascending: true }),
      )
    : [];
  const byCode = new Map(visits.map((v) => [v.visit_id, v]));
  return bills.map((b) => {
    const v = b.visit_id ? byCode.get(b.visit_id) : undefined;
    return {
      id: b.id,
      billNo: b.bill_no ?? '',
      amount: Number(b.total_amount) || 0,
      patient: v?.patients?.name ?? '(unknown patient)',
      hospital: (v?.patients?.hospital_name ?? '') as string,
    };
  });
}

/** Patient rows behind a visit-metric tile, both hospitals. */
async function fetchVisitDrill(metric: 'admissions' | 'discharges' | 'opd' | 'admitted', range: DateRange): Promise<DrillRow[]> {
  const def = VISIT_METRICS[metric === 'opd' ? 'opd' : metric];
  const rows = await fetchAllRows<any>(
    () =>
      def
        .apply(
          sb
            .from('visits')
            .select('id, visit_id, patient_type, admission_date, discharge_date, visit_date, patients!inner(name, hospital_name, corporate)')
            .in('patients.hospital_name', ['hope', 'ayushman']),
          range,
        )
        .order(def.dateCol, { ascending: def.ascending })
        .order('id', { ascending: true }),
    1000,
  );
  return rows.map((r: any) => ({
    id: r.id,
    name: r.patients?.name ?? '(unnamed)',
    hospital: r.patients?.hospital_name ?? '',
    detail: `${r.visit_id ?? ''} · ${String(r[def.dateCol] ?? '').slice(0, 10)}${r.patients?.corporate ? ` · ${r.patients.corporate}` : ''}`,
    tag: (r.patient_type || '').toUpperCase(),
  }));
}

export function HospitalOverviewSplit() {
  const [period, setPeriod] = useState<KpiPeriod>('today');
  const [specificMonth, setSpecificMonth] = useState('');
  const [drill, setDrill] = useState<Metric | null>(null);
  const [drillHospital, setDrillHospital] = useState<HospitalKey | 'all'>('all');

  const range = getDateRange(period, specificMonth);
  const rangeKey = `${range.startISO}|${range.endISO}`;
  const periodLabel =
    period === 'specific'
      ? new Date(`${specificMonth || range.startDate.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
      : PERIOD_LABELS[period as Exclude<KpiPeriod, 'specific'>];

  const q = (metric: 'admissions' | 'discharges' | 'opd') =>
    useQuery({
      queryKey: ['overview-split', metric, rangeKey],
      queryFn: () => fetchVisitSplit(metric, range),
      staleTime: 60_000,
      placeholderData: (prev: SplitCounts | undefined) => prev,
    });
  const admissions = q('admissions');
  const discharges = q('discharges');
  const opd = q('opd');

  const admitted = useQuery({
    queryKey: ['overview-split', 'admitted'],
    queryFn: () => fetchVisitSplit('admitted', range),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const payments = useQuery({
    queryKey: ['overview-split-payments', rangeKey],
    queryFn: () => fetchPayments(range),
    staleTime: 60_000,
    placeholderData: (prev: Awaited<ReturnType<typeof fetchPayments>> | undefined) => prev,
  });
  const collection = payments.data ? collectionSplitOf(payments.data) : null;

  const pendingBills = useQuery({
    queryKey: ['overview-split-pending'],
    queryFn: fetchPendingBills,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const pendingSplit: SplitCounts | null = pendingBills.data
    ? {
        hope: pendingBills.data.filter((b) => b.hospital === 'hope').length,
        ayushman: pendingBills.data.filter((b) => b.hospital === 'ayushman').length,
      }
    : null;

  // Drill rows for the open dialog
  const visitDrill = useQuery({
    queryKey: ['overview-drill', drill, rangeKey],
    enabled: drill != null && drill !== 'collection' && drill !== 'pending',
    queryFn: () => fetchVisitDrill(drill as 'admissions' | 'discharges' | 'opd' | 'admitted', range),
  });

  const drillRows: DrillRow[] = (() => {
    if (drill === 'collection' && payments.data) {
      const rows: DrillRow[] = [];
      for (const r of payments.data.advance) {
        const v = r.visit_id ? payments.data.byVisit.get(r.visit_id) : undefined;
        rows.push({
          id: `a-${r.id}`,
          name: v?.patients?.name ?? r.patient_name ?? '(unknown)',
          hospital: (v?.patients?.hospital_name ?? '') as string,
          detail: `${String(r.created_at).slice(0, 10)} · ${r.payment_mode ?? 'advance'}`,
          amount: Number(r.advance_amount) || 0,
          tag: (v?.patient_type || '').toUpperCase(),
        });
      }
      for (const r of payments.data.finalPay) {
        const v = r.visit_id ? payments.data.byVisit.get(r.visit_id) : undefined;
        rows.push({
          id: `f-${r.id}`,
          name: v?.patients?.name ?? '(unknown)',
          hospital: (v?.patients?.hospital_name ?? '') as string,
          detail: `${String(r.created_at).slice(0, 10)} · discharge payment`,
          amount: Number(r.amount) || 0,
          tag: (v?.patient_type || '').toUpperCase(),
        });
      }
      return rows.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    }
    if (drill === 'pending' && pendingBills.data) {
      return pendingBills.data.map((b) => ({
        id: b.id,
        name: b.patient,
        hospital: b.hospital,
        detail: b.billNo,
        amount: b.amount,
        tag: 'PENDING',
      }));
    }
    return visitDrill.data ?? [];
  })();

  const visibleDrillRows =
    drillHospital === 'all' ? drillRows : drillRows.filter((r) => r.hospital === drillHospital);

  const fmt = (n: number | undefined | null) => (n == null ? '—' : n.toLocaleString('en-IN'));

  const splitLine = (label: string, split: SplitCounts | null | undefined, money = false) => (
    <div className="flex items-center justify-between text-[11px] leading-4">
      <span className="text-white/75">{label}</span>
      <span className="font-bold text-white">
        {split == null ? '—' : money ? fmtMoney((split as any)[label.toLowerCase()]) : fmt((split as any)[label.toLowerCase()])}
      </span>
    </div>
  );

  const CARDS: {
    metric: Metric;
    title: string;
    icon: typeof LogIn;
    color: string;
    total: string;
    body: React.ReactNode;
    subtitle: string;
  }[] = [
    {
      metric: 'admissions',
      title: 'Admissions',
      icon: LogIn,
      color: 'from-blue-500 to-blue-600',
      total: admissions.data ? fmt(admissions.data.hope + admissions.data.ayushman) : '—',
      body: (
        <>
          {splitLine('Hope', admissions.data)}
          {splitLine('Ayushman', admissions.data)}
        </>
      ),
      subtitle: periodLabel,
    },
    {
      metric: 'discharges',
      title: 'Discharges',
      icon: LogOut,
      color: 'from-green-500 to-green-600',
      total: discharges.data ? fmt(discharges.data.hope + discharges.data.ayushman) : '—',
      body: (
        <>
          {splitLine('Hope', discharges.data)}
          {splitLine('Ayushman', discharges.data)}
        </>
      ),
      subtitle: periodLabel,
    },
    {
      metric: 'opd',
      title: 'OPD Visits',
      icon: Stethoscope,
      color: 'from-purple-500 to-purple-600',
      total: opd.data ? fmt(opd.data.hope + opd.data.ayushman) : '—',
      body: (
        <>
          {splitLine('Hope', opd.data)}
          {splitLine('Ayushman', opd.data)}
        </>
      ),
      subtitle: periodLabel,
    },
    {
      metric: 'collection',
      title: 'Collection',
      icon: Wallet,
      color: 'from-emerald-500 to-emerald-600',
      total: collection
        ? fmtMoney(collection.hope.opd + collection.hope.ipd + collection.ayushman.opd + collection.ayushman.ipd)
        : '—',
      body: collection ? (
        <>
          <div className="flex items-center justify-between text-[11px] leading-4">
            <span className="text-white/75">Hope OPD</span>
            <span className="font-bold text-white">{fmtMoney(collection.hope.opd)}</span>
          </div>
          <div className="flex items-center justify-between text-[11px] leading-4">
            <span className="text-white/75">Hope IPD</span>
            <span className="font-bold text-white">{fmtMoney(collection.hope.ipd)}</span>
          </div>
          <div className="flex items-center justify-between text-[11px] leading-4">
            <span className="text-white/75">Ayushman OPD</span>
            <span className="font-bold text-white">{fmtMoney(collection.ayushman.opd)}</span>
          </div>
          <div className="flex items-center justify-between text-[11px] leading-4">
            <span className="text-white/75">Ayushman IPD</span>
            <span className="font-bold text-white">{fmtMoney(collection.ayushman.ipd)}</span>
          </div>
        </>
      ) : (
        <div className="text-[11px] text-white/75">Loading…</div>
      ),
      subtitle: periodLabel,
    },
    {
      metric: 'admitted',
      title: 'Occupancy (Admitted)',
      icon: BedDouble,
      color: 'from-amber-500 to-amber-600',
      total: admitted.data ? fmt(admitted.data.hope + admitted.data.ayushman) : '—',
      body: (
        <>
          {splitLine('Hope', admitted.data)}
          {splitLine('Ayushman', admitted.data)}
        </>
      ),
      subtitle: 'Live',
    },
    {
      metric: 'pending',
      title: 'Pending Approvals',
      icon: Clock,
      color: 'from-rose-500 to-rose-600',
      total: pendingSplit ? fmt(pendingSplit.hope + pendingSplit.ayushman) : '—',
      body: (
        <>
          {splitLine('Hope', pendingSplit)}
          {splitLine('Ayushman', pendingSplit)}
        </>
      ),
      subtitle: 'Live',
    },
  ];

  const drillTitle: Record<Metric, string> = {
    admissions: 'Admitted in the period — patient list',
    discharges: 'Discharged — patient list',
    opd: 'OPD visits — patient list',
    collection: 'Patients who paid',
    admitted: 'Currently admitted patients',
    pending: 'Bills pending approval',
  };

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold text-gray-700">Hospital Overview — Hope vs Ayushman</span>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as KpiPeriod)}>
            <SelectTrigger className="h-9 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="year">This Year</SelectItem>
              <SelectItem value="specific">Specific Month</SelectItem>
            </SelectContent>
          </Select>
          {period === 'specific' && (
            <Input
              type="month"
              value={specificMonth}
              max={currentMonth}
              onChange={(e) => setSpecificMonth(e.target.value)}
              className="h-9 w-[160px]"
              aria-label="Select month"
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {CARDS.map((card) => (
          <button
            key={card.metric}
            type="button"
            onClick={() => {
              setDrillHospital('all');
              setDrill(card.metric);
            }}
            title={`Open ${card.title} details`}
            className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden block text-left transition-transform hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]"
          >
            <div className={`bg-gradient-to-br ${card.color} px-3 py-2`}>
              <div className="flex items-center justify-between">
                <div className="text-white/80 text-[10px] font-medium">{card.title}</div>
                <card.icon className="w-4 h-4 text-white/60" />
              </div>
              <div className="text-white font-extrabold text-lg leading-tight">{card.total}</div>
              <div className="mt-1 space-y-0.5">{card.body}</div>
            </div>
            <div className="px-3 py-1.5">
              <div className="text-[10px] text-gray-400">{card.subtitle} · tap for patient list</div>
            </div>
          </button>
        ))}
      </div>

      <Dialog open={drill != null} onOpenChange={(open) => !open && setDrill(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{drill ? drillTitle[drill] : ''}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            {(['all', 'hope', 'ayushman'] as const).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setDrillHospital(h)}
                className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${
                  drillHospital === h ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {h === 'all' ? 'Both hospitals' : h}
              </button>
            ))}
            <span className="ml-auto text-xs text-gray-500">
              {visibleDrillRows.length.toLocaleString('en-IN')} patient{visibleDrillRows.length === 1 ? '' : 's'}
              {drill === 'collection' || drill === 'pending'
                ? ` · ${fmtMoney(visibleDrillRows.reduce((s, r) => s + (r.amount ?? 0), 0))}`
                : ''}
            </span>
          </div>
          <div className="max-h-[55vh] overflow-y-auto rounded border">
            {visitDrill.isLoading && drill !== 'collection' && drill !== 'pending' ? (
              <div className="py-10 text-center text-sm text-gray-400">Loading patients…</div>
            ) : visibleDrillRows.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">No patients in this list.</div>
            ) : (
              visibleDrillRows.slice(0, 500).map((r) => (
                <div key={r.id} className="flex items-center gap-2 border-b border-gray-100 px-3 py-1.5 text-sm">
                  <span
                    className={`inline-block w-20 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase ${
                      r.hospital === 'hope' ? 'bg-emerald-100 text-emerald-700' : r.hospital === 'ayushman' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {r.hospital || '—'}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                  {r.tag && (
                    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">{r.tag}</span>
                  )}
                  <span className="w-56 shrink-0 truncate text-xs text-gray-500">{r.detail}</span>
                  {r.amount != null && <span className="w-24 shrink-0 text-right font-mono text-xs">{fmtMoney(r.amount)}</span>}
                </div>
              ))
            )}
            {visibleDrillRows.length > 500 && (
              <div className="px-3 py-2 text-center text-xs italic text-gray-500">
                Showing the first 500 — narrow the period for the rest.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
