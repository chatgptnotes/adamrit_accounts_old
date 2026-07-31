import React, { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { mergedLedgerBalances, type LedgerBalanceRow, type LedgerSource } from '@/lib/mergedLedgerBalances';
import { normalizeName } from '@/lib/tallyCompanyMatch';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { useRowCursor } from './tally/useRowCursor';
import { dayLabel } from './tally/PeriodContext';
import {
  ASSET_HEADS,
  LIABILITY_HEADS,
  PL_EXPENSE_HEADS,
  PL_INCOME_HEADS,
  PNL_LEDGER_NAME,
  TRADING_EXPENSE_HEADS,
  TRADING_INCOME_HEADS,
} from './tally/heads';
import { useAccountingCompany } from './AccountingCompanyContext';
import { useSourceFilter, matchesSource } from './useSourceFilter';

interface Line {
  name: string;
  amount: number;
  ledgers: { name: string; amount: number; source: LedgerSource; accountId?: string }[];
}

/** A line the cursor can sit on, so Enter drills the way Tally does. */
interface CursorTarget {
  kind: 'head' | 'ledger';
  head: string;
  accountId?: string;
}

// Tally's balance-sheet heads come from the shared group table, so a company
// using Investments / Suspense A/c / Loans & Advances is not silently dropped.
const LIABILITY_ORDER = LIABILITY_HEADS;
const ASSET_ORDER = ASSET_HEADS;
// All six revenue heads feed the Profit & Loss A/c line, the same way the P&L
// screen counts them. Listing them by hand here left Purchase Accounts and
// Direct Incomes in no bucket at all, so they were dropped from the Balance
// Sheet entirely and the gap surfaced as "Difference in Opening Balances".
const INCOME_HEADS = new Set([...TRADING_INCOME_HEADS, ...PL_INCOME_HEADS]);
const EXPENSE_HEADS = new Set([...TRADING_EXPENSE_HEADS, ...PL_EXPENSE_HEADS]);

// Tally's one reserved ledger that carries profit brought forward.
const PNL_LEDGER = PNL_LEDGER_NAME;

/**
 * Balance Sheet — Tally Prime two-panel replica: Liabilities | Assets,
 * grouped into Tally's heads, P&L A/c on the liabilities side with the
 * current-period figure, matching grand totals on both panels.
 */
const BalanceSheet: React.FC<{
  onOpenGroup?: (head: string) => void;
  onOpenLedger?: (accountId: string) => void;
}> = ({ onOpenGroup, onOpenLedger }) => {
  const { companies, selectedCompanyId } = useAccountingCompany();
  const { source: srcFilter, railItem: sourceRail } = useSourceFilter();
  const [showProfit, setShowProfit] = useState(false);

  const report = useTallyReport({
    filterFields: ['Particulars'],
    views: [
      { label: 'Profit & Loss A/c', target: 'profit-loss' },
      { label: 'Trial Balance', target: 'trial-balance' },
      { label: 'Ratio Analysis', target: 'ratio-analysis' },
      { label: 'Cash Flow', target: 'cash-flow' },
    ],
    // Tally's Balance Sheet F12
    configFields: [
      { key: 'vertical', label: 'Show Vertical Balance Sheet' },
      { key: 'percentages', label: 'Show Percentages' },
    ],
    detailedToggle: { hotkey: 'F5', label: 'Ledger-wise' },
    // Collapsed by default — click a head to open just that one. F5 still
    // expands every head at once.
    initialDetailed: false,
    // Tally exports the Balance Sheet as the two sides side by side; here they
    // are stacked with their side named, which survives a spreadsheet sort.
    exportData: () => ({
      title: 'Balance Sheet',
      period: report.periodLabel,
      columns: ['Side', 'Particulars', 'Amount'],
      rows: [
        ...liabilityLines.flatMap((line) => [
          ['Liabilities', line.name, line.amount] as (string | number)[],
          ...line.ledgers.map((led) => ['Liabilities', `  ${led.name}`, led.amount] as (string | number)[]),
        ]),
        ['Liabilities', 'Profit & Loss A/c', pnl],
        ['Liabilities', 'Total', totalLiab],
        ...assetLines.flatMap((line) => [
          ['Assets', line.name, line.amount] as (string | number)[],
          ...line.ledgers.map((led) => ['Assets', `  ${led.name}`, led.amount] as (string | number)[]),
        ]),
        ['Assets', 'Total', totalAssets],
      ],
    }),
    screenKeys: [
      // Tally's F7 opens the income / expenditure breakup behind the P&L line,
      // so this screen's Source filter moves off F7 to keep the key free.
      { hotkey: 'F7', label: 'Show Profit', active: showProfit, onClick: () => setShowProfit((v) => !v) },
      { ...sourceRail, hotkey: 'F10' },
    ],
  });
  const vertical = !!report.config.vertical;
  const percentages = !!report.config.percentages;

  // Heads the user has opened by clicking. Independent of the F5 toggle.
  const [openHeads, setOpenHeads] = useState<Set<string>>(new Set());
  const toggleHead = (head: string): void =>
    setOpenHeads((prev) => {
      const next = new Set(prev);
      if (next.has(head)) next.delete(head);
      else next.add(head);
      return next;
    });
  const asOfDate = report.to;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['balance_sheet_merged', asOfDate, selectedCompanyId],
    queryFn: () => mergedLedgerBalances({ upto: asOfDate, companyId: selectedCompanyId }),
  });

  // One query per comparison column added with C / A / N
  const columnResults = useQueries({
    queries: report.columns.map((c) => ({
      queryKey: ['balance_sheet_merged', c.to, selectedCompanyId],
      queryFn: () => mergedLedgerBalances({ upto: c.to, companyId: selectedCompanyId }),
    })),
  });

  const compute = useMemo(
    () => (ledgerRows: LedgerBalanceRow[]) => {
      const liabGroups = new Map<string, Line>();
      const assetGroups = new Map<string, Line>();
      let income = 0;
      let expense = 0;
      let broughtForward = 0;

      for (const r of ledgerRows) {
        // r.balance is signed Debit-positive / Credit-negative.
        if (normalizeName(r.name) === PNL_LEDGER) {
          // Tally's reserved Profit & Loss A/c is a Balance Sheet line of its own,
          // not a Capital Account member. Its balance is profit brought forward, so
          // it joins the current period's income - expense on the P&L line below.
          broughtForward += -r.balance;
        } else if (INCOME_HEADS.has(r.head)) {
          income += -r.balance;
        } else if (EXPENSE_HEADS.has(r.head)) {
          expense += r.balance;
        } else if (LIABILITY_ORDER.includes(r.head) || ASSET_ORDER.includes(r.head)) {
          const liability = LIABILITY_ORDER.includes(r.head);
          const bal = liability ? -r.balance : r.balance;
          if (!report.passesBasis(bal)) continue;
          if (!report.passesFilter({ Particulars: r.name })) continue;
          const groups = liability ? liabGroups : assetGroups;
          const line = groups.get(r.head) ?? { name: r.head, amount: 0, ledgers: [] };
          line.amount += bal;
          line.ledgers.push({ name: r.name, amount: bal, source: r.source, accountId: r.accountId });
          groups.set(r.head, line);
        }
      }

      const pnlAmount = broughtForward + income - expense;
      const liabilityLines = LIABILITY_ORDER.map((h) => liabGroups.get(h)).filter(Boolean) as Line[];
      const assetLines = ASSET_ORDER.map((h) => assetGroups.get(h)).filter(Boolean) as Line[];

      const totalLiab = liabilityLines.reduce((s, l) => s + l.amount, 0) + pnlAmount;
      const totalAssets = assetLines.reduce((s, l) => s + l.amount, 0);
      // Tally shows whatever is missing as "Difference in Opening Balances" on
      // the short side, so both Totals are the sum of the rows actually
      // printed under them — the plug row included. That makes the two sides
      // tie, but the gap stays on screen as a labelled line rather than being
      // absorbed silently; `difference` is what drives it.
      const difference = totalLiab - totalAssets;
      const grandTotal = totalLiab + Math.max(0, -difference);
      return {
        liabilityLines,
        assetLines,
        pnl: pnlAmount,
        income,
        expense,
        broughtForward,
        difference,
        totalLiab: grandTotal,
        totalAssets: grandTotal,
      };
    },
    [report.passesBasis, report.passesFilter],
  );

  const { liabilityLines, assetLines, pnl, income, expense, broughtForward, difference, totalLiab, totalAssets, cmps } =
    useMemo(() => {
      const cur = compute(rows.filter((r) => matchesSource(r.source, srcFilter)));
      return {
        ...cur,
        cmps: columnResults.map((q) => compute((q.data ?? []).filter((r) => matchesSource(r.source, srcFilter)))),
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, columnResults.map((q) => q.dataUpdatedAt).join(','), srcFilter, compute]);

  const companyName = companies.find((c) => c.id === selectedCompanyId)?.company_name || 'All Companies';
  const hasColumns = report.columns.length > 0;

  // Every line Enter can drill from, liabilities first then assets — the same
  // order the eye reads them in. Without this the Balance Sheet answered no
  // keyboard at all.
  const targets = useMemo<CursorTarget[]>(() => {
    const out: CursorTarget[] = [];
    const walk = (lines: Line[]) => {
      for (const l of lines) {
        out.push({ kind: 'head', head: l.name });
        if (report.detailed || openHeads.has(l.name)) {
          if (hasColumns) continue;
          for (const led of l.ledgers) out.push({ kind: 'ledger', head: l.name, accountId: led.accountId });
        }
      }
    };
    walk(liabilityLines);
    walk(assetLines);
    return out;
  }, [liabilityLines, assetLines, report.detailed, openHeads, hasColumns]);

  // Where the Assets panel's cursor indices start.
  const liabTargetCount = useMemo(
    () =>
      liabilityLines.reduce(
        (n, l) =>
          n + 1 + ((report.detailed || openHeads.has(l.name)) && !hasColumns ? l.ledgers.length : 0),
        0,
      ),
    [liabilityLines, report.detailed, openHeads, hasColumns],
  );

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

  /** "12.34 %" beside a figure, as Tally's Show Percentages prints it. */
  const pct = (amount: number, total: number) =>
    percentages ? (
      <span className="w-20 shrink-0 text-right font-mono text-[11px] text-gray-500">
        {total ? `${((amount / total) * 100).toFixed(2)} %` : ''}
      </span>
    ) : null;

  const panel = (
    title: string,
    lines: Line[],
    cmpMaps: Map<string, number>[],
    startIndex: number,
    extra?: React.ReactNode,
    total?: number,
    cmpTotals?: number[],
  ) => {
    let at = startIndex - 1;
    return (
      <div className="min-w-0 flex-1">
        <div className="flex items-end justify-between border-b border-black">
          <span className="font-semibold tracking-[0.3em]">{title}</span>
          <span className="text-right">
            <span className="block font-bold">{companyName}</span>
            <span className="block text-[11px]">
              as at {dayLabel(asOfDate)}
              {report.columns.map((c) => ` | ${c.title}`).join('')}
            </span>
          </span>
        </div>
        <div className="mt-2 space-y-0.5">
          {lines.map((l) => {
            const open = report.detailed || openHeads.has(l.name);
            at += 1;
            const headIndex = at;
            return (
              <React.Fragment key={l.name}>
                <button
                  type="button"
                  onClick={() => toggleHead(l.name)}
                  onDoubleClick={() => onOpenGroup?.(l.name)}
                  onMouseEnter={() => setCursor(headIndex)}
                  title={`${open ? 'Collapse' : 'Expand'} ${l.name} · Enter opens Group Summary`}
                  className={`flex w-full justify-between text-left ${
                    cursor === headIndex ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'
                  }`}
                >
                  <span className="min-w-0 flex-1 font-bold">
                    <span className="inline-block w-3 text-gray-500">{open ? '▾' : '▸'}</span>
                    {l.name}
                  </span>
                  {pct(l.amount, total ?? 0)}
                  <span className="w-36 shrink-0 text-right font-mono">{report.fmtAmount(l.amount)}</span>
                  {cmpMaps.map((m, i) => (
                    <span key={report.columns[i].id} className="w-36 shrink-0 text-right font-mono text-gray-600">
                      {report.fmtAmount(m.get(l.name) ?? 0)}
                    </span>
                  ))}
                </button>
                {open &&
                  !hasColumns &&
                  l.ledgers.map((led) => {
                    at += 1;
                    const ledgerIndex = at;
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
                        {pct(led.amount, total ?? 0)}
                        <span className="w-36 shrink-0 text-right font-mono">{report.fmtAmount(led.amount)}</span>
                      </button>
                    );
                  })}
              </React.Fragment>
            );
          })}
          {extra}
        </div>
        {total !== undefined && (
          <div className="mt-10 flex justify-between border-t border-black pt-1 font-bold">
            <span className="min-w-0 flex-1 tracking-[0.3em]">Total</span>
            {percentages && <span className="w-20 shrink-0" />}
            <span className="w-36 shrink-0 text-right font-mono">{report.fmtAmount(total)}</span>
            {(cmpTotals ?? []).map((t, i) => (
              <span key={report.columns[i].id} className="w-36 shrink-0 text-right font-mono text-gray-600">
                {report.fmtAmount(t)}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  /** A non-drillable line under a panel (P&L A/c, Difference in Opening Balances). */
  const plainLine = (label: string, amount: number, cmpAmounts: number[], bold = true) => (
    <div className="flex justify-between">
      <span className={`min-w-0 flex-1 ${bold ? 'font-bold' : ''}`}>
        {/* w-3 spacer keeps this aligned with the collapsible heads above */}
        <span className="inline-block w-3" />
        {label}
      </span>
      {percentages && <span className="w-20 shrink-0" />}
      <span className="w-36 shrink-0 text-right font-mono">{report.fmtAmount(amount)}</span>
      {cmpAmounts.map((a, i) => (
        <span key={report.columns[i].id} className="w-36 shrink-0 text-right font-mono text-gray-600">
          {report.fmtAmount(a)}
        </span>
      ))}
    </div>
  );

  return (
    <>
      <TallyScreen title="Balance Sheet" rail={report.rail}>
        <div className="px-3 pb-4 pt-1 text-[13px]">
          {isLoading ? (
            <div className="py-16 text-center text-gray-400">Loading…</div>
          ) : (
            (() => {
              const liabExtra = (
                <>
                  {plainLine(
                    'Profit & Loss A/c',
                    pnl,
                    cmps.map((c) => c.pnl),
                  )}
                  {/* F7: Show Profit — Tally opens the P&L behind that one line */}
                  {showProfit && (
                    <div className="pl-3 text-[12px] italic text-gray-700">
                      {plainLine('Opening Balance', broughtForward, cmps.map((c) => c.broughtForward), false)}
                      {plainLine('Current Period Income', income, cmps.map((c) => c.income), false)}
                      {plainLine('Less: Current Period Expenses', -expense, cmps.map((c) => -c.expense), false)}
                    </div>
                  )}
                  {difference < -0.005 &&
                    plainLine(
                      'Difference in Opening Balances',
                      -difference,
                      cmps.map((c) => Math.max(0, -c.difference)),
                    )}
                </>
              );
              const assetExtra =
                difference > 0.005
                  ? plainLine(
                      'Difference in Opening Balances',
                      difference,
                      cmps.map((c) => Math.max(0, c.difference)),
                    )
                  : undefined;
              const liabPanel = panel(
                'Liabilities',
                liabilityLines,
                cmps.map((c) => new Map(c.liabilityLines.map((l) => [l.name, l.amount]))),
                0,
                liabExtra,
                totalLiab,
                cmps.map((c) => c.totalLiab),
              );
              const assetPanel = panel(
                'Assets',
                assetLines,
                cmps.map((c) => new Map(c.assetLines.map((l) => [l.name, l.amount]))),
                liabTargetCount,
                assetExtra,
                totalAssets,
                cmps.map((c) => c.totalAssets),
              );

              // F12: Vertical Balance Sheet — Tally stacks the two halves
              return vertical ? (
                <div className="mx-auto max-w-3xl space-y-8">
                  {liabPanel}
                  {assetPanel}
                </div>
              ) : (
                <div className="flex gap-0">
                  <div className="flex-1 border-r border-gray-400 pr-3">{liabPanel}</div>
                  <div className="flex-1 pl-3">{assetPanel}</div>
                </div>
              );
            })()
          )}
        </div>
      </TallyScreen>

      {report.popups}
    </>
  );
};

export default BalanceSheet;
