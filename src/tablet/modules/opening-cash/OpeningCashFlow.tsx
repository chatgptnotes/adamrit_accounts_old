import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { inr } from "@/tablet/lib/format";
import { useCashHandoverAccess } from "@/tablet/hooks/useCashHandoverAccess";
import { OpeningCashCard } from "./OpeningCashCard";

/**
 * The cashier's start-of-shift count, as its own tile.
 *
 * WHY THIS SCREEN PICKS A COUNTER
 *
 * It used to take the counter from the signed-in person's staff record, which
 * is not where they work -- it is where HR filed them. Farhan runs the pharmacy
 * till and his account says "hope", so on 15 August his pharmacy count of
 * Rs 3,220 was recorded against Hope Hospital. Three things followed: the
 * pharmacy has never had an opening on record at all, Diksha was refused at
 * 09:51 because "this counter already has an opening" (Farhan's, four minutes
 * earlier), and the Hope handover an hour later swallowed the pharmacy money
 * and came out at minus Rs 6,349 expected against Rs 1,720 counted.
 *
 * Three counters run at once -- Hope Hospital, Ayushman Nagpur and Hope
 * Pharmacy -- three separate companies with three separate drawers and three
 * separate opening counts. The Cash Handover screen already knows this; it has
 * a Pharmacy tab, which is why Farhan's HANDOVER said pharmacy while his
 * OPENING said hope. This screen now knows it too.
 *
 * Every counter's live state is shown, not just the chosen one, so a cashier
 * can see at a glance that their till is the one still uncounted.
 *
 * Gated like Cash Handover itself -- the named cash roster, plus the cashier
 * role -- because it writes the figure every later reconciliation is measured
 * against.
 */

const COUNTERS = [
  { key: "hope", label: "Hope Hospital", company: "DRM Hope Hospital Pvt Ltd" },
  { key: "ayushman", label: "Ayushman Nagpur", company: "Ayushman Nagpur Hospital" },
  { key: "pharmacy", label: "Hope Pharmacy", company: "Hope Pharmacy" },
] as const;

type CounterKey = (typeof COUNTERS)[number]["key"];

interface OpeningState {
  declared: boolean;
  amount: number;
  at: string | null;
  by: string | null;
}

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      })
    : "—";

export default function OpeningCashFlow() {
  const { user, hospitalType } = useAuth();
  const access = useCashHandoverAccess();

  // Defaults to the counter on their record, because that is right for most
  // people most days -- but it is now a starting point, not a verdict.
  const [counter, setCounter] = useState<CounterKey>(() => {
    const own = (hospitalType ?? "").trim().toLowerCase();
    return COUNTERS.some((c) => c.key === own) ? (own as CounterKey) : "hope";
  });

  // All three at once. Seeing that the pharmacy is uncounted while Hope is
  // done is the whole point; one counter's state in isolation is what let the
  // wrong one be filled in for a fortnight.
  const states = useQuery({
    queryKey: ["opening-cash-states"],
    staleTime: 15_000,
    queryFn: async () => {
      const out: Record<string, OpeningState> = {};
      for (const c of COUNTERS) {
        const { data, error } = await (supabase as any).rpc("cash_opening_state", {
          p_hospital_type: c.key,
        });
        if (error) throw new Error(error.message);
        out[c.key] = data as OpeningState;
      }
      return out;
    },
  });

  if (!access.isLoading && !access.allowed) {
    return (
      <FlowScaffold
        heading="Nisha Opening Cash"
        subheading="Restricted to the people named on the cash roster."
      >
        <TabletCard className="bg-amber-50">
          <p className="text-base font-semibold text-amber-900">
            You are not on the cash roster.
          </p>
          <p className="mt-2 text-sm text-amber-900">
            Only people who hold a drawer record opening cash. Ask the director or the
            accounts desk to add you if you do.
          </p>
        </TabletCard>
      </FlowScaffold>
    );
  }

  const chosen = states.data?.[counter];

  return (
    <FlowScaffold
      heading="Nisha Opening Cash"
      subheading="Count the cash in hand and in the locker before your shift begins."
    >
      <div className="space-y-4">
        <TabletCard variant="flat" className="space-y-3">
          <div>
            <p className="text-sm font-semibold">Which counter are you opening?</p>
            <p className="text-xs text-muted-foreground">
              Three separate companies, three separate drawers. Pick the till you are
              standing at, not the hospital on your staff record.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {COUNTERS.map((c) => {
              const s = states.data?.[c.key];
              const selected = counter === c.key;
              return (
                <TabletButton
                  key={c.key}
                  variant={selected ? "default" : "outline"}
                  className="h-auto flex-col items-start gap-1 py-3 text-left"
                  onClick={() => setCounter(c.key)}
                >
                  <span className="font-semibold">{c.label}</span>
                  {states.isLoading ? (
                    <span className="inline-flex items-center gap-1 text-xs opacity-80">
                      <Loader2 className="h-3 w-3 animate-spin" /> checking
                    </span>
                  ) : s?.declared ? (
                    <span
                      className={`inline-flex items-center gap-1 text-xs ${selected ? "opacity-90" : "text-emerald-700"}`}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      {inr(s.amount)} counted
                    </span>
                  ) : (
                    <span
                      className={`inline-flex items-center gap-1 text-xs ${selected ? "opacity-90" : "text-amber-700"}`}
                    >
                      <TriangleAlert className="h-3 w-3" />
                      not counted
                    </span>
                  )}
                </TabletButton>
              );
            })}
          </div>
        </TabletCard>

        {/* Said before they count, not after they are refused. The database
            allows one live opening per counter, and being told why at the
            moment of typing is the difference between a two-second decision
            and the hour Diksha lost on 15 August. */}
        {chosen?.declared && (
          <TabletCard className="border-amber-300 bg-amber-50">
            <p className="font-semibold text-amber-900">
              {COUNTERS.find((c) => c.key === counter)?.label} has already been counted
              — {inr(chosen.amount)}
            </p>
            <p className="mt-1 text-sm text-amber-900">
              Recorded by {chosen.by || "someone"} at {when(chosen.at)}. This counter
              takes one opening at a time. If that figure is not yours, check you have
              the right counter selected above — or, if {chosen.by || "the previous cashier"}{" "}
              left without handing over, count what is really here and the card below
              will record their handover in their name before starting yours.
            </p>
          </TabletCard>
        )}

        <OpeningCashCard
          // Remounted per counter so a half-typed count cannot be submitted
          // against a till the cashier switched away from.
          key={counter}
          hospitalType={counter}
          userId={user?.id ?? ""}
          alwaysOpen
        />
      </div>
    </FlowScaffold>
  );
}
