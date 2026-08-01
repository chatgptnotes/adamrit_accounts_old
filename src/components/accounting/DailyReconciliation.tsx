import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertTriangle,
  CheckCircle,
  IndianRupee,
  CreditCard,
  Banknote,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { format } from 'date-fns';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReconciliationResult {
  date: string;
  vouchers: {
    total: number;
    cash: number;
    bank: number;
  };
  amounts: {
    cashVouchers: number;
    bankVouchers: number;
    advances: number;
    finalPayments: number;
    pharmacy: number;
    totalCollected: number;
    totalVouchered: number;
    discrepancy: number;
  };
  details: {
    advances: number;
    finalPayments: number;
    pharmacySales: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INR = (amount: number) =>
  `₹${Math.abs(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DailyReconciliation: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState<string>(
    format(new Date(), 'yyyy-MM-dd')
  );

  const {
    data: reconciliation,
    isLoading,
    isFetched,
    refetch,
  } = useQuery<ReconciliationResult>({
    queryKey: ['daily-reconciliation', selectedDate],
    queryFn: async (): Promise<ReconciliationResult> => {
      const startOfDay = new Date(`${selectedDate}T00:00:00`).toISOString();
      const endOfDay = new Date(`${selectedDate}T23:59:59.999`).toISOString();

      // Fetch all data sources in parallel
      const [vouchersRes, advanceRes, finalPayRes, pharmacyRes] =
        await Promise.all([
          supabase
            .from('voucher_entries')
            .select('id, amount, debit_amount, credit_amount, payment_mode, voucher:vouchers(voucher_type:voucher_types(voucher_type_name, voucher_category))')
            .gte('created_at', startOfDay)
            .lte('created_at', endOfDay),
          supabase
            .from('advance_payment')
            .select('id, amount, payment_mode')
            .gte('created_at', startOfDay)
            .lte('created_at', endOfDay),
          supabase
            .from('final_payments')
            .select('id, amount, payment_mode')
            .gte('created_at', startOfDay)
            .lte('created_at', endOfDay),
          supabase
            .from('pharmacy_sales')
            .select('id, total_amount, net_amount, payment_mode')
            .gte('created_at', startOfDay)
            .lte('created_at', endOfDay),
        ]);

      const vouchers = (vouchersRes.data ?? []) as any[];
      const advances = (advanceRes.data ?? []) as any[];
      const finalPay = (finalPayRes.data ?? []) as any[];
      const pharmacy = (pharmacyRes.data ?? []) as any[];

      // Identify receipt vouchers: voucher_category === 'receipt' OR
      // voucher_type_name includes 'receipt' (case-insensitive).
      const receiptVouchers = vouchers.filter((v) => {
        const cat: string =
          v.voucher?.voucher_type?.voucher_category?.toLowerCase() ?? '';
        const name: string =
          v.voucher?.voucher_type?.voucher_type_name?.toLowerCase() ?? '';
        return cat.includes('receipt') || name.includes('receipt');
      });

      const cashVouchers = receiptVouchers.filter(
        (v) => v.payment_mode?.toLowerCase() === 'cash'
      );
      const bankVouchers = receiptVouchers.filter(
        (v) => v.payment_mode && v.payment_mode.toLowerCase() !== 'cash'
      );

      // Amount field resolution: prefer explicit `amount`, fall back to
      // credit_amount (receipts increase cash via credit side in double-entry).
      const voucherAmt = (v: any): number =>
        Number(v.amount) ||
        Number(v.credit_amount) ||
        Number(v.debit_amount) ||
        0;

      const totalCashVouchers = cashVouchers.reduce(
        (sum, v) => sum + voucherAmt(v),
        0
      );
      const totalBankVouchers = bankVouchers.reduce(
        (sum, v) => sum + voucherAmt(v),
        0
      );

      const totalAdvances = advances.reduce(
        (sum, a) => sum + (Number(a.amount) || 0),
        0
      );
      const totalFinalPayments = finalPay.reduce(
        (sum, f) => sum + (Number(f.amount) || 0),
        0
      );
      const totalPharmacy = pharmacy.reduce(
        (sum, p) =>
          sum + (Number(p.total_amount) || Number(p.net_amount) || 0),
        0
      );

      const totalCollected = totalAdvances + totalFinalPayments + totalPharmacy;
      const totalVouchered = totalCashVouchers + totalBankVouchers;
      const discrepancy = totalCollected - totalVouchered;

      return {
        date: selectedDate,
        vouchers: {
          total: receiptVouchers.length,
          cash: cashVouchers.length,
          bank: bankVouchers.length,
        },
        amounts: {
          cashVouchers: totalCashVouchers,
          bankVouchers: totalBankVouchers,
          advances: totalAdvances,
          finalPayments: totalFinalPayments,
          pharmacy: totalPharmacy,
          totalCollected,
          totalVouchered,
          discrepancy,
        },
        details: {
          advances: advances.length,
          finalPayments: finalPay.length,
          pharmacySales: pharmacy.length,
        },
      };
    },
    // Do not auto-fetch on mount; user clicks "Generate Report".
    enabled: false,
    staleTime: 0,
  });

  const isMatch =
    reconciliation != null &&
    Math.abs(reconciliation.amounts.discrepancy) < 1;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="h-5 w-5 text-blue-600" />
          Daily Reconciliation Report
        </CardTitle>
      </CardHeader>

      <CardContent>
        {/* ---- Controls ---- */}
        <div className="flex flex-wrap gap-4 items-end mb-6">
          <div>
            <label className="text-sm font-medium mb-1 block text-gray-700">
              Select Date
            </label>
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-48"
            />
          </div>
          <Button onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw
              className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`}
            />
            {isLoading ? 'Fetching…' : 'Generate Report'}
          </Button>
        </div>

        {/* ---- No data state ---- */}
        {!isLoading && !isFetched && (
          <p className="text-sm text-muted-foreground">
            Select a date and click "Generate Report" to view reconciliation data.
          </p>
        )}

        {/* ---- Loading state ---- */}
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Fetching data from all sources…
          </div>
        )}

        {/* ---- Results ---- */}
        {reconciliation && !isLoading && (
          <div className="space-y-6">

            {/* Status Banner */}
            <div
              className={`p-4 rounded-lg flex items-center gap-3 border ${
                isMatch
                  ? 'bg-green-50 border-green-200'
                  : 'bg-red-50 border-red-200'
              }`}
            >
              {isMatch ? (
                <>
                  <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0" />
                  <span className="text-green-700 font-semibold">
                    Reconciled — All amounts match for{' '}
                    {format(new Date(reconciliation.date), 'dd MMM yyyy')}
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-6 w-6 text-red-600 flex-shrink-0" />
                  <span className="text-red-700 font-semibold">
                    Discrepancy of{' '}
                    {INR(reconciliation.amounts.discrepancy)} found for{' '}
                    {format(new Date(reconciliation.date), 'dd MMM yyyy')}
                  </span>
                </>
              )}
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Cash Receipts */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Banknote className="h-4 w-4 text-green-600" />
                    <span className="text-sm text-muted-foreground">
                      Cash Receipts
                    </span>
                  </div>
                  <p className="text-xl font-bold">
                    {INR(reconciliation.amounts.cashVouchers)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {reconciliation.vouchers.cash} voucher
                    {reconciliation.vouchers.cash !== 1 ? 's' : ''}
                  </p>
                </CardContent>
              </Card>

              {/* Bank / Online */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CreditCard className="h-4 w-4 text-blue-600" />
                    <span className="text-sm text-muted-foreground">
                      Bank / Online
                    </span>
                  </div>
                  <p className="text-xl font-bold">
                    {INR(reconciliation.amounts.bankVouchers)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {reconciliation.vouchers.bank} voucher
                    {reconciliation.vouchers.bank !== 1 ? 's' : ''}
                  </p>
                </CardContent>
              </Card>

              {/* Total Collected */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <IndianRupee className="h-4 w-4 text-purple-600" />
                    <span className="text-sm text-muted-foreground">
                      Total Collected
                    </span>
                  </div>
                  <p className="text-xl font-bold">
                    {INR(reconciliation.amounts.totalCollected)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    All payment sources
                  </p>
                </CardContent>
              </Card>

              {/* Discrepancy */}
              <Card className={isMatch ? 'bg-green-50' : 'bg-red-50'}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    {isMatch ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                    )}
                    <span className="text-sm text-muted-foreground">
                      Discrepancy
                    </span>
                  </div>
                  <p
                    className={`text-xl font-bold ${
                      isMatch ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {INR(reconciliation.amounts.discrepancy)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {reconciliation.amounts.discrepancy > 0.99
                      ? 'Over-collected'
                      : reconciliation.amounts.discrepancy < -0.99
                      ? 'Under-vouchered'
                      : 'Matched'}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Detailed Breakdown Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Detailed Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="p-3 text-left font-semibold text-gray-600">
                          Source
                        </th>
                        <th className="p-3 text-right font-semibold text-gray-600">
                          Count
                        </th>
                        <th className="p-3 text-right font-semibold text-gray-600">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* ---- Collection sources ---- */}
                      <tr className="border-t">
                        <td className="p-3">Advance Payments</td>
                        <td className="p-3 text-right tabular-nums">
                          {reconciliation.details.advances}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {INR(reconciliation.amounts.advances)}
                        </td>
                      </tr>
                      <tr className="border-t">
                        <td className="p-3">Final Payments</td>
                        <td className="p-3 text-right tabular-nums">
                          {reconciliation.details.finalPayments}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {INR(reconciliation.amounts.finalPayments)}
                        </td>
                      </tr>
                      <tr className="border-t">
                        <td className="p-3">Pharmacy Sales</td>
                        <td className="p-3 text-right tabular-nums">
                          {reconciliation.details.pharmacySales}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {INR(reconciliation.amounts.pharmacy)}
                        </td>
                      </tr>
                      <tr className="border-t bg-blue-50 font-semibold">
                        <td className="p-3">Total Collected</td>
                        <td className="p-3 text-right tabular-nums">
                          {reconciliation.details.advances +
                            reconciliation.details.finalPayments +
                            reconciliation.details.pharmacySales}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {INR(reconciliation.amounts.totalCollected)}
                        </td>
                      </tr>

                      {/* ---- Voucher side ---- */}
                      <tr className="border-t-2 border-gray-300">
                        <td className="p-3 text-gray-500 text-xs" colSpan={3}>
                          Voucher Entries
                        </td>
                      </tr>
                      <tr className="border-t">
                        <td className="p-3">Receipt Vouchers (Cash)</td>
                        <td className="p-3 text-right tabular-nums">
                          {reconciliation.vouchers.cash}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {INR(reconciliation.amounts.cashVouchers)}
                        </td>
                      </tr>
                      <tr className="border-t">
                        <td className="p-3">Receipt Vouchers (Bank / Online)</td>
                        <td className="p-3 text-right tabular-nums">
                          {reconciliation.vouchers.bank}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {INR(reconciliation.amounts.bankVouchers)}
                        </td>
                      </tr>
                      <tr className="border-t bg-blue-50 font-semibold">
                        <td className="p-3">Total Vouchered</td>
                        <td className="p-3 text-right tabular-nums">
                          {reconciliation.vouchers.total}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {INR(reconciliation.amounts.totalVouchered)}
                        </td>
                      </tr>

                      {/* ---- Discrepancy row ---- */}
                      <tr
                        className={`border-t-2 border-gray-500 font-bold ${
                          isMatch ? 'bg-green-50' : 'bg-red-50'
                        }`}
                      >
                        <td className="p-3">Discrepancy</td>
                        <td className="p-3" />
                        <td
                          className={`p-3 text-right font-mono ${
                            isMatch ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {INR(reconciliation.amounts.discrepancy)}
                          {reconciliation.amounts.discrepancy > 0.99
                            ? ' (Over)'
                            : reconciliation.amounts.discrepancy < -0.99
                            ? ' (Under)'
                            : ' ✓'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default DailyReconciliation;
