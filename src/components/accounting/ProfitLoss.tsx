import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { toast } from 'sonner';
import { Printer, Download, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { format, startOfMonth } from 'date-fns';
import { useCompanies } from '@/hooks/useCompanies';

// Type definitions
interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: 'Asset' | 'Liability' | 'Income' | 'Expense' | 'Equity';
  parent_account_id: string | null;
  account_group: string;
  is_active: boolean;
  opening_balance: number;
  opening_balance_type: 'Dr' | 'Cr';
  created_at: string;
  updated_at: string;
}

interface VoucherEntry {
  id: string;
  voucher_id: string;
  account_id: string;
  debit_amount: number;
  credit_amount: number;
  narration: string;
  entry_order: number;
  created_at: string;
}

interface Voucher {
  id: string;
  voucher_number: string;
  voucher_date: string;
  status: 'PENDING' | 'AUTHORISED' | 'CANCELLED';
}

interface AccountBalance {
  account: Account;
  balance: number;
}

/**
 * Formats a numeric amount in Indian Rupee locale format with 2 decimal places.
 */
const formatCurrency = (val: number): string => {
  return `\u20B9${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
};

/**
 * Returns the financial year start (April 1) for the given date.
 * If month is Jan-Mar, the FY started the previous calendar year.
 */
const getFYStart = (date: Date): string => {
  const year = date.getMonth() < 3 ? date.getFullYear() - 1 : date.getFullYear();
  return `${year}-04-01`;
};

/**
 * Returns the financial year end (March 31) for the given date.
 */
const getFYEnd = (date: Date): string => {
  const year = date.getMonth() < 3 ? date.getFullYear() : date.getFullYear() + 1;
  return `${year}-03-31`;
};

/**
 * Exports Profit & Loss data as a CSV file.
 */
const exportCSV = (
  incomeItems: AccountBalance[],
  expenseItems: AccountBalance[],
  totalIncome: number,
  totalExpenses: number,
  netProfit: number,
  fromDate: string,
  toDate: string
) => {
  const rows: string[][] = [
    ['Profit & Loss Statement', `${format(new Date(fromDate), 'dd-MMM-yyyy')} to ${format(new Date(toDate), 'dd-MMM-yyyy')}`],
    [],
    ['Particulars', 'Amount (Rs)', '% of Revenue'],
    [],
    ['INCOME', '', ''],
  ];

  incomeItems.forEach((item) => {
    const pct = totalIncome > 0 ? ((item.balance / totalIncome) * 100).toFixed(1) : '0.0';
    rows.push([item.account.account_name, item.balance.toFixed(2), `${pct}%`]);
  });

  rows.push(['Total Income', totalIncome.toFixed(2), '100.0%']);
  rows.push([]);
  rows.push(['EXPENSES', '', '']);

  expenseItems.forEach((item) => {
    const pct = totalIncome > 0 ? ((item.balance / totalIncome) * 100).toFixed(1) : '0.0';
    rows.push([item.account.account_name, item.balance.toFixed(2), `${pct}%`]);
  });

  rows.push(['Total Expenses', totalExpenses.toFixed(2), totalIncome > 0 ? `${((totalExpenses / totalIncome) * 100).toFixed(1)}%` : '0.0%']);
  rows.push([]);

  const profitPct = totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(1) : '0.0';
  rows.push([netProfit >= 0 ? 'Net Profit' : 'Net Loss', netProfit.toFixed(2), `${profitPct}%`]);

  const csvContent = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `profit_loss_${fromDate}_to_${toDate}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast.success('Profit & Loss exported as CSV');
};

/**
 * ProfitLoss - Shows Income vs Expenses with profit calculation for a date range.
 * Fetches chart_of_accounts and voucher_entries from Supabase, computes
 * period balances for Income and Expense accounts, and displays a summary table.
 */
const ProfitLoss: React.FC = () => {
  const now = new Date();
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [fromDate, setFromDate] = useState<string>(getFYStart(now));
  const [toDate, setToDate] = useState<string>(getFYEnd(now));

  // Fetch all active accounts
  const {
    data: accounts = [],
    isLoading: accountsLoading,
    isError: accountsError,
    error: accErr,
    refetch: refetchAccounts,
  } = useQuery({
    queryKey: ['profit_loss_accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('*')
        .eq('is_active', true)
        .order('account_code');
      if (error) throw error;
      return (data || []) as Account[];
    },
  });

  // Fetch voucher entries for posted vouchers within the date range
  const {
    data: entries = [],
    isLoading: entriesLoading,
    isError: entriesError,
    error: entErr,
    refetch: refetchEntries,
  } = useQuery({
    queryKey: ['profit_loss_entries', fromDate, toDate, selectedCompanyId],
    queryFn: async () => {
      // Single join-filtered query, paginated — the previous two-step fetch
      // truncated at 1000 vouchers and produced a silently wrong P&L.
      const data = await fetchAllRows((from, to) => {
        let query = supabase
          .from('voucher_entries')
          .select('*, voucher:vouchers!inner(id, voucher_date, status, company_id)')
          .eq('voucher.status', 'AUTHORISED')
          .gte('voucher.voucher_date', fromDate)
          .lte('voucher.voucher_date', toDate);
        if (selectedCompanyId) {
          query = query.eq('voucher.company_id', selectedCompanyId);
        }
        return query.range(from, to);
      });
      return data as unknown as VoucherEntry[];
    },
  });

  const isLoading = accountsLoading || entriesLoading;
  const isError = accountsError || entriesError;
  const error = accErr || entErr;

  // Compute income and expense balances
  const { incomeItems, expenseItems, totalIncome, totalExpenses } = useMemo(() => {
    // Aggregate debit/credit per account
    const debitMap = new Map<string, number>();
    const creditMap = new Map<string, number>();

    entries.forEach((e) => {
      debitMap.set(e.account_id, (debitMap.get(e.account_id) || 0) + Number(e.debit_amount || 0));
      creditMap.set(e.account_id, (creditMap.get(e.account_id) || 0) + Number(e.credit_amount || 0));
    });

    const incomeItems: AccountBalance[] = [];
    const expenseItems: AccountBalance[] = [];

    accounts.forEach((acc) => {
      const totalDebit = debitMap.get(acc.id) || 0;
      const totalCredit = creditMap.get(acc.id) || 0;

      if (acc.account_type === 'Income') {
        const balance = totalCredit - totalDebit;
        if (balance !== 0) {
          incomeItems.push({ account: acc, balance });
        }
      } else if (acc.account_type === 'Expense') {
        const balance = totalDebit - totalCredit;
        if (balance !== 0) {
          expenseItems.push({ account: acc, balance });
        }
      }
    });

    // Sort by balance descending for better readability
    incomeItems.sort((a, b) => b.balance - a.balance);
    expenseItems.sort((a, b) => b.balance - a.balance);

    const totalIncome = incomeItems.reduce((sum, i) => sum + i.balance, 0);
    const totalExpenses = expenseItems.reduce((sum, i) => sum + i.balance, 0);

    return { incomeItems, expenseItems, totalIncome, totalExpenses };
  }, [accounts, entries]);

  const netProfit = totalIncome - totalExpenses;
  const profitMargin = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;

  // Helper to compute % of revenue
  const pctOfRevenue = (amount: number): string => {
    if (totalIncome === 0) return '0.0%';
    return `${((amount / totalIncome) * 100).toFixed(1)}%`;
  };

  // Print handler
  const handlePrint = () => {
    window.print();
  };

  // Loading skeleton
  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl font-bold text-gray-800">Profit & Loss Statement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-4 w-40 bg-gray-200 rounded animate-pulse" />
                <div className="h-4 flex-1 bg-gray-200 rounded animate-pulse" />
                <div className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (isError) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl font-bold text-gray-800">Profit & Loss Statement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-red-700 font-medium">Failed to load profit & loss data</p>
              <p className="text-xs text-red-600 mt-1">
                {(error as Error)?.message || 'An unexpected error occurred.'}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refetchAccounts();
                refetchEntries();
              }}
            >
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Profit & Loss Statement</h2>
          <p className="text-sm text-gray-500 mt-1">
            {format(new Date(fromDate), 'dd MMM yyyy')} to {format(new Date(toDate), 'dd MMM yyyy')}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label className="text-sm whitespace-nowrap">Company</Label>
            <select
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
              className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="plFromDate" className="text-sm whitespace-nowrap">
              From
            </Label>
            <Input
              id="plFromDate"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="plToDate" className="text-sm whitespace-nowrap">
              To
            </Label>
            <Input
              id="plToDate"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-40"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportCSV(incomeItems, expenseItems, totalIncome, totalExpenses, netProfit, fromDate, toDate)
            }
          >
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1" />
            Print
          </Button>
        </div>
      </div>

      {/* P&L Table */}
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50%]">Particulars</TableHead>
                <TableHead className="text-right">Amount ({'\u20B9'})</TableHead>
                <TableHead className="text-right">% of Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Income Section */}
              <TableRow className="bg-green-50 border-l-4 border-green-500">
                <TableCell className="font-bold text-green-800" colSpan={3}>
                  INCOME
                </TableCell>
              </TableRow>
              {incomeItems.map((item) => (
                <TableRow key={item.account.id}>
                  <TableCell className="pl-8 text-gray-700">{item.account.account_name}</TableCell>
                  <TableCell className="text-right text-gray-700">
                    {formatCurrency(item.balance)}
                  </TableCell>
                  <TableCell className="text-right text-gray-500">
                    {pctOfRevenue(item.balance)}
                  </TableCell>
                </TableRow>
              ))}
              {incomeItems.length === 0 && (
                <TableRow>
                  <TableCell className="pl-8 text-gray-400 italic" colSpan={3}>
                    No income entries in this period
                  </TableCell>
                </TableRow>
              )}
              {/* Total Income */}
              <TableRow className="border-t-2 border-green-200">
                <TableCell className="font-bold text-green-700">Total Income</TableCell>
                <TableCell className="text-right font-bold text-green-700">
                  {formatCurrency(totalIncome)}
                </TableCell>
                <TableCell className="text-right font-bold text-green-700">100.0%</TableCell>
              </TableRow>

              {/* Spacer row */}
              <TableRow>
                <TableCell colSpan={3} className="py-2" />
              </TableRow>

              {/* Expense Section */}
              <TableRow className="bg-red-50 border-l-4 border-red-500">
                <TableCell className="font-bold text-red-800" colSpan={3}>
                  EXPENSES
                </TableCell>
              </TableRow>
              {expenseItems.map((item) => (
                <TableRow key={item.account.id}>
                  <TableCell className="pl-8 text-gray-700">{item.account.account_name}</TableCell>
                  <TableCell className="text-right text-gray-700">
                    {formatCurrency(item.balance)}
                  </TableCell>
                  <TableCell className="text-right text-gray-500">
                    {pctOfRevenue(item.balance)}
                  </TableCell>
                </TableRow>
              ))}
              {expenseItems.length === 0 && (
                <TableRow>
                  <TableCell className="pl-8 text-gray-400 italic" colSpan={3}>
                    No expense entries in this period
                  </TableCell>
                </TableRow>
              )}
              {/* Total Expenses */}
              <TableRow className="border-t-2 border-red-200">
                <TableCell className="font-bold text-red-700">Total Expenses</TableCell>
                <TableCell className="text-right font-bold text-red-700">
                  {formatCurrency(totalExpenses)}
                </TableCell>
                <TableCell className="text-right font-bold text-red-700">
                  {pctOfRevenue(totalExpenses)}
                </TableCell>
              </TableRow>

              {/* Spacer row */}
              <TableRow>
                <TableCell colSpan={3} className="py-2" />
              </TableRow>

              {/* Net Profit/Loss */}
              <TableRow className={netProfit >= 0 ? 'bg-green-50' : 'bg-red-50'}>
                <TableCell className={`font-bold text-base ${netProfit >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                  Net {netProfit >= 0 ? 'Profit' : 'Loss'}
                </TableCell>
                <TableCell
                  className={`text-right font-bold text-base ${netProfit >= 0 ? 'text-green-800' : 'text-red-800'}`}
                >
                  {formatCurrency(Math.abs(netProfit))}
                </TableCell>
                <TableCell
                  className={`text-right font-bold text-base ${netProfit >= 0 ? 'text-green-800' : 'text-red-800'}`}
                >
                  {pctOfRevenue(Math.abs(netProfit))}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Summary Card */}
      <Card className={netProfit >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-center sm:text-left">
              <p className={`text-sm font-medium ${netProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                Gross {netProfit >= 0 ? 'Profit' : 'Loss'}
              </p>
              <p className={`text-3xl font-bold ${netProfit >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                {formatCurrency(Math.abs(netProfit))}
              </p>
            </div>
            <div className="text-center sm:text-right">
              <p className="text-sm font-medium text-gray-500">Profit Margin</p>
              <p className={`text-2xl font-bold ${netProfit >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                {profitMargin.toFixed(1)}%
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProfitLoss;
