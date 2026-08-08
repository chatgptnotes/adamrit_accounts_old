import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { useTileAccess } from "@/hooks/useTileAccess";
import { ALL_ROLES, ALL_TILE_GROUPS, GROUP_LABELS } from "@/config/tileAccess";
import { roleLabel } from "./constants";

interface Props {
  onReset: () => void;
}

/**
 * The tile × role matrix, lifted out of UserManagement unchanged.
 *
 * These rules still live in this browser's localStorage, so they apply to
 * nobody else — the banner below says so rather than letting the screen imply
 * otherwise. Moving them into the database is a separate, later change.
 */
const TileAccessMatrix: React.FC<Props> = ({ onReset }) => {
  const { getAllRules, setTileRoles } = useTileAccess();
  const [open, setOpen] = useState(false);
  const [groupFilter, setGroupFilter] = useState<string>("all");

  return (
    <Card>
      <CardHeader className="cursor-pointer select-none" onClick={() => setOpen((v) => !v)}>
        <CardTitle className="flex items-center justify-between text-lg">
          <span className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            Tile Access Control
          </span>
          {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </CardTitle>
      </CardHeader>

      {open && (
        <CardContent>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Control which tiles each role can see across the app. Check a box = role can
              see the tile. Unchecked = role cannot see it. When a tile has{" "}
              <strong>no roles checked</strong>, it is visible to <strong>all roles</strong>.
            </p>

            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              These rules are currently saved in this browser only — they do not
              apply to anyone else's device yet.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Group:</span>
              {["all", ...ALL_TILE_GROUPS].map((group) => (
                <button
                  key={group}
                  type="button"
                  onClick={() => setGroupFilter(group)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    groupFilter === group
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {group === "all" ? "All" : GROUP_LABELS[group]}
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
                          {roleLabel(role)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {getAllRules()
                      .filter((r) => groupFilter === "all" || r.group === groupFilter)
                      .map((rule) => (
                        <tr key={rule.id} className="border-b hover:bg-gray-50">
                          <td className="sticky left-0 z-10 bg-white px-3 py-2">
                            <span className="font-medium text-gray-800">{rule.label}</span>
                            <span className="ml-1 text-[10px] text-gray-400">{rule.group}</span>
                          </td>
                          {ALL_ROLES.map((role) => {
                            const checked = rule.roles !== undefined && rule.roles.includes(role);
                            return (
                              <td key={role} className="px-2 py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const current = rule.roles;
                                    let next: string[] | undefined;
                                    if (current === undefined) {
                                      next = ALL_ROLES.filter((r) => r !== role);
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
              <Button variant="outline" size="sm" onClick={onReset}>
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
  );
};

export default TileAccessMatrix;
