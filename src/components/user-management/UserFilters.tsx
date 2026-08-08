import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";
import type { AdminUser } from "@/hooks/useAdminUsers";
import { countByHospital, hospitalLabel, roleLabel, rolesInData } from "./constants";

export interface Filters {
  search: string;
  role: string;
  hospital: string;
  status: string;
}

interface Props {
  users: AdminUser[];
  filters: Filters;
  onChange: (filters: Filters) => void;
}

const UserFilters: React.FC<Props> = ({ users, filters, onChange }) => {
  // Options come from the data, not from a hardcoded list — otherwise a user
  // whose role or hospital drifted from the constants cannot be filtered to at
  // all, which is how 33 users became unreachable on the old page.
  const roleOptions = rolesInData(users);
  const hospitalOptions = countByHospital(users);

  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email or phone..."
              value={filters.search}
              onChange={(e) => set({ search: e.target.value })}
              className="pl-10"
            />
          </div>

          <Select value={filters.role} onValueChange={(role) => set({ role })}>
            <SelectTrigger>
              <SelectValue placeholder="Filter by Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {roleOptions.map((r) => (
                <SelectItem key={r} value={r}>
                  {roleLabel(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.hospital} onValueChange={(hospital) => set({ hospital })}>
            <SelectTrigger>
              <SelectValue placeholder="Filter by Hospital" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Hospitals</SelectItem>
              {hospitalOptions.map(({ key, count }) => (
                <SelectItem key={key} value={key}>
                  {hospitalLabel(key)} ({count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.status} onValueChange={(status) => set({ status })}>
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
  );
};

export default UserFilters;
