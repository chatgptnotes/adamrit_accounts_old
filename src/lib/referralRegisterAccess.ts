const REFERRAL_REGISTER_EMAILS = new Set([
  'diksha@hopehospital.com',
  'cmd@hopehospital.com',
  'sanjaykhobragade46@gmail.com',
  'ganeshsharnagat47@gmail.com',
]);

const REFERRAL_REGISTER_ROLES = new Set(['superadmin', 'super_admin', 'ca']);

export function canAccessReferralRegister(user?: { email?: string | null; role?: string | null } | null) {
  const email = (user?.email || '').toLowerCase().trim();
  const role = (user?.role || '').toLowerCase().trim();
  return REFERRAL_REGISTER_EMAILS.has(email) || REFERRAL_REGISTER_ROLES.has(role);
}
