import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { toast } from 'sonner';
import { Printer, Download, ChevronDown, ChevronRight, Loader2, AlertCircle, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { format } from 'date-fns';
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
 * Groups an array of AccountBalance items by their account_group field.
 * Returns a Map where keys are group names and values are arrays of balances.
 */
const groupByAccountGroup = (items: AccountBalance[]): Map<string, AccountBalance[]> => {
  const grouped = new Map<string, AccountBalance[]>();
  items.forEach((item) => {
    const group = item.account.account_group || 'Ungrouped';
    if (!grouped.has(group)) {
      grouped.set(group, []);
    }
    grouped.get(group)!.push(item);
  });
  return grouped;
};

/**
 * Exports the balance sheet data as a CSV file.
 */
const exportCSV = (
  liabilities: AccountBalance[],
  equityItems: AccountBalance[],
  assets: AccountBalance[],
  netProfitLoss: number,
  asOfDate: string
) => {
  const rows: string[][] = [
    ['Balance Sheet', `As on ${format(new Date(asOfDate), 'dd-MMM-yyyy')}`],
    [],
    ['Liabilities & Equity', '', 'Assets', ''],
    ['Account', 'Amount', 'Account', 'Amount'],
  ];

  const liabRows = liabilities.map((l) => [l.account.account_name, l.balance.toFixed(2)]);
  const eqRows = equityItems.map((e) => [e.account.account_name, e.balance.toFixed(2)]);
  eqRows.push(['Net Profit/(Loss)', netProfitLoss.toFixed(2)]);
  const assetRows = assets.map((a) => [a.account.account_name, a.balance.toFixed(2)]);

  const allLeft = [...liabRows, ...eqRows];
  const maxLen = Math.max(allLeft.length, assetRows.length);

  for (let i = 0; i < maxLen; i++) {
    const left = allLeft[i] || ['', ''];
    const right = assetRows[i] || ['', ''];
    rows.push([left[0], left[1], right[0], right[1]]);
  }

  const totalLiabEquity = liabilities.reduce((s, l) => s + l.balance, 0) +
    equityItems.reduce((s, e) => s + e.balance, 0) + netProfitLoss;
  const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
  rows.push([]);
  rows.push(['Total Liabilities & Equity', totalLiabEquity.toFixed(2), 'Total Assets', totalAssets.toFixed(2)]);

  const csvContent = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `balance_sheet_${asOfDate}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast.success('Balance Sheet exported as CSV');
};

/**
 * BalanceSheet - Shows Assets vs Liabilities + Equity as of a given date.
 * Fetches chart_of_accounts and voucher_entries from Supabase, computes
 * balances per account, and displays them in a two-column layout with
 * collapsible groups and a balance check indicator.
 */
const BalanceSheet: React.FC = () => {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [asOfDate, setAsOfDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Fetch all active accounts
  const {
    data: accounts = [],
    isLoading: accountsLoading,
    isError: accountsError,
    error: accErr,
    refetch: refetchAccounts,
  } = useQuery({
    queryKey: ['balance_sheet_accounts'],
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

  // Fetch voucher entries with their associated vouchers (posted, <= asOfDate)
  const {
    data: entries = [],
    isLoading: entriesLoading,
    isError: entriesError,
    error: entErr,
    refetch: refetchEntries,
  } = useQuery({
    queryKey: ['balance_sheet_entries', asOfDate, selectedCompanyId],
    queryFn: async () => {
      // Single join-filtered query, paginated — the previous two-step fetch
      // truncated at 1000 vouchers and produced a silently wrong balance sheet.
      const data = await fetchAllRows((from, to) => {
        let query = supabase
          .from('voucher_entries')
          .select('*, voucher:vouchers!inner(id, voucher_date, status, company_id)')
          .eq('voucher.status', 'AUTHORISED')
          .lte('voucher.voucher_date', asOfDate);
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

  // Compute balances per account
  const { liabilities, equityItems, assets, incomeTotal, expenseTotal } = useMemo(() => {
    // Aggregate debit/credit per account from entries
    const debitMap = new Map<string, number>();
    const creditMap = new Map<string, number>();

    entries.forEach((e) => {
      debitMap.set(e.account_id, (debitMap.get(e.account_id) || 0) + Number(e.debit_amount || 0));
      creditMap.set(e.account_id, (creditMap.get(e.account_id) || 0) + Number(e.credit_amount || 0));
    });

    const liabilities: AccountBalance[] = [];
    const equityItems: AccountBalance[] = [];
    const assets: AccountBalance[] = [];
    let incomeTotal = 0;
    let expenseTotal = 0;

    accounts.forEach((acc) => {
      const totalDebit = debitMap.get(acc.id) || 0;
      const totalCredit = creditMap.get(acc.id) || 0;
      const openingBal = Number(acc.opening_balance || 0);
      const openingDr = acc.opening_balance_type === 'Dr' ? openingBal : 0;
      const openingCr = acc.opening_balance_type === 'Cr' ? openingBal : 0;

      if (acc.account_type === 'Asset') {
        // Asset: debit balance = positive
        const balance = (openingDr - openingCr) + totalDebit - totalCredit;
        if (balance !== 0) {
          assets.push({ account: acc, balance });
        }
      } else if (acc.account_type === 'Liability') {
        // Liability: credit balance = positive
        const balance = (openingCr - openingDr) + totalCredit - totalDebit;
        if (balance !== 0) {
          liabilities.push({ account: acc, balance });
        }
      } else if (acc.account_type === 'Equity') {
        // Equity: credit balance = positive
        const balance = (openingCr - openingDr) + totalCredit - totalDebit;
        if (balance !== 0) {
          equityItems.push({ account: acc, balance });
        }
      } else if (acc.account_type === 'Income') {
        // Income: credit - debit (profit goes to equity side)
        const balance = totalCredit - totalDebit;
        incomeTotal += balance;
      } else if (acc.account_type === 'Expense') {
        // Expense: debit - credit (loss reduces equity side)
        const balance = totalDebit - totalCredit;
        expenseTotal += balance;
      }
    });

    return { liabilities, equityItems, assets, incomeTotal, expenseTotal };
  }, [accounts, entries]);

  // Net Profit/Loss = Total Income - Total Expenses
  const netProfitLoss = incomeTotal - expenseTotal;

  // Compute totals
  const totalLiabilities = liabilities.reduce((sum, l) => sum + l.balance, 0);
  const totalEquity = equityItems.reduce((sum, e) => sum + e.balance, 0) + netProfitLoss;
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
  const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0);

  // Balance check
  const isBalanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01;
  const difference = totalAssets - totalLiabilitiesAndEquity;

  // Group data for display
  const liabilityGroups = useMemo(() => groupByAccountGroup(liabilities), [liabilities]);
  const equityGroups = useMemo(() => groupByAccountGroup(equityItems), [equityItems]);
  const assetGroups = useMemo(() => groupByAccountGroup(assets), [assets]);

  // Toggle group collapse/expand
  const toggleGroup = (groupName: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };

  // Print handler
  const handlePrint = () => {
    window.print();
  };

  // Renders a section of grouped account balances
  const renderGroupedSection = (groups: Map<string, AccountBalance[]>) => {
    return Array.from(groups.entries()).map(([groupName, items]) => {
      const isCollapsed = collapsedGroups.has(groupName);
      const groupTotal = items.reduce((s, i) => s + i.balance, 0);

      return (
        <div key={groupName} className="mb-2">
          {/* Group header - clickable to toggle */}
          <button
            onClick={() => toggleGroup(groupName)}
            className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-gray-50 transition-colors rounded text-sm"
          >
            <span className="flex items-center gap-1 font-medium text-gray-700">
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
              )}
              {groupName}
            </span>
            <span className="font-medium text-gray-700">{formatCurrency(groupTotal)}</span>
          </button>

          {/* Individual accounts within the group */}
          {!isCollapsed &&
            items.map((item) => (
              <div
                key={item.account.id}
                className="flex items-center justify-between px-3 py-1 pl-8 text-sm text-gray-600"
              >
                <span>{item.account.account_name}</span>
                <span>{formatCurrency(item.balance)}</span>
              </div>
            ))}
        </div>
      );
    });
  };

  // Loading skeleton
  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl font-bold text-gray-800">Balance Sheet</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
                <div className="h-4 flex-1 bg-gray-200 rounded animate-pulse" />
                <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
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
          <CardTitle className="text-xl font-bold text-gray-800">Balance Sheet</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-red-700 font-medium">Failed to load balance sheet data</p>
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
          <h2 className="text-2xl font-bold text-gray-800">Balance Sheet</h2>
          <p className="text-sm text-gray-500 mt-1">
            As on {format(new Date(asOfDate), 'dd MMM yyyy')}
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
            <Label htmlFor="asOfDate" className="text-sm whitespace-nowrap">
              As on
            </Label>
            <Input
              id="asOfDate"
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="w-40"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportCSV(liabilities, equityItems, assets, netProfitLoss, asOfDate)
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

      {/* Balance check indicator */}
      <div className="flex justify-end">
        {isBalanced ? (
          <Badge className="bg-green-100 text-green-800 border-green-200">
            <Check className="h-3.5 w-3.5 mr-1" />
            Balanced
          </Badge>
        ) : (
          <Badge className="bg-red-100 text-red-800 border-red-200">
            <AlertCircle className="h-3.5 w-3.5 mr-1" />
            Unbalanced - Difference: {formatCurrency(Math.abs(difference))}
          </Badge>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Side - Liabilities & Equity */}
        <Card>
          <CardHeader className="py-3 bg-blue-50 rounded-t-lg">
            <CardTitle className="text-base font-bold text-gray-800">
              Liabilities & Equity
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {/* Liabilities Section */}
            {liabilityGroups.size > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-3">
                  Liabilities
                </p>
                {renderGroupedSection(liabilityGroups)}
                <div className="flex items-center justify-between px-3 py-1.5 border-t border-gray-200 mt-1">
                  <span className="text-sm font-semibold text-gray-700">Subtotal Liabilities</span>
                  <span className="text-sm font-semibold text-gray-700">
                    {formatCurrency(totalLiabilities)}
                  </span>
                </div>
              </div>
            )}

            <Separator className="my-3" />

            {/* Equity Section */}
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-3">
                Equity
              </p>
              {renderGroupedSection(equityGroups)}
              {/* Net Profit/Loss line */}
              <div className="flex items-center justify-between px-3 py-1 pl-8 text-sm">
                <span className={netProfitLoss >= 0 ? 'text-green-700' : 'text-red-700'}>
                  Net {netProfitLoss >= 0 ? 'Profit' : 'Loss'}
                </span>
                <span className={netProfitLoss >= 0 ? 'text-green-700' : 'text-red-700'}>
                  {formatCurrency(Math.abs(netProfitLoss))}
                  {netProfitLoss < 0 ? ' (Dr)' : ''}
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-1.5 border-t border-gray-200 mt-1">
                <span className="text-sm font-semibold text-gray-700">Subtotal Equity</span>
                <span className="text-sm font-semibold text-gray-700">
                  {formatCurrency(totalEquity)}
                </span>
              </div>
            </div>

            <Separator className="my-3" />

            {/* Grand Total */}
            <div className="flex items-center justify-between px-3 py-2 bg-blue-50 rounded font-bold text-gray-800">
              <span>Total Liabilities & Equity</span>
              <span>{formatCurrency(totalLiabilitiesAndEquity)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Right Side - Assets */}
        <Card>
          <CardHeader className="py-3 bg-blue-50 rounded-t-lg">
            <CardTitle className="text-base font-bold text-gray-800">Assets</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {assetGroups.size > 0 ? (
              renderGroupedSection(assetGroups)
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">No asset accounts found</p>
            )}

            <Separator className="my-3" />

            {/* Grand Total */}
            <div className="flex items-center justify-between px-3 py-2 bg-blue-50 rounded font-bold text-gray-800">
              <span>Total Assets</span>
              <span>{formatCurrency(totalAssets)}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default BalanceSheet;
