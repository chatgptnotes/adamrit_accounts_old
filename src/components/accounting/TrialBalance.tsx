import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Download,
  Printer,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useCompanies } from '@/hooks/useCompanies';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_group: string | null;
  is_active: boolean;
  opening_balance: number | null;
  opening_balance_type: string | null;
}

interface EntryRow {
  account_id: string;
  debit_amount: number | null;
  credit_amount: number | null;
  voucher: {
    voucher_date: string;
    status: string;
  } | null;
}

/** Computed account balance for display. */
interface AccountBalance {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_group: string | null;
  total_debit: number;
  total_credit: number;
  debit_balance: number;
  credit_balance: number;
}

// Account type ordering for display groups
const ACCOUNT_TYPE_ORDER: string[] = [
  'Asset',
  'Liability',
  'Income',
  'Expense',
  'Equity',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a number as Indian Rupees. */
const formatCurrency = (val: number): string =>
  `\u20B9${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const TrialBalance: React.FC = () => {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [asOfDate, setAsOfDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set()
  );

  // Toggle collapse state of an account type group
  const toggleGroup = (type: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  // Fetch all active accounts
  const {
    data: accounts,
    isLoading: accountsLoading,
    isError: accountsError,
  } = useQuery({
    queryKey: ['tb_accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('*')
        .eq('is_active', true)
        .order('account_type')
        .order('account_name');
      if (error) throw error;
      return data as Account[];
    },
  });

  // Fetch all voucher entries with voucher date and status
  const {
    data: entries,
    isLoading: entriesLoading,
    isError: entriesError,
    error,
  } = useQuery({
    queryKey: ['tb_entries', selectedCompanyId, asOfDate],
    queryFn: async () => {
      // Filter server-side and paginate — an unfiltered fetch truncates at
      // 1000 rows and produces a silently wrong trial balance.
      const data = await fetchAllRows((from, to) => {
        let query = supabase
          .from('voucher_entries')
          .select(`
            account_id, debit_amount, credit_amount,
            voucher:vouchers!inner(voucher_date, status, company_id)
          `)
          .eq('voucher.status', 'AUTHORISED')
          .lte('voucher.voucher_date', asOfDate);
        if (selectedCompanyId) {
          query = query.eq('voucher.company_id', selectedCompanyId);
        }
        return query.range(from, to);
      });
      return data as unknown as EntryRow[];
    },
  });

  const isLoading = accountsLoading || entriesLoading;
  const isError = accountsError || entriesError;

  // Compute account balances, grouped by account type
  const { accountBalances, grandTotalDebit, grandTotalCredit } = useMemo(() => {
    if (!accounts || !entries) {
      return { accountBalances: [], grandTotalDebit: 0, grandTotalCredit: 0 };
    }

    // Filter entries: posted vouchers up to asOfDate
    const filteredEntries = entries.filter((e) => {
      const v = e.voucher;
      if (!v || v.status !== 'AUTHORISED') return false;
      return v.voucher_date <= asOfDate;
    });

    const balances: AccountBalance[] = accounts
      .map((account) => {
        const accountEntries = filteredEntries.filter(
          (e) => e.account_id === account.id
        );
        const totalDebit = accountEntries.reduce(
          (s, e) => s + (e.debit_amount || 0),
          0
        );
        const totalCredit = accountEntries.reduce(
          (s, e) => s + (e.credit_amount || 0),
          0
        );

        // Add opening balance
        let openingDebit = 0;
        let openingCredit = 0;
        if (account.opening_balance_type === 'Dr') {
          openingDebit = account.opening_balance || 0;
        } else {
          openingCredit = account.opening_balance || 0;
        }

        const netDebit = totalDebit + openingDebit;
        const netCredit = totalCredit + openingCredit;

        // Net balance
        const balance = netDebit - netCredit;

        return {
          id: account.id,
          account_code: account.account_code,
          account_name: account.account_name,
          account_type: account.account_type,
          account_group: account.account_group,
          total_debit: netDebit,
          total_credit: netCredit,
          debit_balance: balance > 0 ? balance : 0,
          credit_balance: balance < 0 ? Math.abs(balance) : 0,
        };
      })
      // Only include accounts with a non-zero balance
      .filter((a) => a.debit_balance > 0 || a.credit_balance > 0);

    const grandDebit = balances.reduce((s, a) => s + a.debit_balance, 0);
    const grandCredit = balances.reduce((s, a) => s + a.credit_balance, 0);

    return {
      accountBalances: balances,
      grandTotalDebit: grandDebit,
      grandTotalCredit: grandCredit,
    };
  }, [accounts, entries, asOfDate]);

  // Group balances by account type for display
  const groupedBalances = useMemo(() => {
    const groups: Record<string, AccountBalance[]> = {};
    ACCOUNT_TYPE_ORDER.forEach((type) => {
      const items = accountBalances.filter((a) => a.account_type === type);
      if (items.length > 0) {
        groups[type] = items;
      }
    });
    return groups;
  }, [accountBalances]);

  const difference = Math.abs(grandTotalDebit - grandTotalCredit);

  // Export trial balance as CSV
  const exportCSV = () => {
    if (!accountBalances.length) return;
    const headers = [
      'Account Code',
      'Account Name',
      'Account Type',
      'Debit Balance',
      'Credit Balance',
    ];
    const rows = accountBalances.map((a) => [
      a.account_code,
      a.account_name,
      a.account_type,
      a.debit_balance,
      a.credit_balance,
    ]);
    // Grand total row
    rows.push(['', 'Grand Total', '', grandTotalDebit, grandTotalCredit]);

    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${c}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trial_balance_${asOfDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported successfully');
  };

  return (
    <Card className="w-full">
      {/* Print-only header (hidden on screen) */}
      <div className="hidden print:block p-4 text-center border-b">
        <h1 className="text-lg font-bold">Trial Balance</h1>
        <p className="text-sm text-gray-600">As of {asOfDate}</p>
      </div>

      <CardHeader className="pb-4 print:hidden">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-xl font-bold text-blue-700">
            Trial Balance
          </CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={exportCSV}
              disabled={!accountBalances.length}
            >
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.print()}
            >
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-4 flex items-end gap-4 flex-wrap">
          <div className="space-y-1">
            <Label>Company</Label>
            <select
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
              className="flex h-9 w-52 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="as-of-date">As of Date</Label>
            <Input
              id="as-of-date"
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="w-40"
            />
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Error State */}
        {isError && (
          <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle className="h-4 w-4" />
            <span>
              Failed to load trial balance data:{' '}
              {(error as Error)?.message || 'Unknown error'}
            </span>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded bg-gray-100"
              />
            ))}
          </div>
        )}

        {/* Trial Balance Table */}
        {!isLoading && !isError && (
          <ScrollArea className="w-full">
            <div className="min-w-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account Code</TableHead>
                    <TableHead>Account Name</TableHead>
                    <TableHead className="text-right">
                      Debit Balance (\u20B9)
                    </TableHead>
                    <TableHead className="text-right">
                      Credit Balance (\u20B9)
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.keys(groupedBalances).length > 0 ? (
                    <>
                      {ACCOUNT_TYPE_ORDER.map((type) => {
                        const items = groupedBalances[type];
                        if (!items || items.length === 0) return null;

                        const isCollapsed = collapsedGroups.has(type);

                        return (
                          <React.Fragment key={type}>
                            {/* Group header row */}
                            <TableRow
                              className="cursor-pointer bg-gray-50 hover:bg-gray-100"
                              onClick={() => toggleGroup(type)}
                            >
                              <TableCell
                                colSpan={4}
                                className="font-bold text-gray-700"
                              >
                                <span className="inline-flex items-center gap-2">
                                  {isCollapsed ? (
                                    <ChevronRight className="h-4 w-4" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4" />
                                  )}
                                  {type}
                                </span>
                              </TableCell>
                            </TableRow>

                            {/* Account rows within group */}
                            {!isCollapsed &&
                              items.map((acc, idx) => (
                                <TableRow
                                  key={acc.id}
                                  className={
                                    idx % 2 === 0 ? 'even:bg-gray-50' : ''
                                  }
                                >
                                  <TableCell className="pl-8">
                                    {acc.account_code}
                                  </TableCell>
                                  <TableCell>{acc.account_name}</TableCell>
                                  <TableCell className="text-right font-mono">
                                    {acc.debit_balance > 0
                                      ? formatCurrency(acc.debit_balance)
                                      : '-'}
                                  </TableCell>
                                  <TableCell className="text-right font-mono">
                                    {acc.credit_balance > 0
                                      ? formatCurrency(acc.credit_balance)
                                      : '-'}
                                  </TableCell>
                                </TableRow>
                              ))}
                          </React.Fragment>
                        );
                      })}

                      {/* Grand Total Row */}
                      <TableRow className="border-t-2 font-bold">
                        <TableCell colSpan={2} className="text-right">
                          Grand Total
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(grandTotalDebit)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(grandTotalCredit)}
                        </TableCell>
                      </TableRow>

                      {/* Difference warning */}
                      {difference > 0.01 && (
                        <TableRow>
                          <TableCell colSpan={4}>
                            <div className="flex items-center gap-2 text-sm font-medium text-red-600">
                              <AlertTriangle className="h-4 w-4" />
                              Difference: {formatCurrency(difference)} -- Trial
                              balance does not tally.
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-8 text-center text-gray-500"
                      >
                        No account balances found for the selected date.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};

export default TrialBalance;
