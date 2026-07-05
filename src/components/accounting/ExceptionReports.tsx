import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { accountMovements } from '@/lib/accountMovements';
import { format } from 'date-fns';
import { TallyScreen } from './tally/TallyChrome';

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const fyStart = (): string => {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-04-01`;
};

interface Exception {
  kind: string;
  voucherId?: string;
  label: string;
  detail: string;
}

/**
 * Exception Reports — Tally's data-health checks, run live against the books:
 * unbalanced vouchers, vouchers with no entries, duplicate voucher numbers,
 * and cash/bank ledgers with negative (credit) balances.
 */
const ExceptionReports: React.FC<{ onOpenVoucher?: (id: string) => void }> = ({ onOpenVoucher }) => {
  const [fromDate, setFromDate] = useState(fyStart);
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showPeriod, setShowPeriod] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['exception_reports', fromDate, toDate],
    queryFn: async () => {
      const exceptions: Exception[] = [];

      // Vouchers + entry sums in the period
      const vouchers = (await fetchAllRows((from, to) =>
        (supabase as any)
          .from('vouchers')
          .select('id, voucher_number, voucher_date, status, total_amount, voucher_entries(debit_amount, credit_amount)')
          .eq('status', 'AUTHORISED')
          .gte('voucher_date', fromDate)
          .lte('voucher_date', toDate)
          .range(from, to),
      )) as any[];

      const numberCount = new Map<string, number>();
      for (const v of vouchers) {
        numberCount.set(v.voucher_number, (numberCount.get(v.voucher_number) ?? 0) + 1);
        const entries = v.voucher_entries ?? [];
        if (entries.length === 0) {
          exceptions.push({
            kind: 'No entries',
            voucherId: v.id,
            label: v.voucher_number,
            detail: `${v.voucher_date} — header ₹${fmt(Number(v.total_amount) || 0)} but no ledger lines`,
          });
          continue;
        }
        const dr = entries.reduce((s: number, e: any) => s + (Number(e.debit_amount) || 0), 0);
        const cr = entries.reduce((s: number, e: any) => s + (Number(e.credit_amount) || 0), 0);
        if (Math.abs(dr - cr) > 0.01) {
          exceptions.push({
            kind: 'Unbalanced',
            voucherId: v.id,
            label: v.voucher_number,
            detail: `${v.voucher_date} — Dr ₹${fmt(dr)} vs Cr ₹${fmt(cr)} (difference ₹${fmt(Math.abs(dr - cr))})`,
          });
        }
      }
      for (const [no, n] of numberCount) {
        if (n > 1) {
          exceptions.push({
            kind: 'Duplicate number',
            label: no,
            detail: `${n} authorised vouchers share this number in the period`,
          });
        }
      }

      // Negative cash/bank balances as of today
      const [{ data: accounts }, movements] = await Promise.all([
        supabase
          .from('chart_of_accounts')
          .select('id, account_code, account_name, opening_balance, opening_balance_type')
          .eq('is_active', true)
          .or('account_code.like.111%,account_code.like.112%'),
        accountMovements({ upto: toDate }),
      ]);
      for (const a of accounts ?? []) {
        const opening =
          (Number(a.opening_balance) || 0) * (a.opening_balance_type?.toUpperCase() === 'CR' ? -1 : 1);
        const m = movements.get(a.id);
        const bal = opening + (m ? m.debit - m.credit : 0);
        if (bal < -0.005) {
          exceptions.push({
            kind: 'Negative cash/bank',
            label: a.account_name,
            detail: `balance ₹${fmt(Math.abs(bal))} Cr as at ${toDate} — cash/bank cannot be negative`,
          });
        }
      }

      return { exceptions, checked: vouchers.length };
    },
  });

  const KIND_STYLE: Record<string, string> = {
    Unbalanced: 'text-red-700',
    'No entries': 'text-orange-700',
    'Duplicate number': 'text-purple-700',
    'Negative cash/bank': 'text-red-700',
  };

  return (
    <TallyScreen
      title="Exception Reports"
      rail={[
        { hotkey: 'F2', label: 'Period', onClick: () => setShowPeriod((v) => !v) },
        { hotkey: 'F3', label: 'Company', disabled: true },
        { hotkey: 'P', label: 'Print', onClick: () => window.print(), gapBefore: true },
      ]}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        <div className="text-center text-[11px]">
          {fromDate} to {toDate}
        </div>
        {showPeriod && (
          <div className="mb-2 mt-1 flex items-center gap-2 border border-[#9db8d8] bg-[#fdf6d8] px-2 py-1">
            <span>Period:</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="border bg-white px-1" />
            <span>to</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="border bg-white px-1" />
          </div>
        )}

        <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
          <div className="w-40 px-1">Exception</div>
          <div className="w-32 px-1">Reference</div>
          <div className="min-w-0 flex-1 px-1">Details</div>
        </div>

        {isLoading || !data ? (
          <div className="py-10 text-center text-gray-400">Checking the books…</div>
        ) : data.exceptions.length === 0 ? (
          <div className="py-10 text-center font-semibold text-green-700">
            No exceptions found — {data.checked} voucher(s) checked, all balanced, numbered uniquely, and cash/bank
            positive.
          </div>
        ) : (
          <>
            {data.exceptions.map((e, i) => (
              <button
                key={i}
                type="button"
                onClick={() => e.voucherId && onOpenVoucher?.(e.voucherId)}
                className={`flex w-full border-b border-dashed border-gray-200 text-left ${
                  e.voucherId ? 'hover:bg-[#fdf6d8]' : 'cursor-default'
                }`}
              >
                <div className={`w-40 shrink-0 px-1 font-semibold ${KIND_STYLE[e.kind] ?? ''}`}>{e.kind}</div>
                <div className="w-32 shrink-0 px-1 font-mono text-[12px]">{e.label}</div>
                <div className="min-w-0 flex-1 truncate px-1 text-gray-700">{e.detail}</div>
              </button>
            ))}
            <div className="mt-2 text-[11px] italic text-gray-500">
              {data.exceptions.length} exception(s) across {data.checked} voucher(s) — click a row to open the voucher.
            </div>
          </>
        )}
      </div>
    </TallyScreen>
  );
};

export default ExceptionReports;
