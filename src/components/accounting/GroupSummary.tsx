import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { useRowCursor } from './tally/useRowCursor';
import { HEAD_ORDER } from './tally/heads';
import { mergedLedgerBalances } from '@/lib/mergedLedgerBalances';
import { useSourceFilter, matchesSource } from './useSourceFilter';
import SourceBadge from './SourceBadge';

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

interface GroupSummaryProps {
  /** Group head to open with; when absent, shows Tally's List of Groups */
  head?: string | null;
  onOpenLedger?: (accountId: string) => void;
  onClose?: () => void;
}

/**
 * Group Summary — Tally Prime replica: a group's ledgers with Debit/Credit
 * closing balances and total. Opened standalone (pick from List of Groups)
 * or by drilling from Trial Balance; ledger rows drill to Ledger Vouchers.
 */
const GroupSummary: React.FC<GroupSummaryProps> = ({ head: headProp, onOpenLedger, onClose }) => {
  const [pickedHead, setPickedHead] = useState<string | null>(null);
  const head = headProp ?? pickedHead;
  const { source: srcFilter, railItem: sourceRail } = useSourceFilter();

  const report = useTallyReport({
    filterFields: ['Particulars'],
    views: [
      { label: 'Trial Balance', target: 'trial-balance' },
      { label: 'Ledger Vouchers', target: 'ledger-view' },
      { label: 'Balance Sheet', target: 'balance-sheet' },
      { label: 'Chart of Accounts', target: 'chart-of-accounts' },
    ],
    screenKeys: [
      { hotkey: 'F4', label: 'Group', onClick: () => setPickedHead(null), disabled: !!headProp },
      sourceRail,
    ],
  });
  const { to: asOfDate, fmtAmount: fmt } = report;

  const { data: ledgerRows = [], isLoading } = useQuery({
    queryKey: ['group_summary_merged', asOfDate],
    queryFn: () => mergedLedgerBalances({ upto: asOfDate }),
  });

  const rows = useMemo(() => {
    if (!head) return [];
    return ledgerRows
      .filter((r) => r.head === head && matchesSource(r.source, srcFilter))
      .filter((r) => report.passesBasis(r.balance) && report.passesFilter({ Particulars: r.name }))
      .map((r) => ({ name: r.name, bal: r.balance, source: r.source, accountId: r.accountId }));
  }, [ledgerRows, head, srcFilter, report.passesBasis, report.passesFilter]);

  const totalDr = rows.reduce((s, r) => s + Math.max(0, r.bal), 0);
  const totalCr = rows.reduce((s, r) => s + Math.max(0, -r.bal), 0);

  // The cursor walks the List of Groups first, then the group's ledgers
  const { cursor, setCursor } = useRowCursor({
    count: head ? rows.length : HEAD_ORDER.length,
    onEnter: (index) => {
      if (!head) {
        setPickedHead(HEAD_ORDER[index]);
        return;
      }
      const accountId = rows[index]?.accountId;
      if (accountId) onOpenLedger?.(accountId);
    },
  });

  return (
    <>
    <TallyScreen
      title={head ? `Group Summary — ${head}` : 'Group Summary'}
      onClose={onClose ?? (head && !headProp ? () => setPickedHead(null) : undefined)}
      rail={report.rail}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        {!head ? (
          /* List of Groups, Tally style */
          <div className="mx-auto max-w-md pt-4">
            <div className="border bg-[#eef3fa]">
              <div className="bg-[#16437e] px-3 py-1 text-xs font-semibold text-white">List of Groups</div>
              {HEAD_ORDER.map((h, i) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setPickedHead(h)}
                  onMouseEnter={() => setCursor(i)}
                  className={`block w-full border-b border-white px-3 py-1 text-left ${
                    cursor === i ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'
                  }`}
                >
                  {h}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="text-center">
              <div className="font-bold">{head}</div>
              <div className="text-[11px]">as at {tallyDateLabel(asOfDate)}</div>
            </div>
            <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
              <div className="min-w-0 flex-1 px-1">Particulars</div>
              <div className="w-36 px-1 text-right">Debit</div>
              <div className="w-36 px-1 text-right">Credit</div>
            </div>

            {isLoading ? (
              <div className="py-10 text-center text-gray-400">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="py-10 text-center text-gray-400">No ledgers with balances under this group.</div>
            ) : (
              <>
                {rows.map((r, i) => (
                  <button
                    key={`${r.source}:${r.name}`}
                    type="button"
                    onClick={() => r.accountId && onOpenLedger?.(r.accountId)}
                    onMouseEnter={() => setCursor(i)}
                    title={r.accountId ? 'Open ledger vouchers' : 'Tally ledger'}
                    className={`flex w-full border-b border-dashed border-gray-200 text-left ${
                      cursor === i ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'
                    }`}
                  >
                    <div className="min-w-0 flex-1 truncate px-1">
                      {r.name}
                      <SourceBadge source={r.source} />
                    </div>
                    <div className="w-36 px-1 text-right font-mono">{r.bal > 0 ? fmt(r.bal) : ''}</div>
                    <div className="w-36 px-1 text-right font-mono">{r.bal < 0 ? fmt(-r.bal) : ''}</div>
                  </button>
                ))}
                <div className="mt-1 flex border-t border-black pt-0.5 font-bold">
                  <div className="min-w-0 flex-1 px-1 tracking-[0.3em]">Total</div>
                  <div className="w-36 px-1 text-right font-mono">{fmt(totalDr)}</div>
                  <div className="w-36 px-1 text-right font-mono">{fmt(totalCr)}</div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </TallyScreen>

    {report.popups}
    </>
  );
};

export default GroupSummary;
