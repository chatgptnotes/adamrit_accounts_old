const REFERRAL_REGISTER_EMAILS = new Set([
  'diksha@hopehospital.com',
  'cmd@hopehospital.com',
]);

const REFERRAL_REGISTER_ROLES = new Set(['superadmin', 'super_admin']);

export function canAccessReferralRegister(user?: { email?: string | null; role?: string | null } | null) {
  const email = (user?.email || '').toLowerCase().trim();
  const role = (user?.role || '').toLowerCase().trim();
  return REFERRAL_REGISTER_EMAILS.has(email) || REFERRAL_REGISTER_ROLES.has(role);
}
