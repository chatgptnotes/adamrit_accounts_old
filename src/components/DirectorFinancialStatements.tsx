import { Receipt, TrendingUp, ArrowDownToLine, ArrowUpFromLine, Megaphone } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { MonthlyMatrixCard } from '@/components/MonthlyMatrixCard';
import { useDirectorLedgerFigures, type RowValues } from '@/hooks/useDirectorLedgerFigures';

/** Month-wise sum of every row in a RowValues block. */
const totalByMonth = (values: RowValues | undefined): Record<number, number> => {
  const total: Record<number, number> = {};
  for (const months of Object.values(values ?? {})) {
    for (const [month, amount] of Object.entries(months)) {
      total[Number(month)] = (total[Number(month)] ?? 0) + amount;
    }
  }
  return total;
};

const TOTAL_ROW = 'TOTAL — all ledgers below';

/** The total first, then every ledger row, largest first. */
const withTotalRow = (rows: string[]): string[] => (rows.length ? [TOTAL_ROW, ...rows] : rows);
const withTotal = (values: RowValues | undefined): RowValues => ({
  ...(values ?? {}),
  [TOTAL_ROW]: totalByMonth(values),
});

/**
 * Director dashboard financial reports. Every row IS a ledger from the
 * accounting module, labelled "Ledger Name [code]" so the source of each
 * figure is unambiguous. Rows appear when the ledger carries any value in the
 * year; ordering is by magnitude, biggest first.
 */
export function DirectorFinancialStatements() {
  const year = new Date().getFullYear();

  // Every "Sys" figure below comes from the accounting module's ledgers —
  // opening balances plus authorised vouchers, all companies together.
  const { data: ledger } = useDirectorLedgerFigures(year);

  // Rows come from the relationship managers master (the single master for
  // marketing executives), so new hires appear automatically
  const { data: marketingRows = [] } = useQuery({
    queryKey: ['relationship-managers-names'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('relationship_managers')
        .select('name')
        .eq('is_hidden', false)
        .order('name');
      if (error) throw error;
      return (data ?? []).map(u => u.name);
    },
  });

  // The marketing card's rows are master names; the revenue entries carry a
  // free-typed name. Match them case-insensitively.
  const marketingSys: RowValues = {};
  for (const name of marketingRows) {
    const months = ledger?.marketing[name.trim().toLowerCase()];
    if (months) marketingSys[name] = months;
  }

  return (
    <>
      <MonthlyMatrixCard
        title="Income Statement"
        statementKey="income"
        subtitle="One row per income ledger [ledger code] — month's earnings from the accounting module, all companies"
        icon={<TrendingUp className="h-5 w-5 text-blue-600" />}
        accentClass="border-l-blue-500"
        rows={withTotalRow(ledger?.incomeRows ?? [])}
        systemValues={withTotal(ledger?.income)}
        dailyDrillDown
        footnote="Rows are the income ledgers themselves. Live book starts at the 25 Jul 2026 Tally cutover."
      />
      <MonthlyMatrixCard
        title="Expense Report"
        statementKey="expense"
        subtitle="One row per expense ledger [ledger code] — month's spending from the accounting module, all companies"
        icon={<Receipt className="h-5 w-5 text-emerald-600" />}
        accentClass="border-l-emerald-500"
        rows={withTotalRow(ledger?.expenseRows ?? [])}
        systemValues={withTotal(ledger?.expense)}
        dailyDrillDown
        footnote="Rows are the expense ledgers themselves. Live book starts at the 25 Jul 2026 Tally cutover."
      />
      <MonthlyMatrixCard
        title="Receivables"
        statementKey="receivables"
        subtitle="One row per sundry debtor ledger [ledger code] — balance as on the 1st of each month"
        icon={<ArrowDownToLine className="h-5 w-5 text-amber-600" />}
        accentClass="border-l-amber-500"
        rows={withTotalRow(ledger?.receivableRows ?? [])}
        systemValues={withTotal(ledger?.receivables)}
        dailyDrillDown
      />
      <MonthlyMatrixCard
        title="Payables"
        statementKey="payables"
        subtitle="One row per sundry creditor ledger [ledger code] — balance as on the 1st of each month"
        icon={<ArrowUpFromLine className="h-5 w-5 text-rose-600" />}
        accentClass="border-l-rose-500"
        rows={withTotalRow(ledger?.payableRows ?? [])}
        systemValues={withTotal(ledger?.payables)}
        dailyDrillDown
      />
      <MonthlyMatrixCard
        title="Cash Position"
        statementKey="cash_position"
        subtitle="One row per cash and bank ledger [ledger code] — balance at each month end"
        icon={<Receipt className="h-5 w-5 text-cyan-600" />}
        accentClass="border-l-cyan-500"
        rows={withTotalRow(ledger?.cashRows ?? [])}
        systemValues={withTotal(ledger?.cash)}
        dailyDrillDown
      />
      <MonthlyMatrixCard
        title="Marketing Executive Revenue"
        statementKey="marketing_revenue"
        subtitle="Rows from the relationship managers master — Sys figures from the Daily Revenue Report"
        icon={<Megaphone className="h-5 w-5 text-violet-600" />}
        accentClass="border-l-violet-500"
        rows={marketingRows}
        systemValues={marketingSys}
        dailyDrillDown
      />
    </>
  );
}
