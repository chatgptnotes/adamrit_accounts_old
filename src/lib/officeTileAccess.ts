// Who may see the money tiles on the tablet: Accounts (Tilak) and Expense
// Bills. Both open the hospital's books, so they are shown to the office staff
// who work them and to the two super admins, and hidden from everyone else.
//
// Named people, by the email they log in with — a role check would sweep in
// every future account that happens to carry the same role.
const OFFICE_TILE_EMAILS = new Set([
  'diksha@gmail.com',
  'nisha@gmail.com',
  'lalit@gmail.com',
  'lokesh@gmail.com',
  'ganesh@adamrit.com',
  'sanjay@hopehospital.com',
  'suraj@gmail.com',
  'arpit@gmail.com',
  'ysonu@gmail.com',
  'abhishek@gmail.com',
  'accountant@adamrit.com', // Shailesh
  'avni@gmail.com',
  'azherkhan@gmail.com',
  'chetna@hopehospital.com',
  'akshay@gmail.com',
  'ruby@gmail.com', // super admin
  'murali@hospital.com', // super admin
]);

/** Tiles this list governs. */
export const OFFICE_TILE_IDS = ['accounts-tilak', 'expense-bills'] as const;

export function canSeeOfficeTiles(user?: { email?: string | null } | null): boolean {
  return OFFICE_TILE_EMAILS.has((user?.email || '').toLowerCase().trim());
}
