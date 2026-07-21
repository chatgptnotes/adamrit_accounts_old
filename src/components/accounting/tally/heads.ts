// Tally's primary group heads, mapped from chart_of_accounts.account_type.
// Shared by Trial Balance and Group Summary so drill-down stays consistent.

export const HEAD_OF: { match: (t: string) => boolean; head: string }[] = [
  { match: (t) => t === 'EQUITY', head: 'Capital Account' },
  { match: (t) => t === 'LONG_TERM_LIABILITIES', head: 'Loans (Liability)' },
  { match: (t) => t.includes('LIABILIT'), head: 'Current Liabilities' },
  { match: (t) => t === 'FIXED_ASSETS', head: 'Fixed Assets' },
  { match: (t) => t.includes('ASSET'), head: 'Current Assets' },
  { match: (t) => t === 'INDIRECT_INCOME', head: 'Indirect Incomes' },
  { match: (t) => t.includes('INCOME'), head: 'Sales Accounts' },
  { match: (t) => t === 'INDIRECT_EXPENSES', head: 'Indirect Expenses' },
  { match: (t) => t.includes('EXPENSE'), head: 'Direct Expenses' },
];

export const HEAD_ORDER = [
  'Capital Account',
  'Loans (Liability)',
  'Current Liabilities',
  'Fixed Assets',
  'Current Assets',
  'Sales Accounts',
  'Indirect Incomes',
  'Direct Expenses',
  'Indirect Expenses',
];

export const headOfType = (accountType: string | null | undefined): string | null =>
  HEAD_OF.find((h) => h.match((accountType ?? '').toUpperCase()))?.head ?? null;

// Tally ledgers carry a `parent_group` string (Tally's primary group) instead
// of an account_type. Map those onto the SAME HEAD_ORDER buckets so merged
// rows group identically to native accounts. Matched loosely (lowercased,
// hyphen-insensitive) since Tally group names vary by company.
const TALLY_GROUP_HEADS: { match: (g: string) => boolean; head: string }[] = [
  { match: (g) => g.includes('capital'), head: 'Capital Account' },
  { match: (g) => g.includes('loan'), head: 'Loans (Liability)' },
  { match: (g) => g.includes('creditor') || g.includes('duties') || g.includes('provision') || g.includes('current liab'), head: 'Current Liabilities' },
  { match: (g) => g.includes('fixed asset'), head: 'Fixed Assets' },
  { match: (g) => g.includes('debtor') || g.includes('bank') || g.includes('cash') || g.includes('current asset') || g.includes('deposit') || g.includes('advance') || g.includes('loans (asset'), head: 'Current Assets' },
  { match: (g) => g.includes('purchase'), head: 'Direct Expenses' },
  { match: (g) => g.includes('direct exp'), head: 'Direct Expenses' },
  { match: (g) => g.includes('indirect exp'), head: 'Indirect Expenses' },
  { match: (g) => g.includes('sales') || g.includes('direct inc'), head: 'Sales Accounts' },
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
  'Sales Accounts',
  'Indirect Incomes',
]);
