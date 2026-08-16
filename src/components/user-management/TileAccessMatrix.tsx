import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  useTileAccess,
  readLegacyOverrides,
  LEGACY_STORAGE_KEY,
} from "@/hooks/useTileAccess";
import { ALL_ROLES, ALL_TILE_GROUPS, GROUP_LABELS } from "@/config/tileAccess";
import { roleLabel } from "./constants";

interface Props {
  onReset: () => void;
}

/**
 * The tile × role matrix.
 *
 * These rules now live in public.tile_access_overrides and apply to every
 * member of staff. Until 16-Aug-2026 they were saved to this browser's
 * localStorage and applied to nobody, which is why the import prompt below
 * exists: whatever an administrator set back then is still sitting in their
 * browser and was never in force.
 */
const TileAccessMatrix: React.FC<Props> = ({ onReset }) => {
  const { getAllRules, setTileRoles, isLoading, isSaving, error } = useTileAccess();
  const [open, setOpen] = useState(false);
  const [groupFilter, setGroupFilter] = useState<string>("all");

  // Read once. Emptied by importing or discarding, and the prompt goes with it.
  const [legacy, setLegacy] = useState(() => readLegacyOverrides());
  const legacyCount = useMemo(() => Object.keys(legacy).length, [legacy]);

  const importLegacy = async () => {
    const entries = Object.entries(legacy);
    let failed = 0;
    for (const [tileId, roles] of entries) {
      try {
        await setTileRoles(tileId, Array.isArray(roles) ? roles : undefined);
      } catch {
        failed += 1;
      }
    }
    if (failed) {
      toast.error(`${entries.length - failed} of ${entries.length} imported — ${failed} failed.`);
      return;
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    setLegacy({});
    toast.success(`Imported ${entries.length} rule(s). They now apply to everyone.`);
  };

  const discardLegacy = () => {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    setLegacy({});
    toast.success("Old browser-only settings discarded.");
  };

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

            {error && (
              <p className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
                Could not load the saved rules ({error.message}). The defaults built
                into the app are shown instead — do not treat this screen as the
                current settings until it loads.
              </p>
            )}

            {legacyCount > 0 && (
              <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                <p>
                  <strong>{legacyCount} older rule(s) found in this browser.</strong>{" "}
                  Until today this screen saved to your browser only, so these were
                  never applied to anyone. Import them to put them into force for all
                  staff, or discard them.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => void importLegacy()} disabled={isSaving}>
                    Import into the database
                  </Button>
                  <Button size="sm" variant="outline" onClick={discardLegacy} disabled={isSaving}>
                    Discard
                  </Button>
                </div>
              </div>
            )}

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
                                    void setTileRoles(rule.id, next).catch((e: Error) =>
                                      toast.error(
                                        e.message === "forbidden"
                                          ? "Only a super-admin may change tile access."
                                          : `Could not save: ${e.message}`,
                                      ),
                                    );
                                  }}
                                  disabled={isLoading}
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
              <Button variant="outline" size="sm" onClick={onReset} disabled={isSaving}>
                <RefreshCw className="h-4 w-4 mr-1" />
                Reset to Defaults
              </Button>
              <span className="text-xs text-muted-foreground">
                {isLoading
                  ? "Loading the saved rules…"
                  : isSaving
                    ? "Saving…"
                    : "Saved for everyone, on every device. Staff see the change when they next load a page."}
              </span>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
};

export default TileAccessMatrix;
