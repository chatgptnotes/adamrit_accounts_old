import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { accountMovements, type Movement } from '@/lib/accountMovements';
import { TallyScreen } from './tally/TallyChrome';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const currentFyStartYear = (): number => {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
};

const fyMonths = (fyStartYear: number): { label: string; from: string; upto: string }[] => {
  const out: { label: string; from: string; upto: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const m = 3 + i;
    const year = fyStartYear + (m > 11 ? 1 : 0);
    const month = (m % 12) + 1;
    const first = new Date(year, month - 1, 1);
    const last = new Date(year, month, 0);
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({
      label: first.toLocaleDateString('en-GB', { month: 'long', year: '2-digit' }).replace(' ', '-'),
      from: iso(first),
      upto: iso(last),
    });
  }
  return out;
};

interface FlowLine {
  name: string;
  amount: number;
}

interface MonthFlow {
  label: string;
  from: string;
  upto: string;
  sources: FlowLine[];
  applications: FlowLine[];
  total: number;
}

// Classify a period's movements into funds-flow sources/applications.
// Working capital (current assets/liabilities incl. cash) is the balancing
// figure; non-current items and operating profit are the flows — Tally's method.
const computeFlow = (
  accounts: Account[],
  mov: Map<string, Movement>,
): { sources: FlowLine[]; applications: FlowLine[] } => {
  const sources: FlowLine[] = [];
  const applications: FlowLine[] = [];
  let income = 0;
  let expense = 0;
  let wcDelta = 0; // Δ current assets − Δ current liabilities (both as dr−cr)

  for (const a of accounts) {
    const m = mov.get(a.id);
    if (!m) continue;
    const net = m.debit - m.credit;
    if (Math.abs(net) < 0.005) continue;
    const t = a.account_type?.toUpperCase() ?? '';
    if (t.includes('INCOME')) income += -net;
    else if (t.includes('EXPENSE')) expense += net;
    else if (t === 'FIXED_ASSETS') {
      if (net > 0) applications.push({ name: a.account_name, amount: net });
      else sources.push({ name: a.account_name, amount: -net });
    } else if (t === 'LONG_TERM_LIABILITIES' || t === 'EQUITY') {
      if (net < 0) sources.push({ name: a.account_name, amount: -net });
      else applications.push({ name: a.account_name, amount: net });
    } else {
      wcDelta += net;
    }
  }

  const profit = income - expense;
  if (profit > 0.005) sources.push({ name: 'Funds from Operations (Nett Profit)', amount: profit });
  else if (profit < -0.005) applications.push({ name: 'Loss from Operations', amount: -profit });

  if (wcDelta > 0.005) applications.push({ name: 'Increase in Working Capital', amount: wcDelta });
  else if (wcDelta < -0.005) sources.push({ name: 'Decrease in Working Capital', amount: -wcDelta });

  sources.sort((a, b) => b.amount - a.amount);
  applications.sort((a, b) => b.amount - a.amount);
  return { sources, applications };
};

/**
 * Funds Flow — Tally Prime replica: Apr–Mar months with Sources /
 * Applications totals; drill into a month for the two-panel statement
 * (funds from operations, non-current movements, working-capital change).
 */
const FundsFlow: React.FC = () => {
  const [fyYear, setFyYear] = useState(currentFyStartYear);
  const [openMonth, setOpenMonth] = useState<MonthFlow | null>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ['ff_accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_type')
        .eq('is_active', true);
      if (error) throw error;
      return data as Account[];
    },
  });

  const { data: months = [], isLoading } = useQuery({
    queryKey: ['funds_flow', fyYear, accounts.length],
    enabled: accounts.length > 0,
    queryFn: async () => {
      const defs = fyMonths(fyYear);
      const movs = await Promise.all(defs.map((d) => accountMovements({ from: d.from, upto: d.upto })));
      return defs.map((d, i): MonthFlow => {
        const { sources, applications } = computeFlow(accounts, movs[i]);
        return {
          ...d,
          sources,
          applications,
          total: sources.reduce((s, l) => s + l.amount, 0),
        };
      });
    },
  });

  const grand = months.reduce((s, m) => s + m.total, 0);

  return (
    <TallyScreen
      title={openMonth ? `Funds Flow — ${openMonth.label}` : 'Funds Flow'}
      onClose={openMonth ? () => setOpenMonth(null) : undefined}
      rail={[
        {
          hotkey: 'F2',
          label: `FY ${fyYear}-${String(fyYear + 1).slice(2)}`,
          onClick: () => {
            setOpenMonth(null);
            setFyYear((y) => (y === currentFyStartYear() ? y - 1 : currentFyStartYear()));
          },
        },
        { hotkey: 'F3', label: 'Company', disabled: true },
        { hotkey: 'P', label: 'Print', onClick: () => window.print(), gapBefore: true },
      ]}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        {openMonth ? (
          <div className="flex">
            <div className="min-w-0 flex-1 border-r border-gray-400 pr-3">
              <div className="border-b border-black pb-0.5 font-semibold tracking-[0.3em]">Sources</div>
              <div className="mt-1 space-y-0.5">
                {openMonth.sources.map((l) => (
                  <div key={l.name} className="flex justify-between border-b border-dashed border-gray-200">
                    <span className="min-w-0 flex-1 truncate">{l.name}</span>
                    <span className="font-mono">{fmt(l.amount)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-8 flex justify-between border-t border-black pt-1 font-bold">
                <span className="tracking-[0.3em]">Total</span>
                <span className="font-mono">{fmt(openMonth.sources.reduce((s, l) => s + l.amount, 0))}</span>
              </div>
            </div>
            <div className="min-w-0 flex-1 pl-3">
              <div className="border-b border-black pb-0.5 font-semibold tracking-[0.3em]">Applications</div>
              <div className="mt-1 space-y-0.5">
                {openMonth.applications.map((l) => (
                  <div key={l.name} className="flex justify-between border-b border-dashed border-gray-200">
                    <span className="min-w-0 flex-1 truncate">{l.name}</span>
                    <span className="font-mono">{fmt(l.amount)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-8 flex justify-between border-t border-black pt-1 font-bold">
                <span className="tracking-[0.3em]">Total</span>
                <span className="font-mono">{fmt(openMonth.applications.reduce((s, l) => s + l.amount, 0))}</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="text-center text-[11px]">
              1-Apr-{String(fyYear).slice(2)} to 31-Mar-{String(fyYear + 1).slice(2)}
            </div>
            <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
              <div className="min-w-0 flex-1 px-1">Particulars</div>
              <div className="w-40 px-1 text-right">Sources</div>
              <div className="w-40 px-1 text-right">Applications</div>
            </div>
            {isLoading ? (
              <div className="py-10 text-center text-gray-400">Computing monthly flows…</div>
            ) : (
              <>
                {months.map((m) => (
                  <button
                    key={m.label}
                    type="button"
                    onClick={() => m.total > 0 && setOpenMonth(m)}
                    className={`flex w-full border-b border-dashed border-gray-200 text-left ${
                      m.total > 0 ? 'hover:bg-[#fdf6d8]' : 'text-gray-400'
                    }`}
                  >
                    <div className="min-w-0 flex-1 px-1">{m.label}</div>
                    <div className="w-40 px-1 text-right font-mono">{m.total > 0 ? fmt(m.total) : ''}</div>
                    <div className="w-40 px-1 text-right font-mono">
                      {m.total > 0 ? fmt(m.applications.reduce((s, l) => s + l.amount, 0)) : ''}
                    </div>
                  </button>
                ))}
                <div className="mt-1 flex border-t border-black pt-0.5 font-bold">
                  <div className="min-w-0 flex-1 px-1 tracking-[0.2em]">Grand Total</div>
                  <div className="w-40 px-1 text-right font-mono">{fmt(grand)}</div>
                  <div className="w-40 px-1 text-right font-mono">{fmt(grand)}</div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </TallyScreen>
  );
};

export default FundsFlow;
