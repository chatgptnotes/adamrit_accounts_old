const ACCOUNTING_ROLES = new Set(['admin', 'superadmin', 'super_admin', 'ca', 'billing', 'finance', 'accountant']);
const ACCOUNTING_EMAILS = new Set(['cmd@hopehospital.com', 'finance@hopehospital.com']);

export function canCreateAccountingVouchers(user?: { role?: string | null; email?: string | null } | null): boolean {
  const role = (user?.role || '').toLowerCase();
  const email = (user?.email || '').toLowerCase();
  return ACCOUNTING_ROLES.has(role) || ACCOUNTING_EMAILS.has(email);
}
