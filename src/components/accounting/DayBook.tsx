import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { Download, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VoucherEntry {
  id: string;
  debit_amount: number | null;
  credit_amount: number | null;
  narration: string | null;
  entry_order: number | null;
  account: {
    id: string;
    account_name: string;
    account_code: string;
  } | null;
}

interface VoucherType {
  id: string;
  voucher_type_name: string;
  voucher_category: string;
}

interface Voucher {
  id: string;
  voucher_number: string;
  voucher_date: string;
  reference_number: string | null;
  narration: string | null;
  total_amount: number | null;
  status: string;
  voucher_type: VoucherType | null;
  voucher_entries: VoucherEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a number as Indian Rupees. */
const formatCurrency = (val: number): string =>
  `\u20B9${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

/** Return a badge variant class based on voucher status. */
const statusBadgeClass = (status: string): string => {
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
// Component
// ---------------------------------------------------------------------------

const DayBook: React.FC = () => {
  // Default date range: current month
  const now = new Date();
  const [fromDate, setFromDate] = useState(
    format(startOfMonth(now), 'yyyy-MM-dd')
  );
  const [toDate, setToDate] = useState(
    format(endOfMonth(now), 'yyyy-MM-dd')
  );
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Fetch voucher types for the filter dropdown
  const { data: voucherTypes } = useQuery({
    queryKey: ['voucher_types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('voucher_types')
        .select('id, voucher_type_name, voucher_category')
        .eq('is_active', true)
        .order('voucher_type_name');
      if (error) throw error;
      return data as VoucherType[];
    },
  });

  // Fetch vouchers within the selected date range with entries and accounts
  const {
    data: vouchers,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['daybook_vouchers', fromDate, toDate, typeFilter, statusFilter],
    queryFn: async () => {
      let query = supabase
        .from('vouchers')
        .select(`
          *,
          voucher_type:voucher_types(id, voucher_type_name, voucher_category),
          voucher_entries(
            id, debit_amount, credit_amount, narration, entry_order,
            account:chart_of_accounts(id, account_name, account_code)
          )
        `)
        .gte('voucher_date', fromDate)
        .lte('voucher_date', toDate)
        .order('voucher_date', { ascending: false });

      if (typeFilter && typeFilter !== 'all') {
        query = query.eq('voucher_type_id', typeFilter);
      }
      if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error: fetchError } = await query;
      if (fetchError) throw fetchError;
      return data as Voucher[];
    },
  });

  // Toggle expanded state for a voucher row
  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Calculate grand totals across all displayed vouchers
  const grandTotals = useMemo(() => {
    if (!vouchers) return { debit: 0, credit: 0 };
    return vouchers.reduce(
      (acc, v) => {
        const debit =
          v.voucher_entries?.reduce(
            (s, e) => s + (e.debit_amount || 0),
            0
          ) || 0;
        const credit =
          v.voucher_entries?.reduce(
            (s, e) => s + (e.credit_amount || 0),
            0
          ) || 0;
        return { debit: acc.debit + debit, credit: acc.credit + credit };
      },
      { debit: 0, credit: 0 }
    );
  }, [vouchers]);

  // Export displayed vouchers as CSV
  const exportCSV = () => {
    if (!vouchers?.length) return;
    const headers = [
      'Date',
      'Voucher No',
      'Type',
      'Narration',
      'Debit',
      'Credit',
      'Status',
    ];
    const rows = vouchers.map((v) => [
      v.voucher_date,
      v.voucher_number,
      v.voucher_type?.voucher_type_name || '',
      v.narration || '',
      v.voucher_entries?.reduce((s, e) => s + (e.debit_amount || 0), 0) || 0,
      v.voucher_entries?.reduce((s, e) => s + (e.credit_amount || 0), 0) || 0,
      v.status,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${c}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daybook_${fromDate}_${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported successfully');
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-xl font-bold text-blue-700">
            Day Book
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCSV}
            disabled={!vouchers?.length}
          >
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>

        {/* Filters */}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* From Date */}
          <div className="space-y-1">
            <Label htmlFor="from-date">From Date</Label>
            <Input
              id="from-date"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>

          {/* To Date */}
          <div className="space-y-1">
            <Label htmlFor="to-date">To Date</Label>
            <Input
              id="to-date"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>

          {/* Voucher Type Filter */}
          <div className="space-y-1">
            <Label>Voucher Type</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {voucherTypes?.map((vt) => (
                  <SelectItem key={vt.id} value={vt.id}>
                    {vt.voucher_type_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status Filter */}
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="AUTHORISED">Authorised</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Error State */}
        {isError && (
          <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle className="h-4 w-4" />
            <span>Failed to load vouchers: {(error as Error)?.message}</span>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded bg-gray-100"
              />
            ))}
          </div>
        )}

        {/* Voucher Table */}
        {!isLoading && !isError && (
          <ScrollArea className="w-full">
            <div className="min-w-[800px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Date</TableHead>
                    <TableHead>Voucher #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Narration</TableHead>
                    <TableHead className="text-right">Debit Total</TableHead>
                    <TableHead className="text-right">Credit Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vouchers && vouchers.length > 0 ? (
                    <>
                      {vouchers.map((v) => {
                        const isExpanded = expandedIds.has(v.id);
                        const debitTotal =
                          v.voucher_entries?.reduce(
                            (s, e) => s + (e.debit_amount || 0),
                            0
                          ) || 0;
                        const creditTotal =
                          v.voucher_entries?.reduce(
                            (s, e) => s + (e.credit_amount || 0),
                            0
                          ) || 0;

                        return (
                          <React.Fragment key={v.id}>
                            {/* Voucher summary row */}
                            <TableRow
                              className="cursor-pointer hover:bg-blue-50"
                              onClick={() => toggleExpanded(v.id)}
                            >
                              <TableCell>
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-gray-500" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-gray-500" />
                                )}
                              </TableCell>
                              <TableCell>
                                {format(parseISO(v.voucher_date), 'dd MMM yyyy')}
                              </TableCell>
                              <TableCell className="font-medium">
                                {v.voucher_number}
                              </TableCell>
                              <TableCell>
                                {v.voucher_type?.voucher_type_name || '-'}
                              </TableCell>
                              <TableCell className="max-w-[200px] truncate">
                                {v.narration || '-'}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(debitTotal)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {formatCurrency(creditTotal)}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={statusBadgeClass(v.status)}
                                >
                                  {v.status}
                                </Badge>
                              </TableCell>
                            </TableRow>

                            {/* Expanded entry rows */}
                            {isExpanded &&
                              v.voucher_entries
                                ?.sort(
                                  (a, b) =>
                                    (a.entry_order || 0) - (b.entry_order || 0)
                                )
                                .map((entry, idx) => (
                                  <TableRow
                                    key={entry.id}
                                    className="bg-gray-50"
                                  >
                                    <TableCell />
                                    <TableCell className="pl-8 text-sm text-gray-500">
                                      {idx + 1}
                                    </TableCell>
                                    <TableCell
                                      colSpan={2}
                                      className="pl-8 text-sm"
                                    >
                                      {entry.account
                                        ? `${entry.account.account_code} - ${entry.account.account_name}`
                                        : '-'}
                                    </TableCell>
                                    <TableCell className="text-sm text-gray-500">
                                      {entry.narration || '-'}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                      {entry.debit_amount
                                        ? formatCurrency(entry.debit_amount)
                                        : '-'}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                      {entry.credit_amount
                                        ? formatCurrency(entry.credit_amount)
                                        : '-'}
                                    </TableCell>
                                    <TableCell />
                                  </TableRow>
                                ))}
                          </React.Fragment>
                        );
                      })}

                      {/* Grand Totals Row */}
                      <TableRow className="border-t-2 font-bold">
                        <TableCell />
                        <TableCell colSpan={4} className="text-right">
                          Grand Total
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(grandTotals.debit)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(grandTotals.credit)}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </>
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="py-8 text-center text-gray-500"
                      >
                        No vouchers found for the selected date range.
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

export default DayBook;
