import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Banknote, TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { inr } from "@/tablet/lib/format";

// DATA SOURCE: cash_opening_state — "is there a LIVE opening for this counter",
// answered as a row-exists rather than a sum, so a counted-and-empty drawer
// reads as declared.

const COUNTER_LABEL: Record<string, string> = {
  hope: "DRM Hope Hospital",
  ayushman: "Ayushman Nagpur",
  pharmacy: "Hope Pharmacy",
};

/**
 * A strip telling the cashier the drawer was never counted, with the way to
 * fix it one tap away.
 *
 * Deliberately NOT a block. Refusing payments would stop the counter taking
 * money over a missing count, which is a worse failure than the missing count
 * -- so the payment goes through, this says so at the time, and the directors
 * hear about it that evening through notify_missing_cash_duties.
 *
 * It asks whether an opening is LIVE, not whether one was declared today. If
 * yesterday's opening was never handed over, the baseline still stands and
 * nagging for a fresh count would be wrong.
 *
 * Silent while loading and silent on error. A red strip that appears for a
 * moment on every screen load, or because a query failed, is one people learn
 * to ignore -- and then it is worth nothing on the day it matters.
 */
export function OpeningCashBanner({ className }: { className?: string }) {
  const { user, hospitalType } = useAuth();
  const navigate = useNavigate();
  const counter = (hospitalType ?? "").trim().toLowerCase();

  const state = useQuery({
    queryKey: ["cash-opening-state", counter],
    enabled: !!counter && !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("cash_opening_state", {
        p_hospital_type: counter,
      });
      if (error) throw new Error(error.message);
      return data as { declared: boolean; amount: number; at: string | null; by: string | null };
    },
  });

  if (state.isLoading || state.isError || !state.data) return null;
  if (state.data.declared) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 ${className ?? ""}`}
    >
      <TriangleAlert className="h-5 w-5 flex-shrink-0 text-amber-700" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-amber-900">
          Opening cash has not been declared for {COUNTER_LABEL[counter] ?? counter}
        </p>
        <p className="text-sm text-amber-800">
          Payments still work. But until the drawer is counted there is nothing to
          check today's cash against, and the directors are told this evening.
        </p>
      </div>
      <button
        type="button"
        onClick={() => navigate("/opening-cash", { viewTransition: true })}
        className="inline-flex min-h-11 flex-shrink-0 items-center gap-2 rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white active:scale-[0.98]"
      >
        <Banknote className="h-5 w-5" />
        Declare it — Nisha Opening Cash
      </button>
    </div>
  );
}

/**
 * The same fact in one line, for screens where a full strip would crowd out
 * the work. Shows the figure when there IS one, so a cashier can see at a
 * glance what the drawer was opened with.
 */
export function OpeningCashLine() {
  const { hospitalType } = useAuth();
  const counter = (hospitalType ?? "").trim().toLowerCase();

  const state = useQuery({
    queryKey: ["cash-opening-state", counter],
    enabled: !!counter,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("cash_opening_state", {
        p_hospital_type: counter,
      });
      if (error) throw new Error(error.message);
      return data as { declared: boolean; amount: number; by: string | null };
    },
  });

  if (!state.data) return null;

  return state.data.declared ? (
    <p className="text-xs text-muted-foreground">
      Opened with {inr(state.data.amount)}
      {state.data.by ? `, counted by ${state.data.by}` : ""}
    </p>
  ) : (
    <p className="text-xs font-semibold text-amber-700">
      Opening cash not declared for this counter
    </p>
  );
}
