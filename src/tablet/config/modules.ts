import {
  AlertTriangle,
  ArrowLeftRight,
  Banknote,
  BarChart3,
  BedDouble,
  CalendarCheck,
  CalendarClock,
  Camera,
  ClipboardCheck,
  ClipboardList,
  CheckSquare,
  DoorOpen,
  Droplets,
  FileText,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Megaphone,
  NotebookPen,
  Package,
  Pill,
  Receipt,
  ReceiptIndianRupee,
  ScanLine,
  Stethoscope,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { canCreateAccountingVouchers } from "@/lib/accounting-access";

export interface TabletModule {
  /** URL segment under /t/ and lookup key. */
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Tailwind text-color class for the tile icon. */
  accent: string;
  /** Tailwind gradient stops for the tile icon chip (static for JIT). */
  tint: string;
  /** Optional role metadata; tablet home currently does not hard-gate by role. */
  roles?: string[];
  /** Voucher creation tiles use the shared desktop accounting rights. */
  accountingOnly?: boolean;
  /** Hide from the tablet home grid while still allowing direct navigation. */
  hiddenFromHome?: boolean;
}

/** All tablet modules, including child flows that should not appear on the home grid. */
export const TABLET_MODULES: TabletModule[] = [
  {
    id: "director",
    label: "Director Dashboard",
    description: "KPIs & payment deadlines",
    icon: LayoutDashboard,
    accent: "text-purple-600",
    tint: "from-purple-400 to-purple-600",
  },
  {
    id: "register",
    label: "Register Patient Disha",
    description: "New patient & visit",
    icon: UserPlus,
    accent: "text-emerald-600",
    tint: "from-emerald-400 to-emerald-600",
  },
  {
    id: "occupancy",
    label: "Bed Occupancy",
    description: "Live ward & bed status",
    icon: BedDouble,
    accent: "text-sky-600",
    tint: "from-sky-400 to-sky-600",
  },
  {
    id: "bed-shifting",
    label: "Bed Shifting",
    description: "Drag a patient to another bed",
    icon: ArrowLeftRight,
    accent: "text-amber-600",
    tint: "from-amber-400 to-amber-600",
  },
  {
    id: "bed-booking",
    label: "Bed Booking",
    description: "Reserve a bed for an incoming patient",
    icon: CalendarCheck,
    accent: "text-orange-600",
    tint: "from-orange-400 to-orange-600",
  },
  {
    id: "icu-admission",
    label: "ICU Admission",
    description: "Admit / transfer to ICU bed",
    icon: HeartPulse,
    accent: "text-rose-600",
    tint: "from-rose-400 to-rose-600",
  },
  {
    id: "patient-profile",
    label: "Patient Profile Sonali",
    description: "View patient details",
    icon: UserRound,
    accent: "text-blue-600",
    tint: "from-blue-400 to-blue-600",
  },
  {
    id: "advance",
    label: "Advance Statement Arshiya",
    description: "Collect advance & view statement",
    icon: Wallet,
    accent: "text-amber-600",
    tint: "from-amber-400 to-amber-600",
  },
  {
    id: "accounts-tilak",
    label: "Accounts (Tilak)",
    description: "Daily receipts & expenses",
    icon: NotebookPen,
    accent: "text-emerald-700",
    tint: "from-emerald-500 to-cyan-600",
  },
  {
    id: "payment-voucher",
    label: "Payment Voucher",
    description: "Create payment voucher with invoice proof",
    icon: Banknote,
    accent: "text-red-700",
    tint: "from-red-500 to-rose-700",
    accountingOnly: true,
  },
  {
    id: "receipt-voucher",
    label: "Receipt Voucher",
    description: "Create receipt voucher with invoice proof",
    icon: Receipt,
    accent: "text-emerald-700",
    tint: "from-emerald-500 to-green-700",
    accountingOnly: true,
  },
  {
    id: "contra-voucher",
    label: "Contra Voucher",
    description: "Transfer between cash and bank ledgers",
    icon: ArrowLeftRight,
    accent: "text-blue-700",
    tint: "from-blue-500 to-indigo-700",
    accountingOnly: true,
  },
  {
    id: "journal-voucher",
    label: "Journal Voucher",
    description: "Create balanced general journal entry",
    icon: NotebookPen,
    accent: "text-violet-700",
    tint: "from-violet-500 to-purple-700",
    accountingOnly: true,
  },
  {
    id: "expense-bills",
    label: "Expense Bills",
    description: "Record supplier and utility invoices",
    icon: ReceiptIndianRupee,
    accent: "text-rose-700",
    tint: "from-rose-500 to-red-700",
    accountingOnly: true,
  },
  {
    id: "payments-due",
    label: "Payments Due",
    description: "Pay today's salary, rent and vendor obligations",
    icon: CalendarClock,
    accent: "text-amber-700",
    tint: "from-amber-500 to-orange-700",
    accountingOnly: true,
  },
  {
    id: "payment-collection-gaurav",
    label: "Payment Collection (Vasooli) - Gaurav",
    description: "Pending & received bills",
    icon: Wallet,
    accent: "text-teal-700",
    tint: "from-teal-500 to-blue-600",
  },
  {
    id: "private-room-charges-reena",
    label: "Extra Charges (Private Room) - Reena",
    description: "Date-wise private bed charges",
    icon: BedDouble,
    accent: "text-indigo-600",
    tint: "from-indigo-400 to-indigo-600",
  },

  {
    id: "requisition",
    label: "Requisition",
    description: "Raise lab / radiology / store",
    icon: ClipboardList,
    accent: "text-indigo-600",
    tint: "from-indigo-400 to-indigo-600",
  },
  {
    id: "gate-pass",
    label: "Gate Pass",
    description: "Issue & print gate pass",
    icon: DoorOpen,
    accent: "text-cyan-600",
    tint: "from-cyan-400 to-cyan-600",
  },
  {
    id: "discharge-summary",
    label: "Discharge Summary - Diksha",
    description: "View & print summary",
    icon: FileText,
    accent: "text-violet-600",
    tint: "from-violet-400 to-violet-600",
  },
  {
    id: "doctor-notes",
    label: "Doctor Notes",
    description: "Bedside clinical notes",
    icon: Stethoscope,
    accent: "text-teal-600",
    tint: "from-teal-400 to-teal-600",
  },
  {
    id: "dialysis",
    label: "Dialysis",
    description: "Cycle billing & 30-day lab reports",
    icon: Droplets,
    accent: "text-sky-700",
    tint: "from-sky-400 to-blue-600",
  },
  {
    id: "ot-schedule-gaurav",
    label: "OT Schedule - Gaurav",
    description: "Schedule surgery date & time",
    icon: CalendarClock,
    accent: "text-blue-700",
    tint: "from-blue-400 to-cyan-600",
  },
  {
    id: "ot-photos-sarvesh",
    label: "OT Photos - Sarvesh",
    description: "Mark OT done & upload photos",
    icon: Camera,
    accent: "text-emerald-700",
    tint: "from-emerald-400 to-teal-600",
  },
  {
    id: "implant-servesh",
    label: "Implant Sarvesh",
    description: "Open implant bill & sticker tools",
    icon: Package,
    accent: "text-rose-700",
    tint: "from-rose-400 to-orange-600",
  },
  {
    id: "implant-bill",
    label: "Implant Bill",
    description: "Create implant vendor invoice",
    icon: Receipt,
    accent: "text-rose-600",
    tint: "from-rose-400 to-red-600",
    hiddenFromHome: true,
  },
  {
    id: "implant-sticker",
    label: "Implant Sticker",
    description: "Create implant pouch cover sheet",
    icon: ScanLine,
    accent: "text-cyan-700",
    tint: "from-cyan-400 to-blue-600",
    hiddenFromHome: true,
  },
  {
    id: "pharmacy-dispense",
    label: "Pharmacy",
    description: "Dispense / substitute approved meds",
    icon: Pill,
    accent: "text-lime-600",
    tint: "from-lime-400 to-lime-600",
    // No role gate: shown to all non-admin roles (the pharmacy role string
    // varies by deployment). Tighten once that role is confirmed.
  },
  {
    id: "medication-round",
    label: "Medication Round",
    description: "Mark doses given / missed",
    icon: ClipboardCheck,
    accent: "text-pink-600",
    tint: "from-pink-400 to-pink-600",
  },
  {
    id: "discharge",
    label: "Discharged Patients",
    description: "Discharged patient list",
    icon: LogOut,
    accent: "text-slate-600",
    tint: "from-slate-400 to-slate-600",
  },
  {
    id: "dama",
    label: "DAMA / LAMA",
    description: "Discharge against medical advice",
    icon: AlertTriangle,
    accent: "text-orange-600",
    tint: "from-orange-400 to-orange-600",
  },
  {
    id: "billing",
    label: "Billing",
    description: "View bill & collect payment",
    icon: Receipt,
    accent: "text-fuchsia-600",
    tint: "from-fuchsia-400 to-fuchsia-600",
  },
  {
    id: "documents",
    label: "Document azhar",
    description: "Patient documents & downloads",
    icon: FileText,
    accent: "text-indigo-600",
    tint: "from-indigo-400 to-blue-600",
  },
  {
    id: "cash-in-hand",
    label: "Cash in Hand",
    description: "Today's cash position",
    icon: Banknote,
    accent: "text-green-600",
    tint: "from-green-400 to-green-600",
  },
  {
    id: "report",
    label: "Reports",
    description: "Occupancy, collections, census",
    icon: BarChart3,
    accent: "text-blue-600",
    tint: "from-blue-400 to-blue-600",
  },
  {
    id: "referral-register",
    label: "Referral Register",
    description: "Complete referral entries",
    icon: Users,
    accent: "text-emerald-600",
    tint: "from-emerald-400 to-emerald-600",
  },
  {
    id: "referee-ruby",
    label: "Referee - Ruby",
    description: "OPDs & admissions · how patients found us",
    icon: Megaphone,
    accent: "text-pink-700",
    tint: "from-pink-400 to-rose-600",
    roles: ["superadmin", "super_admin"],
  },
  {
    id: "referee-viji",
    label: "Referee - Viji",
    description: "Approve & comment on referrals",
    icon: CheckSquare,
    accent: "text-emerald-700",
    tint: "from-emerald-400 to-teal-600",
    roles: ["superadmin", "super_admin"],
  },
  {
    // Drill list behind every Director Dashboard tile. Which metric it shows comes
    // from ?metric=, so the flow renders its own heading rather than relying on this
    // label.
    id: "director-list",
    label: "Director Dashboard",
    description: "Patients behind a dashboard tile",
    icon: ClipboardList,
    accent: "text-purple-600",
    tint: "from-purple-400 to-purple-600",
    hiddenFromHome: true,
  },
  {
    // Panel-wise mandatory documents. Also reached from the Director Dashboard
    // preview card and from the yellow bell (?patient= opens one checklist).
    id: "panel-documents",
    label: "Panel Documents",
    description: "Panel-wise mandatory docs",
    icon: ClipboardCheck,
    accent: "text-cyan-600",
    tint: "from-cyan-400 to-cyan-600",
  },
];

/**
 * Modules visible to a given user.
 *
 * If `canSeeTile` is provided (from useTileAccess hook), it controls per-tile
 * visibility.
 */
export function modulesForUser(
  user: { role?: string; email?: string } | undefined,
  canSeeTile?: (tileId: string, role?: string | null) => boolean,
): TabletModule[] {
  void canSeeTile;
  // Temporary product rule: tablet home/modules are visible to every user,
  // regardless of tile-access overrides — EXCEPT modules that explicitly
  // declare a `roles` array, which are hard-gated to that list. Re-enable
  // full tile-access filtering here when the tablet role matrix is finalized.
  return TABLET_MODULES.filter((module) => {
    if (module.hiddenFromHome) return false;
    if (module.accountingOnly && !canCreateAccountingVouchers(user)) return false;
    if (module.roles && module.roles.length > 0) {
      return !!user?.role && module.roles.includes(user.role);
    }
    return true;
  });
}

export function getModule(id: string | undefined): TabletModule | undefined {
  return TABLET_MODULES.find((m) => m.id === id);
}

/**
 * Module ids surfaced as primary destinations in the bottom tab bar, in order.
 * "Home" (the module grid) is added by the nav itself. Tabs the current user
 * can't see (per `modulesForUser`) are dropped automatically.
 */
export const BOTTOM_NAV_IDS = [
  "register",
  "billing",
  "doctor-notes",
  "medication-round",
];
