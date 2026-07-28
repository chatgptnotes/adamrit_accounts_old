import React from 'react';
import { useInvoiceAccess } from '@/hooks/useInvoiceAccess';
import InvoicePasswordGate from '@/components/invoice/InvoicePasswordGate';

interface ProtectedFinalBillContentProps {
  visitId?: string | null;
  children: React.ReactNode;
  onBack?: () => void;
  embedded?: boolean;
}

/**
 * Prevents an entire bill feature from mounting until access is granted.
 * Use this around embedded bill tabs and tablet flows; route-level pages use
 * ProtectedFinalBillRoute.
 */
const ProtectedFinalBillContent: React.FC<ProtectedFinalBillContentProps> = ({
  visitId,
  children,
  onBack,
  embedded = true,
}) => {
  const access = useInvoiceAccess({ visitId });

  if (access.needsGate) {
    return (
      <InvoicePasswordGate
        billNo={access.lockState?.bill_no}
        patientName={access.lockState?.patient_name}
        verifying={access.verifying}
        error={access.error}
        onUnlock={access.unlock}
        onBack={onBack}
        adjustmentRequired={access.lockState?.archive_status === 'adjustment_required'}
        embedded={embedded}
      />
    );
  }

  if (access.isLockLoading) {
    return (
      <div className={`${embedded ? 'min-h-[420px] rounded-lg border' : 'min-h-screen'} flex items-center justify-center bg-white`}>
        <p className="text-sm text-gray-600">Checking financial access…</p>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedFinalBillContent;
