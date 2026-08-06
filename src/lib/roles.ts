/** Roles with full super-admin control. */
export const SUPER_ADMIN_ROLES = new Set(['superadmin', 'super_admin', 'ca']);

export const isSuperAdminRole = (role?: string | null): boolean =>
  SUPER_ADMIN_ROLES.has((role || '').toLowerCase().trim());
