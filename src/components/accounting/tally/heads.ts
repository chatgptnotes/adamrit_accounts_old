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
