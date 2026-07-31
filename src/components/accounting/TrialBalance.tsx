import React, { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { mergedLedgerBalances, type LedgerBalanceRow, type LedgerSource } from '@/lib/mergedLedgerBalances';
import { TallyScreen } from './tally/TallyChrome';
import { TallyList } from './tally/TallyPopup';
import { useTallyReport } from './tally/useTallyReport';
import { useRowCursor } from './tally/useRowCursor';
import { dayBefore, dayLabel } from './tally/PeriodContext';
import { useAccountingCompany } from './AccountingCompanyContext';
import { useSourceFilter, matchesSource } from './useSourceFilter';
import { normalizeName } from '@/lib/tallyCompanyMatch';
import { accountMovements, type Movement } from '@/lib/accountMovements';
import { HEAD_ORDER } from './tally/heads';

interface LedgerLine {
  name: string;
  group: string;
  bal: number;
  opening: number;
  /** Debits and credits posted within the period — Tally's Transactions block */
  txDr: number;
  txCr: number;
  source: LedgerSource;
  accountId?: string;
}

interface HeadTotals {
  dr: number;
  cr: number;
  openDr: number;
  openCr: number;
  txDr: number;
  txCr: number;
  ledgers: LedgerLine[];
}

const EMPTY_OPENINGS: Map<string, number> = new Map();
const EMPTY_MOVEMENTS: Map<string, Movement> = new Map();

/** One row of the report body — a head, one of its groups, or a ledger. */
interface BodyRow {
  kind: 'head' | 'group' | 'ledger';
  key: string;
  label: string;
  head: string;
  depth: number;
  dr: number;
  cr: number;
  openDr: number;
  openCr: number;
  txDr: number;
  txCr: number;
  accountId?: string;
}

/**
 * Trial Balance — Tally Prime replica: Particulars with grouped heads,
 * Debit/Credit closing-balance columns, ledger drill-down, Grand Total.
 * C / A / D / N add as many comparison periods beside it as Tally would.
 */
const TrialBalance: React.FC<{
  onOpenGroup?: (head: string) => void;
  onOpenLedger?: (accountId: string) => void;
}> = ({ onOpenGroup, onOpenLedger }) => {
  const { companies, selectedCompanyId } = useAccountingCompany();
  const { source: srcFilter, railItem: sourceRail } = useSourceFilter();
  const [headFilter, setHeadFilter] = useState<string | null>(null);
  const [pickGroup, setPickGroup] = useState(false);

  const report = useTallyReport({
    filterFields: ['Particulars'],
    views: [
      { label: 'Group Summary', target: 'group-summary' },
      { label: 'Ledger Vouchers', target: 'ledger-view' },
      { label: 'Balance Sheet', target: 'balance-sheet' },
      { label: 'Profit & Loss A/c', target: 'profit-loss' },
    ],
    // Tally's Trial Balance F12 — which of the three blocks to print
    configFields: [
      { key: 'showOpening', label: 'Show Opening Balance' },
      { key: 'showTransactions', label: 'Show Transactions' },
      { key: 'showClosing', label: 'Show Closing Balance', value: true },
    ],
    detailedToggle: { hotkey: 'F5', label: 'Ledger-wise' },
    initialDetailed: true,
    screenKeys: [
      {
        hotkey: 'F4',
        label: headFilter ? `Group: ${headFilter}` : 'Group',
        active: !!headFilter,
        onClick: () => setPickGroup(true),
      },
      sourceRail,
    ],
    exportData: () => ({
      title: 'Trial Balance',
      period: report.periodLabel,
      columns: ['Particulars', 'Opening Debit', 'Opening Credit', 'Debit', 'Credit', 'Closing Debit', 'Closing Credit'],
      rows: bodyRows.map((row) => [
        `${'  '.repeat(row.depth)}${row.label}`,
        row.openDr,
        row.openCr,
        row.txDr,
        row.txCr,
        row.dr,
        row.cr,
      ]),
    }),
  });
  const asOfDate = report.to;
  const openingDate = dayBefore(report.from);

  const showOpening = !!report.config.showOpening;
  const showTransactions = !!report.config.showTransactions;
  // Tally never prints an empty report — if you switch all three off, Closing
  // comes back on.
  const showClosing = !!report.config.showClosing || (!showOpening && !showTransactions);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['tb_merged', selectedCompanyId, asOfDate],
    queryFn: () => mergedLedgerBalances({ upto: asOfDate, companyId: selectedCompanyId }),
  });

  // The opening block is the same balances as at the day before the period.
  const { data: openingRows = [] } = useQuery({
    queryKey: ['tb_merged', selectedCompanyId, openingDate],
    enabled: showOpening || showTransactions,
    queryFn: () => mergedLedgerBalances({ upto: openingDate, companyId: selectedCompanyId }),
  });

  // Tally's Transactions block is the debits and credits actually posted in the
  // period, not the movement between the opening and closing balance columns.
  // account_movements() already returns exactly that per account.
  const { data: txMovements = new Map<string, Movement>() } = useQuery({
    queryKey: ['tb_tx', selectedCompanyId, report.from, report.to],
    enabled: showTransactions,
    queryFn: () => accountMovements({ from: report.from, upto: report.to, companyId: selectedCompanyId }),
  });

  // One query per comparison column added with C / A / N
  const columnResults = useQueries({
    queries: report.columns.map((c) => ({
      queryKey: ['tb_merged', selectedCompanyId, c.to],
      queryFn: () => mergedLedgerBalances({ upto: c.to, companyId: selectedCompanyId }),
    })),
  });

  const openingByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of openingRows) map.set(normalizeName(r.name), r.balance);
    return map;
  }, [openingRows]);

  const computeGroups = useMemo(
    () =>
      (
        ledgerRows: LedgerBalanceRow[],
        openings: Map<string, number>,
        movements: Map<string, Movement>,
      ) => {
        const byHead = new Map<string, HeadTotals>();
        for (const r of ledgerRows) {
          const bal = r.balance;
          if (headFilter && r.head !== headFilter) continue;
          if (!report.passesBasis(bal)) continue;
          if (!report.passesFilter({ Particulars: r.name })) continue;
          const opening = openings.get(normalizeName(r.name)) ?? 0;
          // A Tally-sourced row carries no accountId and its balance is an
          // undated snapshot, so it has no period transactions to report.
          const mv = r.accountId ? movements.get(r.accountId) : undefined;
          const txDr = mv?.debit ?? 0;
          const txCr = mv?.credit ?? 0;
          const g =
            byHead.get(r.head) ?? { dr: 0, cr: 0, openDr: 0, openCr: 0, txDr: 0, txCr: 0, ledgers: [] };
          if (bal > 0) g.dr += bal;
          else g.cr += -bal;
          if (opening > 0) g.openDr += opening;
          else g.openCr += -opening;
          g.txDr += txDr;
          g.txCr += txCr;
          g.ledgers.push({
            name: r.name,
            group: r.group,
            bal,
            opening,
            txDr,
            txCr,
            source: r.source,
            accountId: r.accountId,
          });
          byHead.set(r.head, g);
        }
        let grandDr = 0;
        let grandCr = 0;
        let grandOpenDr = 0;
        let grandOpenCr = 0;
        let grandTxDr = 0;
        let grandTxCr = 0;
        for (const g of byHead.values()) {
          grandDr += g.dr;
          grandCr += g.cr;
          grandOpenDr += g.openDr;
          grandOpenCr += g.openCr;
          grandTxDr += g.txDr;
          grandTxCr += g.txCr;
        }
        return { byHead, grandDr, grandCr, grandOpenDr, grandOpenCr, grandTxDr, grandTxCr };
      },
    [report.passesBasis, report.passesFilter, headFilter],
  );

  const { groups, grandDr, grandCr, grandOpenDr, grandOpenCr, grandTxDr, grandTxCr, comparisons } = useMemo(() => {
    const cur = computeGroups(
      rows.filter((r) => matchesSource(r.source, srcFilter)),
      openingByName,
      txMovements,
    );
    // A comparison column covers its own dates, and we hold no opening or
    // movement figures for those. Tally would not print a figure it cannot
    // compute, so the Opening and Transactions blocks stay blank there — they
    // used to repeat the main period's opening, which belonged to other dates.
    const cmps = columnResults.map((q) =>
      computeGroups(
        (q.data ?? []).filter((r) => matchesSource(r.source, srcFilter)),
        EMPTY_OPENINGS,
        EMPTY_MOVEMENTS,
      ),
    );
    const heads = HEAD_ORDER.filter((h) => cur.byHead.has(h) || cmps.some((c) => c.byHead.has(h)));
    return {
      groups: heads.map((h) => ({
        head: h,
        ...(cur.byHead.get(h) ?? { dr: 0, cr: 0, openDr: 0, openCr: 0, txDr: 0, txCr: 0, ledgers: [] }),
      })),
      grandDr: cur.grandDr,
      grandCr: cur.grandCr,
      grandOpenDr: cur.grandOpenDr,
      grandOpenCr: cur.grandOpenCr,
      grandTxDr: cur.grandTxDr,
      grandTxCr: cur.grandTxCr,
      comparisons: cmps,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columnResults.map((q) => q.dataUpdatedAt).join(','), srcFilter, computeGroups, openingByName, txMovements]);

  /**
   * Tally walks head → group → ledger, and every one of those lines is a row
   * the cursor can sit on and drill from. The ledger lines used to be plain
   * divs, so you could not reach a ledger from the Trial Balance at all.
   */
  const bodyRows = useMemo<BodyRow[]>(() => {
    const out: BodyRow[] = [];
    for (const g of groups) {
      out.push({
        kind: 'head',
        key: `h:${g.head}`,
        label: g.head,
        head: g.head,
        depth: 0,
        dr: g.dr,
        cr: g.cr,
        openDr: g.openDr,
        openCr: g.openCr,
        txDr: g.txDr,
        txCr: g.txCr,
      });
      // Comparison columns replace the breakup — Tally cannot print both.
      if (!report.detailed || report.columns.length > 0) continue;

      const byGroup = new Map<string, LedgerLine[]>();
      for (const l of g.ledgers) {
        const list = byGroup.get(l.group) ?? [];
        list.push(l);
        byGroup.set(l.group, list);
      }
      // A single group that just repeats the head adds nothing — skip the level.
      const showGroupLevel = byGroup.size > 1 || !byGroup.has(g.head);
      for (const [groupName, ledgers] of byGroup) {
        if (showGroupLevel) {
          const dr = ledgers.reduce((s, l) => s + Math.max(0, l.bal), 0);
          const cr = ledgers.reduce((s, l) => s + Math.max(0, -l.bal), 0);
          out.push({
            kind: 'group',
            key: `g:${g.head}:${groupName}`,
            label: groupName,
            head: g.head,
            depth: 1,
            dr,
            cr,
            openDr: ledgers.reduce((s, l) => s + Math.max(0, l.opening), 0),
            openCr: ledgers.reduce((s, l) => s + Math.max(0, -l.opening), 0),
            txDr: ledgers.reduce((s, l) => s + l.txDr, 0),
            txCr: ledgers.reduce((s, l) => s + l.txCr, 0),
          });
        }
        for (const l of ledgers) {
          out.push({
            kind: 'ledger',
            key: `l:${l.source}:${l.name}`,
            label: l.name,
            head: g.head,
            depth: showGroupLevel ? 2 : 1,
            dr: Math.max(0, l.bal),
            cr: Math.max(0, -l.bal),
            openDr: Math.max(0, l.opening),
            openCr: Math.max(0, -l.opening),
            txDr: l.txDr,
            txCr: l.txCr,
            accountId: l.accountId,
          });
        }
      }
    }
    return out;
  }, [groups, report.detailed, report.columns.length]);

  const companyName = companies.find((c) => c.id === selectedCompanyId)?.company_name || 'All Companies';

  const { cursor, setCursor } = useRowCursor({
    count: bodyRows.length,
    onEnter: (index) => {
      const row = bodyRows[index];
      if (!row) return;
      if (row.kind === 'ledger') {
        if (row.accountId) onOpenLedger?.(row.accountId);
        return;
      }
      onOpenGroup?.(row.head);
    },
  });

  const amountPair = (dr: number, cr: number, className: string) => (
    <div className="flex w-72 shrink-0">
      <div className={`w-1/2 pr-2 text-right font-mono ${className}`}>{dr > 0 ? report.fmtAmount(dr) : ''}</div>
      <div className={`w-1/2 pr-2 text-right font-mono ${className}`}>{cr > 0 ? report.fmtAmount(cr) : ''}</div>
    </div>
  );

  /**
   * Tally prints up to three Debit/Credit blocks side by side — Opening
   * Balance, Transactions for the period, and Closing Balance. Transactions is
   * the debits and credits posted in the period, which is a figure of its own:
   * deriving it as (closing − opening) reported nothing for a ledger that took
   * in and paid out the same amount, and mixed up ledgers that changed side.
   */
  const amountBlocks = (
    row: { dr: number; cr: number; openDr: number; openCr: number; txDr: number; txCr: number },
    className: string,
  ) => (
    <>
      {showOpening && amountPair(row.openDr, row.openCr, className)}
      {showTransactions && amountPair(row.txDr, row.txCr, className)}
      {showClosing && amountPair(row.dr, row.cr, className)}
    </>
  );

  const drCrHead = (caption: string) => (
    <div className="w-72 shrink-0 border-l border-gray-400 text-center">
      <div className="font-bold">{caption}</div>
      <div className="flex border-t border-gray-400 font-semibold">
        <div className="w-1/2 border-r border-gray-400">Debit</div>
        <div className="w-1/2">Credit</div>
      </div>
    </div>
  );

  const columnHeader = (heading: string, subtitle: string) => (
    <div className="shrink-0">
      <div className="border-l border-gray-400 text-center">
        <div className="font-bold">{heading}</div>
        <div className="text-[11px]">{subtitle}</div>
      </div>
      <div className="flex">
        {showOpening && drCrHead('Opening Balance')}
        {showTransactions && drCrHead('Transactions')}
        {showClosing && drCrHead('Closing Balance')}
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
            {columnHeader(companyName, `as at ${dayLabel(asOfDate)}`)}
            {report.columns.map((c) => (
              <React.Fragment key={c.id}>{columnHeader(companyName, c.title)}</React.Fragment>
            ))}
          </div>

          {isLoading ? (
            <div className="py-10 text-center text-gray-400">Loading…</div>
          ) : (
            <>
              {bodyRows.map((row, i) => {
                const isHead = row.kind === 'head';
                const cmpFor = (cmp: (typeof comparisons)[number]) => cmp.byHead.get(row.head);
                return (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() =>
                      row.kind === 'ledger'
                        ? row.accountId && onOpenLedger?.(row.accountId)
                        : onOpenGroup?.(row.head)
                    }
                    onMouseEnter={() => setCursor(i)}
                    title={row.kind === 'ledger' ? 'Open Ledger Vouchers' : 'Open Group Summary'}
                    className={`flex w-full text-left ${isHead ? 'mt-1.5' : ''} ${
                      cursor === i ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'
                    }`}
                  >
                    <div
                      className={`w-64 flex-1 ${
                        isHead
                          ? 'font-bold'
                          : row.kind === 'group'
                            ? 'text-[12px] font-semibold text-gray-800'
                            : 'text-[12px] italic text-gray-700'
                      }`}
                      style={{ paddingLeft: row.depth * 20 }}
                    >
                      {row.label}
                    </div>
                    {amountBlocks(row, isHead ? 'font-semibold' : '')}
                    {isHead &&
                      comparisons.map((cmp, ci) => (
                        <React.Fragment key={report.columns[ci].id}>
                          {amountBlocks(
                            {
                              dr: cmpFor(cmp)?.dr ?? 0,
                              cr: cmpFor(cmp)?.cr ?? 0,
                              openDr: cmpFor(cmp)?.openDr ?? 0,
                              openCr: cmpFor(cmp)?.openCr ?? 0,
                              txDr: cmpFor(cmp)?.txDr ?? 0,
                              txCr: cmpFor(cmp)?.txCr ?? 0,
                            },
                            'font-semibold',
                          )}
                        </React.Fragment>
                      ))}
                  </button>
                );
              })}

              <div className="mt-10 flex border-t border-black pt-1 font-bold">
                <div className="w-64 flex-1 tracking-[0.3em]">Grand Total</div>
                {amountBlocks(
                  { dr: grandDr, cr: grandCr, openDr: grandOpenDr, openCr: grandOpenCr, txDr: grandTxDr, txCr: grandTxCr },
                  '',
                )}
                {comparisons.map((cmp, ci) => (
                  <React.Fragment key={report.columns[ci].id}>
                    {amountBlocks(
                      {
                        dr: cmp.grandDr,
                        cr: cmp.grandCr,
                        openDr: cmp.grandOpenDr,
                        openCr: cmp.grandOpenCr,
                        txDr: cmp.grandTxDr,
                        txCr: cmp.grandTxCr,
                      },
                      '',
                    )}
                  </React.Fragment>
                ))}
              </div>
              {/* Only meaningful across the whole trial balance — a single
                  group never balances on its own, so F4: Group hides it.
                  Each line names the block it is actually measured on: the
                  one line this used to print was computed from the closing
                  columns while calling itself an opening difference. */}
              {!headFilter && Math.abs(grandOpenDr - grandOpenCr) > 0.01 && (
                <div className="mt-1 text-right text-[12px] font-semibold text-red-600">
                  Difference in Opening Balances: {report.fmtAmount(Math.abs(grandOpenDr - grandOpenCr))}
                </div>
              )}
              {!headFilter && Math.abs(grandDr - grandCr) > 0.01 && (
                <div className="mt-1 text-right text-[12px] font-semibold text-red-600">
                  Difference in Closing Balances: {report.fmtAmount(Math.abs(grandDr - grandCr))}
                </div>
              )}
            </>
          )}
        </div>
      </TallyScreen>

      {pickGroup && (
        <TallyList
          title="List of Groups"
          items={[
            { label: 'All Groups', active: !headFilter, onSelect: () => { setHeadFilter(null); setPickGroup(false); } },
            ...HEAD_ORDER.map((h) => ({
              label: h,
              active: headFilter === h,
              onSelect: () => {
                setHeadFilter(h);
                setPickGroup(false);
              },
            })),
          ]}
          onClose={() => setPickGroup(false)}
        />
      )}

      {report.popups}
    </>
  );
};

export default TrialBalance;
