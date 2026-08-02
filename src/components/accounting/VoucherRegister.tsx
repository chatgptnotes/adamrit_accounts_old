import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { TallyScreen } from './tally/TallyChrome';
import { TallyList } from './tally/TallyPopup';
import { useTallyReport } from './tally/useTallyReport';
import { useRowCursor } from './tally/useRowCursor';
import { monthsInPeriod } from './tally/PeriodContext';
import { fetchTallyVouchers, normalizeVoucherNumber } from '@/lib/mergedVouchers';
import { useAccountingCompany } from './AccountingCompanyContext';
import { useSourceFilter, matchesSource } from './useSourceFilter';

interface VoucherType {
  id: string;
  voucher_type_name: string;
  voucher_category: string;
}

interface VoucherRow {
  id: string;
  voucher_number: string;
  voucher_date: string;
  narration: string | null;
  total_amount: number;
  is_auto?: boolean;
  source: 'adamrit' | 'tally';
}

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

/**
 * Voucher Register — Tally Prime replica of the Sales/Purchase/Journal
 * Register pattern: pick a voucher type from the rail, see Apr–Mar monthly
 * voucher counts and totals, drill into a month for its vouchers, and open
 * any voucher in Alteration.
 */
const VoucherRegister: React.FC<{ onOpenVoucher?: (id: string) => void; initialTypeName?: string }> = ({
  onOpenVoucher,
  initialTypeName,
}) => {
  const [typeId, setTypeId] = useState('');
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  const [typePicker, setTypePicker] = useState(false);
  const { source: srcFilter, railItem: sourceRail } = useSourceFilter();

  const { data: voucherTypes = [] } = useQuery({
    // Its own key — see DayBook: this list has no prefix / current_number, so
    // it must not fill the cache Voucher Entry numbers from.
    queryKey: ['voucher_types', 'names'],
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

  // Account Books opens this register already pointed at a voucher type
  useEffect(() => {
    if (!initialTypeName || typeId || voucherTypes.length === 0) return;
    const wanted = initialTypeName.toLowerCase();
    const match = voucherTypes.find((t) => t.voucher_type_name.toLowerCase().startsWith(wanted));
    if (match) setTypeId(match.id);
  }, [initialTypeName, typeId, voucherTypes]);

  const type = voucherTypes.find((t) => t.id === typeId) || null;

  const { selectedCompanyId } = useAccountingCompany();
  const report = useTallyReport({
    // Monthly register and voucher lists have no comparison columns in Tally.
    supportsColumns: false,
    detailedToggle: { hotkey: 'F5', mod: 'alt', label: 'Detailed' },
    filterFields: ['Particulars', 'Vch No.'],
    views: [
      { label: 'Day Book', target: 'day-book' },
      { label: 'Ledger Vouchers', target: 'ledger-view' },
      { label: 'Cash/Bank Book', target: 'cash-bank-book' },
      { label: 'Edit Log', target: 'edit-log' },
    ],
    // The rail carries shortcuts only. The voucher types are report content, so
    // they are listed in the body below — F4 still opens them as a picker.
    screenKeys: [
      { hotkey: 'F4', label: 'Voucher Type', onClick: () => setTypePicker(true) },
      sourceRail,
    ],
    // The register drills month → vouchers; export whichever is on screen.
    exportData: () =>
      openMonth
        ? {
            title: `${type?.voucher_type_name ?? 'Voucher'} Register — ${openMonth}`,
            period: report.periodLabel,
            columns: ['Date', 'Vch No.', 'Particulars', 'Amount'],
            rows: monthVouchers.map((v) => [
              v.voucher_date,
              v.voucher_number,
              v.narration ?? '',
              Number(v.total_amount) || 0,
            ]),
          }
        : {
            title: `${type?.voucher_type_name ?? 'Voucher'} Register`,
            period: report.periodLabel,
            columns: ['Month', 'Vouchers', 'Total Amount'],
            rows: months.map((m) => [m.label, m.count, m.total]),
          },
  });
  const { from: fyFrom, to: fyTo, fmtAmount: fmt, detailed } = report;
  const periodMonths = monthsInPeriod({ from: fyFrom, to: fyTo });

  const { data: nativeVouchers = [], isLoading } = useQuery({
    queryKey: ['voucher_register', selectedCompanyId, typeId, fyFrom, fyTo],
    enabled: !!selectedCompanyId && !!typeId,
    queryFn: async () => {
      const data = await fetchAllRows((from, to) =>
        supabase
          .from('vouchers')
          .select('id, voucher_number, voucher_date, narration, total_amount, is_auto')
          .eq('voucher_type_id', typeId)
          .eq('status', 'AUTHORISED')
          .eq('company_id', selectedCompanyId)
          .gte('voucher_date', fyFrom)
          .lte('voucher_date', fyTo)
          .order('voucher_date', { ascending: true })
          .range(from, to),
      );
      return (data as unknown as Omit<VoucherRow, 'source'>[]).map((v) => ({ ...v, source: 'adamrit' as const }));
    },
  });

  // Tally mirror vouchers matched to the selected type by name, deduped by number.
  const { data: tallyRows = [] } = useQuery({
    queryKey: ['voucher_register_tally', selectedCompanyId, fyFrom, fyTo],
    enabled: !!selectedCompanyId && !!typeId,
    queryFn: () => fetchTallyVouchers({ companyId: selectedCompanyId, from: fyFrom, upto: fyTo }),
  });

  const vouchers: VoucherRow[] = useMemo(() => {
    const typeKey = (type?.voucher_type_name || '').replace(' Voucher', '').toLowerCase();
    const mappedTally: VoucherRow[] = tallyRows
      .filter((v) => !typeKey || v.voucher_type.toLowerCase().includes(typeKey))
      .map((v) => ({
        id: v.id,
        voucher_number: v.voucher_number,
        voucher_date: v.date,
        narration: v.narration,
        total_amount: v.total,
        source: 'tally' as const,
      }));
    const byNumber = new Map<string, VoucherRow>();
    const passthrough: VoucherRow[] = [];
    for (const v of [...nativeVouchers, ...mappedTally]) {
      const key = normalizeVoucherNumber(v.voucher_number);
      if (!key) { passthrough.push(v); continue; }
      const existing = byNumber.get(key);
      if (!existing || v.source === 'tally') byNumber.set(key, v);
    }
    return [...byNumber.values(), ...passthrough]
      .filter((v) => matchesSource(v.source, srcFilter))
      .filter((v) => report.passesFilter({ Particulars: v.narration ?? '', 'Vch No.': v.voucher_number }))
      .filter((v) => report.passesBasis(Number(v.total_amount) || 0))
      .sort((a, b) => (a.voucher_date || '').localeCompare(b.voucher_date || ''));
  }, [nativeVouchers, tallyRows, type, srcFilter, report.passesFilter, report.passesBasis]);

  const months = useMemo(() => {
    const byMonth = new Map<string, { count: number; total: number }>();
    for (const v of vouchers) {
      const ym = v.voucher_date.slice(0, 7);
      const m = byMonth.get(ym) ?? { count: 0, total: 0 };
      m.count += 1;
      m.total += Number(v.total_amount) || 0;
      byMonth.set(ym, m);
    }
    return periodMonths.map(({ label, ym }) => ({ label, ym, ...(byMonth.get(ym) ?? { count: 0, total: 0 }) }));
  }, [vouchers, periodMonths]);

  const grandCount = months.reduce((s, m) => s + m.count, 0);
  const grandTotal = months.reduce((s, m) => s + m.total, 0);

  const monthVouchers = useMemo(
    () => (openMonth ? vouchers.filter((v) => v.voucher_date.startsWith(openMonth)) : []),
    [vouchers, openMonth],
  );

  // Alt+F5 Detailed: the ledger lines of every voucher in the open month,
  // exactly the By/To expansion the Day Book shows.
  const monthNativeIds = useMemo(
    () => monthVouchers.filter((v) => v.source === 'adamrit').map((v) => v.id),
    [monthVouchers],
  );
  const { data: monthEntries = new Map<string, { label: string; debit: number; credit: number }[]>() } = useQuery({
    queryKey: ['voucher_register_entries', openMonth, monthNativeIds.join(',')],
    enabled: detailed && !!openMonth && monthNativeIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('voucher_entries')
        .select('voucher_id, debit_amount, credit_amount, entry_order, account:chart_of_accounts(account_name)')
        .in('voucher_id', monthNativeIds)
        .order('entry_order', { ascending: true });
      if (error) throw error;
      const map = new Map<string, { label: string; debit: number; credit: number }[]>();
      for (const e of (data || []) as any[]) {
        const list = map.get(e.voucher_id) || [];
        list.push({
          label: e.account?.account_name || '?',
          debit: Number(e.debit_amount) || 0,
          credit: Number(e.credit_amount) || 0,
        });
        map.set(e.voucher_id, list);
      }
      return map;
    },
  });

  const { cursor, setCursor } = useRowCursor({
    count: !type ? voucherTypes.length : openMonth ? monthVouchers.length : months.length,
    onEnter: (index) => {
      if (!type) {
        const picked = voucherTypes[index];
        if (picked) setTypeId(picked.id);
        return;
      }
      if (openMonth) {
        const v = monthVouchers[index];
        if (v?.source === 'adamrit') onOpenVoucher?.(v.id);
        return;
      }
      const month = months[index];
      if (month && month.count > 0) setOpenMonth(month.ym);
    },
  });

  return (
    <>
    <TallyScreen
      title={type ? `${type.voucher_type_name} Register` : 'Voucher Register'}
      onClose={openMonth ? () => setOpenMonth(null) : undefined}
      rail={report.rail}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        {!type ? (
          <>
            {/* Voucher type list — the register opens on the types themselves */}
            <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
              <div className="min-w-0 flex-1 px-1">Particulars</div>
            </div>
            {voucherTypes.map((t, i) => (
              <button
                key={t.id}
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => setTypeId(t.id)}
                title={`Open ${t.voucher_type_name} Register`}
                className={`flex w-full border-b border-dashed border-gray-200 text-left ${
                  cursor === i ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'
                }`}
              >
                <div className="min-w-0 flex-1 px-1 pl-4">{t.voucher_type_name}</div>
              </button>
            ))}
          </>
        ) : openMonth ? (
          <>
            <div className="text-center">
              <div className="font-bold">{type.voucher_type_name} Register</div>
              <div className="text-[11px]">{months.find((m) => m.ym === openMonth)?.label}</div>
            </div>
            <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
              <div className="w-20 px-1">Date</div>
              <div className="min-w-0 flex-1 px-1">Particulars</div>
              <div className="w-32 px-1">Vch No.</div>
              <div className="w-36 px-1 text-right">Amount</div>
            </div>
            {monthVouchers.map((v, i) => (
              <React.Fragment key={v.id}>
                <button
                  type="button"
                  onClick={() => v.source === 'adamrit' && onOpenVoucher?.(v.id)}
                  onMouseEnter={() => setCursor(i)}
                  title={v.source === 'adamrit' ? 'Open voucher (alter)' : 'Tally voucher'}
                  className={`flex w-full border-b border-dashed border-gray-200 text-left ${
                    cursor === i ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'
                  }`}
                >
                  <div className="w-20 px-1">{tallyDateLabel(v.voucher_date)}</div>
                  <div className="min-w-0 flex-1 truncate px-1">
                    {v.narration || ''}
                  </div>
                  <div className="w-32 px-1 font-mono text-[12px]">
                    {v.voucher_number}
                    {/* Posted by a trigger rather than typed by anyone. */}
                    {v.is_auto && (
                      <span className="ml-1 bg-gray-200 px-1 text-[9px] font-bold text-gray-600">AUTO</span>
                    )}
                  </div>
                  <div className="w-36 px-1 text-right font-mono">{fmt(Number(v.total_amount) || 0)}</div>
                </button>
                {detailed && (monthEntries.get(v.id) || []).map((e, ei) => (
                  <div key={`${v.id}-${ei}`} className="flex bg-[#fffdf2] text-[12px] italic text-gray-700">
                    <div className="w-20" />
                    <div className="min-w-0 flex-1 truncate px-1">
                      {e.debit > 0 ? `Dr ${e.label}` : `Cr ${e.label}`}
                    </div>
                    <div className="w-32" />
                    <div className="w-36 px-1 text-right font-mono">{fmt(e.debit > 0 ? e.debit : e.credit)}</div>
                  </div>
                ))}
              </React.Fragment>
            ))}
            <div className="mt-1 flex border-t border-black pt-0.5 font-bold">
              <div className="w-20 px-1" />
              <div className="min-w-0 flex-1 px-1">Total — {monthVouchers.length} voucher(s)</div>
              <div className="w-32 px-1" />
              <div className="w-36 px-1 text-right font-mono">
                {fmt(monthVouchers.reduce((s, v) => s + (Number(v.total_amount) || 0), 0))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="text-center">
              <div className="font-bold">{type.voucher_type_name} Register</div>
              <div className="text-[11px]">
                {report.periodLabel}
              </div>
            </div>
            <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
              <div className="min-w-0 flex-1 px-1">Particulars</div>
              <div className="w-32 px-1 text-right">Vouchers</div>
              <div className="w-40 px-1 text-right">Total Amount</div>
            </div>
            {isLoading ? (
              <div className="py-10 text-center text-gray-400">Loading…</div>
            ) : (
              <>
                {months.map((m, i) => (
                  <button
                    key={m.ym}
                    type="button"
                    onClick={() => m.count > 0 && setOpenMonth(m.ym)}
                    onMouseEnter={() => setCursor(i)}
                    className={`flex w-full border-b border-dashed border-gray-200 text-left ${
                      cursor === i ? 'bg-[#ffc423]' : m.count > 0 ? 'hover:bg-[#fdf6d8]' : 'text-gray-400'
                    }`}
                  >
                    <div className="min-w-0 flex-1 px-1">{m.label}</div>
                    <div className="w-32 px-1 text-right font-mono">{m.count > 0 ? m.count : ''}</div>
                    <div className="w-40 px-1 text-right font-mono">{m.total > 0 ? fmt(m.total) : ''}</div>
                  </button>
                ))}
                <div className="mt-1 flex border-t border-black pt-0.5 font-bold">
                  <div className="min-w-0 flex-1 px-1 tracking-[0.2em]">Grand Total</div>
                  <div className="w-32 px-1 text-right font-mono">{grandCount}</div>
                  <div className="w-40 px-1 text-right font-mono">{fmt(grandTotal)}</div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </TallyScreen>

    {report.popups}

    {typePicker && (
      <TallyList
        title="List of Voucher Types"
        onClose={() => setTypePicker(false)}
        items={voucherTypes.map((t) => ({
          label: t.voucher_type_name,
          active: t.id === typeId,
          onSelect: () => {
            setTypeId(t.id);
            setOpenMonth(null);
            setTypePicker(false);
          },
        }))}
      />
    )}
    </>
  );
};

export default VoucherRegister;
