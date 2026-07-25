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
  { match: (t) => t === 'INDIRECT_INCOME', head: 'Indirect Incomes' },
  { match: (t) => t.includes('DIRECT_INCOME') || t === 'DIRECT_INCOMES', head: 'Direct Incomes' },
  { match: (t) => t.includes('INCOME') || t.includes('SALES'), head: 'Sales Accounts' },
  { match: (t) => t.includes('PURCHASE'), head: 'Purchase Accounts' },
  { match: (t) => t === 'INDIRECT_EXPENSES', head: 'Indirect Expenses' },
  { match: (t) => t.includes('EXPENSE'), head: 'Direct Expenses' },
];

/**
 * Tally's primary groups, in the order Tally lists them. Liabilities and
 * assets first (Balance Sheet order), then the revenue groups (P&L order).
 * A head no ledger falls into is simply not rendered.
 */
export const HEAD_ORDER = [
  'Capital Account',
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

export const headOfType = (accountType: string | null | undefined): string | null =>
  HEAD_OF.find((h) => h.match((accountType ?? '').toUpperCase()))?.head ?? null;

// Tally ledgers carry a `parent_group` string (Tally's primary group) instead
// of an account_type. Map those onto the SAME HEAD_ORDER buckets so merged
// rows group identically to native accounts. Matched loosely (lowercased,
// hyphen-insensitive) since Tally group names vary by company.
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
  { match: (g) => g.includes('purchase'), head: 'Purchase Accounts' },
  { match: (g) => g.includes('direct exp'), head: 'Direct Expenses' },
  { match: (g) => g.includes('indirect exp'), head: 'Indirect Expenses' },
  { match: (g) => g.includes('direct inc'), head: 'Direct Incomes' },
  { match: (g) => g.includes('sales'), head: 'Sales Accounts' },
  { match: (g) => g.includes('indirect inc'), head: 'Indirect Incomes' },
];

export const headOfTallyGroup = (parentGroup: string | null | undefined): string | null => {
  const g = (parentGroup ?? '').toLowerCase().replace(/-/g, ' ').trim();
  if (!g) return null;
  return TALLY_GROUP_HEADS.find((h) => h.match(g))?.head ?? null;
};

/** Heads whose natural balance sits on the Credit side (liabilities + incomes). */
export const CREDIT_NATURE_HEADS = new Set([
  'Capital Account',
  'Loans (Liability)',
  'Current Liabilities',
  'Branch / Divisions',
  'Suspense A/c',
  'Sales Accounts',
  'Direct Incomes',
  'Indirect Incomes',
]);
