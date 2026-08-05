import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from './fetchAllRows';

export interface Movement {
  debit: number;
  credit: number;
}

/**
 * Per-account AUTHORISED debit/credit totals for a date window, aggregated
 * in the database via the account_movements() function (instant). Falls back
 * to paging voucher_entries client-side if the function isn't deployed yet.
 */
export async function accountMovements(opts: {
  from?: string;
  upto?: string;
  companyId?: string;
}): Promise<Map<string, Movement>> {
  const map = new Map<string, Movement>();

  const { data, error } = await (supabase as any).rpc('account_movements', {
    p_from: opts.from ?? null,
    p_upto: opts.upto ?? null,
    p_company: opts.companyId || null,
  });

  if (!error) {
    for (const r of (data ?? []) as { account_id: string; total_debit: number; total_credit: number }[]) {
      map.set(r.account_id, { debit: Number(r.total_debit) || 0, credit: Number(r.total_credit) || 0 });
    }
    return map;
  }

  console.warn('account_movements RPC unavailable, falling back to paged fetch:', error.message);
  const rows = await fetchAllRows((from, to) => {
    let query = (supabase as any)
      .from('voucher_entries')
      .select('account_id, debit_amount, credit_amount, voucher:vouchers!inner(voucher_date, status, company_id, is_optional)')
      .eq('voucher.status', 'AUTHORISED')
      // Tally semantics: optional vouchers never move the books.
      .eq('voucher.is_optional', false);
    if (opts.from) query = query.gte('voucher.voucher_date', opts.from);
    if (opts.upto) query = query.lte('voucher.voucher_date', opts.upto);
    if (opts.companyId) query = query.eq('voucher.company_id', opts.companyId);
    return query.range(from, to);
  });
  for (const r of rows as any[]) {
    const m = map.get(r.account_id) ?? { debit: 0, credit: 0 };
    m.debit += Number(r.debit_amount) || 0;
    m.credit += Number(r.credit_amount) || 0;
    map.set(r.account_id, m);
  }
  return map;
}
