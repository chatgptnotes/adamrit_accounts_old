import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { hashPassword } from "@/utils/auth";
import { logActivity } from "@/lib/activity-logger";
import { useCompanies } from "@/hooks/useCompanies";
import { useAuth } from "@/contexts/AuthContext";
import { useTileAccess } from "@/hooks/useTileAccess";
import {
  ALL_ROLES,
  ALL_TILE_GROUPS,
  GROUP_LABELS,
} from "@/config/tileAccess";

// UI Components
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

// Icons
import {
  UserCog,
  Plus,
  Search,
  Edit2,
  Trash2,
  RefreshCw,
  Upload,
  Download,
  Shield,
  Eye,
  EyeOff,
  Users,
  Building2,
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  Shuffle,
  FileUp,
  UserCheck,
  UserX,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  full_name: string | null;
  employee_id: string | null;
  hr_pulse_can_view_all: boolean | null;
  email: string;
  phone: string | null;
  role: string | null;
  hospital_type: string | null;
  department: string | null;
  designation: string | null;
  is_active: boolean | null;
  must_change_password: boolean | null;
  last_login?: string | null;
  last_login_at: string | null;
  created_at: string | null;
  password: string | null;
  company_id: string | null;
}

interface UserFormData {
  full_name: string;
  employee_id: string;
  email: string;
  phone: string;
  password: string;
  role: string;
  hospital_type: string;
  department: string;
  designation: string;
  is_active: boolean;
  must_change_password: boolean;
  company_id: string;
}

interface CsvRow {
  full_name: string;
  email: string;
  phone: string;
  role: string;
  hospital_type: string;
  department: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Human-readable labels for roles */
const ROLE_LABELS: Record<string, string> = {
  superadmin: "Super Admin",
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

/** Static role-access mapping for the Role Access Summary section */
const ROLE_ACCESS_MAP: Record<string, string[]> = {
  superadmin: [
    "All modules",
    "User Management",
    "System Settings",
    "Audit Logs",
  ],
  admin: [
    "Dashboard",
    "Patient Management",
    "Billing",
    "Reports",
    "User Management",
    "Inventory",
  ],
  doctor: [
    "Patient Dashboard",
    "OPD / IPD",
    "Discharge Summary",
    "Treatment Sheet",
    "Lab Results",
    "Radiology",
  ],
  nurse: [
    "Nursing Station",
    "Treatment Sheet",
    "Vitals Entry",
    "Medication Administration",
    "Patient Overview",
  ],
  receptionist: [
    "Patient Registration",
    "Appointments",
    "OPD Queue",
    "Billing (view)",
  ],
  lab_technician: [
    "Lab Module",
    "Sample Collection",
    "Result Entry",
    "Report Printing",
  ],
  pharmacist: [
    "Pharmacy Module",
    "Drug Dispensing",
    "Inventory",
    "Purchase Orders",
  ],
  radiology_tech: [
    "Radiology Module",
    "CT/MRI Scheduling",
    "Report Upload",
    "Equipment QA",
  ],
  ot_tech: [
    "Operation Theatre",
    "OT Scheduling",
    "Equipment Checklist",
    "Implant Tracking",
  ],
  cath_lab_tech: [
    "Cath Lab Module",
    "Procedure Scheduling",
    "Equipment Logs",
  ],
  marketing: [
    "Marketing Module",
    "Referral Management",
    "Campaign Tracking",
    "Reports",
  ],
  billing: [
    "Billing Module",
    "Invoice Generation",
    "Payment Collection",
    "Financial Reports",
  ],
  housekeeping: ["Room Management", "Housekeeping Requests", "Linen Tracking"],
  security: ["Gate Pass", "Visitor Log", "Security Verification"],
  driver: ["Ambulance Tracking", "Trip Logs", "Vehicle Maintenance"],
  physiotherapist: [
    "Physiotherapy Module",
    "Session Scheduling",
    "Treatment Plans",
    "Billing",
  ],
};

const isSuperAdminRole = (role?: string | null) => role === "superadmin" || role === "super_admin";

/** Default blank form state for adding a new user */
const EMPTY_FORM: UserFormData = {
  full_name: "",
  employee_id: "",
  email: "",
  phone: "",
  password: "",
  role: "receptionist",
  hospital_type: "hope",
  department: "",
  designation: "",
  is_active: true,
  must_change_password: true,
  company_id: "",
};

// ---------------------------------------------------------------------------
// Helper: generate a random 12-character password
// ---------------------------------------------------------------------------
function generateRandomPassword(): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const special = "!@#$%^&*";
  const all = upper + lower + digits + special;

  // Ensure at least one from each category
  let pwd = "";
  pwd += upper[Math.floor(Math.random() * upper.length)];
  pwd += lower[Math.floor(Math.random() * lower.length)];
  pwd += digits[Math.floor(Math.random() * digits.length)];
  pwd += special[Math.floor(Math.random() * special.length)];

  for (let i = 4; i < 12; i++) {
    pwd += all[Math.floor(Math.random() * all.length)];
  }

  // Shuffle the password so the guaranteed chars are not always at the start
  return pwd
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const UserManagement: React.FC = () => {
  const { toast } = useToast();
  const { data: companies = [] } = useCompanies();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "superadmin" || user?.role === "super_admin";
  const { getAllRules, setTileRoles, resetToDefaults } = useTileAccess();

  // ---- Data state ----
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  // ---- Filter state ----
  const [searchTerm, setSearchTerm] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [filterHospital, setFilterHospital] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  // ---- Dialog state: Add / Edit user ----
  const [showUserDialog, setShowUserDialog] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [form, setForm] = useState<UserFormData>({ ...EMPTY_FORM });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingHrPulseUserId, setUpdatingHrPulseUserId] = useState<string | null>(null);

  // ---- Dialog state: CSV Bulk Upload ----
  const [showCsvDialog, setShowCsvDialog] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  // ---- Collapsible Role Access section ----
  const [roleAccessOpen, setRoleAccessOpen] = useState(false);
  const [tileGroupFilter, setTileGroupFilter] = useState<string>("all");

  // -----------------------------------------------------------------------
  // Fetch users
  // -----------------------------------------------------------------------
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("User")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setUsers((data as UserRow[]) || []);
    } catch (err: any) {
      console.error("Error fetching users:", err);
      toast({
        title: "Error",
        description: "Failed to load users.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // -----------------------------------------------------------------------
  // Filtered / searched users (client-side)
  // -----------------------------------------------------------------------
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      // Search by name or email
      const term = searchTerm.toLowerCase();
      const matchesSearch =
        !term ||
        (u.full_name || "").toLowerCase().includes(term) ||
        (u.email || "").toLowerCase().includes(term);

      // Role filter
      const matchesRole = filterRole === "all" || u.role === filterRole;

      // Hospital filter
      const matchesHospital =
        filterHospital === "all" || u.hospital_type === filterHospital;

      // Status filter
      const matchesStatus =
        filterStatus === "all" ||
        (filterStatus === "active" && u.is_active !== false) ||
        (filterStatus === "inactive" && u.is_active === false);

      return matchesSearch && matchesRole && matchesHospital && matchesStatus;
    });
  }, [users, searchTerm, filterRole, filterHospital, filterStatus]);

  // -----------------------------------------------------------------------
  // Summary card data
  // -----------------------------------------------------------------------
  const totalUsers = users.length;
  const activeUsers = users.filter((u) => u.is_active !== false).length;
  const hopeCount = users.filter((u) => u.hospital_type === "hope").length;
  const ayushmanCount = users.filter(
    (u) => u.hospital_type === "ayushman"
  ).length;
  const rolesInUse = new Set(users.map((u) => u.role).filter(Boolean)).size;
  const hrPulseUsers = useMemo(
    () =>
      users
        .filter((u) => isSuperAdminRole(u.role))
        .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email)),
    [users],
  );

  // -----------------------------------------------------------------------
  // Open Add / Edit dialog
  // -----------------------------------------------------------------------
  const openAddDialog = () => {
    setEditingUserId(null);
    setForm({ ...EMPTY_FORM });
    setShowPassword(false);
    setShowUserDialog(true);
  };

  const openEditDialog = (user: UserRow) => {
    setEditingUserId(user.id);
    setForm({
      full_name: user.full_name || "",
      employee_id: user.employee_id || "",
      email: user.email || "",
      phone: user.phone || "",
      password: "", // leave blank on edit; only hash if changed
      role: user.role || "receptionist",
      hospital_type: user.hospital_type || "hope",
      department: user.department || "",
      designation: user.designation || "",
      is_active: user.is_active !== false,
      must_change_password: user.must_change_password === true,
      company_id: user.company_id || "",
    });
    setShowPassword(false);
    setShowUserDialog(true);
  };

  // -----------------------------------------------------------------------
  // Save user (create or update)
  // -----------------------------------------------------------------------
  const handleSaveUser = async () => {
    if (!form.full_name.trim() || !form.email.trim()) {
      toast({
        title: "Validation Error",
        description: "Full Name and Email are required.",
        variant: "destructive",
      });
      return;
    }

    // For new users, password is required
    if (!editingUserId && !form.password) {
      toast({
        title: "Validation Error",
        description: "Password is required for new users.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const existingUser = editingUserId ? users.find((u) => u.id === editingUserId) || null : null;
      // Build the record to upsert
      const record: Record<string, any> = {
        full_name: form.full_name.trim(),
        employee_id: form.employee_id.trim() || null,
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || null,
        role: form.role,
        hospital_type: form.hospital_type,
        company_id: form.company_id || null,
        department: form.department.trim() || null,
        designation: form.designation.trim() || null,
        is_active: form.is_active,
        must_change_password: form.must_change_password,
      };

      // Hash password when provided
      if (form.password) {
        record.password = await hashPassword(form.password);
      }

      if (isSuperAdminRole(form.role)) {
        if (!editingUserId || !isSuperAdminRole(existingUser?.role)) {
          record.hr_pulse_can_view_all = true;
        }
      } else {
        record.hr_pulse_can_view_all = false;
      }

      if (editingUserId && isSuperAdminRole(form.role) && isSuperAdminRole(existingUser?.role)) {
        delete record.hr_pulse_can_view_all;
      }

      if (editingUserId) {
        // Update existing user
        const { error } = await (supabase as any)
          .from("User")
          .update(record)
          .eq("id", editingUserId);

        if (error) throw error;

        await logActivity("user_edit", { email: record.email });
        toast({ title: "Success", description: "User updated successfully." });
      } else {
        // Insert new user
        const { error } = await (supabase as any)
          .from("User")
          .insert([record]);

        if (error) throw error;

        await logActivity("user_create", { email: record.email });
        toast({ title: "Success", description: "User created successfully." });
      }

      setShowUserDialog(false);
      fetchUsers();
    } catch (err: any) {
      console.error("Error saving user:", err);
      toast({
        title: "Error",
        description: err?.message || "Failed to save user.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // -----------------------------------------------------------------------
  // Toggle user active / inactive
  // -----------------------------------------------------------------------
  const toggleUserActive = async (user: UserRow) => {
    const newStatus = user.is_active === false ? true : false;
    try {
      const { error } = await (supabase as any)
        .from("User")
        .update({ is_active: newStatus })
        .eq("id", user.id);

      if (error) throw error;

      await logActivity("user_edit", {
        email: user.email,
        toggled_active: newStatus,
      });
      toast({
        title: "Success",
        description: `User ${newStatus ? "activated" : "deactivated"}.`,
      });
      fetchUsers();
    } catch (err: any) {
      console.error("Error toggling user:", err);
      toast({
        title: "Error",
        description: "Failed to update user status.",
        variant: "destructive",
      });
    }
  };

  const toggleHrPulseAccess = async (user: UserRow, nextValue: boolean) => {
    if (!isSuperAdminRole(user.role)) return;

    setUpdatingHrPulseUserId(user.id);
    try {
      const { error } = await (supabase as any)
        .from("User")
        .update({ hr_pulse_can_view_all: nextValue })
        .eq("id", user.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: `${user.full_name || user.email} HR Pulse access ${nextValue ? "enabled" : "revoked"}.`,
      });
      fetchUsers();
    } catch (err: any) {
      console.error("Error updating HR Pulse access:", err);
      toast({
        title: "Error",
        description: err?.message || "Failed to update HR Pulse access.",
        variant: "destructive",
      });
    } finally {
      setUpdatingHrPulseUserId(null);
    }
  };

  // -----------------------------------------------------------------------
  // CSV Upload helpers
  // -----------------------------------------------------------------------
  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      if (!text) return;

      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length < 2) {
        toast({
          title: "Invalid CSV",
          description: "CSV must have a header row and at least one data row.",
          variant: "destructive",
        });
        return;
      }

      // Parse header (first row)
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());

      const rows: CsvRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map((c) => c.trim());
        if (cols.length < headers.length) continue;

        rows.push({
          full_name: cols[headers.indexOf("full_name")] || "",
          email: cols[headers.indexOf("email")] || "",
          phone: cols[headers.indexOf("phone")] || "",
          role: cols[headers.indexOf("role")] || "receptionist",
          hospital_type: cols[headers.indexOf("hospital_type")] || "hope",
          department: cols[headers.indexOf("department")] || "",
        });
      }

      setCsvRows(rows);
    };
    reader.readAsText(file);
  };

  const handleImportAll = async () => {
    if (csvRows.length === 0) return;

    setImporting(true);
    try {
      const defaultHash = await hashPassword("Welcome@2026");

      const records = csvRows.map((row) => ({
        full_name: row.full_name,
        email: row.email.toLowerCase(),
        phone: row.phone || null,
        role: row.role,
        hospital_type: row.hospital_type,
        department: row.department || null,
        password: defaultHash,
        is_active: true,
        must_change_password: true,
      }));

      const { error } = await (supabase as any).from("User").insert(records);
      if (error) throw error;

      await logActivity("user_bulk_import", { count: records.length });
      toast({
        title: "Success",
        description: `${records.length} users imported successfully.`,
      });

      setCsvRows([]);
      setShowCsvDialog(false);
      fetchUsers();
    } catch (err: any) {
      console.error("Error importing users:", err);
      toast({
        title: "Error",
        description: err?.message || "Failed to import users.",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  // -----------------------------------------------------------------------
  // Delete user (hard delete from User table)
  // -----------------------------------------------------------------------
  const handleDeleteUser = async (user: UserRow) => {
    if (!window.confirm(`Delete user "${user.email}"?`)) {
      return;
    }

    setDeletingUserId(user.id);
    try {
      const { data, error } = await (supabase as any)
        .from("User")
        .delete()
        .eq("id", user.id)
        .select("id");

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("No user row was deleted. The row may be protected by policies or already removed.");
      }

      await logActivity("user_delete", { email: user.email });
      toast({
        title: "Success",
        description: "User deleted successfully.",
      });
      fetchUsers();
    } catch (err: any) {
      console.error("Error deleting user:", err);
      const errorCode = err?.code ? ` (${err.code})` : "";
      const normalizedMessage = `${String(err?.message || "").toLowerCase()}`;
      let reason = "It may be linked to other records or you may not have permission.";

      if (err?.code === "42501") {
        reason = "Permission denied. This account may not have DB delete rights for the User table.";
      } else if (err?.code === "23503") {
        reason = "Cannot delete this user because related records still reference it.";
      } else if (err?.code === "23505") {
        reason = "Duplicate key error (unexpected during delete).";
      } else if (normalizedMessage.includes("no rows")) {
        reason = "No matching user row found for deletion.";
      }

      const details = [err?.message, err?.details, err?.hint].filter(Boolean).join(" ");
      toast({
        title: "Error",
        description:
          `Failed to delete user.${errorCode} ${details || reason}`,
        variant: "destructive",
      });
    } finally {
      setDeletingUserId(null);
    }
  };

  // -----------------------------------------------------------------------
  // Render: loading state
  // -----------------------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-24 text-muted-foreground">
            Loading users...
          </div>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* ----------------------------------------------------------------
            Header
        ---------------------------------------------------------------- */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <UserCog className="h-8 w-8 text-blue-600" />
            <div>
              <h1 className="text-3xl font-bold text-blue-900">
                User Management
              </h1>
              <p className="text-sm text-muted-foreground">
                Manage system users, roles and access
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCsvDialog(true)}
            >
              <Upload className="h-4 w-4 mr-1" />
              Bulk Upload
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchUsers}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            <Button size="sm" onClick={openAddDialog}>
              <Plus className="h-4 w-4 mr-1" />
              Add User
            </Button>
          </div>
        </div>

        {/* ----------------------------------------------------------------
            Summary Cards
        ---------------------------------------------------------------- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Users className="h-4 w-4" />
                Total Users
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-blue-700">{totalUsers}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <UserCheck className="h-4 w-4" />
                Active Users
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-green-600">
                {activeUsers}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Users by Hospital
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-xs text-muted-foreground">Hope</span>
                  <p className="text-2xl font-bold text-blue-700">
                    {hopeCount}
                  </p>
                </div>
                <div className="h-8 border-l" />
                <div>
                  <span className="text-xs text-muted-foreground">
                    Ayushman
                  </span>
                  <p className="text-2xl font-bold text-blue-700">
                    {ayushmanCount}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <BadgeCheck className="h-4 w-4" />
                Roles in Use
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-blue-700">{rolesInUse}</p>
            </CardContent>
          </Card>
        </div>

        {/* ----------------------------------------------------------------
            Filters
        ---------------------------------------------------------------- */}
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Role */}
              <Select value={filterRole} onValueChange={setFilterRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  {ALL_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Hospital */}
              <Select value={filterHospital} onValueChange={setFilterHospital}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by Hospital" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Hospitals</SelectItem>
                  <SelectItem value="hope">Hope</SelectItem>
                  <SelectItem value="ayushman">Ayushman</SelectItem>
                </SelectContent>
              </Select>

              {/* Status */}
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* ----------------------------------------------------------------
            Users Table
        ---------------------------------------------------------------- */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              Users ({filteredUsers.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Full Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Password</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Hospital</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={11}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No users found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        {user.full_name || "-"}
                      </TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <div
                          className="max-w-[220px] truncate text-xs font-mono"
                          title={user.password || "-"}
                        >
                          {user.password || "-"}
                        </div>
                      </TableCell>
                      <TableCell>{user.phone || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
                          {ROLE_LABELS[user.role || ""] || user.role || "-"}
                        </Badge>
                      </TableCell>
                      <TableCell className="capitalize">
                        {user.hospital_type || "-"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {user.company_id ? (companies.find(c => c.id === user.company_id)?.company_name || '-') : '-'}
                      </TableCell>
                      <TableCell>{user.department || "-"}</TableCell>
                      <TableCell>
                        {user.is_active !== false ? (
                          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                            Active
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
                            Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {(user.last_login_at || user.last_login)
                          ? format(
                              new Date(user.last_login_at || user.last_login || ""),
                              "dd MMM yyyy HH:mm"
                            )
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Edit user"
                            onClick={() => openEditDialog(user)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete user"
                            disabled={deletingUserId === user.id}
                            onClick={() => handleDeleteUser(user)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={
                              user.is_active !== false
                                ? "Deactivate user"
                                : "Activate user"
                            }
                            onClick={() => toggleUserActive(user)}
                          >
                            {user.is_active !== false ? (
                              <UserX className="h-4 w-4 text-red-500" />
                            ) : (
                              <UserCheck className="h-4 w-4 text-green-500" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* ----------------------------------------------------------------
            Tile Access Control (superadmin only, collapsible)
        ---------------------------------------------------------------- */}
        {isSuperAdmin && (
        <Card>
          <CardHeader
            className="cursor-pointer select-none"
            onClick={() => setRoleAccessOpen((prev) => !prev)}
          >
            <CardTitle className="flex items-center justify-between text-lg">
              <span className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-blue-600" />
                Tile Access Control
              </span>
              {roleAccessOpen ? (
                <ChevronUp className="h-5 w-5" />
              ) : (
                <ChevronDown className="h-5 w-5" />
              )}
            </CardTitle>
          </CardHeader>
          {roleAccessOpen && (
            <CardContent>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Control which tiles each role can see across the app. Check a box = role can see the tile. Unchecked = role cannot see it.
                  When a tile has <strong>no roles checked</strong>, it is visible to <strong>all roles</strong>.
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Group:</span>
                  <button
                    type="button"
                    onClick={() => setTileGroupFilter("all")}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      tileGroupFilter === "all"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    All
                  </button>
                  {ALL_TILE_GROUPS.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setTileGroupFilter(g)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                        tileGroupFilter === g
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {GROUP_LABELS[g]}
                    </button>
                  ))}
                </div>

                <div className="overflow-x-auto">
                  <div className="min-w-[800px]">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b">
                          <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left text-xs font-semibold text-gray-500 min-w-[180px]">
                            Tile
                          </th>
                          {ALL_ROLES.map((role) => (
                            <th
                              key={role}
                              className="px-2 py-2 text-center text-[10px] font-medium text-gray-500 min-w-[60px]"
                            >
                              {ROLE_LABELS[role] || role}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {getAllRules()
                          .filter(
                            (r) =>
                              tileGroupFilter === "all" || r.group === tileGroupFilter,
                          )
                          .map((rule) => (
                            <tr key={rule.id} className="border-b hover:bg-gray-50">
                              <td className="sticky left-0 z-10 bg-white px-3 py-2">
                                <div>
                                  <span className="font-medium text-gray-800">
                                    {rule.label}
                                  </span>
                                  <span className="ml-1 text-[10px] text-gray-400">
                                    {rule.group}
                                  </span>
                                </div>
                              </td>
                              {ALL_ROLES.map((role) => {
                                const isAll = rule.roles === undefined;
                                const checked = isAll ? false : rule.roles.includes(role);
                                return (
                                  <td key={role} className="px-2 py-2 text-center">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => {
                                        const current = rule.roles;
                                        let next: string[] | undefined;
                                        if (current === undefined) {
                                          const others = ALL_ROLES.filter(
                                            (r) => r !== role,
                                          );
                                          next = others;
                                        } else if (checked) {
                                          next = current.filter((r) => r !== role);
                                          if (next.length === 0) next = undefined;
                                        } else {
                                          next = [...current, role];
                                        }
                                        setTileRoles(rule.id, next);
                                      }}
                                      className="h-4 w-4 rounded border-gray-300"
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      resetToDefaults();
                      toast({ title: "Tile access reset to defaults" });
                    }}
                  >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Reset to Defaults
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Changes are saved automatically to browser storage.
                  </span>
                </div>
              </div>
            </CardContent>
          )}
        </Card>
        )}

        {isSuperAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Shield className="h-5 w-5 text-cyan-600" />
                HR Pulse Access
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Only Super Admin accounts can be granted full HR Pulse visibility. Everyone else remains self-only.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2">User</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">Role</th>
                      <th className="px-3 py-2 text-center">Can see all HR Pulse data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hrPulseUsers.map((row) => {
                      const canViewAll = Boolean(row.hr_pulse_can_view_all);
                      return (
                        <tr key={row.id} className="border-b last:border-b-0">
                          <td className="px-3 py-3 font-medium text-gray-800">{row.full_name || "-"}</td>
                          <td className="px-3 py-3 text-gray-600">{row.email}</td>
                          <td className="px-3 py-3">
                            <Badge variant="outline">{ROLE_LABELS[row.role || ""] || row.role || "-"}</Badge>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <div className="flex items-center justify-center gap-3">
                              <Checkbox
                                checked={canViewAll}
                                disabled={updatingHrPulseUserId === row.id}
                                onCheckedChange={(checked) => toggleHrPulseAccess(row, Boolean(checked))}
                              />
                              <span className="text-xs text-muted-foreground">
                                {canViewAll ? "Full access" : "Self only"}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {hrPulseUsers.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">
                          No Super Admin users found.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ----------------------------------------------------------------
            Add / Edit User Dialog
        ---------------------------------------------------------------- */}
        <Dialog open={showUserDialog} onOpenChange={setShowUserDialog}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingUserId ? "Edit User" : "Add New User"}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Full Name */}
              <div className="space-y-1">
                <Label htmlFor="um-full-name">Full Name *</Label>
                <Input
                  id="um-full-name"
                  placeholder="John Doe"
                  value={form.full_name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, full_name: e.target.value }))
                  }
                />
              </div>

              {/* Email */}
              <div className="space-y-1">
                <Label htmlFor="um-email">Email *</Label>
                <Input
                  id="um-email"
                  type="email"
                  placeholder="john@hospital.com"
                  value={form.email}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, email: e.target.value }))
                  }
                />
              </div>

              {/* HRPulse employee identity */}
              <div className="space-y-1">
                <Label htmlFor="um-employee-id">HRPulse Employee ID</Label>
                <Input
                  id="um-employee-id"
                  placeholder="e.g. EMP-1042"
                  value={form.employee_id}
                  onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Used to scope HR Pulse attendance, leave, payroll, and alerts.</p>
              </div>

              {/* Phone */}
              <div className="space-y-1">
                <Label htmlFor="um-phone">Phone</Label>
                <Input
                  id="um-phone"
                  placeholder="+91 98765 43210"
                  value={form.phone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, phone: e.target.value }))
                  }
                />
              </div>

              {/* Password with show/hide and auto-generate */}
              <div className="space-y-1">
                <Label htmlFor="um-password">
                  Password{editingUserId ? " (leave blank to keep current)" : " *"}
                </Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="um-password"
                      type={showPassword ? "text" : "password"}
                      placeholder={
                        editingUserId
                          ? "Leave blank to keep current"
                          : "Enter password"
                      }
                      value={form.password}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, password: e.target.value }))
                      }
                      className="pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword((v) => !v)}
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Auto-generate password"
                    onClick={() => {
                      const pwd = generateRandomPassword();
                      setForm((f) => ({ ...f, password: pwd }));
                      setShowPassword(true);
                    }}
                  >
                    <Shuffle className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Role */}
              <div className="space-y-1">
                <Label>Role</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Hospital */}
              <div className="space-y-1">
                <Label>Hospital</Label>
                <Select
                  value={form.hospital_type}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, hospital_type: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hope">Hope</SelectItem>
                    <SelectItem value="ayushman">Ayushman</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Company */}
              <div className="space-y-1">
                <Label>Company</Label>
                <Select
                  value={form.company_id || "none"}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, company_id: v === "none" ? "" : v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select company" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not assigned</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Department */}
              <div className="space-y-1">
                <Label htmlFor="um-department">Department</Label>
                <Input
                  id="um-department"
                  placeholder="e.g. Cardiology"
                  value={form.department}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, department: e.target.value }))
                  }
                />
              </div>

              {/* Designation */}
              <div className="space-y-1">
                <Label htmlFor="um-designation">Designation</Label>
                <Input
                  id="um-designation"
                  placeholder="e.g. Senior Consultant"
                  value={form.designation}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, designation: e.target.value }))
                  }
                />
              </div>

              {/* Active toggle */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="um-active"
                  checked={form.is_active}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, is_active: v === true }))
                  }
                />
                <Label htmlFor="um-active" className="cursor-pointer">
                  Active
                </Label>
              </div>

              {/* Must Change Password */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="um-must-change"
                  checked={form.must_change_password}
                  onCheckedChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      must_change_password: v === true,
                    }))
                  }
                />
                <Label htmlFor="um-must-change" className="cursor-pointer">
                  Must Change Password on Next Login
                </Label>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowUserDialog(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button onClick={handleSaveUser} disabled={saving}>
                {saving ? "Saving..." : editingUserId ? "Update User" : "Create User"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ----------------------------------------------------------------
            CSV Bulk Upload Dialog
        ---------------------------------------------------------------- */}
        <Dialog open={showCsvDialog} onOpenChange={setShowCsvDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileUp className="h-5 w-5" />
                Bulk Upload Users via CSV
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Upload a CSV file with columns:{" "}
                <code className="bg-muted px-1 rounded text-xs">
                  full_name, email, phone, role, hospital_type, department
                </code>
                . All imported users will receive the default password{" "}
                <strong>Welcome@2026</strong> and must change it on first login.
              </p>

              <Input
                type="file"
                accept=".csv"
                onChange={handleCsvFileChange}
              />

              {csvRows.length > 0 && (
                <>
                  <p className="text-sm font-medium">
                    Preview ({csvRows.length} rows)
                  </p>
                  <div className="max-h-64 overflow-y-auto border rounded">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>#</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Hospital</TableHead>
                          <TableHead>Department</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {csvRows.map((row, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{idx + 1}</TableCell>
                            <TableCell>{row.full_name}</TableCell>
                            <TableCell>{row.email}</TableCell>
                            <TableCell>{row.phone || "-"}</TableCell>
                            <TableCell className="capitalize">
                              {row.role}
                            </TableCell>
                            <TableCell className="capitalize">
                              {row.hospital_type}
                            </TableCell>
                            <TableCell>{row.department || "-"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setCsvRows([]);
                  setShowCsvDialog(false);
                }}
                disabled={importing}
              >
                Cancel
              </Button>
              <Button
                onClick={handleImportAll}
                disabled={importing || csvRows.length === 0}
              >
                {importing
                  ? "Importing..."
                  : `Import All (${csvRows.length})`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default UserManagement;
