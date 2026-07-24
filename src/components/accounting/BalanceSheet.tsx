import React, { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { mergedLedgerBalances, type LedgerBalanceRow, type LedgerSource } from '@/lib/mergedLedgerBalances';
import { normalizeName } from '@/lib/tallyCompanyMatch';
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

// Tally balance-sheet heads (shared HEAD_ORDER names), split into the two panels.
const LIABILITY_ORDER = ['Capital Account', 'Loans (Liability)', 'Current Liabilities'];
const ASSET_ORDER = ['Fixed Assets', 'Current Assets'];

// Tally's one reserved ledger that carries profit brought forward.
const PNL_LEDGER = 'profit & loss a/c';

/**
 * Balance Sheet — Tally Prime two-panel replica: Liabilities | Assets,
 * grouped into Tally's heads, P&L A/c on the liabilities side with the
 * current-period figure, matching grand totals on both panels.
 */
const BalanceSheet: React.FC = () => {
  const { companies, selectedCompanyId } = useAccountingCompany();
  const { source: srcFilter, railItem: sourceRail } = useSourceFilter();

  const report = useTallyReport({
    filterFields: ['Particulars'],
    views: [
      { label: 'Profit & Loss A/c', target: 'profit-loss' },
      { label: 'Trial Balance', target: 'trial-balance' },
      { label: 'Ratio Analysis', target: 'ratio-analysis' },
      { label: 'Cash Flow', target: 'cash-flow' },
    ],
    detailedToggle: { hotkey: 'F5', label: 'Ledger-wise' },
    initialDetailed: true,
    screenKeys: [sourceRail],
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
        } else if (r.head === 'Sales Accounts' || r.head === 'Indirect Incomes') {
          income += -r.balance;
        } else if (r.head === 'Direct Expenses' || r.head === 'Indirect Expenses') {
          expense += r.balance;
        } else if (LIABILITY_ORDER.includes(r.head) || ASSET_ORDER.includes(r.head)) {
          const liability = LIABILITY_ORDER.includes(r.head);
          const bal = liability ? -r.balance : r.balance;
          if (!report.passesBasis(bal)) continue;
          if (!report.passesFilter({ Particulars: r.name })) continue;
          const groups = liability ? liabGroups : assetGroups;
          const line = groups.get(r.head) ?? { name: r.head, amount: 0, ledgers: [] };
          line.amount += bal;
          line.ledgers.push({ name: r.name, amount: bal, source: r.source });
          groups.set(r.head, line);
        }
      }

      const pnlAmount = broughtForward + income - expense;
      const liabilityLines = LIABILITY_ORDER.map((h) => liabGroups.get(h)).filter(Boolean) as Line[];
      const assetLines = ASSET_ORDER.map((h) => assetGroups.get(h)).filter(Boolean) as Line[];

      const totalLiab = liabilityLines.reduce((s, l) => s + l.amount, 0) + pnlAmount;
      const totalAssets = assetLines.reduce((s, l) => s + l.amount, 0);
      return { liabilityLines, assetLines, pnl: pnlAmount, totalLiab, totalAssets };
    },
    [report.passesBasis, report.passesFilter],
  );

  const { liabilityLines, assetLines, pnl, totalLiab, totalAssets, cmps } = useMemo(() => {
    const cur = compute(rows.filter((r) => matchesSource(r.source, srcFilter)));
    return {
      ...cur,
      cmps: columnResults.map((q) => compute((q.data ?? []).filter((r) => matchesSource(r.source, srcFilter)))),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columnResults.map((q) => q.dataUpdatedAt).join(','), srcFilter, compute]);

  const companyName = companies.find((c) => c.id === selectedCompanyId)?.company_name || 'All Companies';
  const hasColumns = report.columns.length > 0;

  const panel = (
    title: string,
    lines: Line[],
    cmpMaps: Map<string, number>[],
    extra?: React.ReactNode,
    total?: number,
    cmpTotals?: number[],
  ) => (
    <div className="min-w-0 flex-1">
      <div className="border-b border-black text-right">
        <div className="font-bold">{companyName}</div>
        <div className="text-[11px]">
          as at {tallyDateLabel(asOfDate)}
          {report.columns.map((c) => ` | ${c.title}`).join('')}
        </div>
      </div>
      <div className="-mt-10 pb-8 font-semibold tracking-[0.3em]">{title}</div>
      <div className="mt-2 space-y-0.5">
        {lines.map((l) => (
          <React.Fragment key={l.name}>
            <div className="flex justify-between">
              <span className="min-w-0 flex-1 font-bold">{l.name}</span>
              <span className="w-36 shrink-0 text-right font-mono">{report.fmtAmount(l.amount)}</span>
              {cmpMaps.map((m, i) => (
                <span key={report.columns[i].id} className="w-36 shrink-0 text-right font-mono text-gray-600">
                  {report.fmtAmount(m.get(l.name) ?? 0)}
                </span>
              ))}
            </div>
            {report.detailed &&
              !hasColumns &&
              l.ledgers.map((led) => (
                <div key={`${led.source}:${led.name}`} className="flex justify-between text-[12px] italic text-gray-700">
                  <span className="pl-5">
                    {led.name}
                    <SourceBadge source={led.source} />
                  </span>
                  <span className="font-mono">{report.fmtAmount(led.amount)}</span>
                </div>
              ))}
          </React.Fragment>
        ))}
        {extra}
      </div>
      {total !== undefined && (
        <div className="mt-10 flex justify-between border-t border-black pt-1 font-bold">
          <span className="min-w-0 flex-1 tracking-[0.3em]">Total</span>
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

  return (
    <>
      <TallyScreen title="Balance Sheet" rail={report.rail}>
        <div className="px-3 pb-4 pt-1 text-[13px]">
          {isLoading ? (
            <div className="py-16 text-center text-gray-400">Loading…</div>
          ) : (
            <div className="flex gap-0">
              <div className="flex-1 border-r border-gray-400 pr-3">
                {panel(
                  'Liabilities',
                  liabilityLines,
                  cmps.map((c) => new Map(c.liabilityLines.map((l) => [l.name, l.amount]))),
                  <div className="flex justify-between">
                    <span className="min-w-0 flex-1 font-bold">Profit &amp; Loss A/c</span>
                    <span className="w-36 shrink-0 text-right font-mono">{report.fmtAmount(pnl)}</span>
                    {cmps.map((c, i) => (
                      <span key={report.columns[i].id} className="w-36 shrink-0 text-right font-mono text-gray-600">
                        {report.fmtAmount(c.pnl)}
                      </span>
                    ))}
                  </div>,
                  totalLiab,
                  cmps.map((c) => c.totalLiab),
                )}
              </div>
              <div className="flex-1 pl-3">
                {panel(
                  'Assets',
                  assetLines,
                  cmps.map((c) => new Map(c.assetLines.map((l) => [l.name, l.amount]))),
                  undefined,
                  totalAssets,
                  cmps.map((c) => c.totalAssets),
                )}
              </div>
            </div>
          )}
        </div>
      </TallyScreen>

      {report.popups}
    </>
  );
};

export default BalanceSheet;
