import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banknote, Loader2 } from "lucide-react";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { inr } from "@/tablet/lib/format";
import { declareOpeningCash } from "@/lib/cashHandover";

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

  const num = (value: string) => Number(value.replace(/[^0-9.]/g, "")) || 0;
  const total = num(drawer) + num(locker);

  const record = useMutation({
    mutationFn: async () => {
      if (!hospitalType) throw new Error("No hospital on your account");
      if (total <= 0) throw new Error("Count the drawer first");
      // The split is written into the note rather than a new column: the
      // opening figure the reconciliation reads must stay one number.
      const split = `drawer ${inr(num(drawer))} + locker ${inr(num(locker))}`;
      return declareOpeningCash({
        hospitalType,
        amount: total,
        userId,
        note: note.trim() ? `${split}; ${note.trim()}` : split,
      });
    },
    onSuccess: () => {
      toast.success("Opening cash recorded. The drawer counts from here.");
      setDrawer(""); setLocker(""); setNote("");
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
          disabled={record.isPending || total <= 0}
          onClick={() => record.mutate()}
        >
          {record.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
          Record opening cash
        </TabletButton>
      </div>
    </TabletCard>
  );
}
