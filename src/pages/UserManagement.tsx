import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { UserCog, Plus, RefreshCw, Upload } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanies } from "@/hooks/useCompanies";
import { useTileAccess } from "@/hooks/useTileAccess";
import { isSuperAdminRole } from "@/lib/roles";
import { adminUsersErrorMessage, useAdminUsers, type AdminUser, type BulkOp } from "@/hooks/useAdminUsers";

import UserStatCards from "@/components/user-management/UserStatCards";
import GoogleSignInReadiness from "@/components/user-management/GoogleSignInReadiness";
import UserFilters, { type Filters } from "@/components/user-management/UserFilters";
import UserTable from "@/components/user-management/UserTable";
import BulkActionBar from "@/components/user-management/BulkActionBar";
import ResetPasswordDialog from "@/components/user-management/ResetPasswordDialog";
import UserFormDialog, { type UserFormData } from "@/components/user-management/UserFormDialog";
import CsvImportDialog from "@/components/user-management/CsvImportDialog";
import TileAccessMatrix from "@/components/user-management/TileAccessMatrix";
import HrPulseAccess from "@/components/user-management/HrPulseAccess";
import { hospitalKey, isActive } from "@/components/user-management/constants";

const EMPTY_FILTERS: Filters = { search: "", role: "all", hospital: "all", status: "all" };

const UserManagement: React.FC = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: companies = [] } = useCompanies();
  const { resetToDefaults } = useTileAccess();
  const isSuperAdmin = isSuperAdminRole(user?.role);

  const {
    users, loading, error, refetch,
    createUser, patchUser, resetPassword, bulkUpdate, importUsers, deleteUser, setHrPulse,
  } = useAdminUsers();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [showCsv, setShowCsv] = useState(false);
  const [hrPulseBusyId, setHrPulseBusyId] = useState<string | null>(null);

  const fail = (err: unknown) =>
    toast({ title: "Error", description: adminUsersErrorMessage(err), variant: "destructive" });

  const filtered = useMemo(() => {
    const term = filters.search.trim().toLowerCase();
    return users.filter((u) => {
      const matchesSearch =
        !term ||
        (u.full_name || "").toLowerCase().includes(term) ||
        (u.email || "").toLowerCase().includes(term) ||
        (u.phone || "").toLowerCase().includes(term);
      const matchesRole = filters.role === "all" || u.role === filters.role;
      const matchesHospital = filters.hospital === "all" || hospitalKey(u) === filters.hospital;
      const matchesStatus =
        filters.status === "all" ||
        (filters.status === "active" && isActive(u)) ||
        (filters.status === "inactive" && !isActive(u));
      return matchesSearch && matchesRole && matchesHospital && matchesStatus;
    });
  }, [users, filters]);

  // A selection that survives a filter change would let a confirm dialog say
  // "12 users" while the table shows three. Changing the filter clears it.
  const changeFilters = (next: Filters) => {
    setFilters(next);
    setSelected(new Set());
  };

  const handlePatch = (id: string, patch: Partial<AdminUser>) => {
    patchUser.mutate({ id, patch }, { onError: fail });
  };

  const handleSave = (form: UserFormData) => {
    const patch = {
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      employee_id: form.employee_id.trim(),
      phone: form.phone.trim(),
      role: form.role,
      hospital_type: form.hospital_type,
      department: form.department.trim(),
      designation: form.designation.trim(),
      company_id: form.company_id || null,
      is_active: form.is_active,
      must_change_password: form.must_change_password,
    };

    const done = {
      onSuccess: () => {
        toast({ title: editing ? "User updated" : "User created" });
        setShowForm(false);
        setEditing(null);
      },
      onError: fail,
    };

    if (editing) patchUser.mutate({ id: editing.id, patch }, done);
    else createUser.mutate({ ...patch, password: form.password }, done);
  };

  const handleBulk = (op: BulkOp, value?: unknown) => {
    bulkUpdate.mutate(
      { ids: [...selected], op, value },
      {
        onSuccess: ({ users: updated }) => {
          toast({ title: `Updated ${updated.length} user${updated.length === 1 ? "" : "s"}` });
          setSelected(new Set());
        },
        onError: fail,
      },
    );
  };

  const confirmDelete = () => {
    if (!deleting) return;
    deleteUser.mutate(deleting.id, {
      onSuccess: () => {
        toast({ title: "User deleted", description: deleting.email });
        setDeleting(null);
      },
      onError: (err) => { fail(err); setDeleting(null); },
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
        <div className="max-w-7xl mx-auto text-center py-24 text-muted-foreground">
          Loading users...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
        <div className="max-w-7xl mx-auto py-24 text-center space-y-4">
          <p className="text-red-600">{adminUsersErrorMessage(error)}</p>
          <Button onClick={() => refetch()}>Try again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <UserCog className="h-8 w-8 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold text-blue-900">User Management</h1>
              <p className="text-sm text-muted-foreground">
                Manage system users, roles and access
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowCsv(true)}>
              <Upload className="h-4 w-4 mr-1" />
              Bulk Upload
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }}>
              <Plus className="h-4 w-4 mr-1" />
              Add User
            </Button>
          </div>
        </div>

        <UserStatCards
          users={users}
          onSelectHospital={(hospital) => changeFilters({ ...filters, hospital })}
        />

        {/* Password sign-in is to be switched off in favour of Google. This is
            the count that decides when that is safe. */}
        <GoogleSignInReadiness users={users} />

        <UserFilters users={users} filters={filters} onChange={changeFilters} />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              Users ({filtered.length}
              {filtered.length !== users.length && ` of ${users.length}`})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <UserTable
              users={filtered}
              companies={companies}
              selected={selected}
              onSelectedChange={setSelected}
              onPatch={handlePatch}
              onEdit={(u) => { setEditing(u); setShowForm(true); }}
              onResetPassword={setResetting}
              onDelete={setDeleting}
              currentUserId={user?.id}
              busyId={deleteUser.isPending ? deleting?.id : null}
            />
          </CardContent>
        </Card>

        {isSuperAdmin && (
          <TileAccessMatrix
            onReset={() => {
              resetToDefaults();
              toast({ title: "Tile access reset to defaults" });
            }}
          />
        )}

        {isSuperAdmin && (
          <HrPulseAccess
            users={users}
            busyId={hrPulseBusyId}
            onToggle={(row, value) => {
              setHrPulseBusyId(row.id);
              setHrPulse.mutate(
                { id: row.id, value },
                { onError: fail, onSettled: () => setHrPulseBusyId(null) },
              );
            }}
          />
        )}
      </div>

      <BulkActionBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        onApply={handleBulk}
        busy={bulkUpdate.isPending}
      />

      <UserFormDialog
        open={showForm}
        editing={editing}
        companies={companies}
        saving={createUser.isPending || patchUser.isPending}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onSave={handleSave}
      />

      <ResetPasswordDialog
        user={resetting}
        onClose={() => setResetting(null)}
        onReset={async ({ password, mustChange }) => {
          if (!resetting) throw new Error("No user selected.");
          try {
            const result = await resetPassword.mutateAsync({ id: resetting.id, password, mustChange });
            return result.password;
          } catch (err) {
            throw new Error(adminUsersErrorMessage(err));
          }
        }}
      />

      <CsvImportDialog
        open={showCsv}
        existingUsers={users}
        importing={importUsers.isPending}
        onClose={() => setShowCsv(false)}
        onImport={async (rows) => {
          try {
            return await importUsers.mutateAsync(rows);
          } catch (err) {
            fail(err);
            return { users: [], failures: [], credentials: [] };
          }
        }}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this user?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.full_name || deleting?.email} will be removed permanently.
              If they have records in the system the delete will be refused —
              deactivate them instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default UserManagement;
