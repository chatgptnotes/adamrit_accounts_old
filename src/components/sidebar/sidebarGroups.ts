// Groups the long main sidebar list into labelled, collapsible sections so a
// user can scan to the right area instead of reading one ~50-item list.
// Edit GROUP_BY_TITLE to move a tab between sections; GROUP_ORDER sets the
// order the sections appear in. Any main item without an entry here falls into
// the trailing "More" group.

export const GROUP_ORDER = [
  'Overview',
  'Patient Care',
  'Diagnostics',
  'Beds & Facility',
  'Billing & Accounts',
  'Marketing & Outreach',
  'Patient-Facing',
  'More',
] as const;

export const GROUP_BY_TITLE: Record<string, string> = {
  // Overview
  'Dashboard': 'Overview',
  'Director Dashboard': 'Overview',
  'Reports': 'Overview',
  'Task Optimizer': 'Overview',
  'Patient Dashboard': 'Overview',
  'Patient Overview': 'Overview',
  'IPD Dashboard': 'Overview',
  "Today's OPD": 'Overview',

  // Patient Care
  'Currently Admitted': 'Patient Care',
  'Discharged Patients': 'Patient Care',
  'Patients': 'Patient Care',
  'Appointments': 'Patient Care',
  'Nursing Station': 'Patient Care',
  'Operation Theatre': 'Patient Care',
  'Cath Lab': 'Patient Care',
  'Casualty Register': 'Patient Care',
  'NephroPlus Dialysis': 'Patient Care',
  'Shifting': 'Patient Care',
  'Doctor View': 'Patient Care',

  // Diagnostics
  'Lab': 'Diagnostics',
  'Radiology': 'Diagnostics',
  'Pharmacy': 'Diagnostics',
  'CT / MRI': 'Diagnostics',
  'Radiology Worklist': 'Diagnostics',
  'Phlebotomist': 'Diagnostics',
  'Home Collection': 'Diagnostics',
  'Report Delivery': 'Diagnostics',

  // Beds & Facility
  'Accommodation': 'Beds & Facility',
  'Room Management': 'Beds & Facility',
  'External Requisition': 'Beds & Facility',
  'Queue Management': 'Beds & Facility',
  'Staff Attendance': 'Beds & Facility',

  // Billing & Accounts
  'Accounting': 'Billing & Accounts',
  'Cash Book': 'Billing & Accounts',
  'Payment Allocation': 'Billing & Accounts',
  'Payment Voucher': 'Billing & Accounts',
  'Corporate': 'Billing & Accounts',
  'Corporate Receipts': 'Billing & Accounts',
  'Intimation + Bill Submissions': 'Billing & Accounts',
  'Bill Approvals': 'Billing & Accounts',
  'Tally Integration': 'Billing & Accounts',
  'Payment QR': 'Billing & Accounts',

  // Marketing & Outreach
  'Marketing': 'Marketing & Outreach',
  'Marketing Field Tracker': 'Marketing & Outreach',
  'B2B Partners': 'Marketing & Outreach',
  'Telephony Dashboard': 'Marketing & Outreach',
  'Conference Call': 'Marketing & Outreach',

  // Patient-Facing
  'Patient Portal': 'Patient-Facing',
  'Self Check-In Kiosk': 'Patient-Facing',
};

export const groupForTitle = (title: string): string =>
  GROUP_BY_TITLE[title] || 'More';
