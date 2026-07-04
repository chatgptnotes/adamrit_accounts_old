import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TallyScreen } from './tally/TallyChrome';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { toast } from 'sonner';
import {
  Printer,
  Download,
  Loader2,
  AlertCircle,
  Check,
  X,
  Building2,
  Calendar,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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

/** Combined entry with voucher details for display. */
interface TransactionRow {
  entryId: string;
  voucherDate: string;
  voucherNumber: string;
  narration: string;
  debit: number;
  credit: number;
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
 * BankReconciliation - A bank account reconciliation tool.
 * Allows selecting a bank account, viewing its transactions, and marking
 * entries as reconciled. Reconciliation status is persisted in localStorage.
 */
const BankReconciliation: React.FC = () => {
  const now = new Date();
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>(getFYStart(now));
  const [toDate, setToDate] = useState<string>(getFYEnd(now));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reconciled IDs are persisted per bank account in localStorage
  const storageKey = `bank_recon_${selectedAccountId}`;
  const [reconciledIds, setReconciledIds] = useState<Set<string>>(new Set());

  // Load reconciled IDs from localStorage when account changes
  useEffect(() => {
    if (selectedAccountId) {
      const saved = localStorage.getItem(storageKey);
      setReconciledIds(saved ? new Set(JSON.parse(saved)) : new Set());
      setSelectedIds(new Set());
    } else {
      setReconciledIds(new Set());
      setSelectedIds(new Set());
    }
  }, [selectedAccountId, storageKey]);

  // Persist reconciled IDs to localStorage on change
  useEffect(() => {
    if (selectedAccountId) {
      localStorage.setItem(storageKey, JSON.stringify([...reconciledIds]));
    }
  }, [reconciledIds, selectedAccountId, storageKey]);

  // Fetch bank accounts from chart_of_accounts
  const {
    data: bankAccounts = [],
    isLoading: bankLoading,
  } = useQuery({
    queryKey: ['bank_recon_accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('*')
        .eq('is_active', true)
        .eq('account_type', 'Asset')
        .order('account_name');
      if (error) throw error;
      // Filter for bank-related accounts
      return ((data || []) as Account[]).filter(
        (acc) =>
          (acc.account_group || '').toLowerCase().includes('bank') ||
          (acc.account_name || '').toLowerCase().includes('bank')
      );
    },
  });

  // Fetch voucher entries for the selected bank account within the date range
  const {
    data: transactions = [],
    isLoading: txnLoading,
    isError: txnError,
    error: txnErr,
    refetch: refetchTxn,
  } = useQuery({
    queryKey: ['bank_recon_entries', selectedAccountId, fromDate, toDate],
    queryFn: async () => {
      if (!selectedAccountId) return [];

      // Single join-filtered query, paginated — the previous two-step fetch
      // truncated at 1000 vouchers and dropped bank transactions.
      const entryData = await fetchAllRows((from, to) =>
        supabase
          .from('voucher_entries')
          .select('*, voucher:vouchers!inner(id, voucher_number, voucher_date, status)')
          .eq('account_id', selectedAccountId)
          .eq('voucher.status', 'AUTHORISED')
          .gte('voucher.voucher_date', fromDate)
          .lte('voucher.voucher_date', toDate)
          .order('created_at', { ascending: true })
          .range(from, to),
      );

      // Combine entry with voucher info
      return (entryData as any[]).map((entry): TransactionRow => {
        return {
          entryId: entry.id,
          voucherDate: entry.voucher?.voucher_date || '',
          voucherNumber: entry.voucher?.voucher_number || '',
          narration: entry.narration || '',
          debit: Number(entry.debit_amount || 0),
          credit: Number(entry.credit_amount || 0),
        };
      });
    },
    enabled: !!selectedAccountId,
  });

  // Get the selected account object for balance computation
  const selectedAccount = bankAccounts.find((a) => a.id === selectedAccountId);

  // Compute summary values
  const { bookBalance, totalDebits, totalCredits, reconciledAmount, unreconciledAmount, reconciledCount } =
    useMemo(() => {
      // Opening balance (debit = positive for Asset accounts)
      let openingBal = 0;
      if (selectedAccount) {
        const bal = Number(selectedAccount.opening_balance || 0);
        openingBal = selectedAccount.opening_balance_type === 'Dr' ? bal : -bal;
      }

      let totalDebits = 0;
      let totalCredits = 0;
      let reconciledAmount = 0;
      let reconciledCount = 0;

      transactions.forEach((txn) => {
        totalDebits += txn.debit;
        totalCredits += txn.credit;
        if (reconciledIds.has(txn.entryId)) {
          reconciledAmount += txn.debit - txn.credit;
          reconciledCount++;
        }
      });

      const bookBalance = openingBal + totalDebits - totalCredits;
      const unreconciledAmount = bookBalance - reconciledAmount;

      return { bookBalance, totalDebits, totalCredits, reconciledAmount, unreconciledAmount, reconciledCount };
    }, [transactions, reconciledIds, selectedAccount]);

  // Toggle selection for a single row
  const toggleSelected = (entryId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  // Select/deselect all
  const toggleSelectAll = () => {
    if (selectedIds.size === transactions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(transactions.map((t) => t.entryId)));
    }
  };

  // Mark selected entries as reconciled
  const markReconciled = () => {
    if (selectedIds.size === 0) {
      toast.error('No entries selected');
      return;
    }
    setReconciledIds((prev) => {
      const next = new Set(prev);
      selectedIds.forEach((id) => next.add(id));
      return next;
    });
    toast.success(`${selectedIds.size} entries marked as reconciled`);
    setSelectedIds(new Set());
  };

  // Unmark selected entries
  const unmarkReconciled = () => {
    if (selectedIds.size === 0) {
      toast.error('No entries selected');
      return;
    }
    setReconciledIds((prev) => {
      const next = new Set(prev);
      selectedIds.forEach((id) => next.delete(id));
      return next;
    });
    toast.success(`${selectedIds.size} entries unmarked`);
    setSelectedIds(new Set());
  };

  // Print handler
  const handlePrint = () => {
    window.print();
  };

  // No bank account selected state
  if (!selectedAccountId && !bankLoading) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Bank Reconciliation</h2>
          <p className="text-sm text-gray-500 mt-1">
            Reconcile bank statements with your books
          </p>
        </div>

        {/* Bank Account Selector */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <Label htmlFor="bankAccount" className="text-sm whitespace-nowrap font-medium">
                Bank Account
              </Label>
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger className="w-80">
                  <SelectValue placeholder="Select a bank account..." />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.account_code} - {acc.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Prompt */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Building2 className="h-12 w-12 text-gray-300 mb-4" />
              <p className="text-gray-500 text-sm">
                Select a bank account to begin reconciliation
              </p>
              {bankAccounts.length === 0 && !bankLoading && (
                <p className="text-gray-400 text-xs mt-2">
                  No bank accounts found. Add a bank account in Chart of Accounts first.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <TallyScreen title="Bank Reconciliation" rail={[{ hotkey: 'P', label: 'Print', onClick: () => window.print() }]}>
    
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Bank Reconciliation</h2>
          <p className="text-sm text-gray-500 mt-1">
            Reconcile bank statements with your books
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1" />
            Print
          </Button>
        </div>
      </div>

      {/* Controls: Bank account selector + date range */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor="bankAccount" className="text-sm font-medium mb-1.5 block">
                Bank Account
              </Label>
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a bank account..." />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.account_code} - {acc.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="brFromDate" className="text-sm font-medium mb-1.5 block">
                From
              </Label>
              <Input
                id="brFromDate"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-40"
              />
            </div>
            <div>
              <Label htmlFor="brToDate" className="text-sm font-medium mb-1.5 block">
                To
              </Label>
              <Input
                id="brToDate"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-40"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Session-only notice */}
      <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg">
        <AlertCircle className="h-4 w-4 text-yellow-600 flex-shrink-0" />
        <p className="text-xs text-yellow-700">
          Reconciliation status is stored in your browser's local storage. Clearing browser data will reset it.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500 font-medium">Book Balance</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">
              {formatCurrency(bookBalance)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500 font-medium">Reconciled Amount</p>
            <p className="text-2xl font-bold text-green-700 mt-1">
              {formatCurrency(reconciledAmount)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500 font-medium">Unreconciled Amount</p>
            <p className="text-2xl font-bold text-red-700 mt-1">
              {formatCurrency(unreconciledAmount)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          className="bg-green-600 hover:bg-green-700"
          onClick={markReconciled}
          disabled={selectedIds.size === 0}
        >
          <Check className="h-4 w-4 mr-1" />
          Mark Reconciled ({selectedIds.size})
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={unmarkReconciled}
          disabled={selectedIds.size === 0}
        >
          <X className="h-4 w-4 mr-1" />
          Unmark ({selectedIds.size})
        </Button>
        <div className="ml-auto text-sm text-gray-500">
          {selectedIds.size} selected of {transactions.length} entries
        </div>
      </div>

      {/* Transactions Table */}
      <Card>
        <CardContent className="pt-0 px-0">
          {txnLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="h-4 w-6 bg-gray-200 rounded animate-pulse" />
                  <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
                  <div className="h-4 flex-1 bg-gray-200 rounded animate-pulse" />
                  <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
                  <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : txnError ? (
            <div className="flex items-center gap-3 p-6 bg-red-50 border border-red-200 rounded-lg m-4">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-red-700 font-medium">Failed to load transactions</p>
                <p className="text-xs text-red-600 mt-1">
                  {(txnErr as Error)?.message || 'An unexpected error occurred.'}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchTxn()}>
                Retry
              </Button>
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Calendar className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-gray-500 text-sm">
                No transactions found for the selected period
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selectedIds.size === transactions.length && transactions.length > 0}
                        onCheckedChange={toggleSelectAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Voucher #</TableHead>
                    <TableHead>Narration</TableHead>
                    <TableHead className="text-right">Debit (Deposit)</TableHead>
                    <TableHead className="text-right">Credit (Withdrawal)</TableHead>
                    <TableHead className="text-center">Reconciled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((txn) => {
                    const isReconciled = reconciledIds.has(txn.entryId);
                    const isSelected = selectedIds.has(txn.entryId);
                    return (
                      <TableRow
                        key={txn.entryId}
                        className={isReconciled ? 'bg-green-50' : ''}
                      >
                        <TableCell>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelected(txn.entryId)}
                            aria-label={`Select entry ${txn.voucherNumber}`}
                          />
                        </TableCell>
                        <TableCell className="text-sm text-gray-700 whitespace-nowrap">
                          {txn.voucherDate
                            ? format(new Date(txn.voucherDate), 'dd-MMM-yyyy')
                            : '-'}
                        </TableCell>
                        <TableCell className="text-sm font-mono text-gray-600">
                          {txn.voucherNumber || '-'}
                        </TableCell>
                        <TableCell className="text-sm text-gray-700 max-w-xs truncate">
                          {txn.narration || '-'}
                        </TableCell>
                        <TableCell className="text-right text-sm text-gray-700">
                          {txn.debit > 0 ? formatCurrency(txn.debit) : '-'}
                        </TableCell>
                        <TableCell className="text-right text-sm text-gray-700">
                          {txn.credit > 0 ? formatCurrency(txn.credit) : '-'}
                        </TableCell>
                        <TableCell className="text-center">
                          {isReconciled ? (
                            <Badge className="bg-green-100 text-green-800 border-green-200">
                              <Check className="h-3 w-3 mr-0.5" />
                              Yes
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-gray-400">
                              No
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reconciliation Summary */}
      {transactions.length > 0 && (
        <Card>
          <CardHeader className="py-3 bg-gray-50 rounded-t-lg">
            <CardTitle className="text-base font-bold text-gray-800">
              Reconciliation Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Total Debits (Deposits)</span>
                  <span className="font-medium text-gray-800">{formatCurrency(totalDebits)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Total Credits (Withdrawals)</span>
                  <span className="font-medium text-gray-800">{formatCurrency(totalCredits)}</span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Reconciled Items</span>
                  <span className="font-medium text-green-700">
                    {reconciledCount} / {transactions.length}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Unreconciled Balance</span>
                  <span className="font-medium text-red-700">
                    {formatCurrency(unreconciledAmount)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
    </TallyScreen>
  );
};

export default BankReconciliation;
