import { useAuth } from "@/contexts/AuthContext";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { useCashHandoverAccess } from "@/tablet/hooks/useCashHandoverAccess";
import { OpeningCashCard } from "./OpeningCashCard";

/**
 * The cashier's start-of-shift count, as its own tile.
 *
 * It was reachable only from inside Cash Handover, which is the wrong place for
 * it: handover is what you do at the END of a shift, and this is the first
 * thing you do at the start. Burying the opening count inside the closing
 * screen is how it gets skipped, and an unrecorded opening figure is exactly
 * what makes the drawer read short later.
 *
 * Gated like Cash Handover itself -- the named cash roster, plus the cashier
 * role -- because it writes the figure every later reconciliation is measured
 * against.
 */
export default function OpeningCashFlow() {
  const { user, hospitalType } = useAuth();
  const access = useCashHandoverAccess();

  if (!access.isLoading && !access.allowed) {
    return (
      <FlowScaffold
        heading="Opening Cash"
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

  return (
    <FlowScaffold
      heading="Opening Cash"
      subheading="Count the cash in hand and in the locker before your shift begins."
    >
      <OpeningCashCard
        hospitalType={hospitalType ?? null}
        userId={user?.id ?? ""}
        alwaysOpen
      />
    </FlowScaffold>
  );
}
