import { Receipt, TrendingUp, ArrowDownToLine, ArrowUpFromLine, Megaphone } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { MonthlyMatrixCard } from '@/components/MonthlyMatrixCard';

const EXPENSE_ROWS = ['Salary', 'Rent', 'Lab charges', 'Electricity bill'];

const INCOME_ROWS = [
  'Hope OPD income',
  'Hope IPD income',
  'Ayushman OPD income',
  'Ayushman IPD income',
  'Vaccine income',
];

// Will expand to one row per corporate once drill-down is built.
const RECEIVABLE_ROWS = ['Corporate receivables (all corporates)'];

const PAYABLE_ROWS = [
  'Implant vendors',
  'Doctors',
  'Pharmacy vendors',
  'Rent',
  'Lab charges — Gandhi',
];

export function DirectorFinancialStatements() {
  // Rows come from the marketing executives master, so new hires appear automatically
  const { data: marketingRows = [] } = useQuery({
    queryKey: ['marketing-users-names'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_users')
        .select('name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data ?? []).map(u => u.name);
    },
  });

  return (
    <>
      <MonthlyMatrixCard
        title="Income Statement"
        icon={<TrendingUp className="h-5 w-5 text-blue-600" />}
        accentClass="border-l-blue-500"
        rows={INCOME_ROWS}
        footnote="Drill-downs planned: Hope IPD income by corporate; OPD income by private / corporate / insurance."
      />
      <MonthlyMatrixCard
        title="Expense Report"
        icon={<Receipt className="h-5 w-5 text-emerald-600" />}
        accentClass="border-l-emerald-500"
        rows={EXPENSE_ROWS}
      />
      <MonthlyMatrixCard
        title="Receivables"
        subtitle="Position as on the 1st of each month"
        icon={<ArrowDownToLine className="h-5 w-5 text-amber-600" />}
        accentClass="border-l-amber-500"
        rows={RECEIVABLE_ROWS}
        footnote="Will expand to one row per corporate when the drill-down is built."
      />
      <MonthlyMatrixCard
        title="Payables"
        subtitle="Position as on the 1st of each month"
        icon={<ArrowUpFromLine className="h-5 w-5 text-rose-600" />}
        accentClass="border-l-rose-500"
        rows={PAYABLE_ROWS}
      />
      <MonthlyMatrixCard
        title="Marketing Executive Revenue"
        subtitle="Rows pulled live from the marketing executives master"
        icon={<Megaphone className="h-5 w-5 text-violet-600" />}
        accentClass="border-l-violet-500"
        rows={marketingRows}
      />
    </>
  );
}
