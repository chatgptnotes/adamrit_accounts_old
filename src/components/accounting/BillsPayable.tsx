import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { useRowCursor } from './tally/useRowCursor';

interface ScheduleRow {
  id: string;
  schedule_date: string;
  obligation_id: string | null;
  party_name: string;
  category: string;
  total_due: number;
  paid_amount: number;
  status: string;
  days_overdue: number;
}

interface PayableLine {
  party: string;
  category: string;
  date: string;
  pending: number;
  overdue: number;
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

const BUCKETS = [
  { label: '0-30 Days', min: 0, max: 30 },
  { label: '31-60 Days', min: 31, max: 60 },
  { label: '61-90 Days', min: 61, max: 90 },
  { label: 'Greater than 90 Days', min: 91, max: Infinity },
];

/**
 * Bills Payable — Tally Prime replica over the vendor payment schedule:
 * one line per party (latest pending obligation) with Pending Amount,
 * Due on and Overdue by days; F6 Age wise analysis; F4 cycles category.
 */
const BillsPayable: React.FC = () => {
  const { hospitalConfig } = useAuth();
  const [ageWise, setAgeWise] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');

  const report = useTallyReport({
    supportsColumns: false,
    filterFields: ['Particulars', 'Ref. No.'],
    views: [
      { label: 'Bills Receivable', target: 'bills-receivable' },
      { label: 'Bill-wise Outstandings', target: 'billwise' },
      { label: 'Banking', target: 'banking' },
      { label: 'Ledger Vouchers', target: 'ledger-view' },
    ],
    screenKeys: [
      {
        hotkey: 'F4',
        label: categoryFilter === 'all' ? 'Category' : categoryFilter,
        onClick: () =>
          setCategoryFilter((cur) => {
            const ids = ['all', ...categories];
            return ids[(ids.indexOf(cur) + 1) % ids.length];
          }),
      },
      { hotkey: 'F6', label: 'Age wise', active: ageWise, onClick: () => setAgeWise((v) => !v) },
    ],
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['bills_payable', hospitalConfig?.name],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('daily_payment_schedule')
        .select('id, schedule_date, obligation_id, party_name, category, total_due, paid_amount, status, days_overdue')
        .eq('hospital_name', hospitalConfig.name)
        .neq('status', 'paid')
        .order('schedule_date', { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as ScheduleRow[];
    },
  });

  // The schedule carries balances forward daily — the LATEST row per party
  // is its current outstanding position.
  const lines = useMemo<PayableLine[]>(() => {
    const latest = new Map<string, ScheduleRow>();
    for (const r of rows) {
      const key = r.obligation_id ?? r.party_name;
      if (!latest.has(key)) latest.set(key, r); // rows are date-desc, first wins
    }
    return [...latest.values()]
      .map((r) => ({
        party: r.party_name,
        category: r.category,
        date: r.schedule_date,
        pending: Math.max(0, (Number(r.total_due) || 0) - (Number(r.paid_amount) || 0)),
        overdue: Number(r.days_overdue) || 0,
      }))
      .filter((l) => l.pending > 0)
      .sort((a, b) => b.pending - a.pending);
  }, [rows]);

  const categories = useMemo(() => [...new Set(lines.map((l) => l.category).filter(Boolean))].sort(), [lines]);
  const visible = useMemo(
    () => (categoryFilter === 'all' ? lines : lines.filter((l) => l.category === categoryFilter)),
    [lines, categoryFilter],
  );
  const total = visible.reduce((s, l) => s + l.pending, 0);

  const byBucket = useMemo(() => {
    return BUCKETS.map((b) => ({
      ...b,
      rows: visible.filter((l) => l.overdue >= b.min && l.overdue <= b.max),
    })).filter((b) => b.rows.length > 0);
  }, [visible]);

  const asAt = tallyDateLabel(new Date().toISOString());

  // Tally drills a payable line to the party's ledger; unmatched names land on
  // the bill-wise outstandings.
  const drillLine = async (l: PayableLine) => {
    const { data } = await (supabase as any)
      .from('chart_of_accounts')
      .select('id')
      .ilike('account_name', l.party.trim().replace(/[%_\\]/g, '\\$&'))
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (data?.id) {
      window.dispatchEvent(new CustomEvent('tally-open-ledger', { detail: { accountId: data.id, monthly: true } }));
      return;
    }
    window.dispatchEvent(new CustomEvent('tally-goto', { detail: 'billwise' }));
  };

  const flatVisible = ageWise ? byBucket.flatMap((b) => b.rows) : visible;
  const { cursor, setCursor } = useRowCursor({
    count: flatVisible.length,
    onEnter: (i) => flatVisible[i] && void drillLine(flatVisible[i]),
  });

  const lineRow = (l: PayableLine) => {
    const idx = flatVisible.indexOf(l);
    return (
    <button
      key={`${l.party}-${l.date}`}
      type="button"
      onClick={() => void drillLine(l)}
      onMouseEnter={() => setCursor(idx)}
      className={`flex w-full border-b border-dashed border-gray-200 text-left ${cursor === idx ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'}`}
    >
      <div className="w-20 shrink-0 px-1">{tallyDateLabel(l.date)}</div>
      <div className="w-24 shrink-0 px-1 capitalize italic text-gray-600">{l.category}</div>
      <div className="min-w-0 flex-1 truncate px-1">{l.party}</div>
      <div className="w-32 shrink-0 px-1 text-right font-mono">{fmt(l.pending)}</div>
      <div className="w-24 shrink-0 px-1">{tallyDateLabel(l.date)}</div>
      <div className="w-24 shrink-0 px-1 text-right font-mono">{l.overdue > 0 ? l.overdue : ''}</div>
    </button>
    );
  };

  return (
    <>
    <TallyScreen
      title="Bills Payable"
      rail={report.rail}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        <div className="text-center">
          <div className="font-bold">
            {ageWise ? 'Age wise analysis of Bills Payable' : 'Bills Payable'}
            {categoryFilter !== 'all' ? ` — ${categoryFilter}` : ''}
          </div>
          <div className="text-[11px]">as at {asAt}</div>
        </div>

        {/* Column header */}
        <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
          <div className="w-20 shrink-0 px-1">Date</div>
          <div className="w-24 shrink-0 px-1">Category</div>
          <div className="min-w-0 flex-1 px-1">Party's Name</div>
          <div className="w-32 shrink-0 px-1 text-right">Pending Amount</div>
          <div className="w-24 shrink-0 px-1">Due on</div>
          <div className="w-24 shrink-0 px-1 text-right">Overdue by days</div>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-gray-400">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="py-10 text-center text-gray-400">No pending vendor payments.</div>
        ) : ageWise ? (
          byBucket.map((b) => (
            <React.Fragment key={b.label}>
              <div className="mt-1.5 flex bg-[#eef3fa] font-bold">
                <div className="min-w-0 flex-1 px-1">{b.label}</div>
                <div className="w-32 shrink-0 px-1 text-right font-mono">
                  {fmt(b.rows.reduce((s, l) => s + l.pending, 0))}
                </div>
                <div className="w-48 shrink-0 px-1 text-right text-[11px] font-normal italic text-gray-600">
                  {b.rows.length} part{b.rows.length === 1 ? 'y' : 'ies'}
                </div>
              </div>
              {b.rows.map(lineRow)}
            </React.Fragment>
          ))
        ) : (
          visible.map(lineRow)
        )}

        {!isLoading && visible.length > 0 && (
          <div className="mt-2 flex border-t border-black pt-0.5 font-bold">
            <div className="w-20 shrink-0 px-1" />
            <div className="w-24 shrink-0 px-1" />
            <div className="min-w-0 flex-1 px-1 tracking-[0.2em]">
              Total — {visible.length} part{visible.length === 1 ? 'y' : 'ies'}
            </div>
            <div className="w-32 shrink-0 px-1 text-right font-mono">{fmt(total)}</div>
            <div className="w-24 shrink-0 px-1" />
            <div className="w-24 shrink-0 px-1" />
          </div>
        )}
      </div>
    </TallyScreen>

    {report.popups}
    </>
  );
};

export default BillsPayable;
