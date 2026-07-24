import React, { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { mergedLedgerBalances, type LedgerBalanceRow, type LedgerSource } from '@/lib/mergedLedgerBalances';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { useRowCursor } from './tally/useRowCursor';
import { useAccountingCompany } from './AccountingCompanyContext';
import { useSourceFilter, matchesSource } from './useSourceFilter';

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

import { HEAD_ORDER } from './tally/heads';

interface HeadTotals {
  dr: number;
  cr: number;
  ledgers: { name: string; bal: number; source: LedgerSource }[];
}

/**
 * Trial Balance — Tally Prime replica: Particulars with grouped heads,
 * Debit/Credit closing-balance columns, ledger drill-down, Grand Total.
 * C / A / D / N add as many comparison periods beside it as Tally would.
 */
const TrialBalance: React.FC<{ onOpenGroup?: (head: string) => void }> = ({ onOpenGroup }) => {
  const { companies, selectedCompanyId } = useAccountingCompany();
  const { source: srcFilter, railItem: sourceRail } = useSourceFilter();

  const report = useTallyReport({
    filterFields: ['Particulars'],
    views: [
      { label: 'Group Summary', target: 'group-summary' },
      { label: 'Ledger Vouchers', target: 'ledger-view' },
      { label: 'Balance Sheet', target: 'balance-sheet' },
      { label: 'Profit & Loss A/c', target: 'profit-loss' },
    ],
    detailedToggle: { hotkey: 'F5', label: 'Ledger-wise' },
    initialDetailed: true,
    screenKeys: [sourceRail],
  });
  const asOfDate = report.to;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['tb_merged', selectedCompanyId, asOfDate],
    queryFn: () => mergedLedgerBalances({ upto: asOfDate, companyId: selectedCompanyId }),
  });

  // One query per comparison column added with C / A / N
  const columnResults = useQueries({
    queries: report.columns.map((c) => ({
      queryKey: ['tb_merged', selectedCompanyId, c.to],
      queryFn: () => mergedLedgerBalances({ upto: c.to, companyId: selectedCompanyId }),
    })),
  });

  const computeGroups = useMemo(
    () => (ledgerRows: LedgerBalanceRow[]) => {
      const byHead = new Map<string, HeadTotals>();
      for (const r of ledgerRows) {
        const bal = r.balance;
        if (!report.passesBasis(bal)) continue;
        if (!report.passesFilter({ Particulars: r.name })) continue;
        const g = byHead.get(r.head) ?? { dr: 0, cr: 0, ledgers: [] };
        if (bal > 0) g.dr += bal;
        else g.cr += -bal;
        g.ledgers.push({ name: r.name, bal, source: r.source });
        byHead.set(r.head, g);
      }
      let grandDr = 0;
      let grandCr = 0;
      for (const g of byHead.values()) {
        grandDr += g.dr;
        grandCr += g.cr;
      }
      return { byHead, grandDr, grandCr };
    },
    [report.passesBasis, report.passesFilter],
  );

  const { groups, grandDr, grandCr, comparisons } = useMemo(() => {
    const cur = computeGroups(rows.filter((r) => matchesSource(r.source, srcFilter)));
    const cmps = columnResults.map((q) => computeGroups((q.data ?? []).filter((r) => matchesSource(r.source, srcFilter))));
    const heads = HEAD_ORDER.filter((h) => cur.byHead.has(h) || cmps.some((c) => c.byHead.has(h)));
    return {
      groups: heads.map((h) => ({ head: h, ...(cur.byHead.get(h) ?? { dr: 0, cr: 0, ledgers: [] }) })),
      grandDr: cur.grandDr,
      grandCr: cur.grandCr,
      comparisons: cmps,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columnResults.map((q) => q.dataUpdatedAt).join(','), srcFilter, computeGroups]);

  const companyName = companies.find((c) => c.id === selectedCompanyId)?.company_name || 'All Companies';

  const { cursor, setCursor } = useRowCursor({
    count: groups.length,
    onEnter: (index) => groups[index] && onOpenGroup?.(groups[index].head),
  });

  const amountPair = (dr: number, cr: number, className: string) => (
    <div className="flex w-72 shrink-0">
      <div className={`w-1/2 pr-2 text-right font-mono ${className}`}>{dr > 0 ? report.fmtAmount(dr) : ''}</div>
      <div className={`w-1/2 pr-2 text-right font-mono ${className}`}>{cr > 0 ? report.fmtAmount(cr) : ''}</div>
    </div>
  );

  const columnHeader = (heading: string, subtitle: string) => (
    <div className="w-72 shrink-0 border-l border-gray-400 text-center">
      <div className="font-bold">{heading}</div>
      <div className="text-[11px]">{subtitle}</div>
      <div className="font-bold">Closing Balance</div>
      <div className="flex border-t border-gray-400 font-semibold">
        <div className="w-1/2 border-r border-gray-400">Debit</div>
        <div className="w-1/2">Credit</div>
      </div>
    </div>
  );

  return (
    <>
      <TallyScreen title="Trial Balance" rail={report.rail}>
        <div className="min-w-max px-3 pb-4 pt-1 text-[13px]">
          {/* Header */}
          <div className="flex border-b border-black">
            <div className="w-64 flex-1 pt-8 font-semibold tracking-[0.3em]">Particulars</div>
            {columnHeader(companyName, `as at ${tallyDateLabel(asOfDate)}`)}
            {report.columns.map((c) => (
              <React.Fragment key={c.id}>{columnHeader(companyName, c.title)}</React.Fragment>
            ))}
          </div>

          {isLoading ? (
            <div className="py-10 text-center text-gray-400">Loading…</div>
          ) : (
            <>
              {groups.map((g, i) => (
                <React.Fragment key={g.head}>
                  <button
                    type="button"
                    onClick={() => onOpenGroup?.(g.head)}
                    onMouseEnter={() => setCursor(i)}
                    title="Open Group Summary"
                    className={`mt-1.5 flex w-full text-left ${cursor === i ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'}`}
                  >
                    <div className="w-64 flex-1 font-bold">{g.head}</div>
                    {amountPair(g.dr, g.cr, 'font-semibold')}
                    {comparisons.map((cmp, ci) => (
                      <React.Fragment key={report.columns[ci].id}>
                        {amountPair(cmp.byHead.get(g.head)?.dr ?? 0, cmp.byHead.get(g.head)?.cr ?? 0, 'font-semibold')}
                      </React.Fragment>
                    ))}
                  </button>
                  {report.detailed &&
                    report.columns.length === 0 &&
                    g.ledgers.map((l) => (
                      <div key={`${l.source}:${l.name}`} className="flex text-[12px] italic text-gray-700">
                        <div className="w-64 flex-1 pl-5">
                          {l.name}
                        </div>
                        {amountPair(Math.max(0, l.bal), Math.max(0, -l.bal), '')}
                      </div>
                    ))}
                </React.Fragment>
              ))}

              <div className="mt-10 flex border-t border-black pt-1 font-bold">
                <div className="w-64 flex-1 tracking-[0.3em]">Grand Total</div>
                {amountPair(grandDr, grandCr, '')}
                {comparisons.map((cmp, ci) => (
                  <React.Fragment key={report.columns[ci].id}>
                    {amountPair(cmp.grandDr, cmp.grandCr, '')}
                  </React.Fragment>
                ))}
              </div>
              {Math.abs(grandDr - grandCr) > 0.01 && (
                <div className="mt-1 text-right text-[12px] font-semibold text-red-600">
                  Difference: {report.fmtAmount(Math.abs(grandDr - grandCr))}
                </div>
              )}
            </>
          )}
        </div>
      </TallyScreen>

      {report.popups}
    </>
  );
};

export default TrialBalance;
