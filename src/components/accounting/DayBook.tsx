import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { TallyScreen, getTallyConfig } from './tally/TallyChrome';
import { TallyList } from './tally/TallyPopup';
import { useTallyReport } from './tally/useTallyReport';
import { useRowCursor } from './tally/useRowCursor';
import { fetchTallyVouchers } from '@/lib/mergedVouchers';
import { normalizeName } from '@/lib/tallyCompanyMatch';
import SourceBadge from './SourceBadge';
import { useSourceFilter, matchesSource } from './useSourceFilter';
import { useAccountingCompany } from './AccountingCompanyContext';

type LedgerSource = 'adamrit' | 'tally';

interface DayRow {
  id: string;
  nativeId: string | null;
  date: string;
  particulars: string;
  type: string;
  number: string;
  debit: number;
  credit: number;
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

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

const summarySides = (
  voucherType: string,
  total: number,
  entries: { debit: number; credit: number; order: number }[],
): { debit: number; credit: number } => {
  const normalizedType = voucherType.toLowerCase();
  const amount = total || entries.reduce((sum, entry) => sum + Math.max(entry.debit, entry.credit), 0);

  if (normalizedType.includes('receipt')) return { debit: 0, credit: amount };
  if (normalizedType.includes('payment') || normalizedType.includes('contra')) return { debit: amount, credit: 0 };

  const lead = [...entries]
    .sort((a, b) => a.order - b.order)
    .find((entry) => entry.debit > 0 || entry.credit > 0);
  if (lead?.debit > 0) return { debit: lead.debit, credit: 0 };
  if (lead?.credit > 0) return { debit: 0, credit: lead.credit };
  return { debit: 0, credit: 0 };
};

/**
 * Day Book — Tally Prime replica: one row per voucher (Date, Particulars =
 * lead ledger, Vch Type, Vch No., Debit/Credit amount), click expands to
 * show all ledger lines like Tally's detailed mode.
 */
const DayBook: React.FC<{ onOpenVoucher?: (id: string) => void }> = ({ onOpenVoucher }) => {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [typeFilter, setTypeFilter] = useState('');
  // Regular = authorised up to today; Optional = is_optional; Post-Dated = future-dated
  const [scope, setScope] = useState<'Regular' | 'Optional' | 'Post-Dated'>('Regular');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [typePicker, setTypePicker] = useState(false);
  const { source: srcFilter, railItem: sourceRail } = useSourceFilter();
  const { selectedCompanyId } = useAccountingCompany();

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

  const report = useTallyReport({
    from: getTallyConfig().dayBookMonth ? today.slice(0, 8) + '01' : today,
    to: today,
    filterFields: ['Particulars', 'Vch Type', 'Vch No.'],
    views: [
      { label: 'Registers', target: 'voucher-register' },
      { label: 'Ledger Vouchers', target: 'ledger-view' },
      { label: 'Cash/Bank Book', target: 'cash-bank-book' },
      { label: 'Edit Log', target: 'edit-log' },
    ],
    detailedToggle: { hotkey: 'F8', label: 'Detailed' },
    screenKeys: [
      { hotkey: 'F4', label: 'Voucher Type', onClick: () => setTypePicker(true) },
      {
        hotkey: 'F5',
        label: scope,
        active: scope !== 'Regular',
        onClick: () =>
          setScope((cur) => {
            const order: ('Regular' | 'Optional' | 'Post-Dated')[] = ['Regular', 'Optional', 'Post-Dated'];
            return order[(order.indexOf(cur) + 1) % order.length];
          }),
      },
      sourceRail,
    ],
  });
  const { from: fromDate, to: toDate, detailed, fmtAmount: fmt } = report;

  const { data: vouchers = [], isLoading } = useQuery({
    queryKey: ['daybook_vouchers', selectedCompanyId, fromDate, toDate, typeFilter, scope],
    enabled: Boolean(selectedCompanyId),
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
      query = query.eq('company_id', selectedCompanyId);
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
    queryKey: ['daybook_tally', selectedCompanyId, fromDate, toDate, scope],
    enabled: scope === 'Regular' && Boolean(selectedCompanyId),
    queryFn: () => fetchTallyVouchers({ companyId: selectedCompanyId, from: fromDate, upto: toDate }),
  });

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const leadLedger = (
    voucherType: string,
    entries: { accountName: string; debit: number; credit: number; order: number }[],
  ): string => {
    const sorted = [...entries].sort((a, b) => a.order - b.order);
    const normalizedType = voucherType.toLowerCase();
    const lead = normalizedType.includes('receipt') || normalizedType.includes('contra')
      ? sorted.find((e) => e.credit > 0)
      : sorted.find((e) => e.debit > 0);
    return lead?.accountName ?? sorted[0]?.accountName ?? '';
  };

  const rows: DayRow[] = useMemo(() => {
    const nativeRows: DayRow[] = vouchers.map((v) => {
      const entries = [...(v.voucher_entries ?? [])].sort((a, b) => (a.entry_order || 0) - (b.entry_order || 0));
      const normalizedEntries = entries.map((e) => ({
        accountName: e.account?.account_name ?? '',
        debit: Number(e.debit_amount) || 0,
        credit: Number(e.credit_amount) || 0,
        order: e.entry_order || 0,
      }));
      const sides = summarySides(
        v.voucher_type?.voucher_category ?? v.voucher_type?.voucher_type_name ?? '',
        Number(v.total_amount) || 0,
        normalizedEntries,
      );
      return {
        id: `adamrit:${v.id}`,
        nativeId: v.id,
        date: v.voucher_date,
        particulars: leadLedger(v.voucher_type?.voucher_category ?? v.voucher_type?.voucher_type_name ?? '', normalizedEntries),
        type: v.voucher_type?.voucher_type_name?.replace(' Voucher', '') ?? '',
        number: v.voucher_number,
        debit: sides.debit,
        credit: sides.credit,
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
      const normalizedEntries = v.entries.map((e, index) => ({
        accountName: e.ledger,
        debit: e.debit,
        credit: e.credit,
        order: index,
      }));
      const sides = summarySides(v.voucher_type, v.total, normalizedEntries);
      return {
        id: v.id,
        nativeId: null,
        date: v.date,
        particulars: leadLedger(v.voucher_type, normalizedEntries),
        type: v.voucher_type.replace(' Voucher', ''),
        number: v.voucher_number,
        debit: sides.debit,
        credit: sides.credit,
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
      .filter((r) => report.passesFilter({ Particulars: r.particulars, 'Vch Type': r.type, 'Vch No.': r.number }))
      .filter((r) => report.passesBasis(r.debit || r.credit))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }, [vouchers, tallyRows, typeName, srcFilter, report.passesFilter, report.passesBasis]);

  const totals = useMemo(
    () => rows.reduce((sum, row) => ({ debit: sum.debit + row.debit, credit: sum.credit + row.credit }), { debit: 0, credit: 0 }),
    [rows],
  );

  const { cursor, setCursor } = useRowCursor({
    count: rows.length,
    onEnter: (index) => {
      const row = rows[index];
      if (!row) return;
      if (row.nativeId && onOpenVoucher) onOpenVoucher(row.nativeId);
      else toggleExpanded(row.id);
    },
  });

  return (
    <>
    <TallyScreen
      title={`Day Book${typeName ? ` — ${typeName}` : ''}${scope !== 'Regular' ? ` (${scope})` : ''}`}
      rail={report.rail}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        {/* Period line, like Tally's "For x-Jul-26" subtitle */}
        <div className="mb-1 text-center">
          <span className="font-semibold">
            {fromDate === toDate ? `For ${tallyDateLabel(fromDate)}` : `${tallyDateLabel(fromDate)} to ${tallyDateLabel(toDate)}`}
          </span>
        </div>

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
            {rows.map((r, i) => {
              const expanded = detailed || expandedIds.has(r.id);
              return (
                <React.Fragment key={r.id}>
                  <button
                    type="button"
                    onClick={() => (r.nativeId && onOpenVoucher ? onOpenVoucher(r.nativeId) : toggleExpanded(r.id))}
                    onMouseEnter={() => setCursor(i)}
                    title={r.nativeId ? 'Open voucher (alter)' : 'Tally voucher — expand'}
                    className={`flex w-full border-b border-dashed border-gray-300 text-left ${
                      cursor === i ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'
                    }`}
                  >
                    <div className="w-20 px-1">{tallyDateLabel(r.date)}</div>
                    <div className="min-w-0 flex-1 truncate px-1 font-semibold">
                      {r.particulars}
                      <SourceBadge source={r.source} />
                    </div>
                    <div className="w-32 px-1">{r.type}</div>
                    <div className="w-28 px-1 font-mono text-[12px]">{r.number}</div>
                    <div className="w-32 px-1 text-right font-mono">{r.debit > 0 ? fmt(r.debit) : ''}</div>
                    <div className="w-32 px-1 text-right font-mono">{r.credit > 0 ? fmt(r.credit) : ''}</div>
                  </button>
                  {expanded && (
                    <div className="border-b border-dashed border-gray-300 bg-[#fffdf2] py-0.5">
                      {r.entries.flatMap((e, i) => [
                        ...(e.debit > 0 ? [{ key: `${i}-debit`, label: e.label.replace(/^Cr /, 'Dr '), debit: e.debit, credit: 0 }] : []),
                        ...(e.credit > 0 ? [{ key: `${i}-credit`, label: e.label.replace(/^Dr /, 'Cr '), debit: 0, credit: e.credit }] : []),
                      ]).map((entry) => (
                        <div key={entry.key} className="flex text-[12px] italic text-gray-700">
                          <div className="w-20" />
                          <div className="min-w-0 flex-1 truncate px-1">{entry.label}</div>
                          <div className="w-32" />
                          <div className="w-28" />
                          <div className="w-32 px-1 text-right font-mono">
                            {entry.debit > 0 ? fmt(entry.debit) : ''}
                          </div>
                          <div className="w-32 px-1 text-right font-mono">
                            {entry.credit > 0 ? fmt(entry.credit) : ''}
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
              <div className="w-32 px-1 text-right font-mono">{fmt(totals.debit)}</div>
              <div className="w-32 px-1 text-right font-mono">{fmt(totals.credit)}</div>
            </div>
          </>
        )}
      </div>
    </TallyScreen>

    {report.popups}

    {typePicker && (
      <TallyList
        title="List of Voucher Types"
        onClose={() => setTypePicker(false)}
        items={[
          { label: 'All Vouchers', active: !typeFilter, onSelect: () => { setTypeFilter(''); setTypePicker(false); } },
          ...voucherTypes.map((t) => ({
            label: t.voucher_type_name,
            active: t.id === typeFilter,
            onSelect: () => {
              setTypeFilter(t.id);
              setTypePicker(false);
            },
          })),
        ]}
      />
    )}
    </>
  );
};

export default DayBook;
