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
]);

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
export function canDepositCash(user?: { role?: string | null; email?: string | null } | null): boolean {
  return canCreateAccountingVouchers(user)
    || (user?.role || '').toLowerCase() === 'cashier'
    || CASH_DEPOSIT_EMAILS.has((user?.email || '').toLowerCase());
}

export function canCreateAccountingVouchers(user?: { role?: string | null; email?: string | null } | null): boolean {
  const role = (user?.role || '').toLowerCase();
  const email = (user?.email || '').toLowerCase();
  return ACCOUNTING_ROLES.has(role) || ACCOUNTING_EMAILS.has(email);
}
