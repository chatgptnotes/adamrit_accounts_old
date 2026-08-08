import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eye, EyeOff } from "lucide-react";
import { ALL_ROLES } from "@/config/tileAccess";
import type { AdminUser } from "@/hooks/useAdminUsers";
import { HOSPITALS, roleLabel } from "./constants";

export interface UserFormData {
  full_name: string;
  employee_id: string;
  email: string;
  phone: string;
  password: string;
  role: string;
  hospital_type: string;
  department: string;
  designation: string;
  company_id: string;
  is_active: boolean;
  must_change_password: boolean;
}

const EMPTY_FORM: UserFormData = {
  full_name: "", employee_id: "", email: "", phone: "", password: "",
  role: "receptionist", hospital_type: "hope", department: "", designation: "",
  company_id: "", is_active: true, must_change_password: true,
};

interface Props {
  open: boolean;
  /** null means "add a new user". */
  editing: AdminUser | null;
  companies: { id: string; company_name: string }[];
  saving: boolean;
  onClose: () => void;
  onSave: (form: UserFormData) => void;
}

const UserFormDialog: React.FC<Props> = ({ open, editing, companies, saving, onClose, onSave }) => {
  const [form, setForm] = useState<UserFormData>(EMPTY_FORM);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setShowPassword(false);
    setForm(editing ? {
      full_name: editing.full_name || "",
      employee_id: editing.employee_id || "",
      email: editing.email || "",
      phone: editing.phone || "",
      // Blank on edit. Changing a password is the Reset password action, which
      // is the only path that can show the new one to the admin.
      password: "",
      role: editing.role || "receptionist",
      hospital_type: editing.hospital_type || "hope",
      department: editing.department || "",
      designation: editing.designation || "",
      company_id: editing.company_id || "",
      is_active: editing.is_active !== false,
      must_change_password: editing.must_change_password === true,
    } : EMPTY_FORM);
  }, [open, editing]);

  const set = (patch: Partial<UserFormData>) => setForm((f) => ({ ...f, ...patch }));

  const submit = () => {
    if (!form.full_name.trim()) return setError("Full name is required.");
    if (!form.email.trim()) return setError("Email is required.");
    if (!editing && !form.password) return setError("A password is required for a new user.");
    if (!editing && form.password.length < 8) return setError("Password must be at least 8 characters.");
    setError("");
    onSave(form);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit User" : "Add New User"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="um-full-name">Full Name *</Label>
            <Input
              id="um-full-name" placeholder="John Doe"
              value={form.full_name}
              onChange={(e) => set({ full_name: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="um-email">Email *</Label>
            <Input
              id="um-email" type="email" placeholder="john@hospital.com"
              value={form.email}
              onChange={(e) => set({ email: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="um-employee-id">HRPulse Employee ID</Label>
            <Input
              id="um-employee-id" placeholder="e.g. EMP-1042"
              value={form.employee_id}
              onChange={(e) => set({ employee_id: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Used to scope HR Pulse attendance, leave, payroll, and alerts.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="um-phone">Phone</Label>
            <Input
              id="um-phone" placeholder="+91 98765 43210"
              value={form.phone}
              onChange={(e) => set({ phone: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Needed to send login details on WhatsApp.
            </p>
          </div>

          {/* Only offered when creating. An existing user's password is changed
              through Reset password, which shows the new one once. */}
          {!editing && (
            <div className="space-y-1">
              <Label htmlFor="um-password">Password *</Label>
              <div className="relative">
                <Input
                  id="um-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="At least 8 characters"
                  value={form.password}
                  onChange={(e) => set({ password: e.target.value })}
                  className="pr-10"
                />
                <button
                  type="button" tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label>Role</Label>
            <Select value={form.role} onValueChange={(role) => set({ role })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {form.role && !ALL_ROLES.includes(form.role as any) && (
                  <SelectItem value={form.role}>{roleLabel(form.role)}</SelectItem>
                )}
                {ALL_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Hospital</Label>
            <Select value={form.hospital_type} onValueChange={(hospital_type) => set({ hospital_type })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {HOSPITALS.map((h) => (
                  <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Company</Label>
            <Select
              value={form.company_id || "none"}
              onValueChange={(v) => set({ company_id: v === "none" ? "" : v })}
            >
              <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not assigned</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="um-department">Department</Label>
            <Input
              id="um-department" placeholder="e.g. Cardiology"
              value={form.department}
              onChange={(e) => set({ department: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="um-designation">Designation</Label>
            <Input
              id="um-designation" placeholder="e.g. Senior Consultant"
              value={form.designation}
              onChange={(e) => set({ designation: e.target.value })}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="um-active" checked={form.is_active}
              onCheckedChange={(v) => set({ is_active: v === true })}
            />
            <Label htmlFor="um-active" className="cursor-pointer">Active</Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="um-must-change" checked={form.must_change_password}
              onCheckedChange={(v) => set({ must_change_password: v === true })}
            />
            <Label htmlFor="um-must-change" className="cursor-pointer">
              Must change password on next login
            </Label>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving..." : editing ? "Update User" : "Create User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UserFormDialog;
