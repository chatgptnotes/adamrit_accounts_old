import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { resolveTallyCompanyIds } from '@/lib/tallyCompanyMatch';

export interface MergedVoucherEntry {
  ledger: string;
  debit: number;
  credit: number;
}

export interface MergedVoucher {
  /** Stable row key: `tally:<id>` or `adamrit:<id>`. */
  id: string;
  /** Native voucher id for drill-down (alter); null for Tally-only rows. */
  nativeId: string | null;
  date: string;
  voucher_number: string;
  voucher_type: string;
  narration: string | null;
  total: number;
  entries: MergedVoucherEntry[];
  source: 'adamrit' | 'tally';
}

interface TallyVoucherRow {
  id: string;
  date: string | null;
  voucher_number: string | null;
  voucher_type: string | null;
  narration: string | null;
  amount: number | null;
  ledger_entries: { ledger?: string; amount?: number; is_debit?: boolean }[] | null;
}

/** Normalize a Tally mirror voucher into the shared report shape. */
export function normalizeTallyVoucher(v: TallyVoucherRow): MergedVoucher {
  const entries: MergedVoucherEntry[] = (Array.isArray(v.ledger_entries) ? v.ledger_entries : []).map((e) => {
    const amt = Math.abs(Number(e.amount) || 0);
    return { ledger: e.ledger || '', debit: e.is_debit ? amt : 0, credit: e.is_debit ? 0 : amt };
  });
  return {
    id: `tally:${v.id}`,
    nativeId: null,
    date: v.date || '',
    voucher_number: v.voucher_number || '',
    voucher_type: v.voucher_type || 'Voucher',
    narration: v.narration || null,
    total: Number(v.amount) || 0,
    entries,
    source: 'tally',
  };
}

/**
 * Fetch + normalize Tally mirror vouchers for the companies paired with a
 * native accounting company (all Tally companies when companyId is empty).
 * Returns [] when no Tally company pairs.
 */
export async function fetchTallyVouchers(opts: {
  companyId?: string;
  from?: string;
  upto?: string;
}): Promise<MergedVoucher[]> {
  const tallyCompanyIds = await resolveTallyCompanyIds(opts.companyId);
  if (tallyCompanyIds.length === 0) return [];

  // Page through all rows so large companies are never silently truncated.
  const data = await fetchAllRows<TallyVoucherRow>((from, to) => {
    let query = (supabase as any)
      .from('tally_vouchers')
      .select('id, date, voucher_number, voucher_type, narration, amount, ledger_entries')
      .in('company_id', tallyCompanyIds)
      .order('date', { ascending: true })
      .range(from, to);
    if (opts.from) query = query.gte('date', opts.from);
    if (opts.upto) query = query.lte('date', opts.upto);
    return query;
  });
  return data.map(normalizeTallyVoucher);
}

/**
 * One voucher number, however it happens to be written. The series has been issued
 * as REC-012932 and as REC12933, and Tally holds its own spelling of both, so the
 * separator and the zero padding cannot be part of the identity.
 */
export const normalizeVoucherNumber = (n: string | null | undefined): string =>
  (n ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]/g, '')
    .replace(/^([a-z]*)0+(\d)/, '$1$2');

/**
 * Tally-preferred dedup across an already-normalized voucher list: when a Tally
 * row and an Adamrit row share a (non-empty) voucher number, the Tally row wins.
 * Rows with no voucher number are always kept.
 */
export function dedupeVouchersTallyPreferred(rows: MergedVoucher[]): MergedVoucher[] {
  const byNumber = new Map<string, MergedVoucher>();
  const passthrough: MergedVoucher[] = [];
  for (const row of rows) {
    const key = normalizeVoucherNumber(row.voucher_number);
    if (!key) {
      passthrough.push(row);
      continue;
    }
    const existing = byNumber.get(key);
    if (!existing || row.source === 'tally') byNumber.set(key, row);
  }
  return [...byNumber.values(), ...passthrough];
}
