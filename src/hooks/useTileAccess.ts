import { useCallback, useEffect, useState } from "react";
import {
  TILE_ACCESS_RULES,
  type TileAccessRule,
} from "@/config/tileAccess";

const STORAGE_KEY = "tileAccessOverrides";

type Overrides = Record<string, string[] | undefined>;

function readOverrides(): Overrides {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeOverrides(overrides: Overrides): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export function useTileAccess() {
  const [overrides, setOverrides] = useState<Overrides>({});

  useEffect(() => {
    setOverrides(readOverrides());
  }, []);

  const getRule = useCallback(
    (tileId: string): TileAccessRule | undefined => {
      const base = TILE_ACCESS_RULES.find((r) => r.id === tileId);
      if (!base) return undefined;
      if (tileId in overrides) {
        return { ...base, roles: overrides[tileId] };
      }
      return base;
    },
    [overrides],
  );

  const canSeeTile = useCallback(
    (tileId: string, role?: string | null): boolean => {
      const rule = getRule(tileId);
      if (!rule) return true;
      if (rule.roles === undefined) return true;
      if (rule.roles.length === 0) return false;
      if (!role) return false;
      return rule.roles.includes(role);
    },
    [getRule],
  );

  const setTileRoles = useCallback(
    (tileId: string, roles: string[] | undefined) => {
      setOverrides((prev) => {
        const next = { ...prev, [tileId]: roles };
        writeOverrides(next);
        return next;
      });
    },
    [],
  );

  const resetToDefaults = useCallback(() => {
    setOverrides({});
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const getAllRules = useCallback((): TileAccessRule[] => {
    return TILE_ACCESS_RULES.map((r) => {
      if (r.id in overrides) {
        return { ...r, roles: overrides[r.id] };
      }
      return r;
    });
  }, [overrides]);

  return { canSeeTile, getRule, setTileRoles, resetToDefaults, getAllRules };
}
