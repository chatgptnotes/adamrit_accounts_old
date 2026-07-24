import React, { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { mergedLedgerBalances, type LedgerBalanceRow, type LedgerSource } from '@/lib/mergedLedgerBalances';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { useAccountingCompany } from './AccountingCompanyContext';
import SourceBadge from './SourceBadge';
import { useSourceFilter, matchesSource } from './useSourceFilter';

interface Line {
  name: string;
  amount: number;
  ledgers: { name: string; amount: number; source: LedgerSource }[];
}

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

/**
 * Profit & Loss A/c — Tally Prime two-panel replica with the trading
 * split: direct expenses vs direct incomes above Gross Profit c/o → b/f,
 * indirect expenses vs indirect incomes below, ending in Nett Profit/Loss.
 * Adding a column with C / A / N switches it to Tally's columnar layout.
 */
const ProfitLoss: React.FC = () => {
  const { companies, selectedCompanyId } = useAccountingCompany();
  const { source: srcFilter, railItem: sourceRail } = useSourceFilter();

  const report = useTallyReport({
    filterFields: ['Particulars'],
    views: [
      { label: 'Balance Sheet', target: 'balance-sheet' },
      { label: 'Trial Balance', target: 'trial-balance' },
      { label: 'Ratio Analysis', target: 'ratio-analysis' },
      { label: 'Receipts & Payments', target: 'receipts-payments' },
    ],
    detailedToggle: { hotkey: 'F5', label: 'Ledger-wise' },
    screenKeys: [sourceRail],
  });
  const { from: fromDate, to: toDate } = report;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['profit_loss_merged', fromDate, toDate, selectedCompanyId],
    queryFn: () => mergedLedgerBalances({ from: fromDate, upto: toDate, companyId: selectedCompanyId }),
  });

  // One query per comparison column added with C / A / N
  const columnResults = useQueries({
    queries: report.columns.map((c) => ({
      queryKey: ['profit_loss_merged', c.from, c.to, selectedCompanyId],
      queryFn: () => mergedLedgerBalances({ from: c.from, upto: c.to, companyId: selectedCompanyId }),
    })),
  });

  const compute = useMemo(
    () => (ledgerRows: LedgerBalanceRow[]) => {
      const mk = (name: string): Line => ({ name, amount: 0, ledgers: [] });
      const dirExp = mk('Direct Expenses');
      const purch = mk('Purchase Accounts');
      const indExp = mk('Indirect Expenses');
      const dirInc = mk('Sales Accounts');
      const indInc = mk('Indirect Incomes');

      for (const r of ledgerRows) {
        // r.balance is signed Debit-positive / Credit-negative.
        const income = r.head === 'Sales Accounts' || r.head === 'Indirect Incomes';
        const expense = r.head === 'Direct Expenses' || r.head === 'Indirect Expenses';
        if (!income && !expense) continue;
        const bal = income ? -r.balance : r.balance; // both shown positive
        if (!report.passesBasis(bal)) continue;
        if (!report.passesFilter({ Particulars: r.name })) continue;
        const line = income
          ? r.head === 'Indirect Incomes'
            ? indInc
            : dirInc
          : r.head === 'Indirect Expenses'
            ? indExp
            : r.name.toLowerCase().includes('purchase')
              ? purch
              : dirExp;
        line.amount += bal;
        line.ledgers.push({ name: r.name, amount: bal, source: r.source });
      }

      const grossProfit = dirInc.amount - purch.amount - dirExp.amount;
      const nett = grossProfit + indInc.amount - indExp.amount;
      return {
        purchase: purch,
        directExpense: dirExp,
        indirectExpense: indExp,
        directIncome: dirInc,
        indirectIncome: indInc,
        grossProfit,
        nett,
      };
    },
    [report.passesBasis, report.passesFilter],
  );

  const { purchase, directExpense, indirectExpense, directIncome, indirectIncome, grossProfit, nett, prevs } =
    useMemo(() => {
      const cur = compute(rows.filter((r) => matchesSource(r.source, srcFilter)));
      return {
        ...cur,
        prevs: columnResults.map((q) => compute((q.data ?? []).filter((r) => matchesSource(r.source, srcFilter)))),
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, columnResults.map((q) => q.dataUpdatedAt).join(','), srcFilter, compute]);

  const companyName = companies.find((c) => c.id === selectedCompanyId)?.company_name || 'All Companies';
  const fmt = report.fmtAmount;

  const tradingTopLeft = grossProfit >= 0 ? grossProfit : 0; // Gross Profit c/o on left when profit
  const tradingTopRight = grossProfit < 0 ? -grossProfit : 0; // Gross Loss c/o on right
  const leftTradingTotal = purchase.amount + directExpense.amount + tradingTopLeft;
  const rightTradingTotal = directIncome.amount + tradingTopRight;
  const tradingTotal = Math.max(leftTradingTotal, rightTradingTotal);

  const bottomLeftTotal = indirectExpense.amount + (nett >= 0 ? nett : 0);
  const bottomRightTotal = (grossProfit >= 0 ? grossProfit : 0) + indirectIncome.amount + (nett < 0 ? -nett : 0);
  const bottomTotal = Math.max(bottomLeftTotal, bottomRightTotal);

  const lineRow = (l: Line, bold = true) =>
    Math.abs(l.amount) >= 0.005 && (
      <React.Fragment key={l.name}>
        <div className="flex justify-between">
          <span className={bold ? 'font-bold' : ''}>{l.name}</span>
          <span className="font-mono">{fmt(l.amount)}</span>
        </div>
        {report.detailed &&
          l.ledgers.map((led) => (
            <div key={`${led.source}:${led.name}`} className="flex justify-between text-[12px] italic text-gray-700">
              <span className="pl-5">
                {led.name}
                <SourceBadge source={led.source} />
              </span>
              <span className="font-mono">{fmt(led.amount)}</span>
            </div>
          ))}
      </React.Fragment>
    );

  const header = (
    <div className="border-b border-black text-right">
      <div className="font-bold">{companyName}</div>
      <div className="text-[11px]">
        {tallyDateLabel(fromDate)} to {tallyDateLabel(toDate)}
      </div>
    </div>
  );

  /** Tally's columnar P&L — one column per period added on the rail */
  const columnar = (
    <div className="min-w-max">
      <div className="flex border-y border-black bg-[#f0f4fa] font-semibold">
        <div className="w-64 flex-1 px-1">Particulars</div>
        <div className="w-44 shrink-0 px-1 text-right">
          {tallyDateLabel(fromDate)}–{tallyDateLabel(toDate)}
        </div>
        {report.columns.map((c) => (
          <div key={c.id} className="w-44 shrink-0 px-1 text-right text-gray-600">
            {c.title}
          </div>
        ))}
      </div>
      {(
        [
          ['Sales Accounts', directIncome.amount, (p) => p.directIncome.amount],
          ['Purchase Accounts', purchase.amount, (p) => p.purchase.amount],
          ['Direct Expenses', directExpense.amount, (p) => p.directExpense.amount],
          ['Gross Profit', grossProfit, (p) => p.grossProfit],
          ['Indirect Incomes', indirectIncome.amount, (p) => p.indirectIncome.amount],
          ['Indirect Expenses', indirectExpense.amount, (p) => p.indirectExpense.amount],
          ['Nett Profit', nett, (p) => p.nett],
        ] as [string, number, (p: (typeof prevs)[number]) => number][]
      ).map(([label, cur, pick]) => (
        <div
          key={label}
          className={`flex border-b border-dashed border-gray-200 ${
            label === 'Gross Profit' || label === 'Nett Profit' ? 'font-bold' : ''
          }`}
        >
          <div className="w-64 flex-1 px-1">{label}</div>
          <div className="w-44 shrink-0 px-1 text-right font-mono">{fmt(cur)}</div>
          {prevs.map((p, i) => (
            <div key={report.columns[i].id} className="w-44 shrink-0 px-1 text-right font-mono text-gray-600">
              {fmt(pick(p))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <>
      <TallyScreen title="Profit & Loss A/c" rail={report.rail}>
        <div className="px-3 pb-4 pt-1 text-[13px]">
          {isLoading ? (
            <div className="py-16 text-center text-gray-400">Loading…</div>
          ) : report.columns.length > 0 ? (
            columnar
          ) : (
            <div className="flex">
              {/* Left panel */}
              <div className="min-w-0 flex-1 border-r border-gray-400 pr-3">
                {header}
                <div className="-mt-10 pb-6 font-semibold tracking-[0.3em]">Particulars</div>
                <div className="mt-2 space-y-0.5">
                  {lineRow(purchase)}
                  {lineRow(directExpense)}
                  {grossProfit >= 0 && (
                    <div className="flex justify-between">
                      <span className="font-bold italic">Gross Profit c/o</span>
                      <span className="font-mono">{fmt(grossProfit)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-gray-400 pt-0.5">
                    <span />
                    <span className="font-mono font-semibold">{fmt(tradingTotal)}</span>
                  </div>
                  <div className="pt-2">{lineRow(indirectExpense)}</div>
                  {nett >= 0 && (
                    <div className="flex justify-between">
                      <span className="font-bold italic">Nett Profit</span>
                      <span className="font-mono">{fmt(nett)}</span>
                    </div>
                  )}
                </div>
                <div className="mt-10 flex justify-between border-t border-black pt-1 font-bold">
                  <span className="tracking-[0.3em]">Total</span>
                  <span className="font-mono">{fmt(bottomTotal)}</span>
                </div>
              </div>
              {/* Right panel */}
              <div className="min-w-0 flex-1 pl-3">
                {header}
                <div className="-mt-10 pb-6 font-semibold tracking-[0.3em]">Particulars</div>
                <div className="mt-2 space-y-0.5">
                  {lineRow(directIncome)}
                  {grossProfit < 0 && (
                    <div className="flex justify-between">
                      <span className="font-bold italic">Gross Loss c/o</span>
                      <span className="font-mono">{fmt(-grossProfit)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-gray-400 pt-0.5">
                    <span />
                    <span className="font-mono font-semibold">{fmt(tradingTotal)}</span>
                  </div>
                  <div className="pt-2">
                    {grossProfit >= 0 && (
                      <div className="flex justify-between">
                        <span className="font-bold italic">Gross Profit b/f</span>
                        <span className="font-mono">{fmt(grossProfit)}</span>
                      </div>
                    )}
                    {lineRow(indirectIncome)}
                    {nett < 0 && (
                      <div className="flex justify-between">
                        <span className="font-bold italic">Nett Loss</span>
                        <span className="font-mono">{fmt(-nett)}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-10 flex justify-between border-t border-black pt-1 font-bold">
                  <span className="tracking-[0.3em]">Total</span>
                  <span className="font-mono">{fmt(bottomTotal)}</span>
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

export default ProfitLoss;
