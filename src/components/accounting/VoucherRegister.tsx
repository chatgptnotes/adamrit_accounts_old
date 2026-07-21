import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { TallyScreen } from './tally/TallyChrome';
import { fetchTallyVouchers } from '@/lib/mergedVouchers';
import { normalizeName } from '@/lib/tallyCompanyMatch';
import SourceBadge from './SourceBadge';
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
  source: 'adamrit' | 'tally';
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

const fyMonths = (fyStartYear: number): { label: string; ym: string }[] => {
  const out: { label: string; ym: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const m = 3 + i;
    const year = fyStartYear + (m > 11 ? 1 : 0);
    const month = (m % 12) + 1;
    const d = new Date(year, month - 1, 1);
    out.push({
      label: d.toLocaleDateString('en-GB', { month: 'long', year: '2-digit' }).replace(' ', '-'),
      ym: `${year}-${String(month).padStart(2, '0')}`,
    });
  }
  return out;
};

const currentFyStartYear = (): number => {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
};

/**
 * Voucher Register — Tally Prime replica of the Sales/Purchase/Journal
 * Register pattern: pick a voucher type from the rail, see Apr–Mar monthly
 * voucher counts and totals, drill into a month for its vouchers, and open
 * any voucher in Alteration.
 */
const VoucherRegister: React.FC<{ onOpenVoucher?: (id: string) => void }> = ({ onOpenVoucher }) => {
  const [fyYear, setFyYear] = useState(currentFyStartYear);
  const [typeId, setTypeId] = useState('');
  const [openMonth, setOpenMonth] = useState<string | null>(null);
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

  const type = voucherTypes.find((t) => t.id === typeId) || null;
  const fyFrom = `${fyYear}-04-01`;
  const fyTo = `${fyYear + 1}-03-31`;

  const { data: nativeVouchers = [], isLoading } = useQuery({
    queryKey: ['voucher_register', typeId, fyFrom, fyTo],
    enabled: !!typeId,
    queryFn: async () => {
      const data = await fetchAllRows((from, to) =>
        supabase
          .from('vouchers')
          .select('id, voucher_number, voucher_date, narration, total_amount')
          .eq('voucher_type_id', typeId)
          .eq('status', 'AUTHORISED')
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
    queryKey: ['voucher_register_tally', fyFrom, fyTo],
    enabled: !!typeId,
    queryFn: () => fetchTallyVouchers({ from: fyFrom, upto: fyTo }),
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
      const key = normalizeName(v.voucher_number);
      if (!key) { passthrough.push(v); continue; }
      const existing = byNumber.get(key);
      if (!existing || v.source === 'tally') byNumber.set(key, v);
    }
    return [...byNumber.values(), ...passthrough]
      .filter((v) => matchesSource(v.source, srcFilter))
      .sort((a, b) => (a.voucher_date || '').localeCompare(b.voucher_date || ''));
  }, [nativeVouchers, tallyRows, type, srcFilter]);

  const months = useMemo(() => {
    const byMonth = new Map<string, { count: number; total: number }>();
    for (const v of vouchers) {
      const ym = v.voucher_date.slice(0, 7);
      const m = byMonth.get(ym) ?? { count: 0, total: 0 };
      m.count += 1;
      m.total += Number(v.total_amount) || 0;
      byMonth.set(ym, m);
    }
    return fyMonths(fyYear).map(({ label, ym }) => ({ label, ym, ...(byMonth.get(ym) ?? { count: 0, total: 0 }) }));
  }, [vouchers, fyYear]);

  const grandCount = months.reduce((s, m) => s + m.count, 0);
  const grandTotal = months.reduce((s, m) => s + m.total, 0);

  const monthVouchers = useMemo(
    () => (openMonth ? vouchers.filter((v) => v.voucher_date.startsWith(openMonth)) : []),
    [vouchers, openMonth],
  );

  return (
    <TallyScreen
      title={type ? `${type.voucher_type_name} Register` : 'Voucher Register'}
      onClose={openMonth ? () => setOpenMonth(null) : undefined}
      rail={[
        {
          hotkey: 'F2',
          label: `FY ${fyYear}-${String(fyYear + 1).slice(2)}`,
          onClick: () => setFyYear((y) => (y === currentFyStartYear() ? y - 1 : currentFyStartYear())),
        },
        { hotkey: 'F3', label: 'Company', disabled: true },
        ...voucherTypes.map((t, i) => ({
          label: t.voucher_type_name,
          gapBefore: i === 0,
          active: t.id === typeId,
          onClick: () => {
            setTypeId(t.id);
            setOpenMonth(null);
          },
        })),
        sourceRail,
        { hotkey: 'P', label: 'Print', onClick: () => window.print(), gapBefore: true },
      ]}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        {!type ? (
          <div className="py-16 text-center text-gray-400">Select a voucher type from the panel on the right.</div>
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
            {monthVouchers.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => v.source === 'adamrit' && onOpenVoucher?.(v.id)}
                title={v.source === 'adamrit' ? 'Open voucher (alter)' : 'Tally voucher'}
                className="flex w-full border-b border-dashed border-gray-200 text-left hover:bg-[#fdf6d8]"
              >
                <div className="w-20 px-1">{tallyDateLabel(v.voucher_date)}</div>
                <div className="min-w-0 flex-1 truncate px-1">
                  {v.narration || ''}
                  <SourceBadge source={v.source} />
                </div>
                <div className="w-32 px-1 font-mono text-[12px]">{v.voucher_number}</div>
                <div className="w-36 px-1 text-right font-mono">{fmt(Number(v.total_amount) || 0)}</div>
              </button>
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
                {tallyDateLabel(fyFrom)} to {tallyDateLabel(fyTo)}
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
                {months.map((m) => (
                  <button
                    key={m.ym}
                    type="button"
                    onClick={() => m.count > 0 && setOpenMonth(m.ym)}
                    className={`flex w-full border-b border-dashed border-gray-200 text-left ${
                      m.count > 0 ? 'hover:bg-[#fdf6d8]' : 'text-gray-400'
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
  );
};

export default VoucherRegister;
