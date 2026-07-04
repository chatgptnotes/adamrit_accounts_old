import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TallyScreen } from './tally/TallyChrome';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  IndianRupee,
  TrendingUp,
  TrendingDown,
  Users,
  FileText,
  Scale,
  Landmark,
  BarChart3,
  RefreshCcw,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a number as Indian Rupees (INR). */
const formatINR = (amount: number): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
    amount
  );

/** Colour palette used for the expense breakdown pie chart. */
const PIE_COLORS = [
  '#2563eb',
  '#3b82f6',
  '#60a5fa',
  '#93c5fd',
  '#bfdbfe',
  '#dbeafe',
];

/** Map voucher status to a badge variant colour class. */
const statusBadgeClass = (
  status: string
): string => {
  switch (status) {
    case 'AUTHORISED':
      return 'bg-green-100 text-green-700 border-green-200';
    case 'PENDING':
      return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    case 'CANCELLED':
      return 'bg-red-100 text-red-700 border-red-200';
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200';
  }
};

// ---------------------------------------------------------------------------
// Types for Supabase query results
// ---------------------------------------------------------------------------

interface AccountRow {
  id: string;
  account_type: string;
  account_name: string;
  account_group: string | null;
  opening_balance: number | null;
  opening_balance_type: string | null;
}

interface VoucherEntryRow {
  debit_amount: number;
  credit_amount: number;
  account: AccountRow | null;
  voucher: {
    id: string;
    status: string;
    voucher_date: string;
  } | null;
}

interface VoucherRow {
  id: string;
  voucher_number: string;
  voucher_date: string;
  narration: string | null;
  total_amount: number;
  status: string;
  created_at: string;
  voucher_type: {
    voucher_type_name: string;
  } | null;
}

// ---------------------------------------------------------------------------
// Data hooks
// ---------------------------------------------------------------------------

/** Fetch all voucher entries with joined account and voucher data. */
const useVoucherEntries = () =>
  useQuery({
    queryKey: ['dashboard-voucher-entries'],
    queryFn: async () => {
      // Filter server-side and paginate — an unfiltered fetch truncates at 1000 rows.
      const data = await fetchAllRows((from, to) =>
        supabase
          .from('voucher_entries')
          .select(
            `
            debit_amount, credit_amount,
            account:chart_of_accounts(id, account_type, account_name, account_group),
            voucher:vouchers!inner(id, status, voucher_date)
          `
          )
          .eq('voucher.status', 'AUTHORISED')
          .range(from, to),
      );
      return data as unknown as VoucherEntryRow[];
    },
  });

/** Fetch chart_of_accounts for receivables calculation. */
const useAccounts = () =>
  useQuery({
    queryKey: ['dashboard-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('id, account_type, account_name, account_group, opening_balance, opening_balance_type');

      if (error) throw error;
      return (data ?? []) as unknown as AccountRow[];
    },
  });

/** Fetch the 10 most recent vouchers for the recent activity table. */
const useRecentVouchers = () =>
  useQuery({
    queryKey: ['dashboard-recent-vouchers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vouchers')
        .select(
          `
          id, voucher_number, voucher_date, narration,
          total_amount, status, created_at,
          voucher_type:voucher_types(voucher_type_name)
        `
        )
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      return (data ?? []) as unknown as VoucherRow[];
    },
  });

// ---------------------------------------------------------------------------
// Derived calculations
// ---------------------------------------------------------------------------

interface SummaryTotals {
  totalIncome: number;
  totalExpenses: number;
  netProfitLoss: number;
  receivables: number;
}

/** Compute summary totals from raw query data. */
const computeSummary = (
  entries: VoucherEntryRow[],
  accounts: AccountRow[]
): SummaryTotals => {
  // Only consider entries tied to posted vouchers
  const posted = entries.filter((e) => e.voucher?.status === 'AUTHORISED');

  // Income = sum(credit) - sum(debit) for Income-type accounts
  const totalIncome = posted
    .filter((e) => (e.account as AccountRow | null)?.account_type?.includes('INCOME'))
    .reduce((sum, e) => sum + (e.credit_amount ?? 0) - (e.debit_amount ?? 0), 0);

  // Expenses = sum(debit) - sum(credit) for Expense-type accounts
  const totalExpenses = posted
    .filter((e) => (e.account as AccountRow | null)?.account_type?.includes('EXPENSE'))
    .reduce((sum, e) => sum + (e.debit_amount ?? 0) - (e.credit_amount ?? 0), 0);

  // Receivables from opening balances of relevant asset accounts
  const receivables = accounts
    .filter((a) => {
      if (!a.account_type?.includes('ASSET')) return false;
      const group = (a.account_group ?? '').toLowerCase();
      return group.includes('receivab') || group.includes('sundry debtors');
    })
    .reduce((sum, a) => sum + (a.opening_balance ?? 0), 0);

  return {
    totalIncome,
    totalExpenses,
    netProfitLoss: totalIncome - totalExpenses,
    receivables,
  };
};

/** Build monthly revenue data for the last 6 months. */
const buildMonthlyRevenue = (entries: VoucherEntryRow[]) => {
  const now = new Date();
  const months: { label: string; start: Date; end: Date }[] = [];

  for (let i = 5; i >= 0; i--) {
    const d = subMonths(now, i);
    months.push({
      label: format(d, 'MMM yyyy'),
      start: startOfMonth(d),
      end: endOfMonth(d),
    });
  }

  return months.map((m) => {
    const monthEntries = entries.filter((e) => {
      if (e.voucher?.status !== 'AUTHORISED') return false;
      if ((e.account as AccountRow | null)?.account_type?.includes('INCOME') !== true) return false;
      const vDate = new Date(e.voucher?.voucher_date ?? '');
      return vDate >= m.start && vDate <= m.end;
    });

    const revenue = monthEntries.reduce(
      (sum, e) => sum + (e.credit_amount ?? 0) - (e.debit_amount ?? 0),
      0
    );

    return { month: m.label, revenue: Math.max(0, revenue) };
  });
};

/** Build expense breakdown by account name for the pie chart. */
const buildExpenseBreakdown = (entries: VoucherEntryRow[]) => {
  const posted = entries.filter(
    (e) =>
      e.voucher?.status === 'AUTHORISED' &&
      (e.account as AccountRow | null)?.account_type?.includes('EXPENSE')
  );

  const map = new Map<string, number>();
  posted.forEach((e) => {
    const name =
      (e.account as AccountRow | null)?.account_group ||
      (e.account as AccountRow | null)?.account_name ||
      'Other';
    const val = (e.debit_amount ?? 0) - (e.credit_amount ?? 0);
    map.set(name, (map.get(name) ?? 0) + val);
  });

  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value: Math.max(0, value) }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
};

// ---------------------------------------------------------------------------
// Skeleton components
// ---------------------------------------------------------------------------

/** Placeholder pulse block used while data is loading. */
const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse bg-gray-200 rounded ${className}`} />
);

const SummaryCardSkeleton: React.FC = () => (
  <Card>
    <CardHeader className="pb-2">
      <Skeleton className="h-4 w-24" />
    </CardHeader>
    <CardContent>
      <Skeleton className="h-8 w-32 mb-1" />
      <Skeleton className="h-3 w-20" />
    </CardContent>
  </Card>
);

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SummaryCardProps {
  title: string;
  value: number;
  subtitle: string;
  icon: React.ElementType;
  colorClass: string;
}

/** Single summary metric card shown at the top of the dashboard. */
const SummaryCard: React.FC<SummaryCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  colorClass,
}) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between pb-2">
      <CardTitle className="text-sm font-medium text-gray-500">
        {title}
      </CardTitle>
      <Icon className={`h-5 w-5 ${colorClass}`} />
    </CardHeader>
    <CardContent>
      <div className={`text-2xl font-bold ${colorClass}`}>
        {formatINR(value)}
      </div>
      <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
    </CardContent>
  </Card>
);

// ---------------------------------------------------------------------------
// Main Dashboard Component
// ---------------------------------------------------------------------------

/**
 * Dashboard -- accounting overview with summary cards, charts, recent
 * vouchers, and quick-action buttons. All data is fetched from Supabase
 * via React Query.
 */
const Dashboard: React.FC = () => {
  const {
    data: entries = [],
    isLoading: entriesLoading,
    isError: entriesError,
    refetch: refetchEntries,
  } = useVoucherEntries();

  const {
    data: accounts = [],
    isLoading: accountsLoading,
    isError: accountsError,
    refetch: refetchAccounts,
  } = useAccounts();

  const {
    data: recentVouchers = [],
    isLoading: vouchersLoading,
    isError: vouchersError,
    refetch: refetchVouchers,
  } = useRecentVouchers();

  const isLoading = entriesLoading || accountsLoading;
  const isError = entriesError || accountsError;

  // Derived data
  const summary = computeSummary(entries, accounts);
  const monthlyRevenue = buildMonthlyRevenue(entries);
  const expenseBreakdown = buildExpenseBreakdown(entries);

  // ------ Error state ------
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center">
        <p className="text-red-600 font-medium mb-4">
          Failed to load dashboard data. Please try again.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            refetchEntries();
            refetchAccounts();
            refetchVouchers();
          }}
        >
          <RefreshCcw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <TallyScreen title="Gateway — Accounts Dashboard" rail={[{ hotkey: 'P', label: 'Print', onClick: () => window.print() }]}>
    
    <div className="space-y-6">
      {/* Page heading */}
      <div>
        <h2 className="text-2xl font-bold text-gray-800">
          Accounting Dashboard
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Overview of your financial performance
        </p>
      </div>

      {/* ---- Summary Cards ---- */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SummaryCardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            title="Total Income"
            value={summary.totalIncome}
            subtitle="From posted vouchers"
            icon={TrendingUp}
            colorClass="text-green-600"
          />
          <SummaryCard
            title="Total Expenses"
            value={summary.totalExpenses}
            subtitle="From posted vouchers"
            icon={TrendingDown}
            colorClass="text-red-600"
          />
          <SummaryCard
            title="Net Profit / Loss"
            value={summary.netProfitLoss}
            subtitle={summary.netProfitLoss >= 0 ? 'Profit' : 'Loss'}
            icon={IndianRupee}
            colorClass={
              summary.netProfitLoss >= 0 ? 'text-green-600' : 'text-red-600'
            }
          />
          <SummaryCard
            title="Receivables"
            value={summary.receivables}
            subtitle="Outstanding balance"
            icon={Users}
            colorClass="text-blue-600"
          />
        </div>
      )}

      {/* ---- Charts Row (2 columns) ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Revenue Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Monthly Revenue (Last 6 Months)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : monthlyRevenue.every((m) => m.revenue === 0) ? (
              <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
                No revenue data available for the selected period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthlyRevenue}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v: number) =>
                      new Intl.NumberFormat('en-IN', {
                        notation: 'compact',
                        compactDisplay: 'short',
                      }).format(v)
                    }
                  />
                  <Tooltip
                    formatter={(value: number) => [formatINR(value), 'Revenue']}
                  />
                  <Legend />
                  <Bar
                    dataKey="revenue"
                    name="Revenue"
                    fill="#2563eb"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Expense Breakdown Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Expense Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : expenseBreakdown.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
                No expense data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={expenseBreakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }: { name: string; percent: number }) =>
                      `${name} (${(percent * 100).toFixed(0)}%)`
                    }
                  >
                    {expenseBreakdown.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => [formatINR(value), 'Amount']}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---- Recent Vouchers Table ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Vouchers</CardTitle>
        </CardHeader>
        <CardContent>
          {vouchersLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : vouchersError ? (
            <div className="text-center py-8">
              <p className="text-red-600 text-sm mb-3">
                Failed to load recent vouchers.
              </p>
              <Button variant="outline" size="sm" onClick={() => refetchVouchers()}>
                <RefreshCcw className="h-3 w-3 mr-1" />
                Retry
              </Button>
            </div>
          ) : recentVouchers.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">
              No vouchers found
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-2 pr-4 font-medium">Date</th>
                    <th className="pb-2 pr-4 font-medium">Voucher #</th>
                    <th className="pb-2 pr-4 font-medium">Type</th>
                    <th className="pb-2 pr-4 font-medium">Narration</th>
                    <th className="pb-2 pr-4 font-medium text-right">Amount</th>
                    <th className="pb-2 font-medium text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentVouchers.map((v) => (
                    <tr key={v.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-2.5 pr-4 whitespace-nowrap">
                        {format(new Date(v.voucher_date), 'dd MMM yyyy')}
                      </td>
                      <td className="py-2.5 pr-4 font-medium whitespace-nowrap">
                        {v.voucher_number}
                      </td>
                      <td className="py-2.5 pr-4 whitespace-nowrap">
                        {v.voucher_type?.voucher_type_name ?? '-'}
                      </td>
                      <td className="py-2.5 pr-4 max-w-xs truncate">
                        {v.narration || '-'}
                      </td>
                      <td className="py-2.5 pr-4 text-right whitespace-nowrap">
                        {formatINR(v.total_amount)}
                      </td>
                      <td className="py-2.5 text-center">
                        <Badge
                          variant="outline"
                          className={`text-xs capitalize ${statusBadgeClass(v.status)}`}
                        >
                          {v.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Quick Actions ---- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" size="sm">
              <FileText className="h-4 w-4 mr-2" />
              New Voucher
            </Button>
            <Button variant="outline" size="sm">
              <BarChart3 className="h-4 w-4 mr-2" />
              Day Book
            </Button>
            <Button variant="outline" size="sm">
              <Scale className="h-4 w-4 mr-2" />
              Trial Balance
            </Button>
            <Button variant="outline" size="sm">
              <Landmark className="h-4 w-4 mr-2" />
              Balance Sheet
            </Button>
            <Button variant="outline" size="sm">
              <TrendingUp className="h-4 w-4 mr-2" />
              P&L
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
    </TallyScreen>
  );
};

export default Dashboard;
