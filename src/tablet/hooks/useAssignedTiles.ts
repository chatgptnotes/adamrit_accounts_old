import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const db = supabase as any;

export const ASSIGNED_TILES_QUERY_KEY = "tablet-assigned-tiles";

/**
 * Tile ids mapped to the signed-in user, either by name or through their role
 * (see supabase/migrations/20260801180000_tile_assignments.sql). The tablet home
 * grid floats these above the rest; it never hides anything, so an empty set
 * just means the grid renders exactly as it always has.
 */
export function useAssignedTiles() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const role = user?.role ?? null;

  const query = useQuery({
    queryKey: [ASSIGNED_TILES_QUERY_KEY, userId, role],
    enabled: !!(userId || role),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // A row targets a person or a role, never both, so the two clauses cannot
      // overlap and the union is taken client-side.
      const targets = [
        userId ? `user_id.eq.${userId}` : null,
        role ? `role.eq.${role}` : null,
      ].filter(Boolean) as string[];

      const { data, error } = await db
        .from("tile_assignments")
        .select("tile_id")
        .or(targets.join(","));

      // A missing table means the migration has not run yet. That must leave the
      // home grid working rather than take it down, so it reads as "nobody is
      // mapped to anything".
      if (error) {
        console.warn("[useAssignedTiles] tile_assignments unavailable:", error.message);
        return [] as string[];
      }
      return (data || []).map((row: { tile_id: string }) => row.tile_id);
    },
  });

  const assigned = useMemo(() => new Set(query.data ?? []), [query.data]);

  return { assigned, loading: query.isLoading };
}
