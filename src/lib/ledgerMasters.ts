/**
 * Writing a ledger master into chart_of_accounts.
 *
 * The counterpart of `src/components/accounting/tally/heads.ts`, which reads the
 * other way (account_type -> the Tally head a report groups it under). This file
 * is the write side: the group a user picked -> account_type, and a ledger name
 * -> account_code.
 */

/** The 13 values chart_of_accounts.account_type's CHECK constraint allows. */
export const ACCOUNT_TYPES = [
  'ASSETS',
  'CURRENT_ASSETS',
  'FIXED_ASSETS',
  'LIABILITIES',
  'CURRENT_LIABILITIES',
  'LONG_TERM_LIABILITIES',
  'EQUITY',
  'INCOME',
  'DIRECT_INCOME',
  'INDIRECT_INCOME',
  'EXPENSES',
  'DIRECT_EXPENSES',
  'INDIRECT_EXPENSES',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const DEFAULT_ACCOUNT_TYPE: AccountType = 'CURRENT_ASSETS';

const ACCOUNT_TYPE_SET = new Set<string>(ACCOUNT_TYPES);

export const isAccountType = (value: string | null | undefined): value is AccountType =>
  !!value && ACCOUNT_TYPE_SET.has(value);

/**
 * chart_of_accounts.account_code for a ledger — FNV-1a over the name, prefixed
 * with the company.
 *
 * Byte-identical to tallyChartAccountCode() in
 * scripts/import-tally-masters-json.js and supabase/functions/tally-proxy so a
 * hand-created ledger carries the same code shape as an imported one. 15 chars
 * ('TL' + 6 + 7), inside account_code's VARCHAR(20), and company-scoped by
 * construction so the same ledger name in two companies never collides.
 */
export function tallyChartAccountCode(companyId: string, ledgerName: string): string {
  let hash = 2166136261;
  for (const char of ledgerName) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `TL${companyId.replace(/-/g, '').slice(0, 6)}${(hash >>> 0).toString(36).padStart(7, '0').slice(-7)}`;
}

/**
 * The code to try on attempt `n` after a unique violation on the one before.
 * A 32-bit hash over a few thousand names collides rarely but not never, and a
 * collision would otherwise surface as an unexplained save failure. Attempt 0
 * is the base code; later attempts append a suffix, staying within VARCHAR(20).
 */
export function accountCodeAttempt(base: string, attempt: number): string {
  return attempt === 0 ? base : `${base}${attempt.toString(36)}`;
}

/**
 * The key two account names are compared on — parity with nameKey() in
 * scripts/import-tally-masters-json.js, so the form's duplicate check refuses
 * exactly the names the Tally importer would treat as already present.
 */
export const normalizeAccountName = (name: string | null | undefined): string =>
  (name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The same normalization the group heads use, so group names compare loosely. */
export const normalizeGroupName = (group: string | null | undefined): string =>
  (group ?? '').replace(/&amp;/gi, '&').replace(/-/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * One group name -> account_type, following the rules the Tally masters import
 * uses (scripts/import-tally-masters-json.js: matchAccountType).
 *
 * Two deliberate differences from that script:
 *  - `indirect` is tested before `direct`. "indirect expenses".includes('direct')
 *    is true, so the importer typed Tally's Indirect Expenses group as
 *    DIRECT_EXPENSES — the reason the Trial Balance's Direct Expenses line
 *    carries the indirect ones. heads.ts:19-25 guards the same ordering trap.
 *  - the misspellings this hospital's groups actually use ("Expences",
 *    "Expance") are matched; a miss would fall through to Current Assets and
 *    file an expense ledger on the balance sheet.
 */
export function matchAccountType(groupName: string | null | undefined): AccountType | null {
  const group = normalizeGroupName(groupName);
  if (!group) return null;

  // Tally marks asset-side groups with a bracketed "(Asset)" suffix — "Loans &
  // Advances (Asset)", "Deposits (Asset)", "Misc. Expenses (ASSET)". Tested
  // first, or "Loans & Advances (Asset)" reads as a liability. The bracketed
  // form is deliberate: "SALARY ADVANCE" is a Current Liabilities group.
  if (group.includes('(asset)')) return 'CURRENT_ASSETS';
  if (group.includes('bank') || group.includes('cash') || group.includes('debtor') || group.includes('stock')) {
    return 'CURRENT_ASSETS';
  }
  if (group.includes('fixed asset')) return 'FIXED_ASSETS';
  if (group.includes('loan')) return 'LONG_TERM_LIABILITIES';
  if (group.includes('creditor') || group.includes('dutie') || group.includes('liabilit')) {
    return 'CURRENT_LIABILITIES';
  }
  if (group.includes('capital') || group.includes('reserve')) return 'EQUITY';
  if (group.includes('income') || group.includes('sale')) {
    return group.includes('indirect') ? 'INDIRECT_INCOME' : group.includes('direct') ? 'DIRECT_INCOME' : 'INDIRECT_INCOME';
  }
  if (
    group.includes('expense') ||
    group.includes('expence') ||
    group.includes('expance') ||
    group.includes('purchase')
  ) {
    return group.includes('indirect')
      ? 'INDIRECT_EXPENSES'
      : group.includes('direct')
        ? 'DIRECT_EXPENSES'
        : 'INDIRECT_EXPENSES';
  }
  return null;
}

/** ledger_groups.group_type, the last resort before the blanket default. */
const TYPE_OF_GROUP_TYPE: Record<string, AccountType> = {
  assets: 'CURRENT_ASSETS',
  liabilities: 'CURRENT_LIABILITIES',
  income: 'INDIRECT_INCOME',
  expenses: 'INDIRECT_EXPENSES',
};

export interface DerivedAccountType {
  type: AccountType;
  /** Which rule produced it — a 'default' outcome is visibly a guess. */
  derivedFrom: 'siblings' | 'rule' | 'group_type' | 'default';
  /** The group whose name matched, when derivedFrom is 'rule'. */
  matchedGroup: string | null;
}

/**
 * Walk a group chain [group, parent, grandparent, …] until a name matches.
 *
 * Most ledgers sit under groups the hospital created — "Consultant", "RMO
 * Salary", "IPD Privite Pt" — that match no rule; Tally files them under
 * whichever predefined group they descend from, and so do we.
 */
export function accountTypeForGroupChain(
  chain: readonly (string | null | undefined)[],
  groupType?: string | null,
): DerivedAccountType {
  for (const group of chain) {
    const type = matchAccountType(group);
    if (type) return { type, derivedFrom: 'rule', matchedGroup: (group ?? '').trim() || null };
  }
  const fromGroupType = TYPE_OF_GROUP_TYPE[(groupType ?? '').trim().toLowerCase()];
  if (fromGroupType) return { type: fromGroupType, derivedFrom: 'group_type', matchedGroup: null };
  return { type: DEFAULT_ACCOUNT_TYPE, derivedFrom: 'default', matchedGroup: null };
}

/**
 * The account_type most of this group's existing ledgers already carry.
 *
 * Preferred over the name rules: the point of creating a ledger under a group
 * is that it reports where its siblings do, and the siblings are the ground
 * truth — including where a past import typed them in a way the rules would
 * not reproduce.
 */
export function accountTypeFromSiblings(
  groupName: string | null | undefined,
  accounts: readonly { account_group: string | null; account_type: string }[],
): { type: AccountType; siblings: number } | null {
  const key = normalizeGroupName(groupName);
  if (!key) return null;

  const counts = new Map<AccountType, number>();
  for (const account of accounts) {
    if (normalizeGroupName(account.account_group) !== key) continue;
    if (!isAccountType(account.account_type)) continue;
    counts.set(account.account_type, (counts.get(account.account_type) ?? 0) + 1);
  }

  let best: { type: AccountType; siblings: number } | null = null;
  for (const [type, siblings] of counts) {
    if (!best || siblings > best.siblings) best = { type, siblings };
  }
  return best;
}
