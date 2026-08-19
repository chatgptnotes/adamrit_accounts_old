import { useAuth } from '@/contexts/AuthContext';
import { canCreateAccountingVouchers } from '@/lib/accounting-access';
import { useCashHandoverAccess } from '@/tablet/hooks/useCashHandoverAccess';

// Per-screen rights for the accounting module: these roles (and the
// director logins) may create/alter/delete; everyone else views only.
//
// The cash roster counts too, from 19 Aug: Dr M asked that every cashier have
// the accounting tiles and the vouchers, and the drawer-holders are not in the
// accounting roles -- they are a receptionist, a radiology technician, a
// pharmacist, a nurse and a marketing manager. It is asked here rather than
// inside canCreateAccountingVouchers because the roster is a database question
// and that has to stay a plain function the tablet tile grid can call.
//
// While the roster is still loading this returns view-only, not create. A cash
// screen is the wrong place to fail permissive, and the alternative -- showing
// the buttons and snatching them away a moment later -- is worse than a brief
// absence.
export const useAccountingRights = (): { canAlter: boolean } => {
  const { user } = useAuth();
  const cash = useCashHandoverAccess();
  return { canAlter: canCreateAccountingVouchers(user, cash.allowed) };
};
