// Who may see the money tiles on the tablet: Accounts (Tilak) and Expense
// Bills. Both open the hospital's books, so they are shown to the office staff
// who work them and to management, and hidden from everyone else.
//
// Two ways in, because either alone was wrong:
//
//   * By role, for management. An email list cannot keep up with the accounts
//     people log in under — superadmin@ayushman.com, cmd@hopehospital.com and
//     superadmin@hospital.com are all real superadmin logins that a list of
//     names would never have contained, and locking a director out of the
//     books is worse than showing a tile to one more admin.
//   * By email, for the named staff who are not management: Diksha is a
//     receptionist, Lokesh, Suraj, Arpit and Akshay are billing, Lalit is a
//     pharmacist. Their roles are shared with dozens of others, so only the
//     person is admitted, not the role.

const MANAGEMENT_ROLES = new Set([
  'superadmin',
  'super_admin',
  'admin',
  'cmd',
  'director',
]);

const OFFICE_TILE_EMAILS = new Set([
  // The named office staff, by the address they actually log in with.
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
  'accountant@adamrit.com', // Shailesh, billing login
  'shailesh@gmail.com', // Shailesh, superadmin login
  'avni@gmail.com',
  'azherkhan@gmail.com',
  'chetna@hopehospital.com',
  'akshay@gmail.com',
  'nikhil@gmail.com', // Nikhil, CA
  // Management, listed as well as covered by role, so a role rename cannot
  // lock them out.
  'ruby@gmail.com',
  'murali@hospital.com',
  'murali@gmail.com',
  'cmd@hopehospital.com',
  'superadmin@hospital.com',
  'superadmin@ayushman.com',
]);

/** Tiles this list governs. */
export const OFFICE_TILE_IDS = ['accounts-tilak', 'expense-bills'] as const;

export function canSeeOfficeTiles(
  user?: { email?: string | null; role?: string | null } | null,
): boolean {
  const role = (user?.role || '').toLowerCase().trim();
  if (MANAGEMENT_ROLES.has(role)) return true;
  return OFFICE_TILE_EMAILS.has((user?.email || '').toLowerCase().trim());
}
