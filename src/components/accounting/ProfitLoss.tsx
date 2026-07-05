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
}

interface Line {
  name: string;
  amount: number;
  ledgers: { name: string; amount: number }[];
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

const shiftYear = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  d.setFullYear(d.getFullYear() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fyStart = (): string => {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-04-01`;
};

/**
 * Profit & Loss A/c — Tally Prime two-panel replica with the trading
 * split: direct expenses vs direct incomes above Gross Profit c/o → b/f,
 * indirect expenses vs indirect incomes below, ending in Nett Profit/Loss.
 */
const ProfitLoss: React.FC = () => {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [fromDate, setFromDate] = useState(fyStart);
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showPeriod, setShowPeriod] = useState(false);
  const [detailed, setDetailed] = useState(() => getTallyConfig().defaultDetailed);
  const [compare, setCompare] = useState(false); // previous-year column

  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ['pnl_accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_type')
        .eq('is_active', true)
        .order('account_code');
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });

  const { data: movements = new Map<string, Movement>(), isLoading: entriesLoading } = useQuery({
    queryKey: ['profit_loss_movements', fromDate, toDate, selectedCompanyId],
    queryFn: () => accountMovements({ from: fromDate, upto: toDate, companyId: selectedCompanyId }),
  });

  const { data: movements2 = new Map<string, Movement>() } = useQuery({
    queryKey: ['profit_loss_movements', shiftYear(fromDate), shiftYear(toDate), selectedCompanyId],
    enabled: compare,
    queryFn: () =>
      accountMovements({ from: shiftYear(fromDate), upto: shiftYear(toDate), companyId: selectedCompanyId }),
  });

  const compute = (mov: Map<string, Movement>) => {
    const debit = new Map<string, number>();
    const credit = new Map<string, number>();
    for (const [id, m] of mov) {
      debit.set(id, m.debit);
      credit.set(id, m.credit);
    }

    const mk = (name: string): Line => ({ name, amount: 0, ledgers: [] });
    const dirExp = mk('Direct Expenses');
    const purch = mk('Purchase Accounts');
    const indExp = mk('Indirect Expenses');
    const dirInc = mk('Sales Accounts');
    const indInc = mk('Indirect Incomes');

    for (const a of accounts) {
      const t = a.account_type?.toUpperCase() ?? '';
      const dr = debit.get(a.id) ?? 0;
      const cr = credit.get(a.id) ?? 0;
      if (!t.includes('INCOME') && !t.includes('EXPENSE')) continue;
      if (t.includes('INCOME')) {
        const bal = cr - dr;
        if (Math.abs(bal) < 0.005) continue;
        const line = t === 'INDIRECT_INCOME' ? indInc : dirInc;
        line.amount += bal;
        line.ledgers.push({ name: a.account_name, amount: bal });
      } else {
        const bal = dr - cr;
        if (Math.abs(bal) < 0.005) continue;
        const isPurchase = a.account_name.toLowerCase().includes('purchase');
        const line = t === 'INDIRECT_EXPENSES' ? indExp : isPurchase ? purch : dirExp;
        line.amount += bal;
        line.ledgers.push({ name: a.account_name, amount: bal });
      }
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
  };

  const { purchase, directExpense, indirectExpense, directIncome, indirectIncome, grossProfit, nett, prev } =
    useMemo(() => {
      const cur = compute(movements);
      return { ...cur, prev: compare ? compute(movements2) : null };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accounts, movements, movements2, compare]);

  const isLoading = accountsLoading || entriesLoading;
  const companyName = companies.find((c) => c.id === selectedCompanyId)?.company_name || 'All Companies';

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
        {detailed &&
          l.ledgers.map((led: { name: string; amount: number }) => (
            <div key={led.name} className="flex justify-between text-[12px] italic text-gray-700">
              <span className="pl-5">{led.name}</span>
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

  return (
    <TallyScreen
      title="Profit & Loss A/c"
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
          label: compare ? 'Del Column' : 'New Column',
          onClick: () => setCompare((v) => !v),
          active: compare,
        },
        { label: 'Exception Reports', disabled: true },
        { label: 'Save View', disabled: true },
        { hotkey: 'P', label: 'Print', onClick: () => window.print(), gapBefore: true },
      ]}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        {showPeriod && (
          <div className="mb-2 flex items-center gap-2 border border-[#9db8d8] bg-[#fdf6d8] px-2 py-1">
            <span>Period:</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="border bg-white px-1" />
            <span>to</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="border bg-white px-1" />
            <span className="ml-4">Company:</span>
            <select value={selectedCompanyId} onChange={(e) => setSelectedCompanyId(e.target.value)} className="border bg-white px-1">
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
        ) : compare && prev ? (
          /* Comparative columnar P&L (Tally New Column) */
          <div className="mx-auto max-w-3xl">
            <div className="flex border-y border-black bg-[#f0f4fa] font-semibold">
              <div className="min-w-0 flex-1 px-1">Particulars</div>
              <div className="w-44 px-1 text-right">
                {tallyDateLabel(fromDate)}–{tallyDateLabel(toDate)}
              </div>
              <div className="w-44 px-1 text-right text-gray-600">
                {tallyDateLabel(shiftYear(fromDate))}–{tallyDateLabel(shiftYear(toDate))}
              </div>
            </div>
            {[
              ['Sales Accounts', directIncome.amount, prev.directIncome.amount],
              ['Purchase Accounts', purchase.amount, prev.purchase.amount],
              ['Direct Expenses', directExpense.amount, prev.directExpense.amount],
              ['Gross Profit', grossProfit, prev.grossProfit],
              ['Indirect Incomes', indirectIncome.amount, prev.indirectIncome.amount],
              ['Indirect Expenses', indirectExpense.amount, prev.indirectExpense.amount],
              ['Nett Profit', nett, prev.nett],
            ].map(([label, cur, prv]) => (
              <div
                key={label as string}
                className={`flex border-b border-dashed border-gray-200 ${
                  label === 'Gross Profit' || label === 'Nett Profit' ? 'font-bold' : ''
                }`}
              >
                <div className="min-w-0 flex-1 px-1">{label as string}</div>
                <div className="w-44 px-1 text-right font-mono">{fmt(Number(cur))}</div>
                <div className="w-44 px-1 text-right font-mono text-gray-600">{fmt(Number(prv))}</div>
              </div>
            ))}
          </div>
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
  );
};

export default ProfitLoss;
