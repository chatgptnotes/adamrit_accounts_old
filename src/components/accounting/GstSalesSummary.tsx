import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { dayLabel } from './tally/PeriodContext';

interface ItemRow {
  medicationId: string | null;
  name: string;
  gross: number;
}

interface MedInfo {
  gst_rate: number | null;
  hsn_code: string | null;
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const GST_RATES = [0, 5, 12, 18] as const;

/**
 * Hope Pharmacy GST Sales Summary — rate-wise (F4: HSN-wise) split of pharmacy
 * sales for the period. Prices are MRP-inclusive, so taxable value and tax are
 * back-computed from gross: taxable = gross × 100/(100+rate).
 *
 * Medicines with no GST rate on the master land in a "Rate not set" bucket,
 * with an inline rate-setter so the accountant can classify them from here.
 */
const GstSalesSummary: React.FC = () => {
  const queryClient = useQueryClient();
  const [byHsn, setByHsn] = useState(false);

  const report = useTallyReport({
    supportsColumns: false,
    filterFields: ['Medicine'],
    views: [
      { label: 'Day Book', target: 'day-book' },
      { label: 'Sales Register', target: 'voucher-register:Sales' },
      { label: 'Profit & Loss A/c', target: 'profit-loss' },
    ],
    screenKeys: [
      { hotkey: 'F4', label: byHsn ? 'HSN-wise' : 'Rate-wise', onClick: () => setByHsn((v) => !v) },
    ],
  });
  const { from: fromDate, to: toDate } = report;

  const { data: gstin } = useQuery({
    queryKey: ['pharmacy_gstin'],
    queryFn: async (): Promise<string | null> => {
      const { data } = await (supabase as any)
        .from('companies')
        .select('gst_number')
        .ilike('company_name', '%pharmacy%')
        .limit(1)
        .maybeSingle();
      return data?.gst_number ?? null;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['gst_sales_summary', fromDate, toDate],
    queryFn: async () => {
      // Sale items in the period, paged past PostgREST's 1000-row cap
      const items: ItemRow[] = [];
      for (let fromRow = 0; ; fromRow += 1000) {
        const { data: page, error } = await (supabase as any)
          .from('pharmacy_sale_items')
          .select('medication_id, medication_name, total_price, sale:pharmacy_sales!inner(sale_date, status)')
          .eq('sale.status', 'active')
          .gte('sale.sale_date', fromDate)
          .lte('sale.sale_date', `${toDate}T23:59:59`)
          .order('sale_item_id')
          .range(fromRow, fromRow + 999);
        if (error) throw error;
        for (const r of page ?? []) {
          items.push({
            medicationId: r.medication_id ?? null,
            name: r.medication_name ?? '(unnamed)',
            gross: Number(r.total_price) || 0,
          });
        }
        if (!page || page.length < 1000) break;
      }

      // GST rate + HSN per medicine, fetched in id batches
      const medIds = [...new Set(items.map((i) => i.medicationId).filter(Boolean))] as string[];
      const meds = new Map<string, MedInfo>();
      for (let at = 0; at < medIds.length; at += 200) {
        const { data: page, error } = await (supabase as any)
          .from('medication')
          .select('id, gst_rate, hsn_code')
          .in('id', medIds.slice(at, at + 200));
        if (error) throw error;
        for (const m of page ?? []) meds.set(m.id, { gst_rate: m.gst_rate, hsn_code: m.hsn_code });
      }
      return { items, meds };
    },
  });

  const summary = useMemo(() => {
    if (!data) return null;
    const groups = new Map<string, { label: string; rate: number | null; gross: number; count: number }>();
    const unrated = new Map<string, { medicationId: string; name: string; gross: number }>();

    for (const item of data.items) {
      const med = item.medicationId ? data.meds.get(item.medicationId) : undefined;
      const rate = med?.gst_rate ?? null;
      if (rate == null) {
        const key = item.medicationId ?? item.name;
        const cur = unrated.get(key) ?? { medicationId: item.medicationId ?? '', name: item.name, gross: 0 };
        cur.gross += item.gross;
        unrated.set(key, cur);
      }
      const key = byHsn ? (med?.hsn_code || (rate == null ? '— rate not set —' : '— no HSN —')) : rate == null ? '— rate not set —' : `${rate}%`;
      const cur = groups.get(key) ?? { label: key, rate, gross: 0, count: 0 };
      cur.gross += item.gross;
      cur.count += 1;
      // In HSN view a code's rate comes from its medicines; keep the first seen
      if (cur.rate == null && rate != null) cur.rate = rate;
      groups.set(key, cur);
    }

    const rows = [...groups.values()]
      .map((g) => {
        const rate = g.rate;
        const taxable = rate != null ? (g.gross * 100) / (100 + rate) : g.gross;
        const tax = g.gross - taxable;
        return { ...g, taxable, tax };
      })
      .sort((a, b) => b.gross - a.gross);

    const unratedTop = [...unrated.values()].filter((u) => u.medicationId).sort((a, b) => b.gross - a.gross);
    return { rows, unratedTop };
  }, [data, byHsn]);

  const setRate = async (medicationId: string, rate: number) => {
    const { error } = await (supabase as any).from('medication').update({ gst_rate: rate }).eq('id', medicationId);
    if (error) { toast.error(error.message); return; }
    toast.success(`Rate set to ${rate}%.`);
    queryClient.invalidateQueries({ queryKey: ['gst_sales_summary'] });
  };

  const totals = summary?.rows.reduce(
    (s, r) => ({ gross: s.gross + r.gross, taxable: s.taxable + r.taxable, tax: s.tax + r.tax }),
    { gross: 0, taxable: 0, tax: 0 },
  );

  return (
    <>
      <TallyScreen title="GST Sales Summary" rail={report.rail}>
        <div className="px-3 pb-4 pt-1 text-[13px]">
          <div className="text-center">
            <div className="font-bold">Hope Pharmacy — GST Sales Summary ({byHsn ? 'HSN-wise' : 'Rate-wise'})</div>
            <div className="text-[11px]">
              {dayLabel(fromDate)} to {dayLabel(toDate)}
              {gstin ? ` · GSTIN ${gstin}` : ''}
            </div>
            <div className="text-[11px] italic text-gray-500">
              Prices are MRP-inclusive — taxable value is gross × 100/(100+rate).
            </div>
          </div>

          <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
            <div className="min-w-0 flex-1 px-1">{byHsn ? 'HSN' : 'GST Rate'}</div>
            <div className="w-20 shrink-0 px-1 text-right">Items</div>
            <div className="w-32 shrink-0 px-1 text-right">Taxable Value</div>
            <div className="w-28 shrink-0 px-1 text-right">CGST</div>
            <div className="w-28 shrink-0 px-1 text-right">SGST</div>
            <div className="w-32 shrink-0 px-1 text-right">Gross</div>
          </div>

          {isLoading || !summary ? (
            <div className="py-10 text-center text-gray-400">Loading…</div>
          ) : summary.rows.length === 0 ? (
            <div className="py-10 text-center text-gray-400">No pharmacy sales in this period.</div>
          ) : (
            summary.rows.map((r) => (
              <div key={r.label} className="flex border-b border-dashed border-gray-200 hover:bg-[#fdf6d8]">
                <div className={`min-w-0 flex-1 truncate px-1 ${r.rate == null ? 'font-semibold text-amber-700' : ''}`}>
                  {r.label}
                  {byHsn && r.rate != null ? <span className="ml-2 text-xs text-gray-500">@ {r.rate}%</span> : ''}
                </div>
                <div className="w-20 shrink-0 px-1 text-right font-mono">{r.count}</div>
                <div className="w-32 shrink-0 px-1 text-right font-mono">{r.rate == null ? '' : fmt(r.taxable)}</div>
                <div className="w-28 shrink-0 px-1 text-right font-mono">{r.rate == null ? '' : fmt(r.tax / 2)}</div>
                <div className="w-28 shrink-0 px-1 text-right font-mono">{r.rate == null ? '' : fmt(r.tax / 2)}</div>
                <div className="w-32 shrink-0 px-1 text-right font-mono">{fmt(r.gross)}</div>
              </div>
            ))
          )}

          {totals && summary && summary.rows.length > 0 && (
            <div className="mt-2 flex border-t border-black pt-0.5 font-bold">
              <div className="min-w-0 flex-1 px-1 tracking-[0.2em]">Total</div>
              <div className="w-20 shrink-0 px-1" />
              <div className="w-32 shrink-0 px-1 text-right font-mono">{fmt(totals.taxable)}</div>
              <div className="w-28 shrink-0 px-1 text-right font-mono">{fmt(totals.tax / 2)}</div>
              <div className="w-28 shrink-0 px-1 text-right font-mono">{fmt(totals.tax / 2)}</div>
              <div className="w-32 shrink-0 px-1 text-right font-mono">{fmt(totals.gross)}</div>
            </div>
          )}

          {summary && summary.unratedTop.length > 0 && (
            <div className="mt-6">
              <div className="border-b border-black font-semibold text-amber-800">
                Medicines without a GST rate — set them here ({summary.unratedTop.length})
              </div>
              {summary.unratedTop.slice(0, 40).map((u) => (
                <div key={u.medicationId} className="flex items-center border-b border-dashed border-gray-200 py-0.5">
                  <div className="min-w-0 flex-1 truncate px-1">{u.name}</div>
                  <div className="w-28 shrink-0 px-1 text-right font-mono">{fmt(u.gross)}</div>
                  <div className="flex shrink-0 gap-1 px-1">
                    {GST_RATES.map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => setRate(u.medicationId, rate)}
                        className="border border-[#8fb0d4] px-1.5 text-[11px] text-[#1a4d8f] hover:bg-[#ffc423] hover:text-black"
                      >
                        {rate}%
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {summary.unratedTop.length > 40 && (
                <div className="px-1 py-1 text-[11px] italic text-gray-500">
                  Showing the 40 biggest by sales — set these first, the rest follow the same way.
                </div>
              )}
            </div>
          )}
        </div>
      </TallyScreen>

      {report.popups}
    </>
  );
};

export default GstSalesSummary;
