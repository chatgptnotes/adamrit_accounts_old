import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  TILE_ACCESS_RULES,
  type TileAccessRule,
} from "@/config/tileAccess";

/**
 * Which roles may see which tile.
 *
 * These rules used to live in this browser's localStorage, which meant an
 * administrator restricting a tile changed nothing for the staff it was aimed
 * at, nothing for their colleagues, and nothing on their own second device.
 * They now live in public.tile_access_overrides and apply to everyone.
 *
 * Reads come straight from the table under its open SELECT policy, because ten
 * screens ask this question during their first render. Writes go through
 * /api/tile-access, which requires a superadmin and uses the service role — the
 * table has no write policy, so the anon key published in the bundle cannot
 * change who sees what.
 */

export const TILE_ACCESS_KEY = ["tile-access-overrides"];

/** A key present IS an override; `undefined` against it means "every role". */
type Overrides = Record<string, string[] | undefined>;

/** The pre-database key. Read only by the import prompt in TileAccessMatrix. */
export const LEGACY_STORAGE_KEY = "tileAccessOverrides";

export function readLegacyOverrides(): Overrides {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function postTileAccess(body: Record<string, unknown>): Promise<void> {
  const response = await fetch("/api/tile-access", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || "request_failed");
}

export function useTileAccess() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: TILE_ACCESS_KEY,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Overrides> => {
      const { data, error } = await (supabase as any)
        .from("tile_access_overrides")
        .select("tile_id, roles");
      if (error) throw error;
      const out: Overrides = {};
      for (const row of (data || []) as { tile_id: string; roles: string[] | null }[]) {
        // NULL in the column means "every role", which is the same thing the
        // old map said with an explicit undefined against a present key.
        out[row.tile_id] = row.roles ?? undefined;
      }
      return out;
    },
  });

  // A failed or in-flight fetch falls back to the defaults compiled into
  // tileAccess.ts rather than to "hide everything". Losing the network is not a
  // reason to take screens away from staff who are entitled to them, and this
  // matrix is a convenience layer -- the gates that actually protect money and
  // patient data live elsewhere.
  const overrides: Overrides = query.data ?? {};

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

  const getAllRules = useCallback((): TileAccessRule[] => {
    return TILE_ACCESS_RULES.map((r) => {
      if (r.id in overrides) {
        return { ...r, roles: overrides[r.id] };
      }
      return r;
    });
  }, [overrides]);

  // Applied to the cache first so a checkbox answers immediately, then rolled
  // back if the server refuses. Without it every tick waits on a round trip and
  // reads as a broken control.
  const setMutation = useMutation({
    mutationFn: async (vars: { tileId: string; roles: string[] | undefined }) =>
      postTileAccess({ action: "set", tile_id: vars.tileId, roles: vars.roles ?? null }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: TILE_ACCESS_KEY });
      const previous = queryClient.getQueryData<Overrides>(TILE_ACCESS_KEY);
      queryClient.setQueryData<Overrides>(TILE_ACCESS_KEY, {
        ...(previous ?? {}),
        [vars.tileId]: vars.roles,
      });
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData<Overrides>(TILE_ACCESS_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: TILE_ACCESS_KEY });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => postTileAccess({ action: "reset" }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: TILE_ACCESS_KEY });
    },
  });

  const setTileRoles = useCallback(
    (tileId: string, roles: string[] | undefined): Promise<void> =>
      setMutation.mutateAsync({ tileId, roles }),
    [setMutation],
  );

  const resetToDefaults = useCallback((): Promise<void> => {
    // The pre-database copy goes too, or the import prompt would offer to
    // restore the very rules that were just cleared.
    if (typeof window !== "undefined") localStorage.removeItem(LEGACY_STORAGE_KEY);
    return resetMutation.mutateAsync();
  }, [resetMutation]);

  return {
    canSeeTile,
    getRule,
    setTileRoles,
    resetToDefaults,
    getAllRules,
    isLoading: query.isLoading,
    isSaving: setMutation.isPending || resetMutation.isPending,
    error: query.error as Error | null,
  };
}
