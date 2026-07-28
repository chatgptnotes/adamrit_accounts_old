import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useInvoiceAccess } from '@/hooks/useInvoiceAccess';
import InvoicePasswordGate from '@/components/invoice/InvoicePasswordGate';

interface ProtectedFinalBillRouteProps {
  children: React.ReactNode;
}

/**
 * Checks financial access before FinalBill mounts. This keeps the frozen
 * FinalBill page unchanged and, more importantly, prevents its many billing
 * queries from running while a private archived visit is locked.
 */
const ProtectedFinalBillRoute: React.FC<ProtectedFinalBillRouteProps> = ({ children }) => {
  const { visitId } = useParams<{ visitId: string }>();
  const navigate = useNavigate();
  const access = useInvoiceAccess({ visitId });

  if (access.needsGate) {
    return (
      <InvoicePasswordGate
        billNo={access.lockState?.bill_no}
        patientName={access.lockState?.patient_name}
        verifying={access.verifying}
        error={access.error}
        onUnlock={access.unlock}
        onBack={() => navigate(-1)}
        adjustmentRequired={access.lockState?.archive_status === 'adjustment_required'}
      />
    );
  }

  if (access.isLockLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <p className="text-sm text-gray-600">Checking financial access…</p>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedFinalBillRoute;
