import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * May the signed-in person open Cash Handover?
 *
 * Access is by NAME, not by role. The people who hand cash over are a
 * receptionist and a pharmacist, and the people who receive or verify it are
 * administrators and an accountant -- none of them cashiers. Gating the tile on
 * the cashier role would have locked out everyone who uses it, because a person
 * holds exactly one role and theirs has to be the one their day job needs.
 *
 * So the roster in cash_handover_verifiers is the authority, plus the cashier
 * role on its own so a newly created cashier works on day one. The database
 * answers the question through can_use_cash_handover(), which means the same
 * rule applies wherever it is asked.
 */
export function useCashHandoverAccess() {
  const { user } = useAuth();
  const userId = user?.id || null;

  const query = useQuery({
    queryKey: ["cash-handover-access", userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await (supabase as any).rpc("can_use_cash_handover", {
        p_user_id: userId,
      });
      if (error) throw error;
      return data === true;
    },
  });

  return {
    // Closed until proven open. A cash screen is the wrong place to fail
    // permissive, and the alternative -- showing the tile then snatching it
    // away a moment later -- is worse than a brief absence.
    allowed: query.data === true,
    isLoading: query.isLoading,
  };
}
