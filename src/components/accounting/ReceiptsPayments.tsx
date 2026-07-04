import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { accountMovements } from '@/lib/accountMovements';
import { format } from 'date-fns';
import { TallyScreen } from './tally/TallyChrome';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  opening_balance: number | null;
  opening_balance_type: string | null;
}

interface EntryRow {
  account_id: string;
  debit_amount: number | null;
  credit_amount: number | null;
  voucher_id: string;
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

const fyStart = (): string => {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-04-01`;
};

const dayBefore = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return format(d, 'yyyy-MM-dd');
};

/**
 * Receipts & Payments A/c — Tally Prime replica: the cash-basis statement.
 * Every voucher touching cash/bank is classified by its counter-ledgers:
 * money in → Receipts panel, money out → Payments panel, framed by the
 * combined cash+bank Opening and Closing balances.
 */
const ReceiptsPayments: React.FC = () => {
  const [fromDate, setFromDate] = useState(fyStart);
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showPeriod, setShowPeriod] = useState(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ['rp_accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, opening_balance, opening_balance_type')
        .eq('is_active', true);
      if (error) throw error;
      return data as Account[];
    },
  });

  const cashBankIds = useMemo(
    () => new Set(accounts.filter((a) => a.account_code.startsWith('111') || a.account_code.startsWith('112')).map((a) => a.id)),
    [accounts],
  );
  const nameById = useMemo(() => new Map(accounts.map((a) => [a.id, a.account_name])), [accounts]);

  // Opening cash+bank = chart openings + movements before the period
  const { data: before = new Map(), isLoading: l1 } = useQuery({
    queryKey: ['rp_before', fromDate],
    queryFn: () => accountMovements({ upto: dayBefore(fromDate) }),
  });

  const { data: entries = [], isLoading: l2 } = useQuery({
    queryKey: ['rp_entries', fromDate, toDate],
    queryFn: async () => {
      const data = await fetchAllRows((from, to) =>
        supabase
          .from('voucher_entries')
          .select('account_id, debit_amount, credit_amount, voucher_id, voucher:vouchers!inner(voucher_date, status)')
          .eq('voucher.status', 'AUTHORISED')
          .gte('voucher.voucher_date', fromDate)
          .lte('voucher.voucher_date', toDate)
          .range(from, to),
      );
      return data as unknown as EntryRow[];
    },
  });

  const { openingCash, receipts, payments, netCash } = useMemo(() => {
    let openingCash = 0;
    for (const a of accounts) {
      if (!cashBankIds.has(a.id)) continue;
      const opening = (Number(a.opening_balance) || 0) * (a.opening_balance_type === 'Cr' ? -1 : 1);
      const m: any = before.get(a.id);
      openingCash += opening + (m ? m.debit - m.credit : 0);
    }

    // Classify each voucher touching cash/bank by its counter-ledgers
    const byVoucher = new Map<string, EntryRow[]>();
    for (const e of entries) {
      const list = byVoucher.get(e.voucher_id) ?? [];
      list.push(e);
      byVoucher.set(e.voucher_id, list);
    }
    const receiptsMap = new Map<string, number>();
    const paymentsMap = new Map<string, number>();
    let netCash = 0;
    for (const list of byVoucher.values()) {
      const cashLegs = list.filter((e) => cashBankIds.has(e.account_id));
      if (cashLegs.length === 0) continue;
      const net = cashLegs.reduce((s, e) => s + (Number(e.debit_amount) || 0) - (Number(e.credit_amount) || 0), 0);
      netCash += net;
      const counters = list.filter((e) => !cashBankIds.has(e.account_id));
      if (net > 0.005) {
        for (const c of counters) {
          const amt = (Number(c.credit_amount) || 0) - (Number(c.debit_amount) || 0);
          if (amt <= 0) continue;
          const name = nameById.get(c.account_id) ?? 'Unknown';
          receiptsMap.set(name, (receiptsMap.get(name) ?? 0) + amt);
        }
      } else if (net < -0.005) {
        for (const c of counters) {
          const amt = (Number(c.debit_amount) || 0) - (Number(c.credit_amount) || 0);
          if (amt <= 0) continue;
          const name = nameById.get(c.account_id) ?? 'Unknown';
          paymentsMap.set(name, (paymentsMap.get(name) ?? 0) + amt);
        }
      }
    }
    const sort = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
    return { openingCash, receipts: sort(receiptsMap), payments: sort(paymentsMap), netCash };
  }, [accounts, cashBankIds, nameById, before, entries]);

  const closingCash = openingCash + netCash;
  const receiptsTotal = receipts.reduce((s, [, v]) => s + v, 0);
  const paymentsTotal = payments.reduce((s, [, v]) => s + v, 0);
  // Both panels balance to: opening + receipts = payments + closing
  const panelTotal = Math.max(openingCash + receiptsTotal, paymentsTotal + closingCash);
  const isLoading = l1 || l2;

  const panel = (title: string, rows: [string, number][], frame: { label: string; value: number }, frameFirst: boolean) => (
    <div className="min-w-0 flex-1">
      <div className="border-b border-black pb-0.5 font-semibold tracking-[0.3em]">{title}</div>
      <div className="mt-1 space-y-0.5">
        {frameFirst && (
          <div className="flex justify-between font-bold italic">
            <span>{frame.label}</span>
            <span className="font-mono">{fmt(frame.value)}</span>
          </div>
        )}
        {rows.map(([name, amt]) => (
          <div key={name} className="flex justify-between border-b border-dashed border-gray-200">
            <span className="min-w-0 flex-1 truncate">{name}</span>
            <span className="font-mono">{fmt(amt)}</span>
          </div>
        ))}
        {!frameFirst && (
          <div className="flex justify-between font-bold italic">
            <span>{frame.label}</span>
            <span className="font-mono">{fmt(frame.value)}</span>
          </div>
        )}
      </div>
      <div className="mt-6 flex justify-between border-t border-black pt-1 font-bold">
        <span className="tracking-[0.3em]">Total</span>
        <span className="font-mono">{fmt(panelTotal)}</span>
      </div>
    </div>
  );

  return (
    <TallyScreen
      title="Receipts and Payments"
      rail={[
        { hotkey: 'F2', label: 'Period', onClick: () => setShowPeriod((v) => !v) },
        { hotkey: 'F3', label: 'Company', disabled: true },
        { hotkey: 'P', label: 'Print', onClick: () => window.print(), gapBefore: true },
      ]}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        <div className="text-center text-[11px]">
          {tallyDateLabel(fromDate)} to {tallyDateLabel(toDate)}
        </div>
        {showPeriod && (
          <div className="mb-2 mt-1 flex items-center gap-2 border border-[#9db8d8] bg-[#fdf6d8] px-2 py-1">
            <span>Period:</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="border bg-white px-1" />
            <span>to</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="border bg-white px-1" />
          </div>
        )}
        {isLoading ? (
          <div className="py-16 text-center text-gray-400">Loading…</div>
        ) : (
          <div className="mt-1 flex gap-0">
            <div className="flex-1 border-r border-gray-400 pr-3">
              {panel('Receipts', receipts, { label: 'Opening Balance (Cash & Bank)', value: openingCash }, true)}
            </div>
            <div className="flex-1 pl-3">
              {panel('Payments', payments, { label: 'Closing Balance (Cash & Bank)', value: closingCash }, false)}
            </div>
          </div>
        )}
      </div>
    </TallyScreen>
  );
};

export default ReceiptsPayments;
