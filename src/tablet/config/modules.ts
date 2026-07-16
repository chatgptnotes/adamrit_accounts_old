import {
  AlertTriangle,
  Banknote,
  BarChart3,
  BedDouble,
  ClipboardCheck,
  ClipboardList,
  DoorOpen,
  FileText,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Pill,
  Receipt,
  Stethoscope,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { canAccessReferralRegister } from "@/lib/referralRegisterAccess";

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
  /** If set, only these roles see the tile (admins always see everything). */
  roles?: string[];
}

/** The 12 v1 tablet modules, in home-grid order. */
export const TABLET_MODULES: TabletModule[] = [
  {
    id: "director",
    label: "Director Dashboard",
    description: "KPIs & payment deadlines",
    icon: LayoutDashboard,
    accent: "text-purple-600",
    tint: "from-purple-400 to-purple-600",
    roles: ["superadmin", "super_admin"],
  },
  {
    id: "register",
    label: "Register Patient",
    description: "New patient & visit",
    icon: UserPlus,
    accent: "text-emerald-600",
    tint: "from-emerald-400 to-emerald-600",
    roles: ["receptionist", "reception", "front_office", "nurse"],
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
    id: "icu-admission",
    label: "ICU Admission",
    description: "Admit / transfer to ICU bed",
    icon: HeartPulse,
    accent: "text-rose-600",
    tint: "from-rose-400 to-rose-600",
    roles: ["receptionist", "reception", "nurse", "doctor"],
  },
  {
    id: "patient-profile",
    label: "Patient Profile",
    description: "View patient details",
    icon: UserRound,
    accent: "text-blue-600",
    tint: "from-blue-400 to-blue-600",
  },
  {
    id: "advance",
    label: "Advance Statement",
    description: "Collect advance & view statement",
    icon: Wallet,
    accent: "text-amber-600",
    tint: "from-amber-400 to-amber-600",
    roles: ["receptionist", "reception", "billing", "front_office"],
  },

  {
    id: "requisition",
    label: "Requisition",
    description: "Raise lab / radiology / store",
    icon: ClipboardList,
    accent: "text-indigo-600",
    tint: "from-indigo-400 to-indigo-600",
    roles: ["nurse", "doctor", "receptionist", "reception"],
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
    label: "Discharge Summary",
    description: "View & print summary",
    icon: FileText,
    accent: "text-violet-600",
    tint: "from-violet-400 to-violet-600",
    roles: ["doctor", "nurse", "consultant"],
  },
  {
    id: "doctor-notes",
    label: "Doctor Notes",
    description: "Bedside clinical notes",
    icon: Stethoscope,
    accent: "text-teal-600",
    tint: "from-teal-400 to-teal-600",
    roles: ["doctor", "consultant", "nurse"],
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
    roles: ["nurse", "doctor"],
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
    roles: ["doctor", "nurse", "consultant"],
  },
  {
    id: "billing",
    label: "Billing",
    description: "View bill & collect payment",
    icon: Receipt,
    accent: "text-fuchsia-600",
    tint: "from-fuchsia-400 to-fuchsia-600",
    roles: ["billing", "receptionist", "reception"],
  },
  {
    id: "cash-in-hand",
    label: "Cash in Hand",
    description: "Today's cash position",
    icon: Banknote,
    accent: "text-green-600",
    tint: "from-green-400 to-green-600",
    roles: ["billing", "receptionist", "reception"],
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
];

const ADMIN_ROLES = ["admin", "superadmin", "super_admin"];
const DIRECTOR_ROLES = ["superadmin", "super_admin"];
const DIRECTOR_EMAILS = ["cmd@hopehospital.com", "finance@hopehospital.com"];

/** Tiles hidden from the tablet edition for all users. */
const HIDDEN_MODULE_IDS = new Set([
  "occupancy",
  "icu-admission",
  "requisition",
  "gate-pass",
  "discharge-summary",
  "dama",
  "billing",
]);

/**
 * Modules visible to a given user. Admins (and unknown roles) see all except
 * the Director tile, which is restricted to superadmin role or director emails.
 *
 * If `canSeeTile` is provided (from useTileAccess hook), it overrides the
 * hardcoded `roles` on each module for dynamic config-based gating.
 */
export function modulesForUser(
  user: { role?: string; email?: string } | undefined,
  canSeeTile?: (tileId: string, role?: string | null) => boolean,
): TabletModule[] {
  const role = user?.role;
  const email = user?.email?.toLowerCase() ?? "";
  const isDirectorRole = !!role && DIRECTOR_ROLES.includes(role);
  const isDirectorEmail = DIRECTOR_EMAILS.includes(email);

  return TABLET_MODULES.filter((m) => {
    if (HIDDEN_MODULE_IDS.has(m.id)) return false;
    if (m.id === "director") {
      return isDirectorRole || isDirectorEmail;
    }
    if (m.id === "referral-register") {
      return canAccessReferralRegister(user);
    }
    if (canSeeTile) {
      return canSeeTile(`t-${m.id}`, role);
    }
    const isAdmin = !!role && ADMIN_ROLES.includes(role);
    if (!role || isAdmin) return true;
    return !m.roles || m.roles.includes(role);
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
