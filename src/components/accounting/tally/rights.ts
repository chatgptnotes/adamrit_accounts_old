import { useAuth } from '@/contexts/AuthContext';
import { canCreateAccountingVouchers } from '@/lib/accounting-access';

// Per-screen rights for the accounting module: these roles (and the
// director logins) may create/alter/delete; everyone else views only.
export const useAccountingRights = (): { canAlter: boolean } => {
  const { user } = useAuth();
  return { canAlter: canCreateAccountingVouchers(user) };
};
