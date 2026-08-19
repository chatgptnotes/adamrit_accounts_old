import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Pencil, Calendar, IndianRupee, Hash } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { isOverdue, getBillStatus } from './types';
import type { BillStatus } from './types';
import { knownSchemeShortName } from '@/lib/schemeShortName';

const accentMap: Record<BillStatus, string> = {
  pending_submission: 'border-t-rose-400',
  submitted: 'border-t-sky-500',
  payment_expected: 'border-t-violet-500',
  payment_received: 'border-t-emerald-500',
  deduction_dispute: 'border-t-amber-500',
};

// Keyed on the SHORT name, so correcting a spelling in the corporate master
// cannot quietly turn every MJPJAY chip grey.
const corporateStyles: Record<string, string> = {
  'PM-JAY': 'bg-blue-50 text-blue-700 border-blue-200',
  MJPJAY: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CGHS: 'bg-purple-50 text-purple-700 border-purple-200',
  ECHS: 'bg-orange-50 text-orange-700 border-orange-200',
};

function getCorporateStyle(corporate: string) {
  const short = knownSchemeShortName(corporate);
  return (short && corporateStyles[short]) || 'bg-gray-50 text-gray-600 border-gray-200';
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function formatDate(dateString: string) {
  if (!dateString) return null;
  return new Date(dateString).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  });
}

interface BillWorkflowCardProps {
  submission: any;
  onEdit: (submission: any) => void;
}

export function BillWorkflowCard({ submission, onEdit }: BillWorkflowCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: submission.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 50 : 'auto',
  };

  const { overdue, reason } = isOverdue(submission);
  const status = getBillStatus(submission);
  const corporate = submission.patient_corporate || submission.corporate || '';
  const hasDeduction = submission.deduction_amount && Number(submission.deduction_amount) > 0;
  const billNo = submission.bill_no || submission.visit_id;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`
        group bg-white rounded-xl shadow-sm hover:shadow-lg
        border border-gray-100 border-t-[3px] ${accentMap[status]}
        cursor-grab active:cursor-grabbing touch-none
        transition-shadow duration-200 ease-out select-none
        ${isDragging ? 'shadow-xl' : ''}
      `}
    >
      <div className="p-3.5">
        {/* Top row: name + corporate badge */}
        <div className="flex items-start justify-between gap-1.5 mb-2.5 min-w-0">
          <h4 className="font-bold text-sm text-gray-900 truncate leading-tight min-w-0">
            {submission.patient_name}
          </h4>
          {corporate && (
            <span className={`flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full border max-w-[100px] truncate ${getCorporateStyle(corporate)}`}>
              {corporate.length > 20 ? corporate.slice(0, 20) + '…' : corporate}
            </span>
          )}
        </div>

        {/* Bill ID */}
        <div className="flex items-center gap-1.5 mb-2.5 min-w-0">
          <Hash className="h-3 w-3 text-gray-400 flex-shrink-0" />
          <span className="text-[11px] text-gray-500 font-mono tracking-tight truncate">{billNo}</span>
        </div>

        {/* Amount */}
        <div className="bg-gray-50 rounded-lg px-2.5 py-2 mb-2.5">
          <span className="text-sm font-bold text-gray-900 whitespace-nowrap">
            {formatAmount(submission.bill_amount || 0)}
          </span>
          {hasDeduction && (
            <span className="text-xs text-amber-600 font-medium ml-1.5 whitespace-nowrap">
              −{formatAmount(Number(submission.deduction_amount))}
            </span>
          )}
        </div>

        {/* Dates */}
        <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-2.5 min-w-0">
          {submission.admission_date && (
            <span className="flex items-center gap-1 whitespace-nowrap">
              <Calendar className="h-3 w-3 flex-shrink-0" />
              {formatDate(submission.admission_date)}
            </span>
          )}
          {submission.discharge_date && (
            <span className="flex items-center gap-1 whitespace-nowrap truncate">
              <Calendar className="h-3 w-3 flex-shrink-0" />
              {formatDate(submission.discharge_date)}
            </span>
          )}
        </div>

        {/* Bottom row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {overdue && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 rounded-md font-medium">
                {reason}
              </Badge>
            )}
            {!overdue && status === 'deduction_dispute' && (
              <Badge className="text-[10px] px-1.5 py-0 rounded-md font-medium bg-amber-100 text-amber-700 border-amber-200">
                Follow-up
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg hover:bg-gray-100"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onEdit(submission);
            }}
          >
            <Pencil className="h-3.5 w-3.5 text-gray-400" />
          </Button>
        </div>
      </div>
    </div>
  );
}
