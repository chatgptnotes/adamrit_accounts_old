import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { TallyScreen } from './tally/TallyChrome';

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
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [showPeriod, setShowPeriod] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [detailed, setDetailed] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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
    queryKey: ['daybook_vouchers', fromDate, toDate, typeFilter],
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
        `)
        .eq('status', 'AUTHORISED')
        .gte('voucher_date', fromDate)
        .lte('voucher_date', toDate)
        .order('voucher_date', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1000);
      if (typeFilter) query = query.eq('voucher_type_id', typeFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as Voucher[];
    },
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

  const totals = useMemo(
    () => vouchers.reduce((s, v) => s + (Number(v.total_amount) || 0), 0),
    [vouchers],
  );

  const typeName = voucherTypes.find((t) => t.id === typeFilter)?.voucher_type_name;

  return (
    <TallyScreen
      title={`Day Book${typeName ? ` — ${typeName}` : ''}`}
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
        { hotkey: 'H', label: detailed ? 'Condensed' : 'Detailed', gapBefore: true, onClick: () => setDetailed((v) => !v) },
        { label: 'Save View', disabled: true },
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
        ) : vouchers.length === 0 ? (
          <div className="py-10 text-center text-gray-400">No vouchers in this period.</div>
        ) : (
          <>
            {vouchers.map((v) => {
              const expanded = detailed || expandedIds.has(v.id);
              const entries = [...(v.voucher_entries ?? [])].sort((a, b) => (a.entry_order || 0) - (b.entry_order || 0));
              return (
                <React.Fragment key={v.id}>
                  <button
                    type="button"
                    onClick={() => (onOpenVoucher ? onOpenVoucher(v.id) : toggleExpanded(v.id))}
                    title="Open voucher (alter)"
                    className="flex w-full border-b border-dashed border-gray-300 text-left hover:bg-[#fdf6d8]"
                  >
                    <div className="w-20 px-1">{tallyDateLabel(v.voucher_date)}</div>
                    <div className="min-w-0 flex-1 truncate px-1 font-semibold">{leadLedger(v)}</div>
                    <div className="w-32 px-1">{v.voucher_type?.voucher_type_name?.replace(' Voucher', '') ?? ''}</div>
                    <div className="w-28 px-1 font-mono text-[12px]">{v.voucher_number}</div>
                    <div className="w-32 px-1 text-right font-mono">{fmt(Number(v.total_amount) || 0)}</div>
                    <div className="w-32 px-1 text-right font-mono">{fmt(Number(v.total_amount) || 0)}</div>
                  </button>
                  {expanded && (
                    <div className="border-b border-dashed border-gray-300 bg-[#fffdf2] py-0.5">
                      {entries.map((e) => (
                        <div key={e.id} className="flex text-[12px] italic text-gray-700">
                          <div className="w-20" />
                          <div className="min-w-0 flex-1 truncate px-1">
                            {Number(e.debit_amount) > 0 ? 'Dr' : 'Cr'} {e.account?.account_name ?? ''}
                          </div>
                          <div className="w-32" />
                          <div className="w-28" />
                          <div className="w-32 px-1 text-right font-mono">
                            {Number(e.debit_amount) > 0 ? fmt(Number(e.debit_amount)) : ''}
                          </div>
                          <div className="w-32 px-1 text-right font-mono">
                            {Number(e.credit_amount) > 0 ? fmt(Number(e.credit_amount)) : ''}
                          </div>
                        </div>
                      ))}
                      {v.narration && (
                        <div className="px-24 text-[11px] italic text-gray-500">({v.narration})</div>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
            <div className="mt-2 flex border-t border-black pt-0.5 font-bold">
              <div className="w-20 px-1" />
              <div className="min-w-0 flex-1 px-1 tracking-[0.2em]">Total — {vouchers.length} voucher(s)</div>
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
