import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from './fetchAllRows';
import { fetchActiveAccounts } from './fetchAccounts';

/** Cash-in-Hand (111x) and Bank (112x) ledgers — the ones this filter applies to. */
export const CASH_BANK_CODE_PREFIXES = ['111', '112'];

/**
 * The cash and bank ledgers are meant to read as the cash box and the bank
 * statements: patient receipts, counter purchases and payment vouchers, each
 * on the account that actually took the money. Pharmacy sales reach them as
 * `is_optional` journal vouchers ("Optional JV - pharmacy sale BILL…"), which
 * crowd those ledgers out.
 *
 * The vouchers stay posted — this is a display filter. Row screens drop the
 * rows; balance screens subtract the net below. Trial Balance, Balance Sheet
 * and P&L deliberately keep reporting the posted figures, so these ledgers
 * read higher there than on the cash/bank screens.
 */
export function isCashBankLedger(accountCode?: string | null): boolean {
  return !!accountCode && CASH_BANK_CODE_PREFIXES.some((prefix) => accountCode.startsWith(prefix));
}

interface EntryRow {
  account_id: string;
  debit_amount: number | null;
  credit_amount: number | null;
}

/**
 * Net Dr−Cr of the optional (pharmacy-JV) entries on each cash/bank ledger for
 * a date window. Balance screens subtract an account's entry from the movement
 * accountMovements() reports for it.
 */
export async function optionalNetByAccount(opts: {
  from?: string;
  upto?: string;
  companyId?: string;
}): Promise<Map<string, number>> {
  const net = new Map<string, number>();

  const accounts = await fetchActiveAccounts<{ id: string }>({
    columns: 'id, account_code',
    codePrefixes: CASH_BANK_CODE_PREFIXES,
    companyId: opts.companyId,
  });
  if (accounts.length === 0) return net;

  const rows = await fetchAllRows<EntryRow>((from, to) => {
    let query = supabase
      .from('voucher_entries')
      .select('account_id, debit_amount, credit_amount, voucher:vouchers!inner(voucher_date, status, is_optional, company_id)')
      .in('account_id', accounts.map((a) => a.id))
      .eq('voucher.status', 'AUTHORISED')
      .eq('voucher.is_optional', true);
    if (opts.from) query = query.gte('voucher.voucher_date', opts.from);
    if (opts.upto) query = query.lte('voucher.voucher_date', opts.upto);
    if (opts.companyId) query = query.eq('voucher.company_id', opts.companyId);
    return query.range(from, to) as unknown as PromiseLike<{ data: EntryRow[] | null; error: unknown }>;
  });

  for (const r of rows) {
    const value = (Number(r.debit_amount) || 0) - (Number(r.credit_amount) || 0);
    net.set(r.account_id, (net.get(r.account_id) ?? 0) + value);
  }
  return net;
}
