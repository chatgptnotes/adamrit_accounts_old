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
  XCircle,
} from 'lucide-react';
import { format } from 'date-fns';

// ---------------------------------------------------------------------------
// What this screen answers
//
//   "Of the money the hospital took in on a given day, how much reached the
//    ledgers as a receipt voucher?"
//
// Collections come from three places (advances, final payments, pharmacy).
// The voucher side is the DEBIT on a cash or bank ledger of a receipt voucher —
// that is the money arriving, in double-entry terms.
//
// HISTORY. Every one of this screen's four queries used to be rejected by the
// database (advance_payment.amount, final_payments.payment_mode,
// pharmacy_sales.id and voucher_entries.amount do not exist), and the results
// were read as `(res.data ?? [])`. Four rejected reads became four empty lists,
// every total became zero, and zero-minus-zero reported the day as perfectly
// reconciled. The screen was never reachable from the menu, so nobody was
// misled — but the shape of the bug is the reason every read below throws.
//
// NOT SCOPED BY COMPANY, deliberately. advance_payment and final_payments carry
// no company column, so filtering the voucher side by company while the
// collection side stayed hospital-wide would invent a discrepancy that is not
// real. This compares like with like across the whole hospital.
// ---------------------------------------------------------------------------

interface SourceTotal {
  count: number;
  amount: number;
}

interface ModeRow {
  mode: string;
  count: number;
  amount: number;
}

interface LedgerRow {
  name: string;
  code: string;
  kind: 'Cash' | 'Bank';
  count: number;
  amount: number;
}

interface ReconciliationResult {
  date: string;
  collected: {
    advances: SourceTotal;
    refunds: SourceTotal;
    finalPayments: SourceTotal;
    pharmacy: SourceTotal;
    byMode: ModeRow[];
    total: number;
  };
  vouchered: {
    cash: SourceTotal;
    bank: SourceTotal;
    byLedger: LedgerRow[];
    total: number;
  };
  discrepancy: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INR = (amount: number) =>
  `₹${Math.abs(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const normaliseMode = (mode: unknown): string => {
  const text = String(mode ?? '').trim();
  if (!text) return 'Unspecified';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
};

/**
 * Which ledgers count as cash or bank.
 *
 * Same rule as CashBankBook.tsx, deliberately — two screens disagreeing about
 * what "cash" means is worse than either rule being imperfect. Tally-imported
 * banks carry TL... codes rather than 111x/112x, so the group name matters as
 * much as the code, and liabilities (overdrafts) are excluded.
 */
const classifyLedger = (account: {
  account_code?: string | null;
  account_group?: string | null;
  account_type?: string | null;
}): 'Cash' | 'Bank' | null => {
  const code = String(account?.account_code ?? '');
  const group = String(account?.account_group ?? '').toLowerCase();
  const type = String(account?.account_type ?? '').toUpperCase();
  if (type.includes('LIABILIT')) return null;
  if (code.startsWith('111') || group.includes('cash')) return 'Cash';
  if (code.startsWith('112') || group.includes('bank')) return 'Bank';
  return null;
};

const tally = (rows: { amount: number }[]): SourceTotal => ({
  count: rows.length,
  amount: rows.reduce((sum, r) => sum + r.amount, 0),
});

const groupByMode = (rows: { mode: string; amount: number }[]): ModeRow[] => {
  const map = new Map<string, ModeRow>();
  for (const row of rows) {
    const existing = map.get(row.mode) ?? { mode: row.mode, count: 0, amount: 0 };
    existing.count += 1;
    existing.amount += row.amount;
    map.set(row.mode, existing);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
};

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
    isError,
    error,
    refetch,
  } = useQuery<ReconciliationResult>({
    queryKey: ['daily-reconciliation', selectedDate],
    queryFn: async (): Promise<ReconciliationResult> => {
      // Collections are timestamps, so the day is bounded in local (IST) time.
      const startOfDay = new Date(`${selectedDate}T00:00:00`).toISOString();
      const endOfDay = new Date(`${selectedDate}T23:59:59.999`).toISOString();

      const [advanceRes, finalPayRes, pharmacyRes, voucherRes] = await Promise.all([
        supabase
          .from('advance_payment')
          .select('id, advance_amount, returned_amount, is_refund, payment_mode, patient_name')
          .gte('created_at', startOfDay)
          .lte('created_at', endOfDay),
        supabase
          .from('final_payments')
          .select('id, amount, mode_of_payment')
          .gte('created_at', startOfDay)
          .lte('created_at', endOfDay),
        supabase
          .from('pharmacy_sales')
          .select('sale_id, bill_number, total_amount, payment_method')
          .gte('created_at', startOfDay)
          .lte('created_at', endOfDay),
        // voucher_date is a plain DATE, so it is matched exactly — converting it
        // through a timezone would silently shift the day.
        supabase
          .from('voucher_entries')
          // One unbroken literal on purpose: check-accounting-schema.cjs replays
          // these strings against the live database, and it cannot evaluate a
          // concatenation. A select it cannot read is a select nothing verifies.
          .select(`
            id, debit_amount, credit_amount,
            voucher:vouchers!inner(id, voucher_number, voucher_date, status,
              voucher_type:voucher_types!inner(voucher_type_name, voucher_category)),
            account:chart_of_accounts!inner(account_name, account_code, account_group, account_type)
          `)
          .eq('voucher.voucher_date', selectedDate),
      ]);

      // A rejected read must never be mistaken for a quiet day. This is the
      // whole reason the screen used to report zero and call it reconciled.
      if (advanceRes.error) throw advanceRes.error;
      if (finalPayRes.error) throw finalPayRes.error;
      if (pharmacyRes.error) throw pharmacyRes.error;
      if (voucherRes.error) throw voucherRes.error;

      // ---- Collections --------------------------------------------------
      const advanceRows = (advanceRes.data ?? []) as any[];
      const takings = advanceRows
        .filter((r) => !r.is_refund)
        .map((r) => ({ amount: num(r.advance_amount), mode: normaliseMode(r.payment_mode) }));
      // Refunds are money going back out. Shown on their own line and netted
      // off, never quietly folded into takings.
      const refunds = advanceRows
        .filter((r) => r.is_refund)
        .map((r) => ({ amount: num(r.returned_amount) || num(r.advance_amount), mode: normaliseMode(r.payment_mode) }));

      const finalRows = ((finalPayRes.data ?? []) as any[]).map((r) => ({
        amount: num(r.amount),
        mode: normaliseMode(r.mode_of_payment),
      }));
      const pharmacyRows = ((pharmacyRes.data ?? []) as any[]).map((r) => ({
        amount: num(r.total_amount),
        mode: normaliseMode(r.payment_method),
      }));

      const advances = tally(takings);
      const refundTotal = tally(refunds);
      const finalPayments = tally(finalRows);
      const pharmacy = tally(pharmacyRows);
      const collectedTotal =
        advances.amount + finalPayments.amount + pharmacy.amount - refundTotal.amount;

      // ---- Voucher side --------------------------------------------------
      // A receipt voucher's DEBIT on a cash or bank ledger is the money in.
      // Restricting to receipts keeps contra entries (bank-to-cash transfers)
      // from being counted as fresh collections.
      const entries = (voucherRes.data ?? []) as any[];
      const receiptEntries = entries.filter((e) => {
        const category = String(e.voucher?.voucher_type?.voucher_category ?? '').toLowerCase();
        const name = String(e.voucher?.voucher_type?.voucher_type_name ?? '').toLowerCase();
        return category.includes('receipt') || name.includes('receipt');
      });

      const ledgerMap = new Map<string, LedgerRow>();
      let cashCount = 0;
      let cashAmount = 0;
      let bankCount = 0;
      let bankAmount = 0;

      for (const entry of receiptEntries) {
        const kind = classifyLedger(entry.account ?? {});
        if (!kind) continue;
        const amount = num(entry.debit_amount);
        if (amount === 0) continue;

        if (kind === 'Cash') {
          cashCount += 1;
          cashAmount += amount;
        } else {
          bankCount += 1;
          bankAmount += amount;
        }

        const name = String(entry.account?.account_name ?? 'Unnamed ledger');
        const existing = ledgerMap.get(name) ?? {
          name,
          code: String(entry.account?.account_code ?? ''),
          kind,
          count: 0,
          amount: 0,
        };
        existing.count += 1;
        existing.amount += amount;
        ledgerMap.set(name, existing);
      }

      const vouchered = cashAmount + bankAmount;

      return {
        date: selectedDate,
        collected: {
          advances,
          refunds: refundTotal,
          finalPayments,
          pharmacy,
          byMode: groupByMode([...takings, ...finalRows, ...pharmacyRows]),
          total: collectedTotal,
        },
        vouchered: {
          cash: { count: cashCount, amount: cashAmount },
          bank: { count: bankCount, amount: bankAmount },
          byLedger: [...ledgerMap.values()].sort((a, b) => b.amount - a.amount),
          total: vouchered,
        },
        discrepancy: collectedTotal - vouchered,
      };
    },
    // Do not auto-fetch on mount; user clicks "Generate Report".
    enabled: false,
    staleTime: 0,
    retry: false,
  });

  const isMatch =
    reconciliation != null && Math.abs(reconciliation.discrepancy) < 1;

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

        {/* ---- Failure state. Never show zeros when a read failed. ---- */}
        {isError && !isLoading && (
          <div className="p-4 rounded-lg border bg-red-50 border-red-200 flex items-start gap-3">
            <XCircle className="h-6 w-6 text-red-600 flex-shrink-0" />
            <div>
              <p className="text-red-700 font-semibold">
                Could not build the reconciliation — no figures are shown.
              </p>
              <p className="text-sm text-red-600 mt-1">
                {(error as any)?.message ?? 'The database rejected one of the reads.'}
              </p>
              <p className="text-xs text-red-500 mt-2">
                This is deliberately an error rather than a zero: a failed read must
                never look like a day with no money in it.
              </p>
            </div>
          </div>
        )}

        {/* ---- Results ---- */}
        {reconciliation && !isLoading && !isError && (
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
                    Reconciled — collections and receipt vouchers agree for{' '}
                    {format(new Date(reconciliation.date), 'dd MMM yyyy')}
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-6 w-6 text-red-600 flex-shrink-0" />
                  <span className="text-red-700 font-semibold">
                    Discrepancy of {INR(reconciliation.discrepancy)} for{' '}
                    {format(new Date(reconciliation.date), 'dd MMM yyyy')}
                  </span>
                </>
              )}
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Banknote className="h-4 w-4 text-green-600" />
                    <span className="text-sm text-muted-foreground">Cash Receipts</span>
                  </div>
                  <p className="text-xl font-bold">
                    {INR(reconciliation.vouchered.cash.amount)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {reconciliation.vouchered.cash.count} entr
                    {reconciliation.vouchered.cash.count === 1 ? 'y' : 'ies'}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CreditCard className="h-4 w-4 text-blue-600" />
                    <span className="text-sm text-muted-foreground">Bank / Online</span>
                  </div>
                  <p className="text-xl font-bold">
                    {INR(reconciliation.vouchered.bank.amount)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {reconciliation.vouchered.bank.count} entr
                    {reconciliation.vouchered.bank.count === 1 ? 'y' : 'ies'}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <IndianRupee className="h-4 w-4 text-purple-600" />
                    <span className="text-sm text-muted-foreground">Total Collected</span>
                  </div>
                  <p className="text-xl font-bold">
                    {INR(reconciliation.collected.total)}
                  </p>
                  <p className="text-xs text-muted-foreground">Net of refunds</p>
                </CardContent>
              </Card>

              <Card className={isMatch ? 'bg-green-50' : 'bg-red-50'}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    {isMatch ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                    )}
                    <span className="text-sm text-muted-foreground">Discrepancy</span>
                  </div>
                  <p
                    className={`text-xl font-bold ${
                      isMatch ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {INR(reconciliation.discrepancy)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {reconciliation.discrepancy > 0.99
                      ? 'Collected but not vouchered'
                      : reconciliation.discrepancy < -0.99
                      ? 'Vouchered but not collected'
                      : 'Matched'}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Source breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Where the money came from</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="p-3 text-left font-semibold text-gray-600">Source</th>
                        <th className="p-3 text-right font-semibold text-gray-600">Count</th>
                        <th className="p-3 text-right font-semibold text-gray-600">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t">
                        <td className="p-3">Advance Payments</td>
                        <td className="p-3 text-right tabular-nums">
                          {reconciliation.collected.advances.count}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {INR(reconciliation.collected.advances.amount)}
                        </td>
                      </tr>
                      <tr className="border-t">
                        <td className="p-3">Final Payments</td>
                        <td className="p-3 text-right tabular-nums">
                          {reconciliation.collected.finalPayments.count}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {INR(reconciliation.collected.finalPayments.amount)}
                        </td>
                      </tr>
                      <tr className="border-t">
                        <td className="p-3">Pharmacy Sales</td>
                        <td className="p-3 text-right tabular-nums">
                          {reconciliation.collected.pharmacy.count}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {INR(reconciliation.collected.pharmacy.amount)}
                        </td>
                      </tr>
                      {reconciliation.collected.refunds.count > 0 && (
                        <tr className="border-t text-red-700">
                          <td className="p-3">Refunds paid out</td>
                          <td className="p-3 text-right tabular-nums">
                            {reconciliation.collected.refunds.count}
                          </td>
                          <td className="p-3 text-right font-mono">
                            −{INR(reconciliation.collected.refunds.amount)}
                          </td>
                        </tr>
                      )}
                      <tr className="border-t bg-blue-50 font-semibold">
                        <td className="p-3">Total Collected</td>
                        <td className="p-3" />
                        <td className="p-3 text-right font-mono">
                          {INR(reconciliation.collected.total)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Payment mode breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">How it was paid</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="p-3 text-left font-semibold text-gray-600">Payment mode</th>
                        <th className="p-3 text-right font-semibold text-gray-600">Count</th>
                        <th className="p-3 text-right font-semibold text-gray-600">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconciliation.collected.byMode.length === 0 && (
                        <tr className="border-t">
                          <td className="p-3 text-muted-foreground" colSpan={3}>
                            No collections recorded for this date.
                          </td>
                        </tr>
                      )}
                      {reconciliation.collected.byMode.map((row) => (
                        <tr className="border-t" key={row.mode}>
                          <td className="p-3">{row.mode}</td>
                          <td className="p-3 text-right tabular-nums">{row.count}</td>
                          <td className="p-3 text-right font-mono">{INR(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Ledger drill-down */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Which ledgers the receipts landed in
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="p-3 text-left font-semibold text-gray-600">Ledger</th>
                        <th className="p-3 text-left font-semibold text-gray-600">Code</th>
                        <th className="p-3 text-left font-semibold text-gray-600">Type</th>
                        <th className="p-3 text-right font-semibold text-gray-600">Entries</th>
                        <th className="p-3 text-right font-semibold text-gray-600">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reconciliation.vouchered.byLedger.length === 0 && (
                        <tr className="border-t">
                          <td className="p-3 text-muted-foreground" colSpan={5}>
                            No receipt vouchers hit a cash or bank ledger on this date.
                          </td>
                        </tr>
                      )}
                      {reconciliation.vouchered.byLedger.map((row) => (
                        <tr className="border-t" key={row.name}>
                          <td className="p-3">{row.name}</td>
                          <td className="p-3 text-muted-foreground">{row.code}</td>
                          <td className="p-3">{row.kind}</td>
                          <td className="p-3 text-right tabular-nums">{row.count}</td>
                          <td className="p-3 text-right font-mono">{INR(row.amount)}</td>
                        </tr>
                      ))}
                      <tr className="border-t bg-blue-50 font-semibold">
                        <td className="p-3" colSpan={3}>Total Vouchered</td>
                        <td className="p-3 text-right tabular-nums">
                          {reconciliation.vouchered.cash.count +
                            reconciliation.vouchered.bank.count}
                        </td>
                        <td className="p-3 text-right font-mono">
                          {INR(reconciliation.vouchered.total)}
                        </td>
                      </tr>
                      <tr
                        className={`border-t-2 border-gray-500 font-bold ${
                          isMatch ? 'bg-green-50' : 'bg-red-50'
                        }`}
                      >
                        <td className="p-3" colSpan={4}>
                          Discrepancy (collected − vouchered)
                        </td>
                        <td
                          className={`p-3 text-right font-mono ${
                            isMatch ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {INR(reconciliation.discrepancy)}
                          {reconciliation.discrepancy > 0.99
                            ? ' (Over)'
                            : reconciliation.discrepancy < -0.99
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
