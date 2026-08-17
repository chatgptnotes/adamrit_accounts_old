import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banknote, Loader2 } from "lucide-react";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { inr } from "@/tablet/lib/format";
import {
  declareOpeningCash,
  declareOpeningCashUnattended,
  fetchOpeningState,
  type UnattendedOpeningResult,
} from "@/lib/cashHandover";

/**
 * Opening cash: what the counter physically holds before the shift starts.
 *
 * Lives here rather than inside the handover screen because it is used in two
 * places -- its own tile, which the cashier opens at the start of a shift, and
 * the Cash Handover screen, where it is to hand if the figure was never
 * recorded. One component, so the two can never ask for different things.
 *
 * The locker is counted alongside the drawer. Cash sitting in the locker is
 * still cash the counter holds, and leaving it out was why the opening figure
 * read low. They are entered separately because they are counted separately and
 * in different places, then recorded as one opening total -- with the split kept
 * in the note, so a figure can be explained later without anybody having to
 * remember it.
 *
 * Same declare_opening_cash RPC as the desktop page, so a figure recorded on
 * either is one record rather than two that can disagree.
 *
 * WHEN THE LAST SHIFT NEVER HANDED OVER. The counter may still carry the
 * previous cashier's balance. The card says so, names them, and lets this
 * cashier proceed only after ticking an acknowledgment -- because proceeding
 * closes the absent cashier's session with an unattended handover in THEIR
 * name, counted at what this cashier actually found. The check lives in this
 * shared card so both entry points behave identically; the DB re-checks
 * anyway, so a race with a real handover just becomes an ordinary declaration.
 */
export function OpeningCashCard({
  hospitalType,
  userId,
  /** The tile renders it open; the handover screen keeps it behind a button. */
  alwaysOpen = false,
}: {
  hospitalType: string | null;
  userId: string;
  alwaysOpen?: boolean;
}) {
  const [open, setOpen] = useState(alwaysOpen);
  const [drawer, setDrawer] = useState("");
  const [locker, setLocker] = useState("");
  const [note, setNote] = useState("");
  // Movements between the drawer and the locker. Recorded for the trail, never
  // added to the opening total: whatever came out of the locker is in the hand
  // count, and whatever went in is in the locker count. Adding them would count
  // the same notes twice.
  const [outOfLocker, setOutOfLocker] = useState("");
  const [intoLocker, setIntoLocker] = useState("");
  const [ackUnattended, setAckUnattended] = useState(false);

  const queryClient = useQueryClient();

  const pending = useQuery({
    queryKey: ["cash-opening-state", hospitalType],
    queryFn: () => fetchOpeningState(hospitalType as string),
    enabled: !!hospitalType && open,
    staleTime: 15_000,
  });
  // Only someone ELSE's balance needs the unattended path. One's own balance
  // stays a hard refusal (the DB enforces it): a cashier must not be able to
  // re-open their own drawer at a bigger number.
  const previousPending = pending.data?.declared === true;

  const num = (value: string) => Number(value.replace(/[^0-9.]/g, "")) || 0;
  const total = num(drawer) + num(locker);

  const record = useMutation({
    mutationFn: async () => {
      if (!hospitalType) throw new Error("No hospital on your account");
      if (total <= 0) throw new Error("Count the drawer first");
      // The split is written into the note rather than a new column: the
      // opening figure the reconciliation reads must stay one number.
      const split = `drawer ${inr(num(drawer))} + locker ${inr(num(locker))}`;
      const fullNote = note.trim() ? `${split}; ${note.trim()}` : split;
      if (previousPending) {
        if (!ackUnattended) {
          throw new Error(
            "Tick the box first — recording over the previous shift's balance " +
            "hands their drawer over in their name.");
        }
        return declareOpeningCashUnattended({
          hospitalType,
          drawer: num(drawer),
          locker: num(locker),
          userId,
          note: fullNote,
          lockerWithdrawn: num(outOfLocker),
          lockerDeposited: num(intoLocker),
        });
      }
      return declareOpeningCash({
        hospitalType,
        amount: total,
        userId,
        note: fullNote,
        lockerWithdrawn: num(outOfLocker),
        lockerDeposited: num(intoLocker),
      });
    },
    onSuccess: (result) => {
      const r = result as Partial<UnattendedOpeningResult> | undefined;
      if (r?.unattended) {
        toast.success(
          `Opening cash recorded. ${r.previousBy ?? "The previous shift"}'s balance was ` +
          `handed over unattended (${r.handoverNo}) — any difference is on their handover, ` +
          `and the directors can see it.`,
          { duration: 10_000 });
      } else {
        toast.success("Opening cash recorded. The drawer counts from here.");
      }
      setDrawer(""); setLocker(""); setNote(""); setOutOfLocker(""); setIntoLocker("");
      setAckUnattended(false);
      // Both screens read these; without the invalidation the tiles ride out
      // their staleTime and keep showing the balance that was just resolved.
      queryClient.invalidateQueries({ queryKey: ["cash-opening-state", hospitalType] });
      queryClient.invalidateQueries({ queryKey: ["opening-cash-states"] });
      if (!alwaysOpen) setOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not record it"),
  });

  if (!open) {
    return (
      <TabletButton variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <Banknote className="mr-2 h-5 w-5" /> Record opening cash
      </TabletButton>
    );
  }

  return (
    <TabletCard className="space-y-3 border-slate-300">
      <div>
        <p className="text-base font-semibold">Opening cash</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Before your shift, count everything the counter physically holds — the cash in
          hand and the cash in the locker — and record it. The system started counting
          part-way through a day, so cash already there was never seen. Recorded once and
          carried into the next handover.
        </p>
      </div>

      {previousPending && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">
            This counter still holds {inr(pending.data?.amount ?? 0)} recorded by{" "}
            {pending.data?.by ?? "the previous shift"}, never handed over.
          </p>
          <p className="mt-1">
            You can still start your shift. Recording your count will first hand their
            drawer over in their name, at the amount you actually find — so any
            difference stays theirs, not yours.
          </p>
          <label className="mt-2 flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={ackUnattended}
              onChange={(e) => setAckUnattended(e.target.checked)}
            />
            <span>
              I counted what is really here, and I understand{" "}
              {pending.data?.by ?? "the previous cashier"}'s handover will be recorded
              without them present.
            </span>
          </label>
        </div>
      )}

      <div>
        <TabletLabel htmlFor="oc-drawer">Cash in hand</TabletLabel>
        <TabletInput
          id="oc-drawer"
          inputMode="decimal"
          value={drawer}
          onChange={(e) => setDrawer(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0"
        />
      </div>

      <div>
        <TabletLabel htmlFor="oc-locker">Cash in the locker</TabletLabel>
        <TabletInput
          id="oc-locker"
          inputMode="decimal"
          value={locker}
          onChange={(e) => setLocker(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <TabletLabel htmlFor="oc-out">Withdrawn from the locker</TabletLabel>
          <TabletInput
            id="oc-out"
            inputMode="decimal"
            value={outOfLocker}
            onChange={(e) => setOutOfLocker(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0"
          />
        </div>
        <div>
          <TabletLabel htmlFor="oc-in">Deposited into the locker</TabletLabel>
          <TabletInput
            id="oc-in"
            inputMode="decimal"
            value={intoLocker}
            onChange={(e) => setIntoLocker(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Movements only — not added to the total. Cash taken out of the locker is already
        in the hand count, and cash put in is already in the locker count.
      </p>

      <div className="flex items-center justify-between border-t pt-2">
        <span className="text-muted-foreground">Opening total</span>
        <span className="text-2xl font-bold">{inr(total)}</span>
      </div>

      <div>
        <TabletLabel htmlFor="oc-note">Note (optional)</TabletLabel>
        <TabletInput
          id="oc-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Who counted it, and with whom"
        />
      </div>

      <div className="flex gap-2">
        {!alwaysOpen && (
          <TabletButton variant="outline" className="flex-1" onClick={() => setOpen(false)}>
            Cancel
          </TabletButton>
        )}
        <TabletButton
          className="flex-1"
          disabled={record.isPending || total <= 0 || (previousPending && !ackUnattended)}
          onClick={() => record.mutate()}
        >
          {record.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
          {previousPending ? "Record and take over the counter" : "Record opening cash"}
        </TabletButton>
      </div>
    </TabletCard>
  );
}
