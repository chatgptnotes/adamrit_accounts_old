// Tally's primary group heads, mapped from chart_of_accounts.account_type.
// Shared by Trial Balance and Group Summary so drill-down stays consistent.

// Order matters: the first matching rule wins, so the specific heads sit above
// the catch-all `includes('ASSET')` / `includes('EXPENSE')` rules.
export const HEAD_OF: { match: (t: string) => boolean; head: string }[] = [
  { match: (t) => t === 'EQUITY', head: 'Capital Account' },
  { match: (t) => t === 'LONG_TERM_LIABILITIES', head: 'Loans (Liability)' },
  { match: (t) => t.includes('LIABILIT'), head: 'Current Liabilities' },
  { match: (t) => t === 'FIXED_ASSETS', head: 'Fixed Assets' },
  { match: (t) => t.includes('INVESTMENT'), head: 'Investments' },
  { match: (t) => t.includes('SUSPENSE'), head: 'Suspense A/c' },
  { match: (t) => t.includes('BRANCH') || t.includes('DIVISION'), head: 'Branch / Divisions' },
  { match: (t) => t.includes('MISC'), head: 'Misc. Expenses (ASSET)' },
  { match: (t) => t.includes('LOAN') && t.includes('ADVANCE'), head: 'Loans & Advances (Asset)' },
  { match: (t) => t.includes('ASSET'), head: 'Current Assets' },
  // INDIRECT_* must be tested before DIRECT_* — "INDIRECT_INCOME" contains
  // "DIRECT_INCOME", so the specific rule is unreachable if it comes second.
  { match: (t) => t.includes('INDIRECT_INCOME'), head: 'Indirect Incomes' },
  { match: (t) => t.includes('DIRECT_INCOME'), head: 'Direct Incomes' },
  { match: (t) => t.includes('INCOME') || t.includes('SALES'), head: 'Sales Accounts' },
  { match: (t) => t.includes('PURCHASE'), head: 'Purchase Accounts' },
  { match: (t) => t.includes('INDIRECT_EXPENSE'), head: 'Indirect Expenses' },
  // Unclassified 'EXPENSES' still lands here, as it always has.
  { match: (t) => t.includes('EXPENSE'), head: 'Direct Expenses' },
];

/**
 * Tally's primary groups, in the order Tally lists them. Liabilities and
 * assets first (Balance Sheet order), then the revenue groups (P&L order).
 * A head no ledger falls into is simply not rendered.
 */
export const HEAD_ORDER = [
  'Capital Account',
  'Profit & Loss A/c',
  'Loans (Liability)',
  'Current Liabilities',
  'Fixed Assets',
  'Investments',
  'Current Assets',
  'Loans & Advances (Asset)',
  'Misc. Expenses (ASSET)',
  'Branch / Divisions',
  'Suspense A/c',
  'Sales Accounts',
  'Direct Incomes',
  'Indirect Incomes',
  'Purchase Accounts',
  'Direct Expenses',
  'Indirect Expenses',
];

/** The Balance Sheet's two sides, in Tally's order. */
export const LIABILITY_HEADS = [
  'Capital Account',
  'Loans (Liability)',
  'Current Liabilities',
  'Branch / Divisions',
  'Suspense A/c',
];

/**
 * Tally's one reserved ledger. It is NOT a Capital Account member — Tally
 * gives it a primary group of its own and prints it as a separate line on
 * both the Trial Balance and the Balance Sheet. Verified against live Tally:
 * Capital Account 8,09,55,539.12 Cr and Profit & Loss A/c 4,12,88,217.43 Cr
 * are two rows, where this module was reporting their sum as Capital Account.
 */
export const PNL_LEDGER_NAME = 'profit & loss a/c';
export const PNL_HEAD = 'Profit & Loss A/c';

export const ASSET_HEADS = [
  'Fixed Assets',
  'Investments',
  'Current Assets',
  'Loans & Advances (Asset)',
  'Misc. Expenses (ASSET)',
];

/** The Profit & Loss heads, split into Tally's Trading and Income sections. */
export const TRADING_EXPENSE_HEADS = ['Purchase Accounts', 'Direct Expenses'];
export const TRADING_INCOME_HEADS = ['Sales Accounts', 'Direct Incomes'];
export const PL_EXPENSE_HEADS = ['Indirect Expenses'];
export const PL_INCOME_HEADS = ['Indirect Incomes'];

/**
 * Every revenue head — Tally's nominal accounts.
 *
 * These carry NO opening balance: Tally closes them to Profit & Loss A/c at
 * year end, so a new year starts them at zero and their reported figure is
 * pure period movement. Verified against the live server, whose Sales Accounts
 * figure is the period's sales alone.
 */
export const PL_HEADS = new Set([
  ...TRADING_INCOME_HEADS,
  ...TRADING_EXPENSE_HEADS,
  ...PL_INCOME_HEADS,
  ...PL_EXPENSE_HEADS,
]);

export const headOfType = (accountType: string | null | undefined): string | null =>
  HEAD_OF.find((h) => h.match((accountType ?? '').toUpperCase()))?.head ?? null;

// Tally ledgers carry a `parent_group` string (Tally's primary group) instead
// of an account_type. Map those onto the SAME HEAD_ORDER buckets so merged
// rows group identically to native accounts.
//
// Tally's 28 predefined groups are matched by name first — the loose
// `includes()` table below is only a fallback for groups a company created
// itself, and substring matching gets these wrong: "Stock-in-Hand" and
// "Reserves & Surplus" match no rule at all, "Bank OD A/c" matches 'bank' and
// lands in Current Assets when it is a liability, and "Capital Work in
// Progress" matches 'capital'. Keys are normalized the way `headOfTallyGroup`
// normalizes: lowercased, hyphens as spaces, trimmed.
const PREDEFINED_TALLY_GROUP_HEADS: Record<string, string> = {
  // Tally's 15 primary groups
  'capital account': 'Capital Account',
  'loans (liability)': 'Loans (Liability)',
  'current liabilities': 'Current Liabilities',
  'branch / divisions': 'Branch / Divisions',
  'suspense a/c': 'Suspense A/c',
  'fixed assets': 'Fixed Assets',
  investments: 'Investments',
  'current assets': 'Current Assets',
  'misc. expenses (asset)': 'Misc. Expenses (ASSET)',
  'sales accounts': 'Sales Accounts',
  'direct incomes': 'Direct Incomes',
  'indirect incomes': 'Indirect Incomes',
  'purchase accounts': 'Purchase Accounts',
  'direct expenses': 'Direct Expenses',
  'indirect expenses': 'Indirect Expenses',
  // Tally's 13 predefined sub-groups, rolled up to the primary group they sit
  // under. `Loans & Advances (Asset)` is a head of its own in HEAD_ORDER.
  'reserves & surplus': 'Capital Account',
  'retained earnings': 'Capital Account',
  'bank od a/c': 'Loans (Liability)',
  'bank occ a/c': 'Loans (Liability)',
  'secured loans': 'Loans (Liability)',
  'unsecured loans': 'Loans (Liability)',
  'duties & taxes': 'Current Liabilities',
  provisions: 'Current Liabilities',
  'sundry creditors': 'Current Liabilities',
  'bank accounts': 'Current Assets',
  'cash in hand': 'Current Assets',
  'deposits (asset)': 'Current Assets',
  'loans & advances (asset)': 'Loans & Advances (Asset)',
  'stock in hand': 'Current Assets',
  'sundry debtors': 'Current Assets',
};

// Fallback for company-created groups. Order matters: the `indirect` rules sit
// above the `direct` ones because "indirect expenses" contains "direct exp".
const TALLY_GROUP_HEADS: { match: (g: string) => boolean; head: string }[] = [
  { match: (g) => g.includes('capital'), head: 'Capital Account' },
  { match: (g) => g.includes('loans (asset') || (g.includes('loan') && g.includes('advance')), head: 'Loans & Advances (Asset)' },
  { match: (g) => g.includes('loan'), head: 'Loans (Liability)' },
  { match: (g) => g.includes('creditor') || g.includes('duties') || g.includes('provision') || g.includes('current liab'), head: 'Current Liabilities' },
  { match: (g) => g.includes('fixed asset'), head: 'Fixed Assets' },
  { match: (g) => g.includes('investment'), head: 'Investments' },
  { match: (g) => g.includes('misc'), head: 'Misc. Expenses (ASSET)' },
  { match: (g) => g.includes('branch') || g.includes('division'), head: 'Branch / Divisions' },
  { match: (g) => g.includes('suspense'), head: 'Suspense A/c' },
  { match: (g) => g.includes('debtor') || g.includes('bank') || g.includes('cash') || g.includes('current asset') || g.includes('deposit') || g.includes('advance'), head: 'Current Assets' },
  { match: (g) => g.includes('stock'), head: 'Current Assets' },
  { match: (g) => g.includes('purchase'), head: 'Purchase Accounts' },
  { match: (g) => g.includes('indirect exp'), head: 'Indirect Expenses' },
  { match: (g) => g.includes('direct exp'), head: 'Direct Expenses' },
  { match: (g) => g.includes('indirect inc'), head: 'Indirect Incomes' },
  { match: (g) => g.includes('direct inc'), head: 'Direct Incomes' },
  { match: (g) => g.includes('sales'), head: 'Sales Accounts' },
];

// Tally's XML arrives HTML-escaped and is stored that way, so the synced group
// is "Duties &amp; Taxes" rather than "Duties & Taxes". Undo that before
// matching, otherwise every predefined name containing an ampersand misses the
// table above.
export const normalizeGroup = (group: string | null | undefined): string =>
  (group ?? '')
    .replace(/&amp;/gi, '&')
    .toLowerCase()
    .replace(/-/g, ' ')
    .trim();

export const headOfTallyGroup = (parentGroup: string | null | undefined): string | null => {
  const g = normalizeGroup(parentGroup);
  if (!g) return null;
  return PREDEFINED_TALLY_GROUP_HEADS[g] ?? TALLY_GROUP_HEADS.find((h) => h.match(g))?.head ?? null;
};

/**
 * The head for a Tally group, following `tally_groups.parent_group` upwards
 * when the group itself is one the company created.
 *
 * Most ledgers in a real Tally company sit under custom groups — "Consultant",
 * "RMO Salary", "IPD Private Pt" — that match no rule above. Tally reports them
 * under whichever primary group they descend from, and the chain to walk is
 * already synced into `tally_groups`: Consultant → Sundry Creditors → Current
 * Liabilities. `parents` maps a normalized group name to its parent's name.
 */
export const headOfTallyGroupChain = (
  parentGroup: string | null | undefined,
  parents: Map<string, string>,
): string | null => {
  let current = parentGroup;
  const seen = new Set<string>();
  // Tally's own tree is shallow; the bound is only a guard against a cycle in
  // synced data, which would otherwise hang the report.
  for (let depth = 0; depth < 20; depth += 1) {
    const head = headOfTallyGroup(current);
    if (head) return head;
    const key = normalizeGroup(current);
    if (!key || seen.has(key)) return null;
    seen.add(key);
    const parent = parents.get(key);
    if (!parent) return null;
    current = parent;
  }
  return null;
};

/** Heads whose natural balance sits on the Credit side (liabilities + incomes). */
export const CREDIT_NATURE_HEADS = new Set([
  'Capital Account',
  'Profit & Loss A/c',
  'Loans (Liability)',
  'Current Liabilities',
  'Branch / Divisions',
  'Suspense A/c',
  'Sales Accounts',
  'Direct Incomes',
  'Indirect Incomes',
]);
