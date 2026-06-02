// Starter task lists per department, so staff don't begin from a blank box.
// Clicking a chip appends the task to the textarea. Keys match the
// DESIGNATION_OPTIONS labels used in the entry form.
export const COMMON_TASKS: Record<string, string[]> = {
  Nursing: [
    'Check and verify all OPD patient files before shift starts',
    'Clean dressing room and change bedsheet and procedure tray',
    'Clear and organize OPD table for doctor',
    'Register patient: name, address, mobile number and panel type (Private / Ayushman / ESIC)',
    'Record BP and pulse for every OPD patient',
    'Inform patient about tests as per doctor advice',
    'Show test reports to doctor once received from lab',
    'Transfer patient to General Ward / ICU / Private as per doctor order',
    'Update and maintain casualty register for emergency patients',
  ],
  Billing: [
    'Generate final bills at discharge',
    'Reconcile cash counter at end of day',
    'Follow up on pending insurance claims',
    'Issue payment receipts',
  ],
  Pharmacy: [
    'Dispense prescriptions',
    'Check medicine expiry on shelves',
    'Raise purchase orders for low stock',
    'Reconcile pharmacy sales',
  ],
  Laboratory: [
    'Log incoming test samples',
    'Enter test results manually',
    'Print and dispatch reports',
    'Call doctors about critical values',
  ],
  Radiology: [
    'Schedule scan appointments',
    'Enter radiology findings',
    'Dispatch imaging reports',
    'Maintain the scan worklist',
  ],
  'Front Office / Reception': [
    'Register walk-in patients',
    'Answer phone enquiries',
    'Collect and file consent forms',
    'Direct visitors to departments',
  ],
  Administration: [
    'Compile staff attendance',
    'Schedule duty rosters',
    'Approve leave requests',
    'Prepare monthly MIS report',
  ],
  Marketing: [
    'Track daily referrals by source',
    'Follow up with referring doctors',
    'Update camp/event calendar',
    'Compile lead conversion numbers',
  ],
  IT: [
    'Reset user passwords',
    'Add new staff logins',
    'Take database backups',
    'Resolve printer/network tickets',
  ],
  Accounts: [
    'Post daily vouchers',
    'Reconcile bank statements',
    'Track vendor payments',
    'Prepare ledger statements',
  ],
  Finance: [
    'Review daily collections',
    'Track outstanding receivables',
    'Prepare cash-flow summary',
    'Compile expense reports',
  ],
};

// Pre-built workflow templates — one-click load into the entry form.
export interface WorkflowTemplate {
  id: string;
  label: string;
  designation: string;
  description: string;
  tasks: string[];
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'nurse-opd-daily',
    label: 'Nurse — OPD Daily Checklist',
    designation: 'Nursing',
    description: 'Complete 9-step daily workflow for OPD & Casualty nurse',
    tasks: [
      'Check and verify all OPD patient files before shift starts',
      'Clean dressing room and change bedsheet and procedure tray',
      'Clear and organize OPD table for doctor',
      'Register patient: name, address, mobile number and panel type (Private / Ayushman / ESIC)',
      'Record BP and pulse for every OPD patient',
      'Inform patient about tests as per doctor advice',
      'Show test reports to doctor once received from lab',
      'Transfer patient to General Ward / ICU / Private as per doctor order',
      'Update and maintain casualty register for emergency patients',
    ],
  },
  {
    id: 'billing-daily',
    label: 'Billing — Daily Shift Tasks',
    designation: 'Billing',
    description: 'Standard billing staff daily workflow',
    tasks: [
      'Generate final bills for patients due for discharge',
      'Reconcile cash counter at end of day',
      'Follow up on pending insurance claims',
      'Issue payment receipts and update ledger',
      'Submit pending bills for approval',
    ],
  },
  {
    id: 'lab-daily',
    label: 'Lab Technician — Daily Tasks',
    designation: 'Laboratory',
    description: 'Standard lab technician daily workflow',
    tasks: [
      'Log all incoming test samples with patient details',
      'Process and enter test results in the system',
      'Print and dispatch reports to ward / doctor',
      'Call doctors immediately for critical values',
      'Maintain sample register and QC records',
    ],
  },
];

// Adamrit modules the AI can point staff to as "available now" instant wins.
// Surfaced in the optimize prompt so suggested tools map to features that
// already exist in this app rather than generic external software.
export const ADAMRIT_MODULES: string[] = [
  'Final Bill module (auto-compiles charges)',
  'Cash Book and Day Book reports',
  'Tally integration (accounting sync)',
  'IPD / OPD dashboards and census reports',
  'Casualty Register (emergency patient tracking with BP/Pulse recording)',
  'Lab and Radiology worklists',
  'Report Delivery (WhatsApp/portal)',
  'Telephony / Twilio calling and IVR',
  'Self check-in kiosk and Patient Portal',
  'Staff Attendance',
  'Payment QR and receipt auto-send',
  'Marketing Dashboard and incentives',
  'Director Dashboard (MIS export)',
];
