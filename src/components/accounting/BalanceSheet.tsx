import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { accountMovements, type Movement } from '@/lib/accountMovements';
import { format } from 'date-fns';
import { useCompanies } from '@/hooks/useCompanies';
import { TallyScreen, getTallyConfig } from './tally/TallyChrome';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  opening_balance: number | null;
  opening_balance_type: string | null;
}

interface Line {
  name: string;
  amount: number;
  ledgers: { name: string; amount: number }[];
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

// Map chart account_type values onto Tally's balance-sheet heads.
const LIABILITY_HEADS: Record<string, string> = {
  EQUITY: 'Capital Account',
  LONG_TERM_LIABILITIES: 'Loans (Liability)',
  CURRENT_LIABILITIES: 'Current Liabilities',
  LIABILITIES: 'Current Liabilities',
};
const ASSET_HEADS: Record<string, string> = {
  FIXED_ASSETS: 'Fixed Assets',
  CURRENT_ASSETS: 'Current Assets',
  ASSETS: 'Current Assets',
};
const LIABILITY_ORDER = ['Capital Account', 'Loans (Liability)', 'Current Liabilities'];
const ASSET_ORDER = ['Fixed Assets', 'Current Assets'];

/**
 * Balance Sheet — Tally Prime two-panel replica: Liabilities | Assets,
 * grouped into Tally's heads, P&L A/c on the liabilities side with the
 * current-period figure, matching grand totals on both panels.
 */
const BalanceSheet: React.FC = () => {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [asOfDate, setAsOfDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [showPeriod, setShowPeriod] = useState(false);
  const [detailed, setDetailed] = useState(() => getTallyConfig().defaultDetailed || true);
  const [compareAsOf, setCompareAsOf] = useState<string | null>(null);

  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ['balance_sheet_accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_type, opening_balance, opening_balance_type')
        .eq('is_active', true)
        .order('account_code');
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });

  const { data: movements = new Map<string, Movement>(), isLoading: entriesLoading } = useQuery({
    queryKey: ['balance_sheet_movements', asOfDate, selectedCompanyId],
    queryFn: () => accountMovements({ upto: asOfDate, companyId: selectedCompanyId }),
  });

  const { data: movements2 = new Map<string, Movement>() } = useQuery({
    queryKey: ['balance_sheet_movements', compareAsOf, selectedCompanyId],
    enabled: !!compareAsOf,
    queryFn: () => accountMovements({ upto: compareAsOf!, companyId: selectedCompanyId }),
  });

  const compute = (mov: Map<string, Movement>) => {
    const debit = new Map<string, number>();
    const credit = new Map<string, number>();
    for (const [id, m] of mov) {
      debit.set(id, m.debit);
      credit.set(id, m.credit);
    }

    const liabGroups = new Map<string, Line>();
    const assetGroups = new Map<string, Line>();
    let income = 0;
    let expense = 0;

    for (const a of accounts) {
      const dr = debit.get(a.id) ?? 0;
      const cr = credit.get(a.id) ?? 0;
      const opening = (Number(a.opening_balance) || 0) * (a.opening_balance_type?.toUpperCase() === 'CR' ? -1 : 1);
      const t = a.account_type?.toUpperCase() ?? '';

      if (t.includes('INCOME')) {
        income += cr - dr;
      } else if (t.includes('EXPENSE')) {
        expense += dr - cr;
      } else if (t in LIABILITY_HEADS) {
        const bal = -(opening + dr - cr); // credit balance positive
        if (Math.abs(bal) < 0.005) continue;
        const head = LIABILITY_HEADS[t];
        const line = liabGroups.get(head) ?? { name: head, amount: 0, ledgers: [] };
        line.amount += bal;
        line.ledgers.push({ name: a.account_name, amount: bal });
        liabGroups.set(head, line);
      } else if (t in ASSET_HEADS) {
        const bal = opening + dr - cr; // debit balance positive
        if (Math.abs(bal) < 0.005) continue;
        const head = ASSET_HEADS[t];
        const line = assetGroups.get(head) ?? { name: head, amount: 0, ledgers: [] };
        line.amount += bal;
        line.ledgers.push({ name: a.account_name, amount: bal });
        assetGroups.set(head, line);
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
    const cur = compute(movements);
    const c = compareAsOf ? compute(movements2) : null;
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
  }, [accounts, movements, movements2, compareAsOf]);

  const isLoading = accountsLoading || entriesLoading;
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
        {lines.map((l) => (
          <React.Fragment key={l.name}>
            <div className="flex justify-between">
              <span className="min-w-0 flex-1 font-bold">{l.name}</span>
              <span className="w-36 text-right font-mono">{fmt(l.amount)}</span>
              {cmpMap && <span className="w-36 text-right font-mono text-gray-600">{fmt(cmpMap.get(l.name) ?? 0)}</span>}
            </div>
            {detailed &&
              !cmpMap &&
              l.ledgers.map((led) => (
                <div key={led.name} className="flex justify-between text-[12px] italic text-gray-700">
                  <span className="pl-5">{led.name}</span>
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
        {
          hotkey: 'F3',
          label: 'Company',
          onClick: () =>
            setSelectedCompanyId((cur) => {
              const ids = ['', ...companies.map((c) => c.id)];
              return ids[(ids.indexOf(cur) + 1) % ids.length];
            }),
        },
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
        { label: 'Apply Filter', disabled: true, gapBefore: true },
        { hotkey: 'P', label: 'Print', onClick: () => window.print(), gapBefore: true },
      ]}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        {showPeriod && (
          <div className="mb-2 flex items-center gap-2 border border-[#9db8d8] bg-[#fdf6d8] px-2 py-1">
            <span>As at:</span>
            <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="border bg-white px-1" />
            <span className="ml-4">Company:</span>
            <select
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
              className="border bg-white px-1"
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company_name}
                </option>
              ))}
            </select>
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
