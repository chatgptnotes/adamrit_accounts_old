import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Check,
  HandCoins,
  Loader2,
  Pill,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { inr, shortDate } from "@/tablet/lib/format";
import {
  DENOMINATIONS,
  acceptHandover,
  fetchHandovers,
  fetchNominees,
  fetchPharmacyPositions,
  fetchPharmacySummary,
  fetchPreview,
  submitHandover,
  verifyHandover,
} from "@/lib/cashHandover";

// DATA SOURCE: cash_handover_preview / submit_cash_handover / accept_cash_handover
// / verify_cash_handover. Every rupee figure is computed in the database; this
// screen only sends the note count and who is receiving the cash.

type Tab = "hand-over" | "to-me" | "pharmacy";

export default function CashHandoverFlow() {
  const { user, hospitalType } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("hand-over");

  // Only people nominated at THIS hospital (plus the group-wide ones): the
  // Ayushman counter hands to Arpit, which has nothing to do with Hope.
  const nominees = useQuery({
    queryKey: ["cash-handover-nominees", tab === "pharmacy" ? "pharmacy" : hospitalType ?? "all"],
    queryFn: () => fetchNominees(tab === "pharmacy" ? "pharmacy" : hospitalType),
    staleTime: 60_000,
  });

  const inbox = useQuery({
    queryKey: ["cash-handover-inbox", user?.id],
    enabled: !!user?.id,
    queryFn: () => fetchHandovers({ status: ["SUBMITTED", "ACCEPTED"], limit: 50 }),
    staleTime: 15_000,
  });

  const iAmVerifier = useMemo(
    () => (nominees.data ?? []).some((n) => n.user_id === user?.id && n.can_verify),
    [nominees.data, user?.id],
  );

  const mine = (inbox.data ?? []).filter(
    (h) =>
      (h.status === "SUBMITTED" && h.to_user_id === user?.id) ||
      (h.status === "ACCEPTED" && iAmVerifier && h.from_user_id !== user?.id),
  );

  return (
    <FlowScaffold
      heading="Cash Handover"
      subheading="Count the drawer, hand it to a nominated person, and have the count verified."
    >
      <div className="mb-4 flex gap-2">
        <TabletButton
          variant={tab === "hand-over" ? "default" : "outline"}
          className="flex-1"
          onClick={() => setTab("hand-over")}
        >
          <HandCoins className="mr-2 h-5 w-5" /> Hand over cash
        </TabletButton>
        <TabletButton
          variant={tab === "to-me" ? "default" : "outline"}
          className="flex-1"
          onClick={() => setTab("to-me")}
        >
          <ShieldCheck className="mr-2 h-5 w-5" /> For me
          {mine.length > 0 && (
            <span className="ml-2 rounded-full bg-primary-foreground px-2 py-0.5 text-xs font-bold text-primary">
              {mine.length}
            </span>
          )}
        </TabletButton>
        <TabletButton
          variant={tab === "pharmacy" ? "default" : "outline"}
          className="flex-1"
          onClick={() => setTab("pharmacy")}
        >
          <Pill className="mr-2 h-5 w-5" /> Pharmacy
        </TabletButton>
      </div>

      {tab === "pharmacy" ? (
        <PharmacyPanel
          userId={user?.id ?? ""}
          nominees={(nominees.data ?? []).filter(
            (n) => n.can_receive && n.user_id !== user?.id,
          )}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["tablet-pharmacy-positions"] });
            qc.invalidateQueries({ queryKey: ["tablet-pharmacy-summary"] });
            qc.invalidateQueries({ queryKey: ["cash-handover-inbox"] });
          }}
        />
      ) : tab === "hand-over" ? (
        <HandOverPanel
          userId={user?.id ?? ""}
          hospitalType={hospitalType ?? null}
          nominees={(nominees.data ?? []).filter(
            (n) => n.can_receive && n.user_id !== user?.id,
          )}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["cash-handover-inbox"] });
            qc.invalidateQueries({ queryKey: ["cash-handover-preview"] });
          }}
        />
      ) : (
        <ForMePanel
          userId={user?.id ?? ""}
          rows={mine}
          isLoading={inbox.isLoading}
          iAmVerifier={iAmVerifier}
          onDone={() => qc.invalidateQueries({ queryKey: ["cash-handover-inbox"] })}
        />
      )}
    </FlowScaffold>
  );
}

/* ------------------------------------------------------------------ hand over */

function HandOverPanel({
  userId,
  hospitalType,
  nominees,
  onDone,
}: {
  userId: string;
  hospitalType: string | null;
  nominees: { user_id: string; display_name: string }[];
  onDone: () => void;
}) {
  const [includeUnattributed, setIncludeUnattributed] = useState(false);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [toUserId, setToUserId] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  // What the cashier says came in online this shift. Never added to the cash
  // count -- that money is in the bank -- but recorded so the two can be
  // compared against what the software holds.
  const [online, setOnline] = useState("");

  // Scoped to this cashier's own hospital: Hope and Ayushman keep separate
  // drawers even though a receipt carries no hospital of its own.
  const preview = useQuery({
    queryKey: ["cash-handover-preview", userId, includeUnattributed, hospitalType ?? "all"],
    enabled: !!userId,
    queryFn: () => fetchPreview(userId, includeUnattributed, hospitalType),
    staleTime: 10_000,
  });

  const counted = useMemo(
    () =>
      DENOMINATIONS.reduce(
        (sum, d) => sum + d * (parseInt(counts[d] ?? "", 10) || 0),
        0,
      ),
    [counts],
  );
  const expected = preview.data?.expectedCash ?? 0;
  const variance = counted - expected;
  const needsReason = Math.round(variance * 100) !== 0;

  const submit = useMutation({
    mutationFn: async () => {
      if (!toUserId) throw new Error("Choose who is receiving the cash");
      return submitHandover({
        fromUserId: userId,
        toUserId,
        hospitalType,
        includeUnattributed,
        varianceReason: reason.trim() || null,
        notes: notes.trim() || null,
        declaredOnline: online.trim() === "" ? null : Number(online.replace(/[^0-9.]/g, "")),
        denominations: DENOMINATIONS.map((d) => ({
          denomination: d,
          qty: parseInt(counts[d] ?? "", 10) || 0,
        })),
      });
    },
    onSuccess: (r) => {
      toast.success(`Handover ${r.handoverNo} recorded. Waiting for it to be received.`);
      setCounts({});
      setReason("");
      setNotes("");
      setOnline("");
      setToUserId("");
      preview.refetch();
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not record the handover"),
  });

  if (preview.isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const p = preview.data;

  return (
    <div className="space-y-4 pb-4">
      <TabletCard className="bg-emerald-50">
        <p className="text-sm text-muted-foreground">Software says you are holding</p>
        <p className="text-4xl font-bold text-emerald-700">{inr(expected)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {p?.mineCount ?? 0} receipt{(p?.mineCount ?? 0) === 1 ? "" : "s"} recorded to you
          {includeUnattributed && (p?.unattributedCount ?? 0) > 0
            ? `, plus ${p?.unattributedCount} not recorded to anyone`
            : ""}
        </p>
      </TabletCard>

      {(p?.unattributedCount ?? 0) > 0 && (
        <TabletCard className="border-amber-300 bg-amber-50">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {inr(p?.unattributedAmount ?? 0)} was collected without a name
              </p>
              <p className="text-sm text-muted-foreground">
                {p?.unattributedCount} receipt(s). Include this only if the money is
                physically in your drawer.
              </p>
              <TabletButton
                variant={includeUnattributed ? "default" : "outline"}
                className="mt-2"
                onClick={() => setIncludeUnattributed((v) => !v)}
              >
                {includeUnattributed ? "Included in my count" : "Include in my count"}
              </TabletButton>
            </div>
          </div>
        </TabletCard>
      )}

      <div>
        <h3 className="mb-2 font-semibold">Count the notes</h3>
        <div className="space-y-2">
          {DENOMINATIONS.map((d) => {
            const qty = parseInt(counts[d] ?? "", 10) || 0;
            return (
              <div key={d} className="flex items-center gap-3">
                <div className="w-20 flex-shrink-0 text-right font-semibold">₹{d}</div>
                <span className="text-muted-foreground">×</span>
                <TabletInput
                  className="w-24"
                  inputMode="numeric"
                  value={counts[d] ?? ""}
                  placeholder="0"
                  onChange={(e) =>
                    setCounts((c) => ({ ...c, [d]: e.target.value.replace(/\D/g, "") }))
                  }
                />
                <div className="flex-1 text-right text-muted-foreground">
                  {qty > 0 ? inr(d * qty) : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <TabletCard className={needsReason ? "border-amber-400 bg-amber-50" : "bg-muted/40"}>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">You counted</span>
          <span className="text-2xl font-bold">{inr(counted)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-muted-foreground">Software says</span>
          <span className="font-medium">{inr(expected)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t pt-2">
          <span className="font-medium">
            {variance === 0 ? "Matches" : variance > 0 ? "Extra in drawer" : "Short"}
          </span>
          <span
            className={
              variance === 0
                ? "text-xl font-bold text-emerald-700"
                : "text-xl font-bold text-amber-700"
            }
          >
            {variance === 0 ? "✓" : inr(Math.abs(variance))}
          </span>
        </div>
      </TabletCard>

      {needsReason && (
        <div>
          <TabletLabel htmlFor="ch-reason">
            Why is it different? (required — the handover still goes through)
          </TabletLabel>
          <TabletInput
            id="ch-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. ₹500 paid out for stationery, slip in drawer"
          />
        </div>
      )}

      <div>
        <TabletLabel>Who is receiving the cash?</TabletLabel>
        {nominees.length === 0 ? (
          <p className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">
            Nobody is nominated to receive cash yet. A director sets this up on the
            Cash Handover screen.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {nominees.map((n) => (
              <TabletButton
                key={n.user_id}
                variant={toUserId === n.user_id ? "default" : "outline"}
                onClick={() => setToUserId(n.user_id)}
              >
                {n.display_name}
              </TabletButton>
            ))}
          </div>
        )}
      </div>

      <div>
        <TabletLabel htmlFor="ch-online">
          Online receipts this shift (UPI, card) — software says{" "}
          {inr((p?.refUpiTotal ?? 0) + (p?.refCardTotal ?? 0))}
        </TabletLabel>
        <TabletInput
          id="ch-online"
          inputMode="decimal"
          value={online}
          onChange={(e) => setOnline(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="What you took online"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Not handed over — this money is in the bank. Recorded so it can be
          checked against the software.
        </p>
      </div>

      <div>
        <TabletLabel htmlFor="ch-notes">Notes (optional)</TabletLabel>
        <TabletInput
          id="ch-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything the receiver should know"
        />
      </div>

      {(p?.refUpiTotal || p?.refCardTotal) ? (
        <TabletCard className="bg-muted/30">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            For reference only — not handed over
          </p>
          <div className="mt-1 flex justify-between text-sm">
            <span>UPI / online today</span>
            <span className="font-medium">{inr(p?.refUpiTotal ?? 0)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Card today</span>
            <span className="font-medium">{inr(p?.refCardTotal ?? 0)}</span>
          </div>
        </TabletCard>
      ) : null}

      <TabletButton
        className="w-full"
        disabled={submit.isPending || counted <= 0 || !toUserId}
        onClick={() => submit.mutate()}
      >
        <Check className="mr-2 h-5 w-5" />
        {submit.isPending ? "Recording…" : `Hand over ${inr(counted)}`}
      </TabletButton>
    </div>
  );
}

/* ------------------------------------------------------------------- for me */

function ForMePanel({
  userId,
  rows,
  isLoading,
  iAmVerifier,
  onDone,
}: {
  userId: string;
  rows: import("@/lib/cashHandover").CashHandover[];
  isLoading: boolean;
  iAmVerifier: boolean;
  onDone: () => void;
}) {
  // Where a count is out, the verifier records what THEY found before signing
  // it off. The database refuses the sign-off without it.
  const [notes, setNotes] = useState<Record<string, string>>({});

  const act = useMutation({
    mutationFn: async ({ id, kind }: { id: string; kind: "accept" | "verify" }) =>
      kind === "accept"
        ? acceptHandover(id, userId)
        : verifyHandover(id, userId, notes[id]?.trim() || undefined),
    onSuccess: (_d, v) => {
      toast.success(v.kind === "accept" ? "Cash received." : "Count verified.");
      setNotes((n) => ({ ...n, [v.id]: "" }));
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-muted-foreground">
        Nothing waiting for you.
        {!iAmVerifier && " You are not nominated to verify counts."}
      </p>
    );
  }

  return (
    <div className="space-y-3 pb-4">
      {rows.map((h) => {
        const isReceive = h.status === "SUBMITTED";
        return (
          <TabletCard key={h.id} className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{h.from_user_name}</p>
                <p className="text-xs text-muted-foreground">
                  {h.handover_no} · {shortDate(h.submitted_at)} · {h.source_count} receipt(s)
                </p>
              </div>
              <span className="flex-shrink-0 text-2xl font-bold">{inr(h.counted_cash)}</span>
            </div>

            {Math.round(h.variance * 100) !== 0 && (
              <div className="rounded-lg bg-amber-50 p-2 text-sm">
                <p className="font-medium text-amber-800">
                  {h.variance > 0 ? "Extra" : "Short"} {inr(Math.abs(h.variance))} against
                  software ({inr(h.expected_cash)})
                </p>
                {h.variance_reason && (
                  <p className="text-muted-foreground">Reason: {h.variance_reason}</p>
                )}
              </div>
            )}

            {h.notes && <p className="text-sm text-muted-foreground">{h.notes}</p>}

            {!isReceive && Math.round(h.variance * 100) !== 0 && (
              <div>
                <TabletLabel htmlFor={`vn-${h.id}`}>
                  What did you find? (required — the count is out)
                </TabletLabel>
                <TabletInput
                  id={`vn-${h.id}`}
                  value={notes[h.id] ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [h.id]: e.target.value }))}
                  placeholder="e.g. recounted together, ₹100 short"
                />
              </div>
            )}

            <TabletButton
              className="w-full"
              disabled={
                act.isPending ||
                (!isReceive &&
                  Math.round(h.variance * 100) !== 0 &&
                  !(notes[h.id] ?? "").trim())
              }
              onClick={() => act.mutate({ id: h.id, kind: isReceive ? "accept" : "verify" })}
            >
              {isReceive ? (
                <>
                  <Banknote className="mr-2 h-5 w-5" /> I have received this cash
                </>
              ) : (
                <>
                  <BadgeCheck className="mr-2 h-5 w-5" /> I have counted it — verify
                </>
              )}
              <ArrowRight className="ml-2 h-4 w-4" />
            </TabletButton>
          </TabletCard>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- pharmacy */

/**
 * Hope Pharmacy's till. Its own company, its own Cash ledger and its own
 * staff, so it never mixes with the hospital counters.
 *
 * Read-only for now: pharmacy cash is not yet claimable through a handover,
 * because the handover claims patient receipts and the pharmacy sells from a
 * different set of tables.
 */
function PharmacyPanel({
  userId,
  nominees,
  onDone,
}: {
  userId: string;
  nominees: { user_id: string; display_name: string }[];
  onDone: () => void;
}) {
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [toUserId, setToUserId] = useState("");
  const [reason, setReason] = useState("");

  const positions = useQuery({
    queryKey: ["tablet-pharmacy-positions"],
    queryFn: fetchPharmacyPositions,
    staleTime: 30_000,
  });
  // The pharmacy claims its own tables, so the expected figure comes from the
  // same preview the hospital counters use, scoped to "pharmacy".
  const preview = useQuery({
    queryKey: ["pharmacy-preview", userId],
    enabled: !!userId,
    queryFn: () => fetchPreview(userId, true, "pharmacy"),
    staleTime: 10_000,
  });
  const summary = useQuery({
    queryKey: ["tablet-pharmacy-summary"],
    queryFn: fetchPharmacySummary,
    staleTime: 30_000,
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!toUserId) throw new Error("Choose who is receiving the cash");
      return submitHandover({
        fromUserId: userId,
        toUserId,
        hospitalType: "pharmacy",
        includeUnattributed: true,
        varianceReason: reason.trim() || null,
        denominations: DENOMINATIONS.map((d) => ({
          denomination: d,
          qty: parseInt(counts[d] ?? "", 10) || 0,
        })),
      });
    },
    onSuccess: (r) => {
      toast.success(`Handover ${r.handoverNo} recorded. Waiting for it to be received.`);
      setCounts({});
      setReason("");
      setToUserId("");
      preview.refetch();
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not record the handover"),
  });

  if (positions.isLoading || summary.isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const till = (positions.data ?? []).reduce((acc, p) => acc + Number(p.net_cash || 0), 0);
  const s = summary.data;
  const counted = DENOMINATIONS.reduce(
    (sum, d) => sum + d * (parseInt(counts[d] ?? "", 10) || 0),
    0,
  );
  const expected = preview.data?.expectedCash ?? 0;
  const variance = counted - expected;
  const needsReason = Math.round(variance * 100) !== 0;

  return (
    <div className="space-y-4 pb-4">
      <TabletCard className="bg-emerald-50">
        <p className="text-sm text-muted-foreground">Cash in the pharmacy till</p>
        <p className={`text-4xl font-bold ${till < 0 ? "text-amber-700" : "text-emerald-700"}`}>
          {inr(till)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {s?.cashCount ?? 0} cash sale(s), less anything paid out
        </p>
      </TabletCard>

      <div className="grid grid-cols-2 gap-3">
        <TabletCard>
          <p className="text-sm text-muted-foreground">UPI / online</p>
          <p className="text-2xl font-bold">{inr(s?.upiAmount ?? 0)}</p>
          <p className="text-xs text-muted-foreground">{s?.upiCount ?? 0} payment(s)</p>
        </TabletCard>
        <TabletCard>
          <p className="text-sm text-muted-foreground">Card</p>
          <p className="text-2xl font-bold">{inr(s?.cardAmount ?? 0)}</p>
          <p className="text-xs text-muted-foreground">{s?.cardCount ?? 0} payment(s)</p>
        </TabletCard>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        UPI and card are shown for the shift total. Only cash is handed over.
      </p>

      <h3 className="mb-1 font-semibold">Count the till and hand it over</h3>
      <div className="space-y-2">
        {DENOMINATIONS.map((d) => {
          const qty = parseInt(counts[d] ?? "", 10) || 0;
          return (
            <div key={d} className="flex items-center gap-3">
              <div className="w-20 flex-shrink-0 text-right font-semibold">₹{d}</div>
              <span className="text-muted-foreground">×</span>
              <TabletInput
                className="w-24"
                inputMode="numeric"
                value={counts[d] ?? ""}
                placeholder="0"
                onChange={(e) =>
                  setCounts((c) => ({ ...c, [d]: e.target.value.replace(/\D/g, "") }))
                }
              />
              <div className="flex-1 text-right text-muted-foreground">
                {qty > 0 ? inr(d * qty) : "—"}
              </div>
            </div>
          );
        })}
      </div>

      <TabletCard className={needsReason ? "border-amber-400 bg-amber-50" : "bg-muted/40"}>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">You counted</span>
          <span className="text-2xl font-bold">{inr(counted)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-muted-foreground">Software says</span>
          <span className="font-medium">{inr(expected)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t pt-2">
          <span className="font-medium">
            {variance === 0 ? "Matches" : variance > 0 ? "Extra in till" : "Short"}
          </span>
          <span className={variance === 0 ? "text-xl font-bold text-emerald-700" : "text-xl font-bold text-amber-700"}>
            {variance === 0 ? "✓" : inr(Math.abs(variance))}
          </span>
        </div>
      </TabletCard>

      {needsReason && (
        <div>
          <TabletLabel htmlFor="ph-reason">
            Why is it different? (required — the handover still goes through)
          </TabletLabel>
          <TabletInput
            id="ph-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. ₹200 paid out for a delivery"
          />
        </div>
      )}

      <div>
        <TabletLabel>Who is receiving the cash?</TabletLabel>
        {nominees.length === 0 ? (
          <p className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">
            Nobody is nominated to receive pharmacy cash yet. A director sets this
            up on the Cash Handover screen, under Hope Pharmacy.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {nominees.map((n) => (
              <TabletButton
                key={n.user_id}
                variant={toUserId === n.user_id ? "default" : "outline"}
                onClick={() => setToUserId(n.user_id)}
              >
                {n.display_name}
              </TabletButton>
            ))}
          </div>
        )}
      </div>

      <TabletButton
        className="w-full"
        disabled={submit.isPending || counted <= 0 || !toUserId}
        onClick={() => submit.mutate()}
      >
        <Check className="mr-2 h-5 w-5" />
        {submit.isPending ? "Recording…" : `Hand over ${inr(counted)}`}
      </TabletButton>

      <h3 className="mb-1 font-semibold">Who is holding pharmacy cash</h3>
      {(positions.data ?? []).length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">
          No pharmacy cash outstanding.
        </p>
      ) : (
        <div className="space-y-2">
          {(positions.data ?? []).map((p) => (
            <TabletCard
              key={`${p.holder_user_id ?? "x"}-${p.holder_name}`}
              className="flex items-center gap-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {p.attribution === "payout" ? (
                    <span className="text-rose-700">{p.holder_name}</span>
                  ) : p.attribution === "login" ? (
                    p.holder_name
                  ) : p.attribution === "name" ? (
                    <>
                      {p.holder_name}
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        by name
                      </span>
                    </>
                  ) : (
                    <span className="text-amber-700">Not recorded to anyone</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {p.receipt_count} entr{p.receipt_count === 1 ? "y" : "ies"}
                </p>
              </div>
              <span
                className={
                  Number(p.net_cash) < 0
                    ? "font-semibold text-rose-700"
                    : "font-semibold text-emerald-700"
                }
              >
                {inr(p.net_cash)}
              </span>
            </TabletCard>
          ))}
        </div>
      )}
    </div>
  );
}
