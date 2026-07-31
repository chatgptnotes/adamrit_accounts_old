import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { mergedLedgerBalances, type LedgerBalanceRow, type LedgerSource } from '@/lib/mergedLedgerBalances';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { useRowCursor } from './tally/useRowCursor';
import { dayLabel, monthsInPeriod } from './tally/PeriodContext';
import { useAccountingCompany } from './AccountingCompanyContext';
import { useSourceFilter, matchesSource } from './useSourceFilter';

interface Line {
  name: string;
  amount: number;
  ledgers: { name: string; amount: number; source: LedgerSource; accountId?: string }[];
}

/** A line Enter can drill from — the head, or one of its ledgers. */
interface CursorTarget {
  kind: 'head' | 'ledger';
  head: string;
  accountId?: string;
}

/**
 * Profit & Loss A/c — Tally Prime two-panel replica with the trading
 * split: direct expenses vs direct incomes above Gross Profit c/o → b/f,
 * indirect expenses vs indirect incomes below, ending in Nett Profit/Loss.
 * Adding a column with C / A / N switches it to Tally's columnar layout.
 */
const ProfitLoss: React.FC<{
  onOpenGroup?: (head: string) => void;
  onOpenLedger?: (accountId: string) => void;
}> = ({ onOpenGroup, onOpenLedger }) => {
  const { companies, selectedCompanyId } = useAccountingCompany();
  const { source: srcFilter, railItem: sourceRail } = useSourceFilter();
  const [monthly, setMonthly] = useState(false);

  const report = useTallyReport({
    filterFields: ['Particulars'],
    views: [
      { label: 'Balance Sheet', target: 'balance-sheet' },
      { label: 'Trial Balance', target: 'trial-balance' },
      { label: 'Ratio Analysis', target: 'ratio-analysis' },
      { label: 'Receipts & Payments', target: 'receipts-payments' },
    ],
    // Tally's P&L F12
    configFields: [{ key: 'percentages', label: 'Show Percentages' }],
    detailedToggle: { hotkey: 'F5', label: 'Ledger-wise' },
    screenKeys: [
      // Tally's most-used P&L view: one column per month across the period
      { hotkey: 'F6', label: 'Monthly', active: monthly, onClick: () => setMonthly((v) => !v) },
      sourceRail,
    ],
    // Expenditure and income stacked with their side named, so a spreadsheet
    // sort cannot separate a ledger from the group it belongs to.
    exportData: () => {
      const side = (name: string, lines: typeof purchase[]) =>
        lines.flatMap((line) => [
          [name, line.name, line.amount] as (string | number)[],
          ...line.ledgers.map((led) => [name, `  ${led.name}`, led.amount] as (string | number)[]),
        ]);
      return {
        title: 'Profit & Loss A/c',
        period: report.periodLabel,
        columns: ['Side', 'Particulars', 'Amount'],
        rows: [
          ...side('Expenditure', [purchase, directExpense, indirectExpense]),
          ...side('Income', [sales, directIncome, indirectIncome]),
          ['', 'Gross Profit', grossProfit],
          ['', 'Nett Profit', nett],
        ],
      };
    },
  });
  const { from: fromDate, to: toDate } = report;
  const percentages = !!report.config.percentages;

  // Lay the month columns out (and take them away again) without touching a
  // comparison column the user added themselves with Alt+C.
  const ownsColumns = useRef(false);
  useEffect(() => {
    if (monthly) {
      report.replaceColumns(
        monthsInPeriod({ from: fromDate, to: toDate }).map((m) => ({
          title: m.label,
          from: m.from,
          to: m.upto,
        })),
      );
      ownsColumns.current = true;
    } else if (ownsColumns.current) {
      report.replaceColumns([]);
      ownsColumns.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthly, fromDate, toDate]);

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
      const sales = mk('Sales Accounts');
      const dirInc = mk('Direct Incomes');
      const indInc = mk('Indirect Incomes');

      // Purchase Accounts and Direct Incomes are real Tally primary groups and
      // now come straight off the ledger's head. This used to guess purchases
      // by testing whether the ledger name contained the word "purchase".
      const INCOME_LINES: Record<string, Line> = {
        'Sales Accounts': sales,
        'Direct Incomes': dirInc,
        'Indirect Incomes': indInc,
      };
      const EXPENSE_LINES: Record<string, Line> = {
        'Purchase Accounts': purch,
        'Direct Expenses': dirExp,
        'Indirect Expenses': indExp,
      };

      for (const r of ledgerRows) {
        // r.balance is signed Debit-positive / Credit-negative.
        const line = INCOME_LINES[r.head] ?? EXPENSE_LINES[r.head];
        if (!line) continue;
        const bal = INCOME_LINES[r.head] ? -r.balance : r.balance; // both shown positive
        if (!report.passesBasis(bal)) continue;
        if (!report.passesFilter({ Particulars: r.name })) continue;
        line.amount += bal;
        line.ledgers.push({ name: r.name, amount: bal, source: r.source, accountId: r.accountId });
      }

      // Tally's trading account: sales + direct incomes against purchases +
      // direct expenses. (No opening/closing stock — this installation has no
      // inventory module, so there is no stock figure to bring in.)
      const tradingIncome = sales.amount + dirInc.amount;
      const tradingExpense = purch.amount + dirExp.amount;
      const grossProfit = tradingIncome - tradingExpense;
      const nett = grossProfit + indInc.amount - indExp.amount;
      return {
        purchase: purch,
        directExpense: dirExp,
        indirectExpense: indExp,
        sales,
        directIncome: dirInc,
        indirectIncome: indInc,
        grossProfit,
        nett,
      };
    },
    [report.passesBasis, report.passesFilter],
  );

  const { purchase, directExpense, indirectExpense, sales, directIncome, indirectIncome, grossProfit, nett, prevs } =
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
  const rightTradingTotal = sales.amount + directIncome.amount + tradingTopRight;
  const tradingTotal = Math.max(leftTradingTotal, rightTradingTotal);

  const bottomLeftTotal = indirectExpense.amount + (nett >= 0 ? nett : 0);
  const bottomRightTotal = (grossProfit >= 0 ? grossProfit : 0) + indirectIncome.amount + (nett < 0 ? -nett : 0);
  const bottomTotal = Math.max(bottomLeftTotal, bottomRightTotal);

  // Percentages are of turnover, the way Tally's Show Percentages reads them.
  const turnover = sales.amount + directIncome.amount;

  const leftLines = [purchase, directExpense, indirectExpense];
  const rightLines = [sales, directIncome, indirectIncome];
  const shown = (l: Line) => Math.abs(l.amount) >= 0.005;

  // Enter drills a head to its Group Summary and a ledger to its vouchers —
  // left column first, then right, matching the reading order.
  const targets = useMemo<CursorTarget[]>(() => {
    const out: CursorTarget[] = [];
    for (const l of [...leftLines, ...rightLines]) {
      if (!shown(l)) continue;
      out.push({ kind: 'head', head: l.name });
      if (report.detailed) {
        for (const led of l.ledgers) out.push({ kind: 'ledger', head: l.name, accountId: led.accountId });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchase, directExpense, indirectExpense, sales, directIncome, indirectIncome, report.detailed]);

  const { cursor, setCursor } = useRowCursor({
    count: targets.length,
    onEnter: (index) => {
      const t = targets[index];
      if (!t) return;
      if (t.kind === 'ledger') {
        if (t.accountId) onOpenLedger?.(t.accountId);
        return;
      }
      onOpenGroup?.(t.head);
    },
  });

  // Cursor index of each head, computed in the same order as `targets`.
  const indexOf = useMemo(() => {
    const map = new Map<string, number>();
    let at = 0;
    for (const l of [...leftLines, ...rightLines]) {
      if (!shown(l)) continue;
      map.set(l.name, at);
      at += 1 + (report.detailed ? l.ledgers.length : 0);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchase, directExpense, indirectExpense, sales, directIncome, indirectIncome, report.detailed]);

  const pct = (amount: number) =>
    percentages ? (
      <span className="w-20 shrink-0 text-right font-mono text-[11px] text-gray-500">
        {turnover ? `${((amount / turnover) * 100).toFixed(2)} %` : ''}
      </span>
    ) : null;

  const lineRow = (l: Line, bold = true) => {
    if (!shown(l)) return null;
    const headIndex = indexOf.get(l.name) ?? -1;
    return (
      <React.Fragment key={l.name}>
        <button
          type="button"
          onClick={() => onOpenGroup?.(l.name)}
          onMouseEnter={() => setCursor(headIndex)}
          title="Open Group Summary"
          className={`flex w-full justify-between text-left ${
            cursor === headIndex ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'
          }`}
        >
          <span className={`min-w-0 flex-1 ${bold ? 'font-bold' : ''}`}>{l.name}</span>
          {pct(l.amount)}
          <span className="w-36 shrink-0 text-right font-mono">{fmt(l.amount)}</span>
        </button>
        {report.detailed &&
          l.ledgers.map((led, li) => {
            const ledgerIndex = headIndex + 1 + li;
            return (
              <button
                key={`${led.source}:${led.name}`}
                type="button"
                onClick={() => led.accountId && onOpenLedger?.(led.accountId)}
                onMouseEnter={() => setCursor(ledgerIndex)}
                title="Open Ledger Vouchers"
                className={`flex w-full justify-between text-left text-[12px] italic text-gray-700 ${
                  cursor === ledgerIndex ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'
                }`}
              >
                <span className="min-w-0 flex-1 pl-5">{led.name}</span>
                {pct(led.amount)}
                <span className="w-36 shrink-0 text-right font-mono">{fmt(led.amount)}</span>
              </button>
            );
          })}
      </React.Fragment>
    );
  };

  /** A total / carried-forward line — not drillable. */
  const plainRow = (label: string, amount: number, italic = false) => (
    <div className="flex justify-between">
      <span className={`min-w-0 flex-1 font-bold ${italic ? 'italic' : ''}`}>{label}</span>
      {percentages && <span className="w-20 shrink-0" />}
      <span className="w-36 shrink-0 text-right font-mono">{fmt(amount)}</span>
    </div>
  );

  const header = (title: string) => (
    <div className="flex items-end justify-between border-b border-black">
      <span className="font-semibold tracking-[0.3em]">{title}</span>
      <span className="text-right">
        <span className="block font-bold">{companyName}</span>
        <span className="block text-[11px]">
          {dayLabel(fromDate)} to {dayLabel(toDate)}
        </span>
      </span>
    </div>
  );

  /** Tally's columnar P&L — one column per period added on the rail */
  const columnar = (
    <div className="min-w-max">
      <div className="flex border-y border-black bg-[#f0f4fa] font-semibold">
        <div className="w-64 flex-1 px-1">Particulars</div>
        <div className="w-44 shrink-0 px-1 text-right">
          {dayLabel(fromDate)}–{dayLabel(toDate)}
        </div>
        {report.columns.map((c) => (
          <div key={c.id} className="w-44 shrink-0 px-1 text-right text-gray-600">
            {c.title}
          </div>
        ))}
      </div>
      {(
        [
          ['Sales Accounts', sales.amount, (p) => p.sales.amount],
          ['Direct Incomes', directIncome.amount, (p) => p.directIncome.amount],
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
              {/* Left panel — Tally's expense side */}
              <div className="min-w-0 flex-1 border-r border-gray-400 pr-3">
                {header('Particulars')}
                <div className="mt-2 space-y-0.5">
                  {lineRow(purchase)}
                  {lineRow(directExpense)}
                  {grossProfit >= 0 && plainRow('Gross Profit c/o', grossProfit, true)}
                  {/* Tally prints "Total" on both sides of the trading section too */}
                  <div className="border-t border-gray-400 pt-0.5">{plainRow('Total', tradingTotal)}</div>
                  <div className="pt-2">{lineRow(indirectExpense)}</div>
                  {nett >= 0 && plainRow('Nett Profit', nett, true)}
                </div>
                <div className="mt-10 border-t border-black pt-1">{plainRow('Total', bottomTotal)}</div>
              </div>
              {/* Right panel — Tally's income side */}
              <div className="min-w-0 flex-1 pl-3">
                {header('Particulars')}
                <div className="mt-2 space-y-0.5">
                  {lineRow(sales)}
                  {lineRow(directIncome)}
                  {grossProfit < 0 && plainRow('Gross Loss c/o', -grossProfit, true)}
                  <div className="border-t border-gray-400 pt-0.5">{plainRow('Total', tradingTotal)}</div>
                  <div className="pt-2">
                    {grossProfit >= 0 && plainRow('Gross Profit b/f', grossProfit, true)}
                    {lineRow(indirectIncome)}
                    {nett < 0 && plainRow('Nett Loss', -nett, true)}
                  </div>
                </div>
                <div className="mt-10 border-t border-black pt-1">{plainRow('Total', bottomTotal)}</div>
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
