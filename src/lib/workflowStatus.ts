// Manual per-patient workflow status, selected in the Advance Statement Report.
// The Overview report cards and detailed workflow reports are generated from this value.

export interface WorkflowStatusOption {
  value: string;
  label: string;
  workflow: WorkflowReportKey;
  stage: 'pending' | 'done';
}

export type WorkflowReportKey =
  | 'approval'
  | 'extension'
  | 'discharge'
  | 'bill'
  | 'submission'
  | 'payment';

export const WORKFLOW_STATUS_OPTIONS: WorkflowStatusOption[] = [
  { value: 'approval_pending', label: 'Approval Pending', workflow: 'approval', stage: 'pending' },
  { value: 'extension_pending', label: 'Extension Pending', workflow: 'extension', stage: 'pending' },
  { value: 'discharge_pending', label: 'Discharge Pending', workflow: 'discharge', stage: 'pending' },
  { value: 'bill_pending', label: 'Bill Pending', workflow: 'bill', stage: 'pending' },
  { value: 'submission_pending', label: 'Submission Pending', workflow: 'submission', stage: 'pending' },
  { value: 'payment_pending', label: 'Payment Pending', workflow: 'payment', stage: 'pending' },
  { value: 'approval_received', label: 'Approval Received', workflow: 'approval', stage: 'done' },
  { value: 'extension_received', label: 'Extension Received', workflow: 'extension', stage: 'done' },
  { value: 'discharge_done', label: 'Discharge Done', workflow: 'discharge', stage: 'done' },
  { value: 'bill_done', label: 'Bill Done', workflow: 'bill', stage: 'done' },
  { value: 'submission_done', label: 'Submission Done', workflow: 'submission', stage: 'done' },
  { value: 'payment_received', label: 'Payment Received', workflow: 'payment', stage: 'done' },
];

// Government-portal lifecycle statuses — selectable in the dropdown but not
// part of the six workflow reports (no workflow group).
export const PORTAL_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'pre_auth_to_be_submitted', label: 'Pre-authorization to be submitted' },
  { value: 'pre_auth_pending', label: 'Pre-authorization pending' },
  { value: 'under_treatment', label: 'Under treatment' },
  { value: 'claims_to_be_submitted', label: 'Claims to be submitted' },
];

// Static fallback for the dropdown when the workflow_status_master table is
// unavailable; the master (Status Master page) is the editable source of truth.
export const ALL_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  ...PORTAL_STATUS_OPTIONS,
  ...WORKFLOW_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
];

export const WORKFLOW_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  [...WORKFLOW_STATUS_OPTIONS, ...PORTAL_STATUS_OPTIONS].map((o) => [o.value, o.label]),
);

export interface WorkflowReportDef {
  key: WorkflowReportKey;
  title: string;
  statuses: string[]; // ordered: pending first, then done
}

export const WORKFLOW_REPORTS: WorkflowReportDef[] = (
  ['approval', 'extension', 'discharge', 'bill', 'submission', 'payment'] as WorkflowReportKey[]
).map((key) => ({
  key,
  title: `${key.charAt(0).toUpperCase()}${key.slice(1)} Report`,
  statuses: WORKFLOW_STATUS_OPTIONS.filter((o) => o.workflow === key).map((o) => o.value),
}));
