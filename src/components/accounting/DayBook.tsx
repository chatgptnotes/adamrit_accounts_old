import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { TallyScreen, getTallyConfig } from './tally/TallyChrome';
import { fetchTallyVouchers } from '@/lib/mergedVouchers';
import { normalizeName } from '@/lib/tallyCompanyMatch';
import SourceBadge from './SourceBadge';
import { useSourceFilter, matchesSource } from './useSourceFilter';

type LedgerSource = 'adamrit' | 'tally';

interface DayRow {
  id: string;
  nativeId: string | null;
  date: string;
  particulars: string;
  type: string;
  number: string;
  total: number;
  narration: string | null;
  entries: { label: string; debit: number; credit: number }[];
  source: LedgerSource;
}

interface VoucherType {
  id: string;
  voucher_type_name: string;
  voucher_category: string;
}

interface EntryRow {
  id: string;
  debit_amount: number;
  credit_amount: number;
  narration: string | null;
  entry_order: number;
  account: { id: string; account_name: string; account_code: string } | null;
}

interface Voucher {
  id: string;
  voucher_number: string;
  voucher_date: string;
  narration: string | null;
  total_amount: number;
  status: string;
  voucher_type: VoucherType | null;
  voucher_entries: EntryRow[];
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

/**
 * Day Book — Tally Prime replica: one row per voucher (Date, Particulars =
 * lead ledger, Vch Type, Vch No., Debit/Credit amount), click expands to
 * show all ledger lines like Tally's detailed mode.
 */
const DayBook: React.FC<{ onOpenVoucher?: (id: string) => void }> = ({ onOpenVoucher }) => {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [fromDate, setFromDate] = useState(() =>
    getTallyConfig().dayBookMonth ? today.slice(0, 8) + '01' : today,
  );
  const [toDate, setToDate] = useState(today);
  const [showPeriod, setShowPeriod] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [detailed, setDetailed] = useState(() => getTallyConfig().defaultDetailed);
  // Regular = authorised up to today; Optional = is_optional; Post-Dated = future-dated
  const [scope, setScope] = useState<'Regular' | 'Optional' | 'Post-Dated'>('Regular');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const { source: srcFilter, railItem: sourceRail } = useSourceFilter();

  const { data: voucherTypes = [] } = useQuery({
    queryKey: ['voucher_types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('voucher_types')
        .select('id, voucher_type_name, voucher_category')
        .eq('is_active', true)
        .order('voucher_type_name');
      if (error) throw error;
      return data as VoucherType[];
    },
  });

  const { data: vouchers = [], isLoading } = useQuery({
    queryKey: ['daybook_vouchers', fromDate, toDate, typeFilter, scope],
    queryFn: async () => {
      let query = supabase
        .from('vouchers')
        .select(`
          id, voucher_number, voucher_date, narration, total_amount, status,
          voucher_type:voucher_types(id, voucher_type_name, voucher_category),
          voucher_entries(
            id, debit_amount, credit_amount, narration, entry_order,
            account:chart_of_accounts(id, account_name, account_code)
          )
        `);
      if (scope === 'Optional') {
        query = (query as any).eq('is_optional', true);
      } else if (scope === 'Post-Dated') {
        query = query.eq('status', 'AUTHORISED').gt('voucher_date', format(new Date(), 'yyyy-MM-dd'));
      } else {
        query = query.eq('status', 'AUTHORISED');
      }
      query = query
        .gte('voucher_date', scope === 'Post-Dated' ? format(new Date(), 'yyyy-MM-dd') : fromDate)
        .lte('voucher_date', scope === 'Post-Dated' ? '2099-12-31' : toDate)
        .order('voucher_date', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1000);
      if (typeFilter) query = query.eq('voucher_type_id', typeFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as Voucher[];
    },
  });

  // Tally mirror vouchers for the same window (Regular scope only — Optional /
  // Post-Dated are native-only concepts). Deduped against native by number.
  const typeName = voucherTypes.find((t) => t.id === typeFilter)?.voucher_type_name;
  const { data: tallyRows = [] } = useQuery({
    queryKey: ['daybook_tally', fromDate, toDate, scope],
    enabled: scope === 'Regular',
    queryFn: () => fetchTallyVouchers({ from: fromDate, upto: toDate }),
  });

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Lead ledger = first debit entry (Tally shows the debited party on Day Book rows)
  const leadLedger = (v: Voucher): string => {
    const sorted = [...(v.voucher_entries ?? [])].sort((a, b) => (a.entry_order || 0) - (b.entry_order || 0));
    const lead = sorted.find((e) => Number(e.debit_amount) > 0) ?? sorted[0];
    return lead?.account?.account_name ?? '';
  };

  const rows: DayRow[] = useMemo(() => {
    const nativeRows: DayRow[] = vouchers.map((v) => {
      const entries = [...(v.voucher_entries ?? [])].sort((a, b) => (a.entry_order || 0) - (b.entry_order || 0));
      return {
        id: `adamrit:${v.id}`,
        nativeId: v.id,
        date: v.voucher_date,
        particulars: leadLedger(v),
        type: v.voucher_type?.voucher_type_name?.replace(' Voucher', '') ?? '',
        number: v.voucher_number,
        total: Number(v.total_amount) || 0,
        narration: v.narration,
        entries: entries.map((e) => ({
          label: `${Number(e.debit_amount) > 0 ? 'Dr' : 'Cr'} ${e.account?.account_name ?? ''}`,
          debit: Number(e.debit_amount) || 0,
          credit: Number(e.credit_amount) || 0,
        })),
        source: 'adamrit',
      };
    });

    let mappedTally: DayRow[] = tallyRows.map((v) => {
      const lead = v.entries.find((e) => e.debit > 0) ?? v.entries[0];
      return {
        id: v.id,
        nativeId: null,
        date: v.date,
        particulars: lead?.ledger ?? '',
        type: v.voucher_type.replace(' Voucher', ''),
        number: v.voucher_number,
        total: v.total,
        narration: v.narration,
        entries: v.entries.map((e) => ({
          label: `${e.debit > 0 ? 'Dr' : 'Cr'} ${e.ledger}`,
          debit: e.debit,
          credit: e.credit,
        })),
        source: 'tally',
      };
    });
    if (typeName) mappedTally = mappedTally.filter((r) => r.type.toLowerCase().includes(typeName.replace(' Voucher', '').toLowerCase()));

    const byNumber = new Map<string, DayRow>();
    const passthrough: DayRow[] = [];
    for (const r of [...nativeRows, ...mappedTally]) {
      const key = normalizeName(r.number);
      if (!key) { passthrough.push(r); continue; }
      const existing = byNumber.get(key);
      if (!existing || r.source === 'tally') byNumber.set(key, r);
    }
    return [...byNumber.values(), ...passthrough]
      .filter((r) => matchesSource(r.source, srcFilter))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }, [vouchers, tallyRows, typeName, srcFilter]);

  const totals = useMemo(() => rows.reduce((s, r) => s + r.total, 0), [rows]);

  return (
    <TallyScreen
      title={`Day Book${typeName ? ` — ${typeName}` : ''}${scope !== 'Regular' ? ` (${scope})` : ''}`}
      rail={[
        { hotkey: 'F2', label: 'Period', onClick: () => setShowPeriod((v) => !v) },
        { hotkey: 'F3', label: 'Company', disabled: true },
        {
          hotkey: 'F4',
          label: 'Voucher Type',
          gapBefore: true,
          onClick: () =>
            setTypeFilter((cur) => {
              const ids = ['', ...voucherTypes.map((t) => t.id)];
              return ids[(ids.indexOf(cur) + 1) % ids.length];
            }),
        },
        {
          hotkey: 'F5',
          label: scope,
          onClick: () =>
            setScope((cur) => {
              const order: ('Regular' | 'Optional' | 'Post-Dated')[] = ['Regular', 'Optional', 'Post-Dated'];
              return order[(order.indexOf(cur) + 1) % order.length];
            }),
          active: scope !== 'Regular',
        },
        { hotkey: 'H', label: detailed ? 'Condensed' : 'Detailed', gapBefore: true, onClick: () => setDetailed((v) => !v) },
        { label: 'Save View', disabled: true },
        sourceRail,
        { hotkey: 'P', label: 'Print', onClick: () => window.print(), gapBefore: true },
      ]}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        {/* Period line, like Tally's "For x-Jul-26" subtitle */}
        <div className="mb-1 text-center">
          <span className="font-semibold">
            {fromDate === toDate ? `For ${tallyDateLabel(fromDate)}` : `${tallyDateLabel(fromDate)} to ${tallyDateLabel(toDate)}`}
          </span>
        </div>
        {showPeriod && (
          <div className="mb-2 flex items-center gap-2 border border-[#9db8d8] bg-[#fdf6d8] px-2 py-1">
            <span>Period:</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="border bg-white px-1" />
            <span>to</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="border bg-white px-1" />
            <span className="ml-4">Type:</span>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="border bg-white px-1">
              <option value="">All Vouchers</option>
              {voucherTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.voucher_type_name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Header row */}
        <div className="flex border-y border-black bg-[#f0f4fa] font-semibold">
          <div className="w-20 px-1">Date</div>
          <div className="min-w-0 flex-1 px-1">Particulars</div>
          <div className="w-32 px-1">Vch Type</div>
          <div className="w-28 px-1">Vch No.</div>
          <div className="w-32 px-1 text-right">Debit Amount</div>
          <div className="w-32 px-1 text-right">Credit Amount</div>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-gray-400">No vouchers in this period.</div>
        ) : (
          <>
            {rows.map((r) => {
              const expanded = detailed || expandedIds.has(r.id);
              return (
                <React.Fragment key={r.id}>
                  <button
                    type="button"
                    onClick={() => (r.nativeId && onOpenVoucher ? onOpenVoucher(r.nativeId) : toggleExpanded(r.id))}
                    title={r.nativeId ? 'Open voucher (alter)' : 'Tally voucher — expand'}
                    className="flex w-full border-b border-dashed border-gray-300 text-left hover:bg-[#fdf6d8]"
                  >
                    <div className="w-20 px-1">{tallyDateLabel(r.date)}</div>
                    <div className="min-w-0 flex-1 truncate px-1 font-semibold">
                      {r.particulars}
                      <SourceBadge source={r.source} />
                    </div>
                    <div className="w-32 px-1">{r.type}</div>
                    <div className="w-28 px-1 font-mono text-[12px]">{r.number}</div>
                    <div className="w-32 px-1 text-right font-mono">{fmt(r.total)}</div>
                    <div className="w-32 px-1 text-right font-mono">{fmt(r.total)}</div>
                  </button>
                  {expanded && (
                    <div className="border-b border-dashed border-gray-300 bg-[#fffdf2] py-0.5">
                      {r.entries.map((e, i) => (
                        <div key={i} className="flex text-[12px] italic text-gray-700">
                          <div className="w-20" />
                          <div className="min-w-0 flex-1 truncate px-1">{e.label}</div>
                          <div className="w-32" />
                          <div className="w-28" />
                          <div className="w-32 px-1 text-right font-mono">
                            {e.debit > 0 ? fmt(e.debit) : ''}
                          </div>
                          <div className="w-32 px-1 text-right font-mono">
                            {e.credit > 0 ? fmt(e.credit) : ''}
                          </div>
                        </div>
                      ))}
                      {r.narration && (
                        <div className="px-24 text-[11px] italic text-gray-500">({r.narration})</div>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
            <div className="mt-2 flex border-t border-black pt-0.5 font-bold">
              <div className="w-20 px-1" />
              <div className="min-w-0 flex-1 px-1 tracking-[0.2em]">Total — {rows.length} voucher(s)</div>
              <div className="w-32 px-1" />
              <div className="w-28 px-1" />
              <div className="w-32 px-1 text-right font-mono">{fmt(totals)}</div>
              <div className="w-32 px-1 text-right font-mono">{fmt(totals)}</div>
            </div>
          </>
        )}
      </div>
    </TallyScreen>
  );
};

export default DayBook;
