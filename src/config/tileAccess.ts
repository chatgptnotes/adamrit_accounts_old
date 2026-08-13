export interface TileAccessRule {
  id: string;
  label: string;
  group:
    | "tablet"
    | "dashboard"
    | "clinical"
    | "opd"
    | "accounting"
    | "marketing"
    | "location"
    | "sidebar";
  /** If omitted/undefined → all roles see this tile. Empty [] → no one sees it. */
  roles?: string[];
}

export const ALL_ROLES = [
  "superadmin",
  "ca",
  "admin",
  "doctor",
  "nurse",
  "receptionist",
  "lab_technician",
  "pharmacist",
  "radiology_tech",
  "ot_tech",
  "cath_lab_tech",
  "marketing",
  "billing",
  // Tilak keeps the books. Was missing here, so it could not be picked in User
  // Management even though the accounting code already grants it rights.
  "accountant",
  "housekeeping",
  "security",
  "driver",
  "physiotherapist",
  // All of these are already held by live users but were absent here, so an
  // admin editing one of those people could not re-pick their own role and a
  // save would silently move them to something else.
  "finance",
  "reception",
  "pharmacy",
  "user",
] as const;

export const ALL_TILE_GROUPS = [
  "tablet",
  "dashboard",
  "clinical",
  "opd",
  "accounting",
  "marketing",
  "location",
  "sidebar",
] as const;

export const GROUP_LABELS: Record<string, string> = {
  tablet: "Tablet Home Tiles",
  dashboard: "Dashboard KPIs",
  clinical: "Clinical KPIs",
  opd: "OPD Statistics",
  accounting: "Accounting Tiles",
  marketing: "Marketing Stats",
  location: "Location Master",
  sidebar: "Sidebar Menus",
};

export const TILE_ACCESS_RULES: TileAccessRule[] = [
  // ── Tablet Home Tiles (18) ──────────────────────────────────────────
  { id: "t-director", label: "Director Dashboard", group: "tablet" },
  { id: "t-hr-pulse", label: "HR Pulse", group: "tablet" },
  { id: "t-register", label: "Register Patient Diksha", group: "tablet" },
  { id: "t-occupancy", label: "Bed Occupancy", group: "tablet" },
  { id: "t-icu-admission", label: "ICU Admission", group: "tablet" },
  { id: "t-patient-profile", label: "Patient Profile Sonali", group: "tablet" },
  { id: "t-advance", label: "Advance Statement Arshiya", group: "tablet" },
  { id: "t-requisition", label: "Requisition", group: "tablet" },
  { id: "t-gate-pass", label: "Gate Pass", group: "tablet" },
  { id: "t-discharge-summary", label: "Discharge Summary - Diksha", group: "tablet" },
  { id: "t-doctor-notes", label: "Doctor Notes", group: "tablet" },
  { id: "t-ot-schedule-gaurav", label: "OT Schedule - Gaurav", group: "tablet" },
  { id: "t-rmo-duty-gaurav", label: "RMO Duty - Gaurav", group: "tablet" },
  { id: "t-rmo-duty-javed", label: "JAVED RMO DUTY", group: "tablet" },
  { id: "t-ot-photos-sarvesh", label: "OT Photos - Sarvesh", group: "tablet" },
  { id: "t-implant-servesh", label: "Implant Sarvesh", group: "tablet" },
  { id: "t-implant-bill", label: "Implant Bill", group: "tablet" },
  { id: "t-implant-sticker", label: "Implant Sticker", group: "tablet" },
  { id: "t-pharmacy", label: "Pharmacy", group: "tablet" },
  { id: "t-medication-round", label: "Medication Round", group: "tablet" },
  { id: "t-discharge", label: "Discharged Patients", group: "tablet" },
  { id: "t-dama", label: "DAMA / LAMA", group: "tablet" },
  { id: "t-billing", label: "Billing", group: "tablet" },
  { id: "t-documents", label: "Document azhar", group: "tablet" },
  { id: "t-cash-in-hand", label: "Cash in Hand", group: "tablet" },
  { id: "t-report", label: "Reports", group: "tablet" },
  { id: "t-referral-register", label: "Referral Register", group: "tablet" },
  { id: "t-referee-ruby", label: "Referee - Ruby", group: "tablet" },
  { id: "t-referee-viji", label: "Referee - Viji", group: "tablet" },

  // ── Dashboard KPIs (6 Director + 2 Statistics) ────────────────────
  { id: "d-admissions", label: "Admissions", group: "dashboard" },
  { id: "d-discharges", label: "Discharges", group: "dashboard" },
  { id: "d-opd-visits", label: "OPD Visits", group: "dashboard" },
  { id: "d-collection", label: "Collection", group: "dashboard" },
  { id: "d-currently-admitted", label: "Currently Admitted", group: "dashboard" },
  { id: "d-pending-approvals", label: "Pending Approvals", group: "dashboard" },
  { id: "d-total-patients", label: "Total Patients", group: "dashboard" },

  // ── Clinical KPIs (6) ──────────────────────────────────────────────
  { id: "c-alos", label: "ALOS", group: "clinical" },
  { id: "c-bor", label: "BOR", group: "clinical" },
  { id: "c-btr", label: "BTR", group: "clinical" },
  { id: "c-bti", label: "BTI", group: "clinical" },
  { id: "c-arpp", label: "ARPP", group: "clinical" },
  { id: "c-admission-rate", label: "Admission Rate", group: "clinical" },

  // ── OPD Statistics (4) ────────────────────────────────────────────
  { id: "o-waiting", label: "OPD Waiting", group: "opd" },
  { id: "o-in-progress", label: "OPD In Progress", group: "opd" },
  { id: "o-completed", label: "OPD Completed", group: "opd" },
  { id: "o-total", label: "Total OPD Today", group: "opd" },

  // ── Accounting Tiles (6) ──────────────────────────────────────────
  { id: "a-cash-in-hand", label: "Cash-in-Hand", group: "accounting" },
  { id: "a-bank-accounts", label: "Bank Accounts", group: "accounting" },
  { id: "a-income-fy", label: "Income (FY)", group: "accounting" },
  { id: "a-expenses-fy", label: "Expenses (FY)", group: "accounting" },
  { id: "a-nett-profit-loss", label: "Nett Profit/Loss (FY)", group: "accounting" },

  // ── Marketing Stats (12) ──────────────────────────────────────────
  { id: "m-doctors-today", label: "Doctors Today", group: "marketing" },
  { id: "m-doctors-month", label: "Doctors Month", group: "marketing" },
  { id: "m-admissions-yesterday", label: "Admissions Yesterday", group: "marketing" },
  { id: "m-admissions-month", label: "Admissions Month", group: "marketing" },
  { id: "m-occupancy-today", label: "Occupancy Today", group: "marketing" },
  { id: "m-avg-occupancy-month", label: "Avg Occupancy Month", group: "marketing" },
  { id: "m-revenue-today", label: "Revenue Today", group: "marketing" },
  { id: "m-revenue-month", label: "Revenue Month", group: "marketing" },
  { id: "m-revenue-year", label: "Revenue Year", group: "marketing" },
  { id: "m-discharges-yesterday", label: "Discharges Yesterday", group: "marketing" },
  { id: "m-discharges-month", label: "Discharges Month", group: "marketing" },
  { id: "m-todays-plan", label: "Today's Plan", group: "marketing" },

  // ── Location Master Stats (4) ─────────────────────────────────────
  { id: "l-corporates", label: "Corporates", group: "location" },
  { id: "l-hospitals", label: "Hospitals/Dispensaries", group: "location" },
  { id: "l-contacts", label: "Referral Contacts", group: "location" },
  { id: "l-meetings", label: "Meetings This Month", group: "location" },

  // ── Sidebar Menus (key items) ──────────────────────────────────────
  { id: "s-users", label: "Users", group: "sidebar", roles: ["superadmin", "super_admin", "ca"] },
  { id: "s-user-management", label: "User Management", group: "sidebar", roles: ["superadmin", "super_admin", "ca"] },
  { id: "s-payment-allocation", label: "Payment Allocation", group: "sidebar" },
  { id: "s-director-dashboard", label: "Director Dashboard", group: "sidebar" },
  { id: "s-lab-master", label: "Lab Master", group: "sidebar", roles: ["superadmin", "super_admin", "ca", "admin"] },
  { id: "s-radiology-master", label: "Radiology Master", group: "sidebar", roles: ["superadmin", "super_admin", "ca"] },
  { id: "s-surgery", label: "Surgery", group: "sidebar", roles: ["superadmin", "super_admin", "ca"] },
  { id: "s-accounting", label: "Accounting", group: "sidebar" },
  { id: "s-referral-register", label: "Referral Register", group: "sidebar" },
  { id: "s-marketing-dashboard", label: "Marketing Dashboard", group: "sidebar" },
  { id: "s-location-master", label: "Location Master", group: "sidebar" },
];
