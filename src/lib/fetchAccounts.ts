import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from './fetchAllRows';

/**
 * Every ledger in chart_of_accounts, read the only way that is safe.
 *
 * Supabase enforces db-max-rows = 1000 server-side, so a plain select returns
 * the first 1000 rows and silently drops the rest — this project has 4,244
 * active ledgers. Paging through .range() windows (fetchAllRows) is the only
 * way past it; `limit` does not help.
 *
 * A ledger with no company_id is shared by every company, so scoping to a
 * company keeps those too — the same rule mergedLedgerBalances uses.
 */
export async function fetchActiveAccounts<T>(opts: {
  /** Columns to select, e.g. 'id, account_code, account_name' */
  columns: string;
  /** Restrict to this company's ledgers plus the shared ones */
  companyId?: string;
  /** Keep only these account_code prefixes, e.g. ['111', '112'] */
  codePrefixes?: string[];
  /** Include is_active = false rows (master-maintenance screens) */
  includeInactive?: boolean;
}): Promise<T[]> {
  return fetchAllRows<T>((from, to) => {
    let query = supabase.from('chart_of_accounts').select(opts.columns);
    if (!opts.includeInactive) query = query.eq('is_active', true);
    if (opts.companyId) {
      query = query.or(`company_id.eq.${opts.companyId},company_id.is.null`);
    }
    if (opts.codePrefixes?.length) {
      query = query.or(opts.codePrefixes.map((prefix) => `account_code.like.${prefix}%`).join(','));
    }
    return query.order('account_code').range(from, to) as unknown as PromiseLike<{
      data: T[] | null;
      error: unknown;
    }>;
  });
}
