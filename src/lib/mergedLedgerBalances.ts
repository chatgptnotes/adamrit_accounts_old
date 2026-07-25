import { supabase } from '@/integrations/supabase/client';
import { accountMovements } from '@/lib/accountMovements';
import { fetchActiveAccounts } from '@/lib/fetchAccounts';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { normalizeName, resolveTallyCompanyIds } from '@/lib/tallyCompanyMatch';
import {
  headOfType,
  headOfTallyGroupChain,
  normalizeGroup,
  CREDIT_NATURE_HEADS,
  PL_HEADS,
  PNL_HEAD,
  PNL_LEDGER_NAME,
} from '@/components/accounting/tally/heads';

export type LedgerSource = 'adamrit' | 'tally';

/**
 * Where a ledger goes when its account_type / parent_group maps to no head.
 * Dropping it instead (the old behaviour) took it out of the grand totals too,
 * so the Trial Balance went out of balance with nothing on screen to explain
 * it. Suspense A/c is Tally's own home for an unclassified balance.
 */
const UNCLASSIFIED_HEAD = 'Suspense A/c';

export interface LedgerBalanceRow {
  name: string;
  /** One of HEAD_ORDER (shared with native Trial Balance). */
  head: string;
  /**
   * Tally's sub-group under the head — `parent_group` for Tally ledgers,
   * `account_group` for native ones. Lets a report show head → group → ledger
   * instead of dumping every ledger flat under the head.
   */
  group: string;
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
  account_group: string | null;
  opening_balance: number | null;
  opening_balance_type: string | null;
}

interface TallyLedgerRow {
  name: string;
  parent_group: string | null;
  closing_balance: number | null;
}

interface TallyGroupRow {
  name: string | null;
  parent_group: string | null;
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
/** "CURRENT_ASSETS" → "Current Assets", so a native account_type reads as a Tally group. */
const groupLabel = (accountType: string | null | undefined): string =>
  (accountType ?? '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

export async function mergedLedgerBalances(opts: {
  companyId?: string;
  from?: string;
  upto?: string;
}): Promise<LedgerBalanceRow[]> {
  // Paged — a plain select stops at 1000 rows and would understate every total.
  const [accounts, movements, tallyCompanyIds] = await Promise.all([
    fetchActiveAccounts<NativeAccount>({
      columns:
        'id, account_name, account_type, account_group, opening_balance, opening_balance_type',
      companyId: opts.companyId,
    }),
    accountMovements({ from: opts.from, upto: opts.upto, companyId: opts.companyId }),
    resolveTallyCompanyIds(opts.companyId),
  ]);

  const byName = new Map<string, LedgerBalanceRow>();

  // Adamrit rows first — Tally overwrites on name match below.
  for (const a of accounts) {
    // Tally's reserved Profit & Loss A/c is its own primary group, whatever
    // account_type it was filed under locally.
    const head =
      normalizeName(a.account_name) === PNL_LEDGER_NAME
        ? PNL_HEAD
        : headOfType(a.account_type) ?? UNCLASSIFIED_HEAD;
    // Revenue heads are nominal accounts: Tally closes them to Profit & Loss
    // A/c at year end, so they carry no opening balance and their figure is
    // period movement alone. The Tally masters importer seeds an opening for
    // income/expense ledgers too, and adding it here inflated every P&L line.
    const opening = PL_HEADS.has(head)
      ? 0
      : (Number(a.opening_balance) || 0) * (a.opening_balance_type?.toUpperCase() === 'CR' ? -1 : 1);
    const m = movements.get(a.id);
    const balance = opening + (m ? m.debit - m.credit : 0);
    if (Math.abs(balance) < 0.005) continue;
    byName.set(normalizeName(a.account_name), {
      name: a.account_name,
      head,
      // account_group carries the real Tally sub-group — 'Sundry Debtors',
      // 'CGHS', 'IPD Privite Pt' — while account_type is only ever the blunt
      // head ('ASSETS'). Reading the type alone collapsed every imported payer
      // ledger, and every patient ledger, into one flat Current Assets → Assets
      // bucket. Fall back to the type for rows that were saved without a group.
      group: a.account_group?.trim() || groupLabel(a.account_type) || head,
      balance,
      source: 'adamrit',
      accountId: a.id,
    });
  }

  // Tally rows (only when a paired Tally company exists). Page through all rows
  // via fetchAllRows so large companies are never silently truncated.
  if (tallyCompanyIds.length > 0) {
    const [tallyRows, groupRows] = await Promise.all([
      fetchAllRows<TallyLedgerRow>((from, to) =>
        (supabase as any)
          .from('tally_ledgers')
          .select('name, parent_group, closing_balance')
          .in('company_id', tallyCompanyIds)
          .range(from, to),
      ),
      // Tally's group tree, so a ledger under a company-created group ("RMO
      // Salary", "IPD Private Pt") still reaches the primary group it descends
      // from. These rows are not company-scoped in this database.
      fetchAllRows<TallyGroupRow>((from, to) =>
        (supabase as any).from('tally_groups').select('name, parent_group').range(from, to),
      ),
    ]);
    const groupParents = new Map<string, string>();
    for (const g of groupRows) {
      const key = normalizeGroup(g.name);
      if (key && g.parent_group) groupParents.set(key, g.parent_group);
    }
    for (const l of tallyRows) {
      const head =
        normalizeName(l.name) === PNL_LEDGER_NAME
          ? PNL_HEAD
          : headOfTallyGroupChain(l.parent_group, groupParents) ?? UNCLASSIFIED_HEAD;
      // NOTE: closing_balance is an undated snapshot from the last sync, so a
      // Tally-sourced row is never period-filtered — on a P&L it reports the
      // ledger's whole balance regardless of the report's from/upto.
      //
      // The sign of closing_balance is NOT the Dr/Cr side and must not be used
      // as one: checked against the live data, every nonzero Fixed Assets (69),
      // Cash-in-Hand (4), Deposits (Asset) (15) and Purchase Accounts (4) row
      // is negative, and those groups are all debit-nature. Take the magnitude
      // and derive the side from the head, as below.
      const mag = Math.abs(Number(l.closing_balance) || 0);
      if (mag < 0.005) continue;
      const balance = CREDIT_NATURE_HEADS.has(head) ? -mag : mag;
      byName.set(normalizeName(l.name), {
        name: l.name,
        head,
        group: l.parent_group?.trim() || head,
        balance,
        source: 'tally',
      });
    }
  }

  return [...byName.values()];
}
