import { useState, useCallback, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { Loader2, IndianRupee, AlertTriangle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useUpdateBillSubmission } from '@/hooks/useBillSubmissions';
import { formatDateOnly } from '@/utils/dateOnly';
import { BillWorkflowColumn } from './BillWorkflowColumn';
import { BillWorkflowCard } from './BillWorkflowCard';
import { PaymentReceivedDialog } from './PaymentReceivedDialog';
import { columns, getBillStatus, isOverdue } from './types';
import type { BillStatus } from './types';

interface BillWorkflowBoardProps {
  submissions: any[];
  isLoading: boolean;
  onEdit: (submission: any) => void;
  onQuickAdd: (status: BillStatus) => void;
}

function formatToday(): string {
  return formatDateOnly(new Date());
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

const allStatuses: BillStatus[] = [
  'pending_submission',
  'submitted',
  'payment_expected',
  'payment_received',
  'deduction_dispute',
];

export function BillWorkflowBoard({ submissions, isLoading, onEdit, onQuickAdd }: BillWorkflowBoardProps) {
  const updateMutation = useUpdateBillSubmission();
  const [activeSubmission, setActiveSubmission] = useState<any>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [pendingDropSubmission, setPendingDropSubmission] = useState<any>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const groupedByStatus: Record<BillStatus, any[]> = {
    pending_submission: [],
    submitted: [],
    payment_expected: [],
    payment_received: [],
    deduction_dispute: [],
  };

  const statusById = useMemo(() => {
    const map: Record<string, BillStatus> = {};
    submissions.forEach((s) => {
      map[s.id] = getBillStatus(s);
    });
    return map;
  }, [submissions]);

  submissions.forEach((s) => {
    const status = getBillStatus(s);
    groupedByStatus[status].push(s);
  });

  const totalAmount = submissions.reduce((sum, s) => sum + (Number(s.bill_amount) || 0), 0);
  const totalReceived = submissions.reduce((sum, s) => sum + (Number(s.received_amount) || 0), 0);
  const overdueCount = submissions.filter((s) => isOverdue(s).overdue).length;

  const resolveTargetColumn = (overId: string): BillStatus | null => {
    if (allStatuses.includes(overId as BillStatus)) {
      return overId as BillStatus;
    }
    if (statusById[overId]) {
      return statusById[overId];
    }
    return null;
  };

  const handleDragStart = useCallback((event: any) => {
    const submission = submissions.find((s) => s.id === event.active.id);
    setActiveSubmission(submission || null);
  }, [submissions]);

  const handleDragEnd = useCallback((event: any) => {
    setActiveSubmission(null);
    const { active, over } = event;
    if (!over) return;

    const submission = submissions.find((s) => s.id === active.id);
    if (!submission) return;

    const targetStatus = resolveTargetColumn(over.id);
    if (!targetStatus) return;

    const currentStatus = getBillStatus(submission);
    if (currentStatus === targetStatus) return;

    if (targetStatus === 'deduction_dispute') {
      toast.warning('Deductions are set in the edit form. Open the bill to add deduction details.');
      return;
    }

    const currentIdx = allStatuses.indexOf(currentStatus);
    const targetIdx = allStatuses.indexOf(targetStatus);

    if (targetIdx < currentIdx) {
      toast.warning("Can't move backward. Use the edit form to make changes.");
      return;
    }

    if (targetIdx !== currentIdx + 1) {
      toast.warning("Can't skip steps. Move one column at a time.");
      return;
    }

    if (targetStatus === 'submitted') {
      updateMutation.mutate({
        id: submission.id,
        visit_id: submission.visit_id,
        date_of_submission: formatToday(),
      });
      toast.success('Submission date set to today');
    } else if (targetStatus === 'payment_expected') {
      updateMutation.mutate({
        id: submission.id,
        visit_id: submission.visit_id,
        expected_payment_date: formatToday(),
      });
      toast.success('Expected payment date set to today');
    } else if (targetStatus === 'payment_received') {
      setPendingDropSubmission(submission);
      setPaymentDialogOpen(true);
    }
  }, [submissions, updateMutation, statusById]);

  const handlePaymentConfirm = (receivedAmount: number, receivedDate: string) => {
    if (!pendingDropSubmission) return;
    updateMutation.mutate({
      id: pendingDropSubmission.id,
      visit_id: pendingDropSubmission.visit_id,
      received_amount: receivedAmount,
      received_date: receivedDate,
    });
    toast.success('Payment received recorded');
    setPendingDropSubmission(null);
    setPaymentDialogOpen(false);
  };

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex-1 min-w-[240px] max-w-[400px]">
            <div className="h-6 w-28 bg-gray-100 rounded-full mb-3 animate-pulse" />
            <div className="rounded-2xl bg-gray-50 p-2 space-y-2 min-h-[200px]">
              {[1, 2, 3].map((j) => (
                <div key={j} className="bg-white rounded-xl p-3.5 space-y-2 animate-pulse">
                  <div className="h-4 w-24 bg-gray-100 rounded" />
                  <div className="h-3 w-16 bg-gray-50 rounded" />
                  <div className="h-8 w-full bg-gray-50 rounded-lg" />
                  <div className="h-3 w-20 bg-gray-50 rounded" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Summary bar */}
      <div className="flex items-center gap-4 mb-4 px-1 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-sm text-gray-600">
          <Clock className="h-4 w-4" />
          <span className="font-medium">{submissions.length}</span>
          <span className="text-gray-400">bills</span>
        </div>
        <div className="w-px h-4 bg-gray-200" />
        <div className="flex items-center gap-1.5 text-sm text-gray-600">
          <IndianRupee className="h-4 w-4" />
          <span className="font-medium">{formatAmount(totalAmount)}</span>
          <span className="text-gray-400">total</span>
        </div>
        <div className="w-px h-4 bg-gray-200" />
        <div className="flex items-center gap-1.5 text-sm text-emerald-600">
          <IndianRupee className="h-4 w-4" />
          <span className="font-medium">{formatAmount(totalReceived)}</span>
          <span className="text-emerald-400">received</span>
        </div>
        {overdueCount > 0 && (
          <>
            <div className="w-px h-4 bg-gray-200" />
            <div className="flex items-center gap-1.5 text-sm text-red-600">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">{overdueCount}</span>
              <span className="text-red-400">overdue</span>
            </div>
          </>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 pb-6 flex-1 min-h-0 overflow-x-auto scroll-smooth overscroll-contain">
          {columns.map((col) => (
            <BillWorkflowColumn
              key={col.status}
              column={col}
              submissions={groupedByStatus[col.status]}
              onEdit={onEdit}
              onQuickAdd={onQuickAdd}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeSubmission ? (
            <div className="w-[280px] opacity-95 rotate-[1deg] scale-105">
              <BillWorkflowCard submission={activeSubmission} onEdit={() => {}} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <PaymentReceivedDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        onConfirm={handlePaymentConfirm}
        patientName={pendingDropSubmission?.patient_name || ''}
      />
    </div>
  );
}
