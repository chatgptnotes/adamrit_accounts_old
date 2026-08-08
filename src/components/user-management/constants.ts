import type { AdminUser } from "@/hooks/useAdminUsers";

/** Human-readable labels for roles. */
export const ROLE_LABELS: Record<string, string> = {
  superadmin: "Super Admin",
  super_admin: "Super Admin",
  ca: "CA",
  admin: "Admin",
  doctor: "Doctor",
  nurse: "Nurse",
  receptionist: "Receptionist",
  lab_technician: "Lab Technician",
  pharmacist: "Pharmacist",
  radiology_tech: "Radiology Tech",
  ot_tech: "OT Tech",
  cath_lab_tech: "Cath Lab Tech",
  marketing: "Marketing",
  billing: "Billing",
  housekeeping: "Housekeeping",
  security: "Security",
  driver: "Driver",
  physiotherapist: "Physiotherapist",
};

export const roleLabel = (role?: string | null): string =>
  ROLE_LABELS[String(role || "")] || role || "-";

export const HOSPITALS = [
  { value: "hope", label: "Hope" },
  { value: "ayushman", label: "Ayushman" },
];

/**
 * The bucket a user counts towards on the stat card and in the Hospital filter.
 *
 * The old page compared hospital_type to the literals 'hope' and 'ayushman', so
 * a row with NULL, a stray capital, or a third hospital counted towards neither
 * and could not be filtered to — which is why the card showed 58 of 91 users.
 * Everything now goes through here, so every user lands in exactly one bucket.
 */
export const UNASSIGNED = "unassigned";

export const hospitalKey = (user: Pick<AdminUser, "hospital_type">): string =>
  String(user.hospital_type || "").trim().toLowerCase() || UNASSIGNED;

export const hospitalLabel = (key: string): string =>
  key === UNASSIGNED
    ? "Unassigned"
    : HOSPITALS.find((h) => h.value === key)?.label || key;

/** Buckets present in the data, largest first, so the UI never hides a user. */
export const countByHospital = (users: AdminUser[]): { key: string; count: number }[] => {
  const counts = new Map<string, number>();
  for (const user of users) {
    const key = hospitalKey(user);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
};

/** Roles present in the data, so a role that drifted out of ALL_ROLES stays filterable. */
export const rolesInData = (users: AdminUser[]): string[] =>
  [...new Set(users.map((u) => String(u.role || "").trim()).filter(Boolean))].sort();

export const isActive = (user: Pick<AdminUser, "is_active">): boolean => user.is_active !== false;
