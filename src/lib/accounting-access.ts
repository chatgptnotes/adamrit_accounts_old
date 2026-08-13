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
const ACCOUNTING_EMAILS = new Set([
  'cmd@hopehospital.com',
  'finance@hopehospital.com',
  'diksha@gmail.com',
  'nisha@gmail.com',
]);

export function canCreateAccountingVouchers(user?: { role?: string | null; email?: string | null } | null): boolean {
  const role = (user?.role || '').toLowerCase();
  const email = (user?.email || '').toLowerCase();
  return ACCOUNTING_ROLES.has(role) || ACCOUNTING_EMAILS.has(email);
}
