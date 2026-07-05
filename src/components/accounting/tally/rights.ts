import { useAuth } from '@/contexts/AuthContext';

// Per-screen rights for the accounting module: these roles (and the
// director logins) may create/alter/delete; everyone else views only.
const ALTER_ROLES = new Set(['admin', 'superadmin', 'super_admin', 'billing', 'finance', 'accountant']);
const ALTER_EMAILS = new Set(['cmd@hopehospital.com', 'finance@hopehospital.com']);

export const useAccountingRights = (): { canAlter: boolean } => {
  const { user } = useAuth();
  const role = (user?.role || '').toLowerCase();
  const email = (user?.email || '').toLowerCase();
  return { canAlter: ALTER_ROLES.has(role) || ALTER_EMAILS.has(email) };
};
