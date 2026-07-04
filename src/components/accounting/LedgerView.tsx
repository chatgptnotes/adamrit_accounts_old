import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { Download, BookOpen, AlertCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';

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

interface VoucherTypeInfo {
  voucher_type_name: string;
}

interface VoucherInfo {
  id: string;
  voucher_number: string;
  voucher_date: string;
  narration: string | null;
  status: string;
  voucher_type: VoucherTypeInfo | null;
}

interface VoucherEntryRow {
  id: string;
  debit_amount: number | null;
  credit_amount: number | null;
  narration: string | null;
  voucher: VoucherInfo | null;
}

/** A processed ledger row ready for display. */
interface LedgerRow {
  id: string;
  date: string;
  voucherNumber: string;
  type: string;
  particulars: string;
  debit: number;
  credit: number;
  balance: number;
  balanceType: 'Dr' | 'Cr';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a number as Indian Rupees. */
const formatCurrency = (val: number): string =>
  `\u20B9${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

/**
 * Compute the default financial year dates.
 * Indian financial year: April 1 to March 31.
 */
const getFinancialYearDates = (): { from: string; to: string } => {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    from: `${year}-04-01`,
    to: `${year + 1}-03-31`,
  };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const LedgerView: React.FC = () => {
  const fy = getFinancialYearDates();
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [fromDate, setFromDate] = useState(fy.from);
  const [toDate, setToDate] = useState(fy.to);

  // Fetch all active accounts for the dropdown
  const { data: accounts } = useQuery({
    queryKey: ['chart_of_accounts_active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('*')
        .eq('is_active', true)
        .order('account_code');
      if (error) throw error;
      return data as Account[];
    },
  });

  // The currently selected account object
  const selectedAccount = useMemo(
    () => accounts?.find((a) => a.id === selectedAccountId) || null,
    [accounts, selectedAccountId]
  );

  // Fetch voucher entries for the selected account
  const {
    data: rawEntries,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['ledger_entries', selectedAccountId, fromDate, toDate],
    enabled: !!selectedAccountId,
    queryFn: async () => {
      // Filter server-side and paginate: accounts like Cash in Hand have
      // thousands of entries and a single request truncates at 1000 rows.
      const data = await fetchAllRows((from, to) =>
        supabase
          .from('voucher_entries')
          .select(`
            id, debit_amount, credit_amount, narration,
            voucher:vouchers!inner(id, voucher_number, voucher_date, narration, status,
              voucher_type:voucher_types(voucher_type_name)
            )
          `)
          .eq('account_id', selectedAccountId)
          .eq('voucher.status', 'AUTHORISED')
          .gte('voucher.voucher_date', fromDate)
          .lte('voucher.voucher_date', toDate)
          .range(from, to),
      );
      return data as unknown as VoucherEntryRow[];
    },
  });

  // Filter and sort entries client-side, then compute running balance
  const ledgerRows = useMemo<LedgerRow[]>(() => {
    if (!selectedAccount || !rawEntries) return [];

    // Filter by posted status and date range
    const filtered = rawEntries
      .filter((e) => {
        const v = e.voucher;
        if (!v || v.status !== 'AUTHORISED') return false;
        return v.voucher_date >= fromDate && v.voucher_date <= toDate;
      })
      .sort((a, b) =>
        (a.voucher?.voucher_date || '').localeCompare(
          b.voucher?.voucher_date || ''
        )
      );

    // Opening balance: positive = Dr side, negative = Cr side
    let balance =
      selectedAccount.opening_balance_type === 'Dr'
        ? selectedAccount.opening_balance || 0
        : -(selectedAccount.opening_balance || 0);

    const rows: LedgerRow[] = [];

    // Opening balance row
    rows.push({
      id: 'opening',
      date: fromDate,
      voucherNumber: '',
      type: '',
      particulars: 'Opening Balance',
      debit:
        selectedAccount.opening_balance_type === 'Dr'
          ? selectedAccount.opening_balance || 0
          : 0,
      credit:
        selectedAccount.opening_balance_type === 'Cr'
          ? selectedAccount.opening_balance || 0
          : 0,
      balance: Math.abs(balance),
      balanceType: balance >= 0 ? 'Dr' : 'Cr',
    });

    // Transaction rows
    filtered.forEach((entry) => {
      const v = entry.voucher!;
      const debit = entry.debit_amount || 0;
      const credit = entry.credit_amount || 0;
      balance += debit - credit;

      rows.push({
        id: entry.id,
        date: v.voucher_date,
        voucherNumber: v.voucher_number,
        type: v.voucher_type?.voucher_type_name || '-',
        particulars: entry.narration || v.narration || '-',
        debit,
        credit,
        balance: Math.abs(balance),
        balanceType: balance >= 0 ? 'Dr' : 'Cr',
      });
    });

    // Closing balance row
    rows.push({
      id: 'closing',
      date: toDate,
      voucherNumber: '',
      type: '',
      particulars: 'Closing Balance',
      debit: 0,
      credit: 0,
      balance: Math.abs(balance),
      balanceType: balance >= 0 ? 'Dr' : 'Cr',
    });

    return rows;
  }, [rawEntries, selectedAccount, fromDate, toDate]);

  // Export ledger as CSV
  const exportCSV = () => {
    if (!ledgerRows.length || !selectedAccount) return;
    const headers = [
      'Date',
      'Voucher #',
      'Type',
      'Particulars',
      'Debit',
      'Credit',
      'Balance',
    ];
    const rows = ledgerRows.map((r) => [
      r.date,
      r.voucherNumber,
      r.type,
      r.particulars,
      r.debit || '',
      r.credit || '',
      `${r.balance} ${r.balanceType}`,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${c}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger_${selectedAccount.account_code}_${fromDate}_${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported successfully');
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-xl font-bold text-blue-700">
            Ledger View
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCSV}
            disabled={!ledgerRows.length}
          >
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>

        {/* Filters */}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Account Selector */}
          <div className="space-y-1 sm:col-span-2 lg:col-span-1">
            <Label>Account</Label>
            <Select
              value={selectedAccountId}
              onValueChange={setSelectedAccountId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select an account" />
              </SelectTrigger>
              <SelectContent>
                {accounts?.map((acc) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    {acc.account_code} - {acc.account_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* From Date */}
          <div className="space-y-1">
            <Label htmlFor="ledger-from">From Date</Label>
            <Input
              id="ledger-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>

          {/* To Date */}
          <div className="space-y-1">
            <Label htmlFor="ledger-to">To Date</Label>
            <Input
              id="ledger-to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* No account selected */}
        {!selectedAccountId && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <BookOpen className="mb-4 h-12 w-12" />
            <p className="text-lg">Select an account to view its ledger</p>
          </div>
        )}

        {/* Error State */}
        {selectedAccountId && isError && (
          <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle className="h-4 w-4" />
            <span>
              Failed to load ledger entries: {(error as Error)?.message}
            </span>
          </div>
        )}

        {/* Loading State */}
        {selectedAccountId && isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded bg-gray-100"
              />
            ))}
          </div>
        )}

        {/* Account Info Bar and Transactions */}
        {selectedAccountId && selectedAccount && !isLoading && !isError && (
          <>
            {/* Account Info Bar */}
            <div className="mb-4 flex flex-wrap items-center gap-4 rounded-md border bg-blue-50 p-4">
              <div>
                <span className="text-sm font-semibold text-gray-700">
                  {selectedAccount.account_name}
                </span>
                <span className="ml-2 text-sm text-gray-500">
                  ({selectedAccount.account_code})
                </span>
              </div>
              <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-200">
                {selectedAccount.account_type}
              </Badge>
              {selectedAccount.account_group && (
                <span className="text-sm text-gray-500">
                  Group: {selectedAccount.account_group}
                </span>
              )}
              <Separator orientation="vertical" className="hidden h-6 sm:block" />
              <span className="text-sm text-gray-600">
                Opening Balance:{' '}
                <span className="font-medium">
                  {formatCurrency(selectedAccount.opening_balance || 0)}{' '}
                  {selectedAccount.opening_balance_type || '-'}
                </span>
              </span>
            </div>

            {/* Ledger Transactions Table */}
            <ScrollArea className="w-full">
              <div className="min-w-[750px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Voucher #</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Particulars</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledgerRows.map((row) => {
                      const isSpecialRow =
                        row.id === 'opening' || row.id === 'closing';
                      return (
                        <TableRow
                          key={row.id}
                          className={
                            isSpecialRow ? 'bg-gray-50 font-bold' : ''
                          }
                        >
                          <TableCell>
                            {row.id === 'opening' || row.id === 'closing'
                              ? ''
                              : format(parseISO(row.date), 'dd MMM yyyy')}
                          </TableCell>
                          <TableCell>{row.voucherNumber || ''}</TableCell>
                          <TableCell>{row.type || ''}</TableCell>
                          <TableCell>{row.particulars}</TableCell>
                          <TableCell className="text-right font-mono">
                            {row.debit ? formatCurrency(row.debit) : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {row.credit ? formatCurrency(row.credit) : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(row.balance)}{' '}
                            <span className="text-xs text-gray-500">
                              {row.balanceType}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {ledgerRows.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="py-8 text-center text-gray-500"
                        >
                          No posted transactions found for this account in the
                          selected date range.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </ScrollArea>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default LedgerView;
