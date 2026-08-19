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

import { accountingDenied, canCreateAccountingVouchers } from '@/lib/accounting-access';

const MANAGEMENT_ROLES = new Set([
  'superadmin',
  'super_admin',
  'admin',
  'cmd',
  'director',
]);

const OFFICE_TILE_EMAILS = new Set([
  // The named office staff, by the address they actually log in with -- and it
  // has to BE the address they log in with. When Diksha's was corrected on her
  // account, the stale entry here took the Accounts and Expense Bills tiles
  // away from her without a word. Changing an email means grepping this file.
  'sakharediksha54@gmail.com',
  'lalit@gmail.com',
  'lokesh@gmail.com',
  'ganesh@adamrit.com',
  'sanjay@hopehospital.com',
  'suraj@gmail.com',
  'arpit@gmail.com',
  'ysonu@gmail.com',
  'abhishek@gmail.com',
  'accountant@adamrit.com', // Shailesh, dormant billing login
  'shaileshninave37@gmail.com', // Shailesh Ninave, accountant
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

/**
 * The four voucher tiles, and who may work them.
 *
 * These are not read-only screens: opening one is how a voucher gets posted,
 * so this list decides who can move money in the books. It stays a list of
 * PEOPLE rather than a role. Adding 'receptionist' to the accounting roles
 * would hand voucher creation to all six receptionists at once, which is a
 * larger change than naming the two who do the work.
 */
export const VOUCHER_TILE_IDS = [
  'payment-voucher',
  'receipt-voucher',
  'contra-voucher',
  'journal-voucher',
] as const;

/**
 * Kept only for people who work vouchers but hold NO cash drawer. Anyone on the
 * cash roster now arrives through handlesCash below and does not belong here.
 *
 * A hand-edited list of addresses is why this broke repeatedly: it goes stale
 * silently. Nobody is told when an address here stops matching an account --
 * the person simply loses the tile, and the cause looks like anything but a
 * list in the source code. Prefer the roster.
 */
const VOUCHER_TILE_EMAILS = new Set([
  'sakharediksha54@gmail.com', // Diksha Sakhare, receptionist — front-office voucher duty
]);

/**
 * Note this must be applied at BOTH the tile grid and the route guard. When
 * only the grid used it, Diksha was shown the Payment Voucher tile and then
 * bounced back to the home screen the moment she tapped it, because the guard
 * re-tested her against the accounting roles she is not in.
 */
/**
 * @param handlesCash whether this person holds a cash drawer, from
 *   useCashHandoverAccess() -- the cash roster in the database. EVERY CASHIER
 *   SEES EVERY VOUCHER: they pay cash out and take it in all day, and the
 *   voucher is the record of it, so a cashier who cannot open one is being
 *   asked to work blind.
 *
 *   Passed in rather than read here because the roster is a database question
 *   and this has to stay a plain function -- the tile grid calls it outside a
 *   component. Callers that cannot answer omit it, which is why the lists
 *   above still exist.
 *
 *   The roster is deliberately the authority instead of the cashier ROLE. The
 *   people holding drawers are a receptionist, a radiology technician, a
 *   pharmacist, a nurse and a marketing manager -- a person holds one role and
 *   theirs has to be the one their day job needs. Any role list would have
 *   missed most of them, which is exactly how this kept recurring.
 */
export function canSeeVoucherTiles(
  user?: { email?: string | null; role?: string | null } | null,
  handlesCash = false,
): boolean {
  // Named refusals first. Shashank holds a drawer, so handlesCash below would
  // otherwise admit him to every voucher tile (Dr M, 19 Aug: he gets none).
  if (accountingDenied(user)) return false;
  const role = (user?.role || '').toLowerCase().trim();
  if (MANAGEMENT_ROLES.has(role)) return true;
  if (handlesCash) return true;
  if (canCreateAccountingVouchers(user, handlesCash)) return true;
  return VOUCHER_TILE_EMAILS.has((user?.email || '').toLowerCase().trim());
}

/** @deprecated Use canSeeVoucherTiles — Payment Voucher is no longer special. */
export const canSeePaymentVoucher = canSeeVoucherTiles;

/**
 * @param handlesCash from the cash roster. Accounts and Expense Bills are
 *   accounting tiles, and every cashier is to have the accounting tiles
 *   (Dr M, 19 Aug), so the roster admits them here as it already does for the
 *   voucher tiles. The named refusals still win.
 */
export function canSeeOfficeTiles(
  user?: { email?: string | null; role?: string | null } | null,
  handlesCash = false,
): boolean {
  if (accountingDenied(user)) return false;
  const role = (user?.role || '').toLowerCase().trim();
  if (MANAGEMENT_ROLES.has(role)) return true;
  if (handlesCash) return true;
  // Anyone with the books has these two as well. Without this a caller that
  // cannot answer the roster question -- and the sidebar cannot -- hid Accounts
  // and Expense Bills from Nisha while the tablet grid showed them to her.
  if (canCreateAccountingVouchers(user, handlesCash)) return true;
  return OFFICE_TILE_EMAILS.has((user?.email || '').toLowerCase().trim());
}
