import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TallyScreen } from './tally/TallyChrome';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { toast } from 'sonner';
import { Printer, Download, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { format } from 'date-fns';

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

interface CashFlowItem {
  name: string;
  amount: number;
}

/**
 * Formats a numeric amount in Indian Rupee locale format with 2 decimal places.
 */
const formatCurrency = (val: number): string => {
  return `\u20B9${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
};

/**
 * Returns the financial year start (April 1) for the given date.
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
 * Determines whether an account is a cash or bank account based on its
 * account_group and account_name fields.
 */
const isCashOrBankAccount = (acc: Account): boolean =>
  // Cash (111x) and bank (112x) ledgers form the cash pool in this chart
  acc.account_code.startsWith('111') || acc.account_code.startsWith('112');

/**
 * Classifies an account into Operating, Investing, or Financing activity
 * based on its account_type and account_group.
 */
const classifyActivity = (acc: Account): 'operating' | 'investing' | 'financing' => {
  const group = (acc.account_group || '').toLowerCase();

  const t = (acc.account_type || '').toUpperCase();

  // Operating: income and expense accounts (INCOME, DIRECT_INCOME, EXPENSES, ...)
  if (t.includes('INCOME') || t.includes('EXPENSE')) {
    return 'operating';
  }

  // Investing: fixed assets always; other non-cash assets too
  if (t === 'FIXED_ASSETS' || group.includes('investment')) {
    return 'investing';
  }
  if (t.includes('ASSET') && !isCashOrBankAccount(acc)) {
    return 'investing';
  }

  // Financing: liabilities and equity
  if (t.includes('LIABILIT') || t === 'EQUITY') {
    return 'financing';
  }

  return 'operating';
};

/**
 * Exports cash flow data as a CSV file.
 */
const exportCSV = (
  operating: CashFlowItem[],
  investing: CashFlowItem[],
  financing: CashFlowItem[],
  netOperating: number,
  netInvesting: number,
  netFinancing: number,
  netChange: number,
  openingCash: number,
  closingCash: number,
  fromDate: string,
  toDate: string
) => {
  const rows: string[][] = [
    ['Cash Flow Statement', `${format(new Date(fromDate), 'dd-MMM-yyyy')} to ${format(new Date(toDate), 'dd-MMM-yyyy')}`],
    [],
    ['Particulars', 'Amount (Rs)'],
    [],
    ['OPERATING ACTIVITIES', ''],
  ];

  operating.forEach((item) => rows.push([item.name, item.amount.toFixed(2)]));
  rows.push(['Net Cash from Operations', netOperating.toFixed(2)]);
  rows.push([]);
  rows.push(['INVESTING ACTIVITIES', '']);
  investing.forEach((item) => rows.push([item.name, item.amount.toFixed(2)]));
  rows.push(['Net Cash from Investing', netInvesting.toFixed(2)]);
  rows.push([]);
  rows.push(['FINANCING ACTIVITIES', '']);
  financing.forEach((item) => rows.push([item.name, item.amount.toFixed(2)]));
  rows.push(['Net Cash from Financing', netFinancing.toFixed(2)]);
  rows.push([]);
  rows.push(['Net Increase/(Decrease) in Cash', netChange.toFixed(2)]);
  rows.push(['Opening Cash Balance', openingCash.toFixed(2)]);
  rows.push(['Closing Cash Balance', closingCash.toFixed(2)]);

  const csvContent = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `cash_flow_${fromDate}_to_${toDate}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast.success('Cash Flow Statement exported as CSV');
};

/**
 * CashFlow - Displays a Cash Flow Statement showing operating, investing,
 * and financing activities for a given period. Data is fetched from Supabase
 * and classified into the three activity categories.
 */
const CashFlow: React.FC = () => {
  const now = new Date();
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
    queryKey: ['cash_flow_accounts'],
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
    queryKey: ['cash_flow_entries', fromDate, toDate],
    queryFn: async () => {
      // Single join-filtered query, paginated — the previous two-step fetch
      // truncated at 1000 vouchers and produced a silently wrong cash flow.
      const data = await fetchAllRows((from, to) =>
        supabase
          .from('voucher_entries')
          .select('*, voucher:vouchers!inner(id, voucher_date, status)')
          .eq('voucher.status', 'AUTHORISED')
          .gte('voucher.voucher_date', fromDate)
          .lte('voucher.voucher_date', toDate)
          .range(from, to),
      );
      return data as unknown as VoucherEntry[];
    },
  });

  const isLoading = accountsLoading || entriesLoading;
  const isError = accountsError || entriesError;
  const error = accErr || entErr;

  // Compute cash flow items
  const {
    operatingItems,
    investingItems,
    financingItems,
    netOperating,
    netInvesting,
    netFinancing,
    openingCash,
  } = useMemo(() => {
    // Build account lookup map
    const accountMap = new Map<string, Account>();
    accounts.forEach((acc) => accountMap.set(acc.id, acc));

    // Aggregate debit/credit per account from entries
    const debitMap = new Map<string, number>();
    const creditMap = new Map<string, number>();
    entries.forEach((e) => {
      debitMap.set(e.account_id, (debitMap.get(e.account_id) || 0) + Number(e.debit_amount || 0));
      creditMap.set(e.account_id, (creditMap.get(e.account_id) || 0) + Number(e.credit_amount || 0));
    });

    const operatingItems: CashFlowItem[] = [];
    const investingItems: CashFlowItem[] = [];
    const financingItems: CashFlowItem[] = [];

    accounts.forEach((acc) => {
      // Skip cash/bank accounts (they are the result, not the source)
      if (isCashOrBankAccount(acc)) return;

      const totalDebit = debitMap.get(acc.id) || 0;
      const totalCredit = creditMap.get(acc.id) || 0;
      if (totalDebit === 0 && totalCredit === 0) return;

      const activity = classifyActivity(acc);
      let amount = 0;

      const t = (acc.account_type || '').toUpperCase();
      if (t.includes('INCOME')) {
        // Cash inflow from income
        amount = totalCredit - totalDebit;
      } else if (t.includes('EXPENSE')) {
        // Cash outflow from expenses (shown as negative)
        amount = -(totalDebit - totalCredit);
      } else if (t.includes('ASSET')) {
        // Increase in assets = cash outflow, decrease = cash inflow
        amount = -(totalDebit - totalCredit);
      } else if (t.includes('LIABILIT') || t === 'EQUITY') {
        // Increase in liabilities/equity = cash inflow, decrease = outflow
        amount = totalCredit - totalDebit;
      }

      if (amount === 0) return;

      const item: CashFlowItem = { name: acc.account_name, amount };

      if (activity === 'operating') {
        operatingItems.push(item);
      } else if (activity === 'investing') {
        investingItems.push(item);
      } else {
        financingItems.push(item);
      }
    });

    // Sort by absolute amount descending
    const sortByAmount = (a: CashFlowItem, b: CashFlowItem) =>
      Math.abs(b.amount) - Math.abs(a.amount);
    operatingItems.sort(sortByAmount);
    investingItems.sort(sortByAmount);
    financingItems.sort(sortByAmount);

    const netOperating = operatingItems.reduce((s, i) => s + i.amount, 0);
    const netInvesting = investingItems.reduce((s, i) => s + i.amount, 0);
    const netFinancing = financingItems.reduce((s, i) => s + i.amount, 0);

    // Calculate opening cash balance from cash/bank accounts
    let openingCash = 0;
    accounts.forEach((acc) => {
      if (isCashOrBankAccount(acc)) {
        const bal = Number(acc.opening_balance || 0);
        if (acc.opening_balance_type?.toUpperCase() === 'DR') {
          openingCash += bal;
        } else {
          openingCash -= bal;
        }
      }
    });

    return {
      operatingItems,
      investingItems,
      financingItems,
      netOperating,
      netInvesting,
      netFinancing,
      openingCash,
    };
  }, [accounts, entries]);

  const netChange = netOperating + netInvesting + netFinancing;
  const closingCash = openingCash + netChange;

  // Print handler
  const handlePrint = () => {
    window.print();
  };

  // Renders a list of cash flow items
  const renderItems = (items: CashFlowItem[]) => {
    if (items.length === 0) {
      return (
        <p className="text-sm text-gray-400 italic px-4 py-2">No items in this category</p>
      );
    }
    return items.map((item, idx) => (
      <div key={idx} className="flex items-center justify-between px-4 py-1.5 text-sm">
        <span className="text-gray-700">{item.name}</span>
        <span className={item.amount >= 0 ? 'text-green-700' : 'text-red-700'}>
          {item.amount >= 0 ? '' : '('}{formatCurrency(Math.abs(item.amount))}{item.amount < 0 ? ')' : ''}
        </span>
      </div>
    ));
  };

  // Loading skeleton
  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl font-bold text-gray-800">Cash Flow Statement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-4 w-40 bg-gray-200 rounded animate-pulse" />
                <div className="h-4 flex-1 bg-gray-200 rounded animate-pulse" />
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
          <CardTitle className="text-xl font-bold text-gray-800">Cash Flow Statement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-red-700 font-medium">Failed to load cash flow data</p>
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
    <TallyScreen title="Cash Flow" rail={[{ hotkey: 'P', label: 'Print', onClick: () => window.print() }]}>
    
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Cash Flow Statement</h2>
          <p className="text-sm text-gray-500 mt-1">
            {format(new Date(fromDate), 'dd MMM yyyy')} to {format(new Date(toDate), 'dd MMM yyyy')}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label htmlFor="cfFromDate" className="text-sm whitespace-nowrap">
              From
            </Label>
            <Input
              id="cfFromDate"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="cfToDate" className="text-sm whitespace-nowrap">
              To
            </Label>
            <Input
              id="cfToDate"
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
              exportCSV(
                operatingItems,
                investingItems,
                financingItems,
                netOperating,
                netInvesting,
                netFinancing,
                netChange,
                openingCash,
                closingCash,
                fromDate,
                toDate
              )
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

      {/* Operating Activities */}
      <Card>
        <CardHeader className="py-3 bg-blue-50 rounded-t-lg">
          <CardTitle className="text-base font-bold text-gray-800">
            A. Cash Flow from Operating Activities
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 pb-2">
          {renderItems(operatingItems)}
          <Separator className="my-2" />
          <div className="flex items-center justify-between px-4 py-2 font-bold text-sm">
            <span className="text-gray-800">Net Cash from Operations</span>
            <span className={netOperating >= 0 ? 'text-green-700' : 'text-red-700'}>
              {formatCurrency(netOperating)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Investing Activities */}
      <Card>
        <CardHeader className="py-3 bg-blue-50 rounded-t-lg">
          <CardTitle className="text-base font-bold text-gray-800">
            B. Cash Flow from Investing Activities
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 pb-2">
          {renderItems(investingItems)}
          <Separator className="my-2" />
          <div className="flex items-center justify-between px-4 py-2 font-bold text-sm">
            <span className="text-gray-800">Net Cash from Investing</span>
            <span className={netInvesting >= 0 ? 'text-green-700' : 'text-red-700'}>
              {formatCurrency(netInvesting)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Financing Activities */}
      <Card>
        <CardHeader className="py-3 bg-blue-50 rounded-t-lg">
          <CardTitle className="text-base font-bold text-gray-800">
            C. Cash Flow from Financing Activities
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 pb-2">
          {renderItems(financingItems)}
          <Separator className="my-2" />
          <div className="flex items-center justify-between px-4 py-2 font-bold text-sm">
            <span className="text-gray-800">Net Cash from Financing</span>
            <span className={netFinancing >= 0 ? 'text-green-700' : 'text-red-700'}>
              {formatCurrency(netFinancing)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card className="border-2 border-blue-200">
        <CardHeader className="py-3 bg-blue-50 rounded-t-lg">
          <CardTitle className="text-base font-bold text-gray-800">Summary</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-gray-700">Net Cash from Operations (A)</span>
              <span className={netOperating >= 0 ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>
                {formatCurrency(netOperating)}
              </span>
            </div>
            <div className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-gray-700">Net Cash from Investing (B)</span>
              <span className={netInvesting >= 0 ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>
                {formatCurrency(netInvesting)}
              </span>
            </div>
            <div className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-gray-700">Net Cash from Financing (C)</span>
              <span className={netFinancing >= 0 ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>
                {formatCurrency(netFinancing)}
              </span>
            </div>

            <Separator />

            <div className="flex items-center justify-between px-4 py-2 text-sm font-bold">
              <span className="text-gray-800">Net Increase/(Decrease) in Cash (A+B+C)</span>
              <span className={netChange >= 0 ? 'text-green-800' : 'text-red-800'}>
                {formatCurrency(netChange)}
              </span>
            </div>
            <div className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-gray-700">Opening Cash Balance</span>
              <span className="text-gray-700 font-medium">{formatCurrency(openingCash)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3 bg-blue-50 rounded font-bold text-base">
              <span className="text-gray-800">Closing Cash Balance</span>
              <span className={closingCash >= 0 ? 'text-green-800' : 'text-red-800'}>
                {formatCurrency(closingCash)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
    </TallyScreen>
  );
};

export default CashFlow;
