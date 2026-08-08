// Client for /api/admin-users — the only way this app reads or writes staff
// accounts now. Nothing here touches Supabase directly: the anon key cannot see
// password hashes or staff PINs any more, and it is not supposed to.
//
// AdminUser is declared here rather than imported from the generated Supabase
// types because src/integrations/supabase/types.ts is stale for this table (it
// is missing employee_id and hr_pulse_can_view_all, which is why the old page
// cast `(supabase as any)` on every call). This type describes what the API
// actually returns, which is the contract that matters.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface AdminUser {
  id: string;
  full_name: string | null;
  employee_id: string | null;
  email: string;
  phone: string | null;
  role: string | null;
  hospital_type: string | null;
  company_id: string | null;
  department: string | null;
  designation: string | null;
  is_active: boolean | null;
  must_change_password: boolean | null;
  hr_pulse_can_view_all: boolean | null;
  last_login_at: string | null;
  created_at: string | null;
  /** Whether a staff PIN is set. The PIN itself never leaves the server. */
  has_staff_pin?: boolean;
}

export interface ImportFailure {
  row: number;
  email: string;
  reason: string;
}

export interface ImportedCredential {
  email: string;
  full_name: string;
  phone: string | null;
  password: string;
}

export type BulkOp = "role" | "hospital" | "active" | "force_reset";

export const ADMIN_USERS_KEY = ["admin-users"] as const;

/**
 * The API answers with machine-readable error codes so the server stays the
 * single source of truth on what is allowed; this is where they become English.
 */
const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: "Your session has expired. Please log in again.",
  super_admin_required: "Only a super admin can manage users.",
  account_inactive: "Your account is no longer active.",
  email_already_exists: "That email address is already registered.",
  valid_email_required: "Enter a valid email address.",
  full_name_required: "Full name is required.",
  password_required: "A password is required for new users.",
  password_too_short: "Password must be at least 8 characters.",
  cannot_demote_yourself: "You cannot remove your own super admin access.",
  cannot_deactivate_yourself: "You cannot deactivate your own account.",
  cannot_delete_yourself: "You cannot delete your own account.",
  cannot_include_yourself: "Remove yourself from the selection first.",
  last_super_admin: "This is the last active super admin — promote someone else first.",
  user_referenced_elsewhere: "This user has records in the system and cannot be deleted. Deactivate them instead.",
  delete_not_permitted: "The database refused the delete.",
  pin_must_be_four_digits: "A staff PIN must be exactly 4 digits.",
  pin_already_in_use: "That staff PIN is already assigned to someone else.",
  nothing_to_update: "No changes to save.",
  too_many_rows: "That file has too many rows — import up to 500 at a time.",
};

export const adminUsersErrorMessage = (error: unknown): string => {
  const code = error instanceof Error ? error.message : String(error);
  return ERROR_MESSAGES[code] || code || "Something went wrong.";
};

async function callAdminUsers<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/admin-users", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || "request_failed");
  return payload as T;
}

export function useAdminUsers() {
  const queryClient = useQueryClient();

  const usersQuery = useQuery({
    queryKey: ADMIN_USERS_KEY,
    queryFn: async (): Promise<AdminUser[]> => {
      const response = await fetch("/api/admin-users", { credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "request_failed");
      return payload.users as AdminUser[];
    },
  });

  const setCache = (updater: (previous: AdminUser[]) => AdminUser[]) =>
    queryClient.setQueryData<AdminUser[]>(ADMIN_USERS_KEY, (previous) => updater(previous || []));

  const mergeUser = (user: AdminUser) =>
    setCache((previous) => previous.map((u) => (u.id === user.id ? { ...u, ...user } : u)));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ADMIN_USERS_KEY });

  /**
   * Inline role/hospital/status edits apply to the cache immediately so the cell
   * does not visibly lag a click. onMutate captures the row as it was, and
   * onError puts it back — otherwise a rejected change (the last-super-admin
   * guard, say) leaves the table showing a value the database never accepted.
   */
  const patchUser = useMutation({
    mutationFn: (variables: { id: string; patch: Partial<AdminUser> }) =>
      callAdminUsers<{ user: AdminUser }>({ action: "update", id: variables.id, patch: variables.patch }),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: ADMIN_USERS_KEY });
      const snapshot = queryClient.getQueryData<AdminUser[]>(ADMIN_USERS_KEY);
      setCache((previous) => previous.map((u) => (u.id === id ? { ...u, ...patch } : u)));
      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      if (context?.snapshot) queryClient.setQueryData(ADMIN_USERS_KEY, context.snapshot);
    },
    onSuccess: ({ user }) => mergeUser(user),
  });

  const createUser = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      callAdminUsers<{ user: AdminUser }>({ action: "create", patch }),
    onSuccess: invalidate,
  });

  const resetPassword = useMutation({
    mutationFn: (variables: { id: string; password?: string; mustChange?: boolean }) =>
      callAdminUsers<{ user: AdminUser; password: string }>({
        action: "reset_password",
        id: variables.id,
        password: variables.password,
        mustChange: variables.mustChange,
      }),
    onSuccess: ({ user }) => mergeUser(user),
  });

  const bulkUpdate = useMutation({
    mutationFn: (variables: { ids: string[]; op: BulkOp; value?: unknown }) =>
      callAdminUsers<{ users: AdminUser[] }>({
        action: "bulk",
        ids: variables.ids,
        op: variables.op,
        value: variables.value,
      }),
    onSuccess: invalidate,
  });

  const importUsers = useMutation({
    mutationFn: (rows: Record<string, string>[]) =>
      callAdminUsers<{ users: AdminUser[]; failures: ImportFailure[]; credentials: ImportedCredential[] }>({
        action: "import",
        rows,
      }),
    onSuccess: invalidate,
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => callAdminUsers<{ id: string }>({ action: "delete", id }),
    onSuccess: ({ id }) => setCache((previous) => previous.filter((u) => u.id !== id)),
  });

  const setHrPulse = useMutation({
    mutationFn: (variables: { id: string; value: boolean }) =>
      callAdminUsers<{ user: AdminUser }>({ action: "set_hr_pulse", id: variables.id, value: variables.value }),
    onSuccess: ({ user }) => mergeUser(user),
  });

  const setStaffPin = useMutation({
    mutationFn: (variables: { id: string; pin: string | null }) =>
      callAdminUsers<{ user: AdminUser }>({ action: "set_staff_pin", id: variables.id, pin: variables.pin }),
    onSuccess: ({ user }) => mergeUser(user),
  });

  return {
    users: usersQuery.data || [],
    loading: usersQuery.isLoading,
    error: usersQuery.error,
    refetch: usersQuery.refetch,
    createUser,
    patchUser,
    resetPassword,
    bulkUpdate,
    importUsers,
    deleteUser,
    setHrPulse,
    setStaffPin,
  };
}
