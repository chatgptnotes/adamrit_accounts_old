import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Shield } from "lucide-react";
import { isSuperAdminRole } from "@/lib/roles";
import type { AdminUser } from "@/hooks/useAdminUsers";
import { roleLabel } from "./constants";

interface Props {
  users: AdminUser[];
  busyId: string | null;
  onToggle: (user: AdminUser, value: boolean) => void;
}

const HrPulseAccess: React.FC<Props> = ({ users, busyId, onToggle }) => {
  const rows = users
    .filter((u) => isSuperAdminRole(u.role))
    .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield className="h-5 w-5 text-cyan-600" />
          HR Pulse Access
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Only Super Admin accounts can be granted full HR Pulse visibility.
          Everyone else remains self-only.
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
              {rows.map((row) => {
                const canViewAll = Boolean(row.hr_pulse_can_view_all);
                return (
                  <tr key={row.id} className="border-b last:border-b-0">
                    <td className="px-3 py-3 font-medium text-gray-800">{row.full_name || "-"}</td>
                    <td className="px-3 py-3 text-gray-600">{row.email}</td>
                    <td className="px-3 py-3">
                      <Badge variant="outline">{roleLabel(row.role)}</Badge>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <div className="flex items-center justify-center gap-3">
                        <Checkbox
                          checked={canViewAll}
                          disabled={busyId === row.id}
                          onCheckedChange={(checked) => onToggle(row, Boolean(checked))}
                        />
                        <span className="text-xs text-muted-foreground">
                          {canViewAll ? "Full access" : "Self only"}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No Super Admin users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};

export default HrPulseAccess;
