import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { useRowCursor } from './tally/useRowCursor';
import { dayLabel } from './tally/PeriodContext';
import { useAccountingCompany } from './AccountingCompanyContext';

interface VarianceRow {
  accountId: string;
  name: string;
  budget: number;
  actual: number;
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/**
 * Budget Variance — Tally's Alt+B view as its own report: for the chosen
 * budget, each budgeted ledger's actual net activity in the budget period
 * against the budgeted amount, with variance and % used.
 */
const BudgetVariance: React.FC<{ onOpenLedger?: (accountId: string) => void }> = ({ onOpenLedger }) => {
  const { selectedCompanyId } = useAccountingCompany();
  const [budgetId, setBudgetId] = useState<string | null>(null);

  const report = useTallyReport({
    supportsColumns: false,
    filterFields: ['Ledger'],
    views: [
      { label: 'Trial Balance', target: 'trial-balance' },
      { label: 'Group Summary', target: 'group-summary' },
      { label: 'Profit & Loss A/c', target: 'profit-loss' },
    ],
  });

  const { data: budgets = [] } = useQuery({
    queryKey: ['budgets', selectedCompanyId],
    enabled: !!selectedCompanyId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('budgets')
        .select('id, name, period_from, period_to')
        .eq('company_id', selectedCompanyId)
        .eq('is_active', true)
        .order('period_from', { ascending: false });
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; period_from: string; period_to: string }[];
    },
  });

  const budget = budgets.find((b) => b.id === (budgetId ?? budgets[0]?.id));

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['budget_variance', budget?.id],
    enabled: !!budget,
    queryFn: async (): Promise<VarianceRow[]> => {
      const { data: lines, error: lineErr } = await (supabase as any)
        .from('budget_lines')
        .select('account_id, amount, account:chart_of_accounts(account_name)')
        .eq('budget_id', budget!.id);
      if (lineErr) throw lineErr;
      if (!lines?.length) return [];

      const ids = lines.map((l: any) => l.account_id);
      const actual = new Map<string, number>();
      for (let fromRow = 0; ; fromRow += 1000) {
        const { data: entries, error: entErr } = await (supabase as any)
          .from('voucher_entries')
          .select('account_id, debit_amount, credit_amount, voucher:vouchers!inner(voucher_date)')
          .in('account_id', ids)
          .gte('voucher.voucher_date', budget!.period_from)
          .lte('voucher.voucher_date', budget!.period_to)
          .order('id')
          .range(fromRow, fromRow + 999);
        if (entErr) throw entErr;
        for (const e of entries ?? []) {
          // Activity magnitude, whichever side the ledger naturally grows on
          actual.set(
            e.account_id,
            (actual.get(e.account_id) ?? 0) + (Number(e.debit_amount) || 0) - (Number(e.credit_amount) || 0),
          );
        }
        if (!entries || entries.length < 1000) break;
      }

      return lines.map((l: any) => ({
        accountId: l.account_id,
        name: l.account?.account_name ?? l.account_id,
        budget: Number(l.amount) || 0,
        actual: Math.abs(actual.get(l.account_id) ?? 0),
      }));
    },
  });

  const { cursor, setCursor } = useRowCursor({
    count: rows.length,
    onEnter: (i) => rows[i] && onOpenLedger?.(rows[i].accountId),
  });

  const totals = useMemo(
    () => rows.reduce((s, r) => ({ budget: s.budget + r.budget, actual: s.actual + r.actual }), { budget: 0, actual: 0 }),
    [rows],
  );

  return (
    <>
      <TallyScreen title="Budget Variance" rail={report.rail}>
        <div className="px-3 pb-4 pt-1 text-[13px]">
          <div className="text-center">
            <div className="font-bold">Budget Variance</div>
            {budget && (
              <div className="text-[11px]">
                {budget.name} — {dayLabel(budget.period_from)} to {dayLabel(budget.period_to)}
              </div>
            )}
          </div>

          {budgets.length > 1 && (
            <div className="mt-1 flex justify-center gap-2">
              {budgets.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBudgetId(b.id)}
                  className={`border px-2 py-0.5 text-xs ${
                    b.id === budget?.id ? 'border-black bg-[#ffc423] font-semibold' : 'border-[#b8c9dd] bg-white text-[#1a4d8f]'
                  }`}
                >
                  {b.name}
                </button>
              ))}
            </div>
          )}

          <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
            <div className="min-w-0 flex-1 px-1">Particulars</div>
            <div className="w-32 shrink-0 px-1 text-right">Budget</div>
            <div className="w-32 shrink-0 px-1 text-right">Actual</div>
            <div className="w-32 shrink-0 px-1 text-right">Variance</div>
            <div className="w-20 shrink-0 px-1 text-right">% Used</div>
          </div>

          {!budget ? (
            <div className="py-10 text-center text-gray-400">
              No budget for this company yet — create one under Masters → Create → Budget.
            </div>
          ) : isLoading ? (
            <div className="py-10 text-center text-gray-400">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-gray-400">This budget has no ledger amounts yet.</div>
          ) : (
            rows.map((r) => {
              const variance = r.budget - r.actual;
              const pct = r.budget > 0 ? (r.actual / r.budget) * 100 : 0;
              return (
                <button
                  key={r.accountId}
                  type="button"
                  onClick={() => onOpenLedger?.(r.accountId)}
                  onMouseEnter={() => setCursor(rows.indexOf(r))}
                  className={`flex w-full border-b border-dashed border-gray-200 text-left ${cursor === rows.indexOf(r) ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'}`}
                >
                  <div className="min-w-0 flex-1 truncate px-1">{r.name}</div>
                  <div className="w-32 shrink-0 px-1 text-right font-mono">{fmt(r.budget)}</div>
                  <div className="w-32 shrink-0 px-1 text-right font-mono">{fmt(r.actual)}</div>
                  <div className={`w-32 shrink-0 px-1 text-right font-mono ${variance < 0 ? 'text-red-700' : ''}`}>
                    {fmt(variance)}
                  </div>
                  <div className={`w-20 shrink-0 px-1 text-right font-mono ${pct > 100 ? 'text-red-700' : ''}`}>
                    {r.budget > 0 ? `${pct.toFixed(0)}%` : ''}
                  </div>
                </button>
              );
            })
          )}

          {!isLoading && rows.length > 0 && (
            <div className="mt-2 flex border-t border-black pt-0.5 font-bold">
              <div className="min-w-0 flex-1 px-1 tracking-[0.2em]">Total</div>
              <div className="w-32 shrink-0 px-1 text-right font-mono">{fmt(totals.budget)}</div>
              <div className="w-32 shrink-0 px-1 text-right font-mono">{fmt(totals.actual)}</div>
              <div className={`w-32 shrink-0 px-1 text-right font-mono ${totals.budget - totals.actual < 0 ? 'text-red-700' : ''}`}>
                {fmt(totals.budget - totals.actual)}
              </div>
              <div className="w-20 shrink-0 px-1" />
            </div>
          )}
        </div>
      </TallyScreen>

      {report.popups}
    </>
  );
};

export default BudgetVariance;
