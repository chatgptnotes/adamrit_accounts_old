import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { accountMovements, type Movement } from '@/lib/accountMovements';
import { format } from 'date-fns';
import { fetchActiveAccounts } from '@/lib/fetchAccounts';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { useAccountingCompany } from './AccountingCompanyContext';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  opening_balance: number | null;
  opening_balance_type: string | null;
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

/**
 * Ratio Analysis — Tally Prime replica: Principal Groups (working capital,
 * cash, bank, debtors, creditors…) on the left, Principal Ratios (current
 * ratio, quick ratio, debt/equity, profit %, turnover days) on the right.
 * Live figures from the chart of accounts + account_movements aggregate.
 */
const RatioAnalysis: React.FC = () => {
  const report = useTallyReport({
    supportsColumns: false,
    filterFields: ['Ratio'],
    views: [
      { label: 'Balance Sheet', target: 'balance-sheet' },
      { label: 'Profit & Loss A/c', target: 'profit-loss' },
      { label: 'Trial Balance', target: 'trial-balance' },
      { label: 'Cash Flow', target: 'cash-flow' },
    ],
  });
  const { selectedCompanyId } = useAccountingCompany();
  const asOfDate = report.to;
  const from = fyStart();

  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ['tb_accounts', selectedCompanyId],
    enabled: !!selectedCompanyId,
    queryFn: () => fetchActiveAccounts<Account>({ columns: 'id, account_code, account_name, account_type, opening_balance, opening_balance_type', companyId: selectedCompanyId }),
  });

  // Cumulative balances to date (balance-sheet items)
  const { data: cumulative = new Map<string, Movement>(), isLoading: l1 } = useQuery({
    queryKey: ['ratio_cumulative', selectedCompanyId, asOfDate],
    enabled: !!selectedCompanyId,
    queryFn: () => accountMovements({ upto: asOfDate, companyId: selectedCompanyId }),
  });
  // FY-window movements (P&L items)
  const { data: period = new Map<string, Movement>(), isLoading: l2 } = useQuery({
    queryKey: ['ratio_period', selectedCompanyId, from, asOfDate],
    enabled: !!selectedCompanyId,
    queryFn: () => accountMovements({ from, upto: asOfDate, companyId: selectedCompanyId }),
  });

  const R = useMemo(() => {
    const bal = (a: Account): number => {
      const opening = (Number(a.opening_balance) || 0) * (a.opening_balance_type?.toUpperCase() === 'CR' ? -1 : 1);
      const m = cumulative.get(a.id);
      return opening + (m ? m.debit - m.credit : 0);
    };
    let cash = 0;
    let bank = 0;
    let debtors = 0;
    let otherCA = 0;
    let currentLiab = 0;
    let loans = 0;
    let capital = 0;
    let fixedAssets = 0;
    let income = 0;
    let directExpense = 0;
    let indirectExpense = 0;

    for (const a of accounts) {
      const t = a.account_type?.toUpperCase() ?? '';
      const code = a.account_code;
      if (t.includes('INCOME')) {
        const m = period.get(a.id);
        income += m ? m.credit - m.debit : 0;
      } else if (t.includes('EXPENSE')) {
        const m = period.get(a.id);
        const v = m ? m.debit - m.credit : 0;
        if (t === 'INDIRECT_EXPENSES') indirectExpense += v;
        else directExpense += v;
      } else if (t === 'CURRENT_ASSETS' || t === 'ASSETS') {
        const b = bal(a);
        if (code.startsWith('111')) cash += b;
        else if (code.startsWith('112')) bank += b;
        else if (a.account_name.toLowerCase().includes('debtor')) debtors += b;
        else otherCA += b;
      } else if (t === 'FIXED_ASSETS') {
        fixedAssets += bal(a);
      } else if (t === 'CURRENT_LIABILITIES' || t === 'LIABILITIES') {
        currentLiab += -bal(a);
      } else if (t === 'LONG_TERM_LIABILITIES') {
        loans += -bal(a);
      } else if (t === 'EQUITY') {
        capital += -bal(a);
      }
    }

    const currentAssets = cash + bank + debtors + otherCA;
    const workingCapital = currentAssets - currentLiab;
    const totalExpense = directExpense + indirectExpense;
    const nettProfit = income - totalExpense;
    const grossProfit = income - directExpense;
    const days = Math.max(1, Math.round((new Date(asOfDate).getTime() - new Date(from).getTime()) / 86400000) + 1);
    return {
      workingCapital,
      cash,
      bank,
      debtors,
      currentAssets,
      currentLiab,
      loans,
      capital,
      fixedAssets,
      income,
      nettProfit,
      grossProfit,
      currentRatio: currentLiab > 0 ? currentAssets / currentLiab : null,
      // No stock ledgers in this chart, so quick ratio equals current ratio
      quickRatio: currentLiab > 0 ? currentAssets / currentLiab : null,
      debtEquity: capital + nettProfit > 0 ? loans / (capital + nettProfit) : null,
      grossPct: income > 0 ? (grossProfit / income) * 100 : null,
      nettPct: income > 0 ? (nettProfit / income) * 100 : null,
      opCostPct: income > 0 ? (totalExpense / income) * 100 : null,
      recvTurnoverDays: income > 0 ? (debtors / income) * days : null,
    };
  }, [accounts, cumulative, period, asOfDate, from]);

  const isLoading = accountsLoading || l1 || l2;

  // Tally drills a ratio line into the report that explains it
  const row = (label: string, value: string, indent = false, target?: string) => (
    target ? (
      <button
        key={label}
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('tally-goto', { detail: target }))}
        className="flex w-full justify-between border-b border-dashed border-gray-200 py-0.5 text-left hover:bg-[#fdf6d8]"
      >
        <span className="font-semibold">{label}</span>
        <span className="font-mono">{value}</span>
      </button>
    ) : (
    <div key={label} className="flex justify-between border-b border-dashed border-gray-200 py-0.5">
      <span className={indent ? 'pl-4 text-[11px] italic text-gray-500' : 'font-semibold'}>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
    )
  );
  const ratio = (v: number | null, suffix = ''): string => (v === null ? '—' : `${fmt(v)}${suffix}`);

  return (
    <>
    <TallyScreen
      title="Ratio Analysis"
      rail={report.rail}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        <div className="text-center text-[11px]">
          {tallyDateLabel(from)} to {tallyDateLabel(asOfDate)}
        </div>
        {isLoading ? (
          <div className="py-16 text-center text-gray-400">Loading…</div>
        ) : (
          <div className="mt-1 flex">
            {/* Principal Groups */}
            <div className="min-w-0 flex-1 border-r border-gray-400 pr-3">
              <div className="border-b border-black pb-0.5 font-semibold tracking-[0.2em]">Principal Groups</div>
              <div className="mt-1">
                {row('Working Capital', fmt(R.workingCapital), false, 'balance-sheet')}
                {row('(Current Assets − Current Liabilities)', '', true)}
                {row('Cash-in-Hand', fmt(R.cash), false, 'cash-bank-summary')}
                {row('Bank Accounts', fmt(R.bank), false, 'cash-bank-summary')}
                {row('Sundry Debtors', fmt(R.debtors), false, 'billwise')}
                {row('Current Assets', fmt(R.currentAssets), false, 'balance-sheet')}
                {row('Current Liabilities', fmt(R.currentLiab), false, 'balance-sheet')}
                {row('Loans (Liability)', fmt(R.loans), false, 'balance-sheet')}
                {row('Capital Account', fmt(R.capital), false, 'balance-sheet')}
                {row('Fixed Assets', fmt(R.fixedAssets), false, 'balance-sheet')}
                {row('Nett Profit', fmt(R.nettProfit), false, 'profit-loss')}
              </div>
            </div>
            {/* Principal Ratios */}
            <div className="min-w-0 flex-1 pl-3">
              <div className="border-b border-black pb-0.5 font-semibold tracking-[0.2em]">Principal Ratios</div>
              <div className="mt-1">
                {row('Current Ratio', ratio(R.currentRatio, ' : 1'))}
                {row('(Current Assets : Current Liabilities)', '', true)}
                {row('Quick Ratio', ratio(R.quickRatio, ' : 1'))}
                {row('Debt/Equity Ratio', ratio(R.debtEquity, ' : 1'))}
                {row('Gross Profit %', ratio(R.grossPct, ' %'), false, 'profit-loss')}
                {row('Nett Profit %', ratio(R.nettPct, ' %'), false, 'profit-loss')}
                {row('Operating Cost %', ratio(R.opCostPct, ' %'), false, 'profit-loss')}
                {row(
                  'Recv. Turnover in days',
                  R.recvTurnoverDays === null ? '—' : `${Math.round(R.recvTurnoverDays)} days`,
                )}
                {row('(payment performance of Debtors)', '', true)}
              </div>
            </div>
          </div>
        )}
      </div>
    </TallyScreen>

    {report.popups}
    </>
  );
};

export default RatioAnalysis;
