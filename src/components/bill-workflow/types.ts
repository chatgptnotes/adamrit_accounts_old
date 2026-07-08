import { Clock, Send, CalendarClock, CheckCircle, AlertTriangle } from 'lucide-react';
import { parseDateOnly } from '@/utils/dateOnly';

export type BillStatus =
  | 'pending_submission'
  | 'submitted'
  | 'payment_expected'
  | 'payment_received'
  | 'deduction_dispute';

export interface ColumnDef {
  status: BillStatus;
  title: string;
  color: string;
  icon: typeof Clock;
}

export const columns: ColumnDef[] = [
  {
    status: 'pending_submission',
    title: 'Pending Submission',
    color: 'bg-rose-50 border-rose-200',
    icon: Clock,
  },
  {
    status: 'submitted',
    title: 'Submitted',
    color: 'bg-sky-50 border-sky-200',
    icon: Send,
  },
  {
    status: 'payment_expected',
    title: 'Payment Expected',
    color: 'bg-violet-50 border-violet-200',
    icon: CalendarClock,
  },
  {
    status: 'payment_received',
    title: 'Payment Received',
    color: 'bg-emerald-50 border-emerald-200',
    icon: CheckCircle,
  },
  {
    status: 'deduction_dispute',
    title: 'Deduction / Dispute',
    color: 'bg-amber-50 border-amber-200',
    icon: AlertTriangle,
  },
];

export function getBillStatus(submission: any): BillStatus {
  const hasDeduction = submission.deduction_amount && Number(submission.deduction_amount) > 0;
  const hasReceived = submission.received_amount && Number(submission.received_amount) > 0;
  const hasExpectedDate = !!submission.expected_payment_date;
  const hasSubmissionDate = !!submission.date_of_submission;

  if (hasDeduction) return 'deduction_dispute';
  if (hasReceived) return 'payment_received';
  if (hasExpectedDate) return 'payment_expected';
  if (hasSubmissionDate) return 'submitted';
  return 'pending_submission';
}

export function isOverdue(submission: any): { overdue: boolean; reason: string } {
  const status = getBillStatus(submission);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (status === 'pending_submission' && submission.discharge_date) {
    const discharge = parseDateOnly(submission.discharge_date);
    if (discharge < today) {
      return { overdue: true, reason: 'Discharged' };
    }
  }

  if (status === 'payment_expected' && submission.expected_payment_date) {
    const expected = parseDateOnly(submission.expected_payment_date);
    if (expected < today) {
      return { overdue: true, reason: 'Past due' };
    }
  }

  if (status === 'deduction_dispute') {
    return { overdue: false, reason: 'Needs follow-up' };
  }

  return { overdue: false, reason: '' };
}
