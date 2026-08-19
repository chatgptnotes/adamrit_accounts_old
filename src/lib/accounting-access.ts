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
  return canCreateAccountingVouchers(user) || (user?.role || '').toLowerCase() === 'cashier';
}

export function canCreateAccountingVouchers(user?: { role?: string | null; email?: string | null } | null): boolean {
  const role = (user?.role || '').toLowerCase();
  const email = (user?.email || '').toLowerCase();
  return ACCOUNTING_ROLES.has(role) || ACCOUNTING_EMAILS.has(email);
}
