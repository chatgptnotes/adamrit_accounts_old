const ACCOUNTING_ROLES = new Set(['admin', 'superadmin', 'super_admin', 'ca', 'billing', 'finance', 'accountant']);

// Named people, for staff whose ROLE is shared with dozens of others who must
// not get these rights. Diksha and Nisha are receptionists who do front-office
// accounting work; adding 'receptionist' to the roles above would hand voucher
// creation to all six receptionists at once.
//
// This is deliberately the one switch for both surfaces: it grants create and
// alter on the desktop Accounting screen (via useAccountingRights, which views
// only for everyone else) AND opens the accountingOnly tablet tiles, Payments
// Due and Bank & Cash among them. Widening it is always a money decision.
// EVERY ADDRESS HERE MUST MATCH A LIVE ACCOUNT. When one stops matching,
// nothing is reported -- the person just quietly loses these rights, and the
// cause looks like anything except a list in the source code. That is exactly
// what happened to Diksha on 16-Aug: her address was corrected on her account
// to sakharediksha54@gmail.com and the old one here went dead the same moment,
// taking her voucher rights with it. Changing somebody's email means grepping
// this file.
const ACCOUNTING_EMAILS = new Set([
  'cmd@hopehospital.com',
  'finance@hopehospital.com',
  'sakharediksha54@gmail.com',
  // Lalit, pharmacist by role, works the vouchers and the books. Named rather
  // than adding 'pharmacist', which would hand the same rights to every
  // pharmacist at once -- the distinction this list exists to make.
  'lalit@gmail.com',
  // Nisha, receptionist by role, works the front-office books and banks the
  // takings. Named on Dr M's instruction (19 Aug), by the address her account
  // actually carries since the placeholders were retired on 18-Aug -- listing
  // the dead nisha@gmail.com would grant her nothing at all.
  'im.nishasharma@gmail.com',
]);

/**
 * Nobody on this list gets accounting rights, whatever else says yes.
 *
 * Dr M, 19 Aug: every cashier is to have the accounting tiles and the vouchers
 * -- and Shashank is to have none of them. He holds a drawer, so he arrives
 * through the cash roster below and would be admitted by the same rule that
 * admits the others. A named refusal is the only thing that separates him,
 * so it is checked FIRST and no later test can overturn it.
 *
 * Both his addresses, for the same reason Farhan has both: shashank@gmail.com
 * is the placeholder his account carries and 007aryan.upgade@gmail.com is the
 * Google address added on 15-Aug (20260815270000:45). If only one were listed,
 * retiring the placeholder the way Shailesh's and Nisha's were retired would
 * silently hand him everything this list exists to withhold.
 */
const ACCOUNTING_DENIED_EMAILS = new Set([
  'shashank@gmail.com',
  '007aryan.upgade@gmail.com',
]);

/** Is this person barred from the books by name? Checked before every grant. */
export function accountingDenied(
  user?: { email?: string | null } | null,
): boolean {
  return ACCOUNTING_DENIED_EMAILS.has((user?.email || '').toLowerCase().trim());
}

// People who carry the takings to the bank but keep no books. Farhan runs the
// pharmacy counter and banks its cash; his role is pharmacist, so neither
// ACCOUNTING_ROLES nor the cashier role below reaches him. Naming him in
// ACCOUNTING_EMAILS above would have worked and been wrong -- that set is the
// single switch for voucher create and alter on the desktop Accounting screen
// as well, which is far more than banking cash and is the quiet over-grant the
// comment above warns about. This list opens the deposit and nothing else.
//
// BOTH HIS ADDRESSES ARE LISTED. farhan@hope.com is the placeholder he signs in
// with today; farhanibrani42@gmail.com is his real address, carried as
// google_email since 14-Aug. When the placeholders are retired the way
// Shailesh's and Nisha's were on 18-Aug his primary email becomes the second
// one, and this right would otherwise die silently the same instant.
// Nisha is the other one. She is a receptionist who banks Hope's takings, and
// the comment at the top of ACCOUNTING_EMAILS claims she is named there --
// she is not, only Diksha is. So she has been carrying cash to the bank with no
// screen to record it on, and the Cash Shift Report has been reporting "no cash
// was paid into the bank" on days she deposited: the only record of a deposit is
// the CONTRA voucher post_cash_bank_entry writes, and she cannot reach either
// tile that calls it. One address only -- nisha@gmail.com was retired on 18-Aug
// (20260818140000) and google_email cleared with it, so listing it would be a
// dead entry of exactly the kind the header warns about.
const CASH_DEPOSIT_EMAILS = new Set([
  'farhan@hope.com',
  'farhanibrani42@gmail.com',
  'im.nishasharma@gmail.com',
]);

/**
 * Banking the day's takings is the one Bank & Cash action a cashier may take.
 *
 * Deliberately NOT done by adding 'cashier' to ACCOUNTING_ROLES above. That set
 * is the single switch for both surfaces, so widening it would also hand every
 * cashier voucher create and alter rights on the desktop Accounting screen --
 * far more than depositing cash, and exactly the kind of quiet over-grant the
 * comment above warns about.
 *
 * The tile opens for them; BankCashFlow shows them the deposit and nothing
 * else, so withdrawals, bank charges and interest stay with accounting.
 */
export function canDepositCash(
  user?: { role?: string | null; email?: string | null } | null,
  handlesCash = false,
): boolean {
  if (accountingDenied(user)) return false;
  return canCreateAccountingVouchers(user, handlesCash)
    || (user?.role || '').toLowerCase() === 'cashier'
    || CASH_DEPOSIT_EMAILS.has((user?.email || '').toLowerCase());
}

/**
 * @param handlesCash whether this person holds a cash drawer, from
 *   useCashHandoverAccess() -- the cash roster in the database.
 *
 *   EVERY CASHIER NOW GETS THE BOOKS. Dr M, 19 Aug: "Nisha and all cashiers to
 *   be given access to all accounting tiles and vouchers." The comment above
 *   used to argue the opposite and it is worth saying why it changed rather
 *   than quietly deleting it: this is a real widening, and it hands voucher
 *   create and alter on the desktop Accounting screen -- posting, altering and
 *   deleting entries in the book of record -- to everybody on the cash roster,
 *   not just the tablet tiles. That is the instruction, and it is defensible:
 *   a cashier takes money in and pays it out all day and the voucher is the
 *   record of it. It is not reversible by accident, though, so if the intent
 *   was only the TILES and not create/alter on the desktop screen, this is the
 *   line to change back.
 *
 *   The ROSTER is the authority, not the cashier role, and it is the roster
 *   that carries the instruction's meaning: the people actually holding drawers
 *   are a receptionist, a radiology technician, a pharmacist, a nurse and a
 *   marketing manager. The one account whose role IS 'cashier' has never signed
 *   in. The role is honoured as well, so a newly created cashier works on day
 *   one, but on its own it would have granted this to nobody who needed it.
 *
 *   Passed in rather than read here because the roster is a database question
 *   and this has to stay a plain function -- the tablet tile grid calls it
 *   outside a component. Callers that cannot answer omit it and fall back to
 *   the lists above, which is why those still exist.
 */
export function canCreateAccountingVouchers(
  user?: { role?: string | null; email?: string | null } | null,
  handlesCash = false,
): boolean {
  // First, and unconditionally. A named refusal that any later test could
  // overturn is not a refusal.
  if (accountingDenied(user)) return false;
  const role = (user?.role || '').toLowerCase();
  const email = (user?.email || '').toLowerCase();
  if (handlesCash || role === 'cashier') return true;
  return ACCOUNTING_ROLES.has(role) || ACCOUNTING_EMAILS.has(email);
}
