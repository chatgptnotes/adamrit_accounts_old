import { Receipt, TrendingUp, ArrowDownToLine, ArrowUpFromLine, Megaphone } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { MonthlyMatrixCard } from '@/components/MonthlyMatrixCard';
import { useDirectorLedgerFigures, type RowValues } from '@/hooks/useDirectorLedgerFigures';

const EXPENSE_ROWS = ['Salary', 'Rent', 'Lab charges', 'Electricity bill'];

const INCOME_ROWS = [
  'Daily receipts (Tilak)',
  'Daily expenses (Tilak)',
  'Net profit / loss (Tilak)',
  'Hope OPD income',
  'Hope IPD income',
  'Ayushman OPD income',
  'Ayushman IPD income',
  'Vaccine income',
];

// Will expand to one row per corporate once drill-down is built.
const RECEIVABLE_ROWS = ['Daily receipts (Tilak)', 'Corporate receivables (all corporates)'];

const PAYABLE_ROWS = [
  'Daily expenses (Tilak)',
  'Implant vendors',
  'Doctors',
  'Pharmacy vendors',
  'Rent',
  'Lab charges — Gandhi',
];

const CASH_POSITION_ROWS = ['Cash in Hand (Tilak)', 'Cash in Bank (Tilak)'];

/** Static rows first, then the ledger-derived rows that aren't already named. */
const withLedgerRows = (staticRows: string[], ledgerRows: string[]) => {
  const seen = new Set(staticRows.map(r => r.toLowerCase()));
  return [...staticRows, ...ledgerRows.filter(r => !seen.has(r.toLowerCase()))];
};

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

export function DirectorFinancialStatements() {
  const year = new Date().getFullYear();

  // Every "Sys" figure below comes from the accounting module's ledgers —
  // opening balances plus authorised vouchers, all companies together.
  const { data: ledger } = useDirectorLedgerFigures(year);

  // Sys values for the Expense Report's "Lab charges" row: monthly
  // visit_labs cost totals via the director_lab_charges_by_month RPC.
  const { data: labCharges } = useQuery({
    queryKey: ['director-lab-charges', year],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .rpc('director_lab_charges_by_month', { p_year: year });
      if (error) throw error;
      const byMonth: Record<number, number> = {};
      for (const r of data ?? []) byMonth[r.month - 1] = Number(r.total);
      return byMonth;
    },
  });

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
        subtitle="Sys figures: income ledger groups from the accounting module, all companies"
        icon={<TrendingUp className="h-5 w-5 text-blue-600" />}
        accentClass="border-l-blue-500"
        rows={withLedgerRows(INCOME_ROWS, ledger?.incomeRows ?? [])}
        systemValues={ledger?.income}
        dailyDrillDown
        footnote="Ledger rows appear once they carry a balance. Live book starts at the 25 Jul 2026 Tally cutover."
      />
      <MonthlyMatrixCard
        title="Expense Report"
        statementKey="expense"
        subtitle="Sys figures: expense ledger groups from the accounting module, all companies"
        icon={<Receipt className="h-5 w-5 text-emerald-600" />}
        accentClass="border-l-emerald-500"
        rows={withLedgerRows(['Daily expenses (Tilak)', ...EXPENSE_ROWS], ledger?.expenseRows ?? [])}
        systemValues={{ ...(ledger?.expense ?? {}), ...(labCharges ? { 'Lab charges': labCharges } : {}) }}
        dailyDrillDown
        footnote="Ledger rows appear once they carry a balance. Live book starts at the 25 Jul 2026 Tally cutover."
      />
      <MonthlyMatrixCard
        title="Receivables"
        statementKey="receivables"
        subtitle="Position as on the 1st of each month — Sys figures from the sundry debtor ledgers"
        icon={<ArrowDownToLine className="h-5 w-5 text-amber-600" />}
        accentClass="border-l-amber-500"
        rows={withLedgerRows(RECEIVABLE_ROWS, ledger?.receivableRows ?? [])}
        systemValues={{
          ...(ledger?.receivables ?? {}),
          'Corporate receivables (all corporates)': totalByMonth(ledger?.receivables),
        }}
        dailyDrillDown
      />
      <MonthlyMatrixCard
        title="Payables"
        statementKey="payables"
        subtitle="Position as on the 1st of each month — Sys figures from the sundry creditor ledgers"
        icon={<ArrowUpFromLine className="h-5 w-5 text-rose-600" />}
        accentClass="border-l-rose-500"
        rows={withLedgerRows(PAYABLE_ROWS, ledger?.payableRows ?? [])}
        systemValues={ledger?.payables}
        dailyDrillDown
      />
      <MonthlyMatrixCard
        title="Cash Position"
        statementKey="cash_position"
        subtitle="Daily entry by Accounts (Tilak) — Sys figures: month-end cash and bank ledger balances"
        icon={<Receipt className="h-5 w-5 text-cyan-600" />}
        accentClass="border-l-cyan-500"
        rows={CASH_POSITION_ROWS}
        systemValues={ledger?.cash}
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
