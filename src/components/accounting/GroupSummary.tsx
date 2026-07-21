import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { TallyScreen } from './tally/TallyChrome';
import { HEAD_ORDER } from './tally/heads';
import { mergedLedgerBalances } from '@/lib/mergedLedgerBalances';
import { useSourceFilter, matchesSource } from './useSourceFilter';
import SourceBadge from './SourceBadge';

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

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
  const [asOfDate, setAsOfDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showPeriod, setShowPeriod] = useState(false);
  const { source: srcFilter, railItem: sourceRail } = useSourceFilter();

  const { data: ledgerRows = [], isLoading } = useQuery({
    queryKey: ['group_summary_merged', asOfDate],
    queryFn: () => mergedLedgerBalances({ upto: asOfDate }),
  });

  const rows = useMemo(() => {
    if (!head) return [];
    return ledgerRows
      .filter((r) => r.head === head && matchesSource(r.source, srcFilter) && Math.abs(r.balance) >= 0.005)
      .map((r) => ({ name: r.name, bal: r.balance, source: r.source, accountId: r.accountId }));
  }, [ledgerRows, head, srcFilter]);

  const totalDr = rows.reduce((s, r) => s + Math.max(0, r.bal), 0);
  const totalCr = rows.reduce((s, r) => s + Math.max(0, -r.bal), 0);

  return (
    <TallyScreen
      title={head ? `Group Summary — ${head}` : 'Group Summary'}
      onClose={onClose ?? (head && !headProp ? () => setPickedHead(null) : undefined)}
      rail={[
        { hotkey: 'F2', label: 'Period', onClick: () => setShowPeriod((v) => !v) },
        { hotkey: 'F3', label: 'Company', disabled: true },
        {
          hotkey: 'F4',
          label: 'Group',
          gapBefore: true,
          onClick: () => setPickedHead(null),
          disabled: !!headProp,
        },
        sourceRail,
        { hotkey: 'P', label: 'Print', onClick: () => window.print(), gapBefore: true },
      ]}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        {!head ? (
          /* List of Groups, Tally style */
          <div className="mx-auto max-w-md pt-4">
            <div className="border bg-[#eef3fa]">
              <div className="bg-[#16437e] px-3 py-1 text-xs font-semibold text-white">List of Groups</div>
              {HEAD_ORDER.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setPickedHead(h)}
                  className="block w-full border-b border-white px-3 py-1 text-left hover:bg-[#fdf6d8]"
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
            {showPeriod && (
              <div className="mb-2 mt-1 flex items-center gap-2 border border-[#9db8d8] bg-[#fdf6d8] px-2 py-1">
                <span>As at:</span>
                <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="border bg-white px-1" />
              </div>
            )}

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
                {rows.map((r) => (
                  <button
                    key={`${r.source}:${r.name}`}
                    type="button"
                    onClick={() => r.accountId && onOpenLedger?.(r.accountId)}
                    title={r.accountId ? 'Open ledger vouchers' : 'Tally ledger'}
                    className="flex w-full border-b border-dashed border-gray-200 text-left hover:bg-[#fdf6d8]"
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
  );
};

export default GroupSummary;
