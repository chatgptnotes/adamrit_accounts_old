import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from './fetchAllRows';
import { fetchActiveAccounts } from './fetchAccounts';

/** 1110 Cash in Hand — the only ledger this filter applies to. */
export const CASH_IN_HAND_CODE = '1110';

/**
 * Cash in Hand is meant to read as the cash box: patient receipts, counter
 * purchases and payment vouchers. Pharmacy sales reach it as `is_optional`
 * journal vouchers ("Optional JV - pharmacy sale BILL…"), which crowd the
 * ledger out even though they are genuinely cash-mode sales.
 *
 * The vouchers stay posted — this is a display filter. Row screens drop the
 * rows; balance screens subtract the net below. Trial Balance, Balance Sheet
 * and P&L deliberately keep reporting the posted figure, so 1110 reads higher
 * there than on the cash screens.
 */
export async function cashInHandAccountId(): Promise<string | null> {
  const accounts = await fetchActiveAccounts<{ id: string; account_code: string }>({
    columns: 'id, account_code',
    codePrefixes: [CASH_IN_HAND_CODE],
  });
  return accounts.find((a) => a.account_code === CASH_IN_HAND_CODE)?.id ?? null;
}

interface EntryRow {
  debit_amount: number | null;
  credit_amount: number | null;
}

/**
 * Net Dr−Cr of the optional (pharmacy-JV) entries on Cash in Hand for a date
 * window. Balance screens subtract this from the movement accountMovements()
 * reports for 1110.
 */
export async function cashInHandOptionalNet(opts: {
  from?: string;
  upto?: string;
  companyId?: string;
}): Promise<number> {
  const accountId = await cashInHandAccountId();
  if (!accountId) return 0;

  const rows = await fetchAllRows<EntryRow>((from, to) => {
    let query = supabase
      .from('voucher_entries')
      .select('debit_amount, credit_amount, voucher:vouchers!inner(voucher_date, status, is_optional, company_id)')
      .eq('account_id', accountId)
      .eq('voucher.status', 'AUTHORISED')
      .eq('voucher.is_optional', true);
    if (opts.from) query = query.gte('voucher.voucher_date', opts.from);
    if (opts.upto) query = query.lte('voucher.voucher_date', opts.upto);
    if (opts.companyId) query = query.eq('voucher.company_id', opts.companyId);
    return query.range(from, to) as unknown as PromiseLike<{ data: EntryRow[] | null; error: unknown }>;
  });

  return rows.reduce((sum, r) => sum + (Number(r.debit_amount) || 0) - (Number(r.credit_amount) || 0), 0);
}
