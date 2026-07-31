import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { accountMovements, type Movement } from '@/lib/accountMovements';
import { fetchActiveAccounts } from '@/lib/fetchAccounts';
import { useAccountingCompany } from './AccountingCompanyContext';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { useRowCursor } from './tally/useRowCursor';
import { monthsInPeriod } from './tally/PeriodContext';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
}


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
  const [openMonth, setOpenMonth] = useState<MonthFlow | null>(null);

  const { selectedCompanyId } = useAccountingCompany();
  const report = useTallyReport({
    filterFields: ['Particulars'],
    views: [
      { label: 'Cash Flow', target: 'cash-flow' },
      { label: 'Receipts & Payments', target: 'receipts-payments' },
      { label: 'Balance Sheet', target: 'balance-sheet' },
      { label: 'Cash/Bank Summary', target: 'cash-bank-summary' },
    ],
  });
  const periodMonths = monthsInPeriod({ from: report.from, to: report.to });
  const fmt = report.fmtAmount;

  const { data: accounts = [] } = useQuery({
    queryKey: ['ff_accounts', selectedCompanyId],
    enabled: !!selectedCompanyId,
    queryFn: () => fetchActiveAccounts<Account>({ columns: 'id, account_code, account_name, account_type', companyId: selectedCompanyId }),
  });

  const { data: months = [], isLoading } = useQuery({
    queryKey: ['funds_flow', selectedCompanyId, report.from, report.to, accounts.length],
    enabled: accounts.length > 0,
    queryFn: async () => {
      const defs = periodMonths;
      const movs = await Promise.all(defs.map((d) => accountMovements({ from: d.from, upto: d.upto, companyId: selectedCompanyId })));
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

  const { cursor, setCursor } = useRowCursor({
    count: months.length,
    enabled: !openMonth,
    onEnter: (index) => months[index] && setOpenMonth(months[index]),
  });

  return (
    <>
    <TallyScreen
      title={openMonth ? `Funds Flow — ${openMonth.label}` : 'Funds Flow'}
      onClose={openMonth ? () => setOpenMonth(null) : undefined}
      rail={report.rail}
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
              {report.periodLabel}
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
                {months.map((m, i) => (
                  <button
                    key={m.label}
                    type="button"
                    onClick={() => m.total > 0 && setOpenMonth(m)}
                    onMouseEnter={() => setCursor(i)}
                    className={`flex w-full border-b border-dashed border-gray-200 text-left ${
                      cursor === i ? 'bg-[#ffc423]' : m.total > 0 ? 'hover:bg-[#fdf6d8]' : 'text-gray-400'
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

    {report.popups}
    </>
  );
};

export default FundsFlow;
