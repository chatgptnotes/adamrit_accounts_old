import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { accountMovements, type Movement } from '@/lib/accountMovements';
import { optionalNetByAccount } from '@/lib/cashBankOptional';
import { format } from 'date-fns';
import { fetchActiveAccounts } from '@/lib/fetchAccounts';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  opening_balance: number | null;
  opening_balance_type: string | null;
}

interface VoucherRow {
  id: string;
  voucher_number: string;
  voucher_date: string;
  narration: string | null;
  total_amount: number;
  voucher_type: { voucher_type_name: string } | null;
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));

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
 * Dashboard — Tally-styled overview: cash & bank position, FY income vs
 * expenses with Nett, top expense heads as inline bars, and the latest
 * vouchers, all from the instant account_movements aggregate.
 */
const Dashboard: React.FC<{ onOpenVoucher?: (id: string) => void; canSeeTile?: (tileId: string, role?: string | null) => boolean }> = ({ onOpenVoucher, canSeeTile }) => {
  const report = useTallyReport({
    supportsColumns: false,
    filterFields: ['Particulars'],
    views: [
      { label: 'Balance Sheet', target: 'balance-sheet' },
      { label: 'Profit & Loss A/c', target: 'profit-loss' },
      { label: 'Day Book', target: 'day-book' },
      { label: 'Cash/Bank Summary', target: 'cash-bank-summary' },
    ],
  });
  const today = format(new Date(), 'yyyy-MM-dd');
  const from = fyStart();

  const { data: accounts = [] } = useQuery({
    queryKey: ['tb_accounts'],
    queryFn: () => fetchActiveAccounts<Account>({ columns: 'id, account_code, account_name, account_type, opening_balance, opening_balance_type' }),
  });

  const { data: cumulative = new Map<string, Movement>() } = useQuery({
    queryKey: ['dash_cumulative', today],
    queryFn: () => accountMovements({ upto: today }),
  });
  const { data: period = new Map<string, Movement>() } = useQuery({
    queryKey: ['dash_period', from, today],
    queryFn: () => accountMovements({ from, upto: today }),
  });

  // These tiles match the Cash/Bank screens, where each cash and bank ledger
  // shows its own transactions only — so the pharmacy JVs come off them too.
  const { data: optionalNet = new Map<string, number>() } = useQuery({
    queryKey: ['dash_cash_bank_optional', today],
    queryFn: () => optionalNetByAccount({ upto: today }),
  });

  const { data: recent = [] } = useQuery({
    queryKey: ['dash_recent'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vouchers')
        .select('id, voucher_number, voucher_date, narration, total_amount, voucher_type:voucher_types(voucher_type_name)')
        .eq('status', 'AUTHORISED')
        .order('created_at', { ascending: false })
        .limit(8);
      if (error) throw error;
      return data as unknown as VoucherRow[];
    },
  });

  const S = useMemo(() => {
    const bal = (a: Account): number => {
      const opening = (Number(a.opening_balance) || 0) * (a.opening_balance_type?.toUpperCase() === 'CR' ? -1 : 1);
      const m = cumulative.get(a.id);
      return opening + (m ? m.debit - m.credit : 0);
    };
    let cash = 0;
    let bank = 0;
    let income = 0;
    let expense = 0;
    let advance = 0;
    const expenseHeads: { name: string; amount: number }[] = [];
    for (const a of accounts) {
      const t = (a.account_type || '').toUpperCase();
      const optional = optionalNet.get(a.id) ?? 0;
      if (a.account_code.startsWith('111')) cash += bal(a) - optional;
      else if (a.account_code.startsWith('112')) bank += bal(a) - optional;
      if (a.account_code === '2110') advance = -bal(a);
      const m = period.get(a.id);
      if (!m) continue;
      if (t.includes('INCOME')) income += m.credit - m.debit;
      else if (t.includes('EXPENSE')) {
        const v = m.debit - m.credit;
        expense += v;
        if (v > 0.005) expenseHeads.push({ name: a.account_name, amount: v });
      }
    }
    expenseHeads.sort((a, b) => b.amount - a.amount);
    return { cash, bank, income, expense, nett: income - expense, advance, expenseHeads: expenseHeads.slice(0, 8) };
  }, [accounts, cumulative, period, optionalNet]);

  const maxExp = S.expenseHeads[0]?.amount || 1;

  const tile = (label: string, value: number, drCr = false, tileId?: string) => {
    if (canSeeTile && tileId && !canSeeTile(tileId)) return null;
    return (
    <div className="border border-[#9db8d8] bg-white">
      <div className="bg-[#eef3fa] px-2 py-0.5 text-[11px] font-semibold tracking-wide text-[#16437e]">{label}</div>
      <div className="px-2 py-1.5 text-right font-mono text-[15px] font-bold">
        ₹ {fmt(value)}
        {drCr ? ` ${value >= 0 ? 'Dr' : 'Cr'}` : ''}
      </div>
    </div>
    );
  };

  return (
    <>
    <TallyScreen title="Dashboard" rail={report.rail}>
      <div className="px-3 pb-4 pt-1 text-[13px]">
        <div className="text-center text-[11px]">
          {tallyDateLabel(from)} to {tallyDateLabel(today)}
        </div>

        {/* Tiles */}
        <div className="mt-1 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
          {tile('Cash-in-Hand', S.cash, false, 'a-cash-in-hand')}
          {tile('Bank Accounts', S.bank, false, 'a-bank-accounts')}
          {tile('Income (FY)', S.income, false, 'a-income-fy')}
          {tile('Expenses (FY)', S.expense, false, 'a-expenses-fy')}
          {tile(S.nett >= 0 ? 'Nett Profit (FY)' : 'Nett Loss (FY)', S.nett, false, 'a-nett-profit-loss')}
          {tile('Patient Advance', S.advance, false, 'a-patient-advance')}
        </div>

        <div className="mt-3 flex gap-3">
          {/* Top expense heads */}
          <div className="min-w-0 flex-1 border border-[#9db8d8] bg-white">
            <div className="bg-[#16437e] px-2 py-0.5 text-[12px] font-semibold text-white">Top Expense Heads (FY)</div>
            <div className="p-2">
              {S.expenseHeads.length === 0 ? (
                <div className="py-6 text-center text-gray-400">No expenses recorded this year.</div>
              ) : (
                S.expenseHeads.map((e) => (
                  <div key={e.name} className="mb-1">
                    <div className="flex justify-between">
                      <span className="min-w-0 flex-1 truncate">{e.name}</span>
                      <span className="font-mono">{fmt(e.amount)}</span>
                    </div>
                    <div className="h-2 w-full bg-[#eef3fa]">
                      <div className="h-2 bg-[#16437e]" style={{ width: `${Math.max(2, (e.amount / maxExp) * 100)}%` }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Recent vouchers */}
          <div className="min-w-0 flex-1 border border-[#9db8d8] bg-white">
            <div className="bg-[#16437e] px-2 py-0.5 text-[12px] font-semibold text-white">Latest Vouchers</div>
            <div className="p-1">
              {recent.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onOpenVoucher?.(v.id)}
                  title="Open voucher"
                  className="flex w-full border-b border-dashed border-gray-200 text-left hover:bg-[#fdf6d8]"
                >
                  <div className="w-20 shrink-0 px-1">{tallyDateLabel(v.voucher_date)}</div>
                  <div className="w-24 shrink-0 truncate px-1 font-mono text-[11px]">{v.voucher_number}</div>
                  <div className="min-w-0 flex-1 truncate px-1 text-gray-600">
                    {v.voucher_type?.voucher_type_name?.replace(' Voucher', '')} — {v.narration || ''}
                  </div>
                  <div className="w-28 shrink-0 px-1 text-right font-mono">{fmt(Number(v.total_amount) || 0)}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </TallyScreen>

    {report.popups}
    </>
  );
};

export default Dashboard;
