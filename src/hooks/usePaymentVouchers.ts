import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * A payment voucher row, scoped to a hospital.
 */
export interface PaymentVoucherRow {
  id: string;
  voucher_no: string;
  voucher_date: string;
  person_name: string;
  amount: number;
  purpose: string | null;
  narration: string | null;
  account_ledger_name: string | null;
  paid_by: string | null;
  hospital_type: string;
  payment_voucher_lines?: Array<{
    ledger_name: string;
    amount: number;
    line_order: number | null;
  }>;
}

/**
 * Cash-book / day-book entry built from a payment voucher. A voucher is cash paid
 * out of the drawer, so it lands on the Credit side (mirrors pharmacy refunds).
 */
export interface VoucherEntry {
  type: 'patient-summary';
  date: string;
  particulars: string;
  summary: string;
  debit: number;
  credit: number;
  patientId: undefined;
  visitId: undefined;
  patientName: string;
  transactionCount: number;
  transactionDate: string;
  paymentMode: string;
}

// Format an ISO date (YYYY-MM-DD) as DD/MM/YYYY, matching CashBook/DayBook rows.
const formatDMY = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

/**
 * Convert a payment voucher into a Credit row for the cash book / day book.
 */
export const voucherToEntry = (v: PaymentVoucherRow): VoucherEntry => {
  const amount = Number(v.amount) || 0;
  const lineNarration = (v.payment_voucher_lines || [])
    .slice()
    .sort((a, b) => (a.line_order || 0) - (b.line_order || 0))
    .map((line) => line.ledger_name)
    .filter(Boolean)
    .join(', ');
  const narration = (v.narration || v.purpose || lineNarration || '').trim();
  const narrationText = narration ? ` | ${narration}` : '';
  const person = v.person_name || 'Unknown';
  return {
    type: 'patient-summary',
    date: formatDMY(v.voucher_date),
    particulars: `${person} - Payment Voucher`,
    summary: `Payment Voucher ${v.voucher_no} | CASH: Rs ${amount.toLocaleString('en-IN')}${narrationText}`,
    debit: 0,
    credit: amount,
    patientId: undefined,
    visitId: undefined,
    patientName: person,
    transactionCount: 1,
    transactionDate: v.voucher_date,
    paymentMode: 'CASH',
  };
};

/**
 * Fetch payment vouchers for a date range, scoped to a hospital. Used by the
 * Cash Book and Day Book to auto-include vouchers as cash-out (Credit) entries.
 */
/**
 * Was this payment voucher actually paid OUT OF CASH?
 *
 * The Cash Book listed every payment voucher as a cash credit, whatever it was
 * paid with. P-Square Biomedical (PV1409, Rs 3,200, 18 Aug) was an online bank
 * payment and appeared as cash — it was the entire "Cr Rs 3,200" against DRM
 * Hope for that day.
 *
 * The paying ledger is recorded under three different spellings in live data —
 * "Cash", "Cash (HOPE)" and "cash in hand" — so the test is normalised rather
 * than an equality check. Anything mentioning a bank is excluded outright, so
 * "Cash at Bank" cannot slip through the prefix.
 *
 * A voucher with NO ledger recorded is NOT cash. 47 vouchers worth Rs 740,202
 * are in that state since the July cutover; counting them as cash overstates
 * the drawer by that much. They need a payment source recorded, not a guess.
 *
 * The DayBook deliberately does NOT use this: it shows every voucher whatever
 * it was paid with, which is the point of a day book.
 */
export const isCashPaymentVoucher = (v: { account_ledger_name?: string | null }): boolean => {
  const raw = (v.account_ledger_name || '').trim().toLowerCase();
  if (!raw) return false;
  if (raw.includes('bank')) return false;
  const normalised = raw.replace(/\(.*?\)/g, ' ').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalised === 'cash' || normalised.startsWith('cash in hand') || normalised.startsWith('cash ');
};

export const usePaymentVouchers = (fromDate: string, toDate: string, hospitalType?: string) => {
  return useQuery({
    queryKey: ['payment-vouchers-cashbook', fromDate, toDate, hospitalType],
    queryFn: async () => {
      let query = (supabase as any)
        .from('payment_vouchers')
        .select('id, voucher_no, voucher_date, person_name, amount, purpose, narration, account_ledger_name, paid_by, hospital_type, payment_voucher_lines(ledger_name, amount, line_order)')
        .gte('voucher_date', fromDate)
        .lte('voucher_date', toDate)
        .order('voucher_date', { ascending: false });

      if (hospitalType) {
        query = query.eq('hospital_type', hospitalType);
      }

      const { data, error } = await query;
      if (error) {
        console.error('Error fetching payment vouchers:', error);
        throw new Error(`Failed to fetch payment vouchers: ${error.message}`);
      }

      return (data ?? []) as PaymentVoucherRow[];
    },
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });
};
