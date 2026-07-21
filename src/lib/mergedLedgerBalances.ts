import { supabase } from '@/integrations/supabase/client';
import { accountMovements } from '@/lib/accountMovements';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { normalizeName, resolveTallyCompanyIds } from '@/lib/tallyCompanyMatch';
import { headOfType, headOfTallyGroup, CREDIT_NATURE_HEADS } from '@/components/accounting/tally/heads';

export type LedgerSource = 'adamrit' | 'tally';

export interface LedgerBalanceRow {
  name: string;
  /** One of HEAD_ORDER (shared with native Trial Balance). */
  head: string;
  /** Signed balance, Debit positive / Credit negative. */
  balance: number;
  source: LedgerSource;
  /** Native chart_of_accounts id (for ledger drill-down); undefined for Tally rows. */
  accountId?: string;
}

interface NativeAccount {
  id: string;
  account_name: string;
  account_type: string;
  opening_balance: number | null;
  opening_balance_type: string | null;
}

interface TallyLedgerRow {
  name: string;
  parent_group: string | null;
  closing_balance: number | null;
}

/**
 * Unified, Tally-preferred ledger balances for the accounting reports.
 *
 * - Adamrit side: chart_of_accounts opening balance + AUTHORISED movements
 *   (same math the native Trial Balance uses), grouped via headOfType.
 * - Tally side: tally_ledgers.closing_balance for every paired Tally company,
 *   grouped via headOfTallyGroup. Tally stores a magnitude whose side is
 *   inferred from the head (liabilities/incomes → Credit, else Debit); flip
 *   the sign in one place here if a company's export differs.
 * - Merge: one row per ledger name; a Tally match overwrites the Adamrit row.
 *
 * `from`/`upto` bound the Adamrit movements. Tally rows are a snapshot from the
 * last sync and are not date-filtered.
 */
export async function mergedLedgerBalances(opts: {
  companyId?: string;
  from?: string;
  upto?: string;
}): Promise<LedgerBalanceRow[]> {
  const [accountsRes, movements, tallyCompanyIds] = await Promise.all([
    supabase
      .from('chart_of_accounts')
      .select('id, account_name, account_type, opening_balance, opening_balance_type')
      .eq('is_active', true)
      .order('account_code'),
    accountMovements({ from: opts.from, upto: opts.upto, companyId: opts.companyId }),
    resolveTallyCompanyIds(opts.companyId),
  ]);

  if (accountsRes.error) throw accountsRes.error;
  const accounts = (accountsRes.data ?? []) as NativeAccount[];

  const byName = new Map<string, LedgerBalanceRow>();

  // Adamrit rows first — Tally overwrites on name match below.
  for (const a of accounts) {
    const head = headOfType(a.account_type);
    if (!head) continue;
    const opening = (Number(a.opening_balance) || 0) * (a.opening_balance_type?.toUpperCase() === 'CR' ? -1 : 1);
    const m = movements.get(a.id);
    const balance = opening + (m ? m.debit - m.credit : 0);
    if (Math.abs(balance) < 0.005) continue;
    byName.set(normalizeName(a.account_name), { name: a.account_name, head, balance, source: 'adamrit', accountId: a.id });
  }

  // Tally rows (only when a paired Tally company exists). Page through all rows
  // via fetchAllRows so large companies are never silently truncated.
  if (tallyCompanyIds.length > 0) {
    const tallyRows = await fetchAllRows<TallyLedgerRow>((from, to) =>
      (supabase as any)
        .from('tally_ledgers')
        .select('name, parent_group, closing_balance')
        .in('company_id', tallyCompanyIds)
        .range(from, to),
    );
    for (const l of tallyRows) {
      const head = headOfTallyGroup(l.parent_group);
      if (!head) continue;
      const mag = Math.abs(Number(l.closing_balance) || 0);
      if (mag < 0.005) continue;
      const balance = CREDIT_NATURE_HEADS.has(head) ? -mag : mag;
      byName.set(normalizeName(l.name), { name: l.name, head, balance, source: 'tally' });
    }
  }

  return [...byName.values()];
}
