import React, { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Edit2, Trash2, KeyRound, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { ALL_ROLES } from "@/config/tileAccess";
import type { AdminUser } from "@/hooks/useAdminUsers";
import { HOSPITALS, hospitalKey, hospitalLabel, isActive, roleLabel, UNASSIGNED } from "./constants";

export type SortKey =
  | "full_name" | "email" | "role" | "hospital_type"
  | "department" | "is_active" | "last_login_at" | "created_at";

interface Props {
  users: AdminUser[];
  companies: { id: string; company_name: string }[];
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  onPatch: (id: string, patch: Partial<AdminUser>) => void;
  onEdit: (user: AdminUser) => void;
  onResetPassword: (user: AdminUser) => void;
  onDelete: (user: AdminUser) => void;
  /** The signed-in admin, who may not deactivate or delete themselves. */
  currentUserId?: string;
  busyId?: string | null;
}

/**
 * Nulls always sort last, in both directions. Sorting ascending by Last Login
 * should surface the person who logged in longest ago, not the forty accounts
 * that have never logged in at all.
 */
const compare = (a: AdminUser, b: AdminUser, key: SortKey): number => {
  const left = key === "hospital_type" ? hospitalKey(a) : (a as any)[key];
  const right = key === "hospital_type" ? hospitalKey(b) : (b as any)[key];

  const leftEmpty = left === null || left === undefined || left === "";
  const rightEmpty = right === null || right === undefined || right === "";
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;

  if (key === "is_active") return Number(isActive(b)) - Number(isActive(a));
  if (key === "last_login_at" || key === "created_at") {
    return new Date(String(right)).getTime() - new Date(String(left)).getTime();
  }
  return String(left).localeCompare(String(right), undefined, { sensitivity: "base" });
};

const UserTable: React.FC<Props> = ({
  users, companies, selected, onSelectedChange, onPatch,
  onEdit, onResetPassword, onDelete, currentUserId, busyId,
}) => {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "created_at",
    dir: "desc",
  });

  const sorted = useMemo(() => {
    const rows = [...users].sort((a, b) => compare(a, b, sort.key));
    return sort.dir === "asc" ? rows : rows.reverse();
  }, [users, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) => (prev.key === key
      ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
      : { key, dir: "asc" }));

  const SortableHead: React.FC<{ column: SortKey; children: React.ReactNode; className?: string }> =
    ({ column, children, className }) => (
      <TableHead className={className}>
        <button
          type="button"
          onClick={() => toggleSort(column)}
          className="inline-flex items-center gap-1 hover:text-foreground transition"
        >
          {children}
          {sort.key !== column ? (
            <ChevronsUpDown className="h-3 w-3 opacity-40" />
          ) : sort.dir === "asc" ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
      </TableHead>
    );

  const allSelected = sorted.length > 0 && sorted.every((u) => selected.has(u.id));
  const someSelected = sorted.some((u) => selected.has(u.id));

  // Select-all applies to what is currently filtered, not the whole table — the
  // header checkbox should never quietly select rows the admin cannot see.
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) sorted.forEach((u) => next.delete(u.id));
    else sorted.forEach((u) => next.add(u.id));
    onSelectedChange(next);
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  };

  // Hospital values found in the data that are not one of the known two, so an
  // inline edit never silently drops a row's existing value from the dropdown.
  const hospitalOptions = useMemo(() => {
    const extra = new Set(
      users.map(hospitalKey).filter((k) => k !== UNASSIGNED && !HOSPITALS.some((h) => h.value === k)),
    );
    return [...HOSPITALS, ...[...extra].map((value) => ({ value, label: hospitalLabel(value) }))];
  }, [users]);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={toggleAll}
                aria-label="Select all filtered users"
              />
            </TableHead>
            <SortableHead column="full_name">Full Name</SortableHead>
            <SortableHead column="email">Email</SortableHead>
            <TableHead>Phone</TableHead>
            <SortableHead column="role">Role</SortableHead>
            <SortableHead column="hospital_type">Hospital</SortableHead>
            <TableHead>Company</TableHead>
            <SortableHead column="department">Department</SortableHead>
            <SortableHead column="is_active">Status</SortableHead>
            <SortableHead column="last_login_at">Last Login</SortableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                No users found.
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((user) => {
              const isSelf = user.id === currentUserId;
              return (
                <TableRow key={user.id} data-state={selected.has(user.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(user.id)}
                      onCheckedChange={() => toggleOne(user.id)}
                      aria-label={`Select ${user.full_name || user.email}`}
                    />
                  </TableCell>

                  <TableCell className="font-medium whitespace-nowrap">
                    {user.full_name || "-"}
                    {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.phone || "-"}</TableCell>

                  {/* Inline role edit — reads as a badge until hovered. */}
                  <TableCell>
                    <Select
                      value={user.role || ""}
                      onValueChange={(role) => onPatch(user.id, { role })}
                    >
                      <SelectTrigger className="h-8 w-[150px] border-0 bg-transparent px-2 hover:bg-muted focus:ring-1">
                        <SelectValue placeholder="-">{roleLabel(user.role)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {/* The user's own role first, in case it is not in ALL_ROLES. */}
                        {user.role && !ALL_ROLES.includes(user.role as any) && (
                          <SelectItem value={user.role}>{roleLabel(user.role)}</SelectItem>
                        )}
                        {ALL_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>

                  <TableCell>
                    <Select
                      value={hospitalKey(user) === UNASSIGNED ? "" : hospitalKey(user)}
                      onValueChange={(hospital_type) => onPatch(user.id, { hospital_type })}
                    >
                      <SelectTrigger className="h-8 w-[130px] border-0 bg-transparent px-2 hover:bg-muted focus:ring-1">
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                      <SelectContent>
                        {hospitalOptions.map((h) => (
                          <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>

                  <TableCell className="text-xs">
                    {user.company_id
                      ? companies.find((c) => c.id === user.company_id)?.company_name || "-"
                      : "-"}
                  </TableCell>
                  <TableCell>{user.department || "-"}</TableCell>

                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={isActive(user)}
                        disabled={isSelf}
                        onCheckedChange={(checked) => onPatch(user.id, { is_active: checked })}
                        aria-label={isActive(user) ? "Deactivate user" : "Activate user"}
                      />
                      <Badge
                        className={isActive(user)
                          ? "bg-green-100 text-green-800 hover:bg-green-100"
                          : "bg-red-100 text-red-800 hover:bg-red-100"}
                      >
                        {isActive(user) ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </TableCell>

                  <TableCell className="whitespace-nowrap">
                    {user.last_login_at
                      ? format(new Date(user.last_login_at), "dd MMM yyyy HH:mm")
                      : "-"}
                  </TableCell>

                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost" size="icon" title="Reset password"
                        onClick={() => onResetPassword(user)}
                      >
                        <KeyRound className="h-4 w-4 text-blue-600" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" title="Edit user"
                        onClick={() => onEdit(user)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        title={isSelf ? "You cannot delete your own account" : "Delete user"}
                        disabled={isSelf || busyId === user.id}
                        onClick={() => onDelete(user)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
};

export default UserTable;
