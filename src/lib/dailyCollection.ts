/**
 * What the hospital actually took in on one day.
 *
 * WHY THIS EXISTS
 * There was no way to ask "how much money came in today". The pieces existed —
 * Avani's tile counts one cash drawer, DailyReconciliation compares collections
 * against vouchers — but the plain question had no screen. DailyReconciliation
 * is also deliberately kept out of the menu until its day-by-day divergence
 * from the voucher side is explained, and its *collections* half should not
 * stay buried behind that unresolved comparison. This is that half, alone.
 *
 * THE DAY IS AN IST DAY, AND THE COLUMNS DISAGREE ABOUT TIME
 * advance_payment.payment_date and pharmacy_sales.sale_date are timestamptz;
 * final_payments.payment_date is a plain DATE. Asking for a UTC calendar day
 * would move every collection taken after 05:30 IST onto the wrong day — the
 * same class of bug as [discharge_date is a plain DATE]. So timestamptz columns
 * are bounded by the UTC instants of the IST day, and DATE columns are matched
 * with equality, which has no timezone to get wrong.
 *
 * RECEIVED IS NOT THE SAME AS BILLED
 * A pharmacy sale on CREDIT is a sale, not a collection — the money has not
 * arrived. On 15-Aug-2026 that was ₹25,985 of ₹37,292 of pharmacy activity.
 * Counting it as collection would overstate the day by more than double. Credit
 * is reported, clearly, on its own line and never inside the received total.
 *
 * REFUNDS COME OFF
 * advance_payment.is_refund marks money going back out. It is subtracted, not
 * hidden, so the net matches what the drawer and the bank actually saw.
 *
 * EVERY READ THROWS
 * Reading `(res.data ?? [])` is what let four rejected queries become four
 * empty lists and report a day as perfectly reconciled. A refused query here
 * fails loudly instead of quietly reporting a quiet day.
 */
import { supabase } from '@/integrations/supabase/client';

export type CollectionSource = 'advance' | 'final' | 'pharmacy';

export const SOURCE_LABEL: Record<CollectionSource, string> = {
  advance: 'Patient advances',
  final: 'Final payments',
  pharmacy: 'Pharmacy sales',
};

/** Modes that mean money actually arrived. Anything else is billed, not banked. */
const RECEIVED_MODES = new Set(['CASH', 'UPI', 'CARD', 'BANK', 'NEFT', 'RTGS', 'CHEQUE', 'DD', 'ONLINE']);

export const normaliseMode = (raw: string | null | undefined): string => {
  const m = String(raw ?? '').trim().toUpperCase();
  if (!m) return 'UNSPECIFIED';
  if (m === 'CREDIT') return 'CREDIT';
  return m;
};

export const isReceivedMode = (mode: string): boolean => RECEIVED_MODES.has(mode);

/**
 * The half-open UTC range covering one IST calendar day.
 * `2026-08-16` becomes [2026-08-15T18:30:00Z, 2026-08-16T18:30:00Z).
 */
export function istDayRangeUtc(date: string): { fromUtc: string; toUtc: string } {
  const start = new Date(`${date}T00:00:00+05:30`);
  if (Number.isNaN(start.getTime())) throw new Error(`Not a date: ${date}`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { fromUtc: start.toISOString(), toUtc: end.toISOString() };
}

export interface CollectionLine {
  source: CollectionSource;
  id: string;
  who: string | null;
  reference: string | null;
  mode: string;
  /** Negative for a refund. */
  amount: number;
  received: boolean;
  isRefund: boolean;
}

export interface ModeTotal {
  mode: string;
  amount: number;
  count: number;
}

export interface SourceTotal {
  source: CollectionSource;
  received: number;
  credit: number;
  refunds: number;
  count: number;
}

export interface DailyCollection {
  date: string;
  lines: CollectionLine[];
  byMode: ModeTotal[];
  bySource: SourceTotal[];
  /** Money in, net of refunds. The headline number. */
  receivedTotal: number;
  refundTotal: number;
  creditTotal: number;
}

const num = (v: unknown) => Number(v ?? 0) || 0;

export async function fetchDailyCollection(date: string): Promise<DailyCollection> {
  const { fromUtc, toUtc } = istDayRangeUtc(date);
  const db = supabase as any;

  // advance_payment — the table that actually carries hospital collections.
  const advances = await db
    .from('advance_payment')
    .select('id,patient_name,bill_no,visit_id,payment_mode,advance_amount,is_refund,payment_date')
    .gte('payment_date', fromUtc)
    .lt('payment_date', toUtc);
  if (advances.error) throw new Error(`advance_payment: ${advances.error.message}`);

  // final_payments — a plain DATE, so equality, no timezone to get wrong.
  const finals = await db
    .from('final_payments')
    .select('id,visit_id,mode_of_payment,amount,payment_date')
    .eq('payment_date', date);
  if (finals.error) throw new Error(`final_payments: ${finals.error.message}`);

  const pharmacy = await db
    .from('pharmacy_sales')
    .select('sale_id,bill_number,patient_name,payment_method,total_amount,sale_date,status')
    .gte('sale_date', fromUtc)
    .lt('sale_date', toUtc)
    .neq('status', 'cancelled');
  if (pharmacy.error) throw new Error(`pharmacy_sales: ${pharmacy.error.message}`);

  const lines: CollectionLine[] = [];

  for (const r of advances.data ?? []) {
    const mode = normaliseMode(r.payment_mode);
    const isRefund = Boolean(r.is_refund);
    lines.push({
      source: 'advance',
      id: String(r.id),
      who: r.patient_name ?? null,
      reference: r.bill_no ?? r.visit_id ?? null,
      mode,
      amount: isRefund ? -num(r.advance_amount) : num(r.advance_amount),
      received: isReceivedMode(mode),
      isRefund,
    });
  }

  for (const r of finals.data ?? []) {
    const mode = normaliseMode(r.mode_of_payment);
    lines.push({
      source: 'final',
      id: String(r.id),
      who: null,
      reference: r.visit_id ?? null,
      mode,
      amount: num(r.amount),
      received: isReceivedMode(mode),
      isRefund: false,
    });
  }

  for (const r of pharmacy.data ?? []) {
    const mode = normaliseMode(r.payment_method);
    lines.push({
      source: 'pharmacy',
      id: String(r.sale_id),
      who: r.patient_name ?? null,
      reference: r.bill_number ?? null,
      mode,
      amount: num(r.total_amount),
      received: isReceivedMode(mode),
      isRefund: false,
    });
  }

  const modeMap = new Map<string, ModeTotal>();
  const sourceMap = new Map<CollectionSource, SourceTotal>();
  let receivedTotal = 0;
  let refundTotal = 0;
  let creditTotal = 0;

  for (const l of lines) {
    let s = sourceMap.get(l.source);
    if (!s) {
      s = { source: l.source, received: 0, credit: 0, refunds: 0, count: 0 };
      sourceMap.set(l.source, s);
    }
    s.count += 1;

    if (l.isRefund) {
      refundTotal += -l.amount;
      s.refunds += -l.amount;
    }

    if (l.received) {
      receivedTotal += l.amount;
      s.received += l.amount;
      const m = modeMap.get(l.mode) ?? { mode: l.mode, amount: 0, count: 0 };
      m.amount += l.amount;
      m.count += 1;
      modeMap.set(l.mode, m);
    } else {
      creditTotal += l.amount;
      s.credit += l.amount;
    }
  }

  return {
    date,
    lines,
    byMode: [...modeMap.values()].sort((a, b) => b.amount - a.amount),
    bySource: [...sourceMap.values()].sort((a, b) => b.received - a.received),
    receivedTotal,
    refundTotal,
    creditTotal,
  };
}
