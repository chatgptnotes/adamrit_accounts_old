import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
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

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const fyStart = (): string => {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-04-01`;
};

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

/**
 * Cash/Bank Summary — replica of Tally's report: Cash-in-Hand and Bank
 * Accounts groups with ledger-wise closing balances in Debit/Credit columns.
 */
const CashBankSummary: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const [fromDate, setFromDate] = useState(fyStart);
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showPeriod, setShowPeriod] = useState(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ['cash_bank_accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, opening_balance, opening_balance_type')
        .eq('is_active', true)
        .or('account_code.like.111%,account_code.like.112%')
        .order('account_code');
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });

  const accountIds = useMemo(() => accounts.map((a) => a.id), [accounts]);

  const { data: sums = {}, isLoading } = useQuery({
    queryKey: ['cash_bank_sums', accountIds.join(','), toDate],
    enabled: accountIds.length > 0,
    queryFn: async () => {
      const movements = await accountMovements({ upto: toDate });
      const byAccount: Record<string, number> = {};
      for (const id of accountIds) {
        const m = movements.get(id);
        if (m) byAccount[id] = m.debit - m.credit;
      }
      return byAccount;
    },
  });

  const closing = (a: Account): number => {
    const opening = (Number(a.opening_balance) || 0) * (a.opening_balance_type === 'Cr' ? -1 : 1);
    return opening + (sums[a.id] ?? 0);
  };

  const groups = useMemo(() => {
    const leaf = (codePrefix: string) =>
      accounts.filter((a) => a.account_code.startsWith(codePrefix) && a.account_code.length > 4);
    // Header accounts (1110/1120 style parents) double as leaves in this chart:
    // treat any account with movement or opening as a line.
    const cash = accounts.filter((a) => a.account_code.startsWith('111'));
    const bank = accounts.filter((a) => a.account_code.startsWith('112'));
    return [
      { name: 'Cash-in-Hand', items: cash },
      { name: 'Bank Accounts', items: bank },
    ].map((g) => ({
      ...g,
      totalDr: g.items.reduce((s, a) => s + Math.max(0, closing(a)), 0),
      totalCr: g.items.reduce((s, a) => s + Math.max(0, -closing(a)), 0),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, sums]);

  const grandDr = groups.reduce((s, g) => s + g.totalDr, 0);
  const grandCr = groups.reduce((s, g) => s + g.totalCr, 0);

  return (
    <TallyScreen
      title="Cash/Bank Summary"
      onClose={onClose}
      rail={[
        { hotkey: 'F2', label: 'Period', onClick: () => setShowPeriod((v) => !v) },
        { hotkey: 'F3', label: 'Company', disabled: true },
        { hotkey: 'F4', label: 'Group', disabled: true },
        { hotkey: 'F5', label: 'Ledger-wise', disabled: true, gapBefore: true },
        { label: 'Basis of Values', disabled: true, gapBefore: true },
        { label: 'Change View', disabled: true },
        { label: 'Save View', disabled: true },
      ]}
    >
      <div className="px-3 pb-6 pt-2 text-[13px]">
        {showPeriod && (
          <div className="mb-2 flex items-center gap-2 border border-[#9db8d8] bg-[#fdf6d8] px-2 py-1">
            <span>Period:</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="border bg-white px-1" />
            <span>to</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="border bg-white px-1" />
          </div>
        )}

        {/* Header */}
        <div className="flex border-b border-black">
          <div className="flex-1 pt-6 font-semibold tracking-[0.3em]">Particulars</div>
          <div className="w-80 border-l border-gray-400 text-center">
            <div className="italic">Bank Accounts</div>
            <div className="font-bold">Closing Balance</div>
            <div className="text-[11px]">{tallyDateLabel(fromDate)} to {tallyDateLabel(toDate)}</div>
            <div className="flex border-t border-gray-400 font-semibold">
              <div className="w-1/2 border-r border-gray-400">Debit</div>
              <div className="w-1/2">Credit</div>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-gray-400">Loading…</div>
        ) : (
          <>
            {groups.map((g) => (
              <React.Fragment key={g.name}>
                <div className="mt-3 flex">
                  <div className="flex-1 font-bold">{g.name}</div>
                  <div className="flex w-80">
                    <div className="w-1/2 pr-2 text-right font-mono font-semibold">{g.totalDr > 0 ? fmt(g.totalDr) : ''}</div>
                    <div className="w-1/2 pr-2 text-right font-mono font-semibold">{g.totalCr > 0 ? fmt(g.totalCr) : ''}</div>
                  </div>
                </div>
                {g.items.map((a) => {
                  const bal = closing(a);
                  if (bal === 0) return null;
                  return (
                    <div key={a.id} className="flex">
                      <div className="flex-1 pl-4 italic">{a.account_name}</div>
                      <div className="flex w-80">
                        <div className="w-1/2 pr-2 text-right font-mono italic">{bal > 0 ? fmt(bal) : ''}</div>
                        <div className="w-1/2 pr-2 text-right font-mono italic">{bal < 0 ? fmt(-bal) : ''}</div>
                      </div>
                    </div>
                  );
                })}
              </React.Fragment>
            ))}

            <div className="mt-16 flex border-t border-black pt-1 font-bold">
              <div className="flex-1 tracking-[0.3em]">Grand Total</div>
              <div className="flex w-80">
                <div className="w-1/2 pr-2 text-right font-mono">{fmt(grandDr)}</div>
                <div className="w-1/2 pr-2 text-right font-mono">{fmt(grandCr)}</div>
              </div>
            </div>
          </>
        )}
      </div>
    </TallyScreen>
  );
};

export default CashBankSummary;
