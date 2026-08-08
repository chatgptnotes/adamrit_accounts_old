import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, UserCheck, Building2, BadgeCheck } from "lucide-react";
import type { AdminUser } from "@/hooks/useAdminUsers";
import { countByHospital, hospitalLabel, isActive, rolesInData } from "./constants";

interface Props {
  users: AdminUser[];
  /** Clicking a hospital chip filters the table to it. */
  onSelectHospital: (key: string) => void;
}

const UserStatCards: React.FC<Props> = ({ users, onSelectHospital }) => {
  const total = users.length;
  const active = users.filter(isActive).length;
  const buckets = countByHospital(users);
  const roles = rolesInData(users).length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Users className="h-4 w-4" />
            Total Users
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-blue-700">{total}</p>
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
          <p className="text-3xl font-bold text-green-600">{active}</p>
          {active !== total && (
            <p className="text-xs text-muted-foreground mt-1">
              {total - active} inactive
            </p>
          )}
        </CardContent>
      </Card>

      {/* Every bucket found in the data is shown, so these always add up to Total. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Users by Hospital
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {buckets.map(({ key, count }) => (
              <button
                key={key}
                type="button"
                onClick={() => onSelectHospital(key)}
                className="text-left rounded px-1 -mx-1 hover:bg-blue-50 transition"
                title={`Filter to ${hospitalLabel(key)}`}
              >
                <span className="block text-xs text-muted-foreground">
                  {hospitalLabel(key)}
                </span>
                <span
                  className={`text-2xl font-bold ${
                    key === "unassigned" ? "text-amber-600" : "text-blue-700"
                  }`}
                >
                  {count}
                </span>
              </button>
            ))}
            {buckets.length === 0 && <span className="text-sm text-muted-foreground">-</span>}
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
          <p className="text-3xl font-bold text-blue-700">{roles}</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default UserStatCards;
