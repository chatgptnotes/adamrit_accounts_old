import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mergedLedgerBalances, type LedgerBalanceRow, type LedgerSource } from '@/lib/mergedLedgerBalances';
import { format } from 'date-fns';
import { TallyScreen, getTallyConfig } from './tally/TallyChrome';
import { useAccountingCompany } from './AccountingCompanyContext';
import SourceBadge from './SourceBadge';
import { useSourceFilter, matchesSource } from './useSourceFilter';

interface Line {
  name: string;
  amount: number;
  ledgers: { name: string; amount: number; source: LedgerSource }[];
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const shiftYear = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  d.setFullYear(d.getFullYear() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

// Tally balance-sheet heads (shared HEAD_ORDER names), split into the two panels.
const LIABILITY_ORDER = ['Capital Account', 'Loans (Liability)', 'Current Liabilities'];
const ASSET_ORDER = ['Fixed Assets', 'Current Assets'];

/**
 * Balance Sheet — Tally Prime two-panel replica: Liabilities | Assets,
 * grouped into Tally's heads, P&L A/c on the liabilities side with the
 * current-period figure, matching grand totals on both panels.
 */
const BalanceSheet: React.FC = () => {
  const { companies, selectedCompanyId } = useAccountingCompany();
  const [asOfDate, setAsOfDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [showPeriod, setShowPeriod] = useState(false);
  const [detailed, setDetailed] = useState(() => getTallyConfig().defaultDetailed || true);
  const [compareAsOf, setCompareAsOf] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const { source: srcFilter, railItem: sourceRail } = useSourceFilter();

  const { data: rows = [], isLoading: entriesLoading } = useQuery({
    queryKey: ['balance_sheet_merged', asOfDate, selectedCompanyId],
    queryFn: () => mergedLedgerBalances({ upto: asOfDate, companyId: selectedCompanyId }),
  });

  const { data: rows2 = [] } = useQuery({
    queryKey: ['balance_sheet_merged', compareAsOf, selectedCompanyId],
    enabled: !!compareAsOf,
    queryFn: () => mergedLedgerBalances({ upto: compareAsOf!, companyId: selectedCompanyId }),
  });

  const compute = (ledgerRows: LedgerBalanceRow[]) => {
    const liabGroups = new Map<string, Line>();
    const assetGroups = new Map<string, Line>();
    let income = 0;
    let expense = 0;

    for (const r of ledgerRows) {
      // r.balance is signed Debit-positive / Credit-negative.
      if (r.head === 'Sales Accounts' || r.head === 'Indirect Incomes') {
        income += -r.balance;
      } else if (r.head === 'Direct Expenses' || r.head === 'Indirect Expenses') {
        expense += r.balance;
      } else if (LIABILITY_ORDER.includes(r.head)) {
        const bal = -r.balance; // credit balance positive
        if (Math.abs(bal) < 0.005) continue;
        const line = liabGroups.get(r.head) ?? { name: r.head, amount: 0, ledgers: [] };
        line.amount += bal;
        line.ledgers.push({ name: r.name, amount: bal, source: r.source });
        liabGroups.set(r.head, line);
      } else if (ASSET_ORDER.includes(r.head)) {
        const bal = r.balance; // debit balance positive
        if (Math.abs(bal) < 0.005) continue;
        const line = assetGroups.get(r.head) ?? { name: r.head, amount: 0, ledgers: [] };
        line.amount += bal;
        line.ledgers.push({ name: r.name, amount: bal, source: r.source });
        assetGroups.set(r.head, line);
      }
    }

    const pnlAmount = income - expense;
    const liabilityLines = LIABILITY_ORDER.map((h) => liabGroups.get(h)).filter(Boolean) as Line[];
    const assetLines = ASSET_ORDER.map((h) => assetGroups.get(h)).filter(Boolean) as Line[];

    const totalLiab = liabilityLines.reduce((s, l) => s + l.amount, 0) + pnlAmount;
    const totalAssets = assetLines.reduce((s, l) => s + l.amount, 0);
    return { liabilityLines, assetLines, pnl: pnlAmount, totalLiab, totalAssets };
  };

  const { liabilityLines, assetLines, pnl, totalLiab, totalAssets, cmp } = useMemo(() => {
    const cur = compute(rows.filter((r) => matchesSource(r.source, srcFilter)));
    const c = compareAsOf ? compute(rows2.filter((r) => matchesSource(r.source, srcFilter))) : null;
    return {
      ...cur,
      cmp: c
        ? {
            liab: new Map(c.liabilityLines.map((l) => [l.name, l.amount])),
            assets: new Map(c.assetLines.map((l) => [l.name, l.amount])),
            pnl: c.pnl,
            totalLiab: c.totalLiab,
            totalAssets: c.totalAssets,
          }
        : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, rows2, compareAsOf, srcFilter]);

  const isLoading = entriesLoading;
  const companyName = companies.find((c) => c.id === selectedCompanyId)?.company_name || 'All Companies';

  const panel = (
    title: string,
    lines: Line[],
    cmpMap: Map<string, number> | null,
    extra?: React.ReactNode,
    total?: number,
    cmpTotal?: number,
  ) => (
    <div className="min-w-0 flex-1">
      <div className="border-b border-black text-right">
        <div className="font-bold">{companyName}</div>
        <div className="text-[11px]">
          as at {tallyDateLabel(asOfDate)}
          {cmpMap && compareAsOf ? ` | ${tallyDateLabel(compareAsOf)}` : ''}
        </div>
      </div>
      <div className="-mt-10 pb-8 font-semibold tracking-[0.3em]">{title}</div>
      <div className="mt-2 space-y-0.5">
        {lines
          .map((l) =>
            filterText
              ? { ...l, ledgers: l.ledgers.filter((led) => led.name.toLowerCase().includes(filterText.toLowerCase())) }
              : l,
          )
          .filter((l) => !filterText || l.ledgers.length > 0)
          .map((l) => (
          <React.Fragment key={l.name}>
            <div className="flex justify-between">
              <span className="min-w-0 flex-1 font-bold">{l.name}</span>
              <span className="w-36 text-right font-mono">{fmt(l.amount)}</span>
              {cmpMap && <span className="w-36 text-right font-mono text-gray-600">{fmt(cmpMap.get(l.name) ?? 0)}</span>}
            </div>
            {detailed &&
              !cmpMap &&
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
        ))}
        {extra}
      </div>
      {total !== undefined && (
        <div className="mt-10 flex justify-between border-t border-black pt-1 font-bold">
          <span className="min-w-0 flex-1 tracking-[0.3em]">Total</span>
          <span className="w-36 text-right font-mono">{fmt(total)}</span>
          {cmpMap && cmpTotal !== undefined && <span className="w-36 text-right font-mono text-gray-600">{fmt(cmpTotal)}</span>}
        </div>
      )}
    </div>
  );

  return (
    <TallyScreen
      title="Balance Sheet"
      rail={[
        { hotkey: 'F2', label: 'Period', onClick: () => setShowPeriod((v) => !v) },
        { label: 'Basis of Values', disabled: true, gapBefore: true },
        { hotkey: 'H', label: detailed ? 'Condensed' : 'Detailed', onClick: () => setDetailed((v) => !v) },
        {
          hotkey: 'C',
          label: compareAsOf ? 'Del Column' : 'New Column',
          onClick: () => setCompareAsOf((c) => (c ? null : shiftYear(asOfDate))),
          active: !!compareAsOf,
        },
        { label: 'Exception Reports', disabled: true },
        { label: 'Save View', disabled: true },
        sourceRail,
        {
          hotkey: 'F',
          label: filterText ? `Filter: ${filterText.slice(0, 10)}` : 'Apply Filter',
          gapBefore: true,
          active: !!filterText,
          onClick: () => {
            const v = window.prompt('Show only ledgers containing:', filterText);
            if (v !== null) setFilterText(v.trim());
          },
        },
        { hotkey: 'P', label: 'Print', onClick: () => window.print(), gapBefore: true },
      ]}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        {showPeriod && (
          <div className="mb-2 flex items-center gap-2 border border-[#9db8d8] bg-[#fdf6d8] px-2 py-1">
            <span>As at:</span>
            <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="border bg-white px-1" />
          </div>
        )}
        {isLoading ? (
          <div className="py-16 text-center text-gray-400">Loading…</div>
        ) : (
          <div className="flex gap-0">
            <div className="flex-1 border-r border-gray-400 pr-3">
              {panel(
                'Liabilities',
                liabilityLines,
                cmp?.liab ?? null,
                <div className="flex justify-between">
                  <span className="min-w-0 flex-1 font-bold">Profit &amp; Loss A/c</span>
                  <span className="w-36 text-right font-mono">{fmt(pnl)}</span>
                  {cmp && <span className="w-36 text-right font-mono text-gray-600">{fmt(cmp.pnl)}</span>}
                </div>,
                totalLiab,
                cmp?.totalLiab,
              )}
            </div>
            <div className="flex-1 pl-3">
              {panel('Assets', assetLines, cmp?.assets ?? null, undefined, totalAssets, cmp?.totalAssets)}
            </div>
          </div>
        )}
      </div>
    </TallyScreen>
  );
};

export default BalanceSheet;
