import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BadgeCheck,
  Banknote,
  Printer,
  Receipt,
  ShieldCheck,
  TriangleAlert,
  UserCog,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  fetchDenominations, fetchHandovers, fetchNominees, fetchPayouts,
  fetchOnlineOut, fetchPharmacyPositions, fetchPharmacySummary, fetchPharmacyTransactions,
  fetchPositions, setNominee,
  verifyHandover, type CashHandover,
} from "@/lib/cashHandover";
import { printHandoverSlip } from "@/lib/printHandoverSlip";

const inr = (n: number | null | undefined) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      })
    : "—";

/**
 * Everyone at the counter may LOOK at this screen — reception, billing and
 * accounts all need to see whose cash is whose. Changing who may receive or
 * verify is a different matter: a receptionist who can nominate themselves as a
 * verifier can approve their own drawer, which is the one thing this feature
 * exists to prevent.
 *
 * Matched case-insensitively on purpose. The same role is stored both ways in
 * the user table — "Receptionist" for Diksha and "receptionist" for Nisha,
 * "Billing" and "billing", "Pharmacy" and "pharmacy" — so an exact comparison
 * silently locks out half the staff who hold the very same job.
 */
const NOMINEE_ADMIN_ROLES = ["superadmin", "super_admin", "ca", "admin", "cmd", "director"];

const canManageNominees = (role: string | null | undefined) =>
  NOMINEE_ADMIN_ROLES.includes((role ?? "").toLowerCase().trim());

const STATUS_TONE: Record<string, string> = {
  SUBMITTED: "bg-amber-100 text-amber-800",
  ACCEPTED: "bg-blue-100 text-blue-800",
  VERIFIED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-muted text-muted-foreground",
};

export default function CashHandoverPage() {
  const { user, hospitalType } = useAuth();
  const qc = useQueryClient();

  // Receipts carry no hospital of their own; it comes from the patient. Without
  // this filter both counters showed each other's transactions.
  const [posScope, setPosScope] = useState<string>("");
  const [showPayouts, setShowPayouts] = useState(false);
  const [showOnlineOut, setShowOnlineOut] = useState(false);
  const positions = useQuery({
    queryKey: ["cash-positions", posScope || "all"],
    queryFn: () => fetchPositions(posScope || null),
  });
  // The individual vouchers behind the "Cash paid out" line — a single total
  // left Dr M unable to find the Rs 1 he knew had been paid.
  const payouts = useQuery({
    queryKey: ["cash-payouts", posScope || "all"],
    queryFn: () => fetchPayouts(posScope || null),
  });
  // Vendor and other payments made by bank or UPI. They never touch the
  // drawer, but a shift cannot be read as complete without them.
  const onlineOut = useQuery({
    queryKey: ["online-out", posScope || "all"],
    queryFn: () => fetchOnlineOut(posScope || null),
  });
  // Hope Pharmacy is a separate company with its own till and its own staff,
  // so it gets its own tab rather than being mixed into the hospital counters.
  const pharmacy = useQuery({ queryKey: ["pharmacy-positions"], queryFn: fetchPharmacyPositions });
  const pharmacySummary = useQuery({ queryKey: ["pharmacy-summary"], queryFn: fetchPharmacySummary });
  const handovers = useQuery({ queryKey: ["cash-handovers"], queryFn: () => fetchHandovers({ limit: 200 }) });
  const nominees = useQuery({ queryKey: ["cash-handover-nominees", "all"], queryFn: () => fetchNominees() });

  const openVariances = useMemo(
    () => (handovers.data ?? []).filter(
      (h) => h.status !== "CANCELLED" && Math.round(h.variance * 100) !== 0,
    ),
    [handovers.data],
  );
  const totalHeld = (positions.data ?? []).reduce((s, p) => s + Number(p.net_cash || 0), 0);

  return (
    // pb-28 clears the floating camera and chat buttons, which sat on top of
    // the last row of the table.
    <div className="space-y-6 p-6 pb-28">
      <div>
        <h1 className="text-2xl font-bold">Cash Handover</h1>
        <p className="text-muted-foreground">
          Who is holding the hospital's cash, and the record of it changing hands.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-l-4 border-l-emerald-500">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Banknote className="h-4 w-4 text-emerald-600" /> Cash at the counter
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-3xl font-bold ${totalHeld < 0 ? "text-amber-700" : ""}`}>
              {inr(totalHeld)}
            </p>
            <p className="text-xs text-muted-foreground">
              Collected, less cash paid out, not yet handed over
            </p>
            {totalHeld < 0 && (
              <p className="mt-2 text-xs text-amber-700">
                Below zero because more has been paid out than collected since
                counting began. The difference came from cash already in the drawer
                beforehand, which the system never saw. It settles after the first
                full handover.
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="h-4 w-4 text-amber-600" /> Differences recorded
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{openVariances.length}</p>
            <p className="text-xs text-muted-foreground">
              Handovers where the count did not match
            </p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-blue-600" /> Nominated people
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{(nominees.data ?? []).length}</p>
            <p className="text-xs text-muted-foreground">Allowed to receive or verify</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="holders">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="holders">Who is holding cash</TabsTrigger>
          <TabsTrigger value="pharmacy">Hope Pharmacy</TabsTrigger>
          <TabsTrigger value="register">Handover register</TabsTrigger>
          <TabsTrigger value="by-person">By person</TabsTrigger>
          <TabsTrigger value="people">Nominated people</TabsTrigger>
        </TabsList>

        <TabsContent value="holders" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <div className="mb-4 flex flex-wrap gap-2">
                {[
                  { key: "", label: "Both hospitals" },
                  { key: "hope", label: "Hope" },
                  { key: "ayushman", label: "Ayushman Nagpur" },
                ].map((h) => (
                  <Button
                    key={h.key || "all"}
                    size="sm"
                    variant={posScope === h.key ? "default" : "outline"}
                    onClick={() => setPosScope(h.key)}
                  >
                    {h.label}
                  </Button>
                ))}
              </div>
              {(onlineOut.data ?? []).length > 0 && (
                <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-blue-900">
                      Paid out by bank or UPI (vendors and others)
                    </span>
                    <span className="font-semibold text-blue-900">
                      {inr((onlineOut.data ?? []).reduce((a, o) => a + Number(o.amount || 0), 0))}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-blue-800">
                    {(onlineOut.data ?? []).length} payment(s). Not part of the drawer —
                    this money left the bank, not the counter.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 bg-white"
                    onClick={() => setShowOnlineOut((v) => !v)}
                  >
                    {showOnlineOut ? "Hide breakdown" : "Show breakdown"}
                  </Button>

                  {showOnlineOut && (
                    <div className="mt-3 max-h-80 overflow-auto rounded border bg-white">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Voucher</TableHead>
                            <TableHead className="text-xs">Paid for</TableHead>
                            <TableHead className="text-xs">From account</TableHead>
                            <TableHead className="text-xs">Dated</TableHead>
                            <TableHead className="text-right text-xs">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(onlineOut.data ?? []).map((o) => (
                            <TableRow key={o.id}>
                              <TableCell className="font-mono text-xs">
                                {o.voucher_no ?? "—"}
                              </TableCell>
                              <TableCell className="text-xs">{o.label}</TableCell>
                              <TableCell className="text-xs">{o.ledger ?? "—"}</TableCell>
                              <TableCell className="text-xs">
                                {o.entry_date
                                  ? new Date(o.entry_date).toLocaleDateString("en-IN", {
                                      day: "2-digit", month: "short",
                                    })
                                  : "—"}
                              </TableCell>
                              <TableCell className="text-right text-xs font-medium text-blue-900">
                                {inr(o.amount)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead className="text-right">Cash held</TableHead>
                    {/* Not "Receipts": on the paid-out row these are vouchers. */}
                    <TableHead className="text-right">Entries</TableHead>
                    <TableHead>Oldest</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(positions.data ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        No cash outstanding at the counter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (positions.data ?? []).map((p) => (
                      <Fragment key={`${p.holder_user_id ?? "x"}-${p.holder_name}`}>
                      <TableRow>
                        <TableCell className="font-medium">
                          {p.attribution === "payout" ? (
                            <>
                              <span className="text-rose-700">{p.holder_name}</span>
                              <span
                                className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-xs font-normal text-rose-800"
                                title="Cash paid out of the drawer on payment vouchers. Payment vouchers record no user, so this reduces the counter rather than one person."
                              >
                                paid out
                              </span>
                            </>
                          ) : p.attribution === "login" ? (
                            p.holder_name
                          ) : p.attribution === "name" ? (
                            <>
                              <span>{p.holder_name}</span>
                              <span
                                className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800"
                                title="Taken from the billing executive name typed on the payment screen, not from a login. This cash cannot be handed over until it is collected under a login."
                              >
                                by name
                              </span>
                            </>
                          ) : (
                            <span className="text-amber-700">Not recorded to anyone</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {inr(p.net_cash)}
                        </TableCell>
                        <TableCell className="text-right">
                          {p.receipt_count}
                          {p.attribution === "payout" && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              voucher{p.receipt_count === 1 ? "" : "s"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {when(p.oldest_uncollected)}
                          {p.attribution === "payout" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="ml-2 h-6 px-2 text-xs"
                              onClick={() => setShowPayouts((v) => !v)}
                            >
                              {showPayouts ? "Hide" : "Show each"}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {p.attribution === "payout" && showPayouts && (
                        <TableRow>
                          <TableCell colSpan={4} className="bg-muted/30 p-0">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-xs">Voucher</TableHead>
                                  <TableHead className="text-xs">Paid for</TableHead>
                                  <TableHead className="text-xs">Paid by</TableHead>
                                  {/* Two dates on purpose: staff routinely file
                                      yesterday's slips today, and the drawer
                                      counts when the cash actually left. */}
                                  <TableHead className="text-xs">Dated</TableHead>
                                  <TableHead className="text-xs">Entered</TableHead>
                                  <TableHead className="text-right text-xs">Amount</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {(payouts.data ?? []).map((v) => (
                                  <TableRow key={v.id}>
                                    <TableCell className="font-mono text-xs">
                                      {v.voucher_no ?? "—"}
                                    </TableCell>
                                    <TableCell className="text-xs">{v.label}</TableCell>
                                    <TableCell className="text-xs">
                                      {v.paid_by ?? (
                                        <span className="text-amber-700">Not recorded</span>
                                      )}
                                    </TableCell>
                                    <TableCell className="text-xs">
                                      {v.entry_date
                                        ? new Date(v.entry_date).toLocaleDateString("en-IN", {
                                            day: "2-digit", month: "short",
                                          })
                                        : "—"}
                                      {v.entry_date &&
                                        v.entry_date !== v.at.slice(0, 10) && (
                                          <span
                                            className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800"
                                            title="Filed under a different day from when the cash left the counter"
                                          >
                                            backdated
                                          </span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-xs">{when(v.at)}</TableCell>
                                    <TableCell className="text-right text-xs font-medium text-rose-700">
                                      −{inr(v.amount)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableCell>
                        </TableRow>
                      )}
                      </Fragment>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pharmacy" className="mt-4">
          <PharmacyPanel
            rows={pharmacy.data ?? []}
            summary={pharmacySummary.data}
            isLoading={pharmacy.isLoading}
          />
        </TabsContent>

        <TabsContent value="register" className="mt-4">
          <RegisterTable
            rows={handovers.data ?? []}
            currentUserId={user?.id ?? ""}
            orgName={hospitalType ?? "Hospital"}
            canVerify={(nominees.data ?? []).some(
              (n) => n.user_id === user?.id && n.can_verify,
            )}
            onChanged={() => {
              qc.invalidateQueries({ queryKey: ["cash-handovers"] });
              qc.invalidateQueries({ queryKey: ["cash-positions"] });
            }}
          />
        </TabsContent>

        <TabsContent value="by-person" className="mt-4">
          <ByPersonPanel rows={handovers.data ?? []} />
        </TabsContent>

        <TabsContent value="people" className="mt-4">
          <NomineeMaster
            nominees={nominees.data ?? []}
            actor={user?.email ?? user?.id ?? null}
            canManage={canManageNominees(user?.role)}
            onChanged={() => qc.invalidateQueries({ queryKey: ["cash-handover-nominees"] })}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------------------------------------------------------- register */

function RegisterTable({
  rows, currentUserId, orgName, canVerify, onChanged,
}: {
  rows: CashHandover[];
  currentUserId: string;
  orgName: string;
  canVerify: boolean;
  onChanged: () => void;
}) {
  // The verifier records what THEY found. Where the count is out, the database
  // will not accept a sign-off without it: the only account of a shortage
  // should not be the account of the person who was short.
  const [verifying, setVerifying] = useState<CashHandover | null>(null);
  const [verifyNote, setVerifyNote] = useState("");

  const verify = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      verifyHandover(id, currentUserId, note.trim() || undefined),
    onSuccess: () => {
      toast.success("Count verified.");
      setVerifying(null);
      setVerifyNote("");
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not verify"),
  });

  const print = async (h: CashHandover) => {
    const denoms = await fetchDenominations(h.id);
    if (!printHandoverSlip(h, denoms, orgName)) {
      toast.error("Popup blocked — allow popups for this site to print the slip");
    }
  };

  const verifyDiff = verifying ? Number(verifying.variance || 0) : 0;
  const verifyNeedsNote = Math.round(verifyDiff * 100) !== 0;

  return (
    <Card>
      <Dialog open={!!verifying} onOpenChange={(o) => !o && setVerifying(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Verify {verifying?.handover_no}</DialogTitle>
            <DialogDescription>
              {verifying?.from_user_name} handed {inr(verifying?.counted_cash ?? 0)} to{" "}
              {verifying?.to_user_name}. The software expected{" "}
              {inr(verifying?.expected_cash ?? 0)}.
            </DialogDescription>
          </DialogHeader>

          {verifyNeedsNote && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
              <p className="font-medium text-amber-900">
                Out by {inr(Math.abs(verifyDiff))} ({verifyDiff > 0 ? "extra" : "short"})
              </p>
              {verifying?.variance_reason && (
                <p className="mt-1 text-amber-800">
                  Cashier said: “{verifying.variance_reason}”
                </p>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="verify-note">
              What did you find?{" "}
              {verifyNeedsNote ? (
                <span className="text-destructive">*</span>
              ) : (
                <span className="text-muted-foreground">(optional)</span>
              )}
            </Label>
            <Textarea
              id="verify-note"
              className="mt-1"
              rows={3}
              value={verifyNote}
              onChange={(e) => setVerifyNote(e.target.value)}
              placeholder={
                verifyNeedsNote
                  ? "e.g. recounted with the cashier, ₹100 short, paid out for stationery without a slip"
                  : "Anything worth recording"
              }
            />
            {verifyNeedsNote && (
              <p className="mt-1 text-xs text-muted-foreground">
                Required, because the count did not match. This is your record,
                separate from the cashier's reason above.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setVerifying(null)}>
              Cancel
            </Button>
            <Button
              disabled={verify.isPending || (verifyNeedsNote && !verifyNote.trim())}
              onClick={() => verifying && verify.mutate({ id: verifying.id, note: verifyNote })}
            >
              <BadgeCheck className="mr-1 h-4 w-4" />
              {verify.isPending ? "Verifying…" : "Verify"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CardContent className="overflow-x-auto pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No.</TableHead>
              <TableHead>From → To</TableHead>
              <TableHead className="text-right">Cash counted</TableHead>
              <TableHead className="text-right">Software cash</TableHead>
              <TableHead className="text-right">Difference</TableHead>
              {/* Online never joins the cash count -- that money is in the
                  bank -- but a shift cannot be read without it. */}
              <TableHead className="text-right">Online (software)</TableHead>
              <TableHead className="text-right">Online (declared)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                  No handovers recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((h) => {
                const diff = Number(h.variance || 0);
                return (
                  <TableRow key={h.id}>
                    <TableCell className="font-mono text-xs">
                      {h.handover_no}
                      {h.is_unmatched && (
                        <span
                          className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-normal text-amber-800"
                          title="No receipts could be matched to this handover — the cash was counted and passed on, but it reconciles against nothing. Usually means the counter shares a login."
                        >
                          unmatched
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{h.from_user_name}</div>
                      <div className="text-xs text-muted-foreground">→ {h.to_user_name}</div>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{inr(h.counted_cash)}</TableCell>
                    <TableCell className="text-right">{inr(h.expected_cash)}</TableCell>
                    <TableCell className="text-right">
                      {Math.round(diff * 100) === 0 ? (
                        <span className="text-emerald-700">—</span>
                      ) : (
                        <span className="font-semibold text-amber-700" title={h.variance_reason ?? ""}>
                          {diff > 0 ? "+" : "−"}{inr(Math.abs(diff))}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-blue-800">
                      {inr((h.ref_upi_total ?? 0) + (h.ref_card_total ?? 0))}
                    </TableCell>
                    <TableCell className="text-right">
                      {h.declared_online === null || h.declared_online === undefined ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span
                          className={
                            Math.round(
                              (Number(h.declared_online) - (h.software_online ?? 0)) * 100,
                            ) === 0
                              ? "text-emerald-700"
                              : "font-semibold text-amber-700"
                          }
                          title="Compared with what the software had recorded online at that moment"
                        >
                          {inr(h.declared_online)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_TONE[h.status]} variant="secondary">
                        {h.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{when(h.submitted_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {h.status === "ACCEPTED" && canVerify && h.from_user_id !== currentUserId && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={verify.isPending}
                            onClick={() => { setVerifying(h); setVerifyNote(""); }}
                          >
                            <BadgeCheck className="mr-1 h-4 w-4" /> Verify
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => print(h)}>
                          <Printer className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ----------------------------------------------------------- nominee master */

const HOSPITAL_SCOPES = [
  { key: "*", label: "All hospitals" },
  { key: "hope", label: "Hope" },
  { key: "ayushman", label: "Ayushman Nagpur" },
] as const;

function NomineeMaster({
  nominees, actor, canManage, onChanged,
}: {
  nominees: {
    user_id: string; display_name: string;
    can_receive: boolean; can_verify: boolean; hospital_type: string;
  }[];
  actor: string | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  // Rights are granted per counter. Everything below applies to this scope.
  const [scope, setScope] = useState<string>("*");

  const users = useQuery({
    queryKey: ["cash-handover-user-list"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("User")
        .select("id, full_name, email, role")
        .order("full_name");
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; full_name: string | null; email: string; role: string }[];
    },
  });

  const save = useMutation({
    mutationFn: (v: { userId: string; canReceive: boolean; canVerify: boolean; isActive: boolean }) =>
      setNominee({ ...v, actor, hospitalType: scope }),
    onSuccess: () => { toast.success("Saved."); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  // Only the nominations for the scope on screen, so a Hope row is never
  // mistaken for an Ayushman one.
  const byId = new Map(
    nominees.filter((n) => n.hospital_type === scope).map((n) => [n.user_id, n]),
  );
  const filtered = (users.data ?? []).filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return byId.has(u.id);
    return (u.full_name ?? "").toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCog className="h-4 w-4" /> Who may receive and verify cash
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Only the people listed here can be handed cash or confirm a count. Rights are
          granted per counter — pick the hospital first. Search to add someone; clear the
          search to see the current list.
        </p>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap gap-2">
          {HOSPITAL_SCOPES.map((h) => (
            <Button
              key={h.key}
              size="sm"
              variant={scope === h.key ? "default" : "outline"}
              onClick={() => setScope(h.key)}
            >
              {h.label}
            </Button>
          ))}
        </div>
        <input
          className="mb-4 w-full rounded-md border px-3 py-2"
          placeholder="Search staff by name or email to nominate…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead className="text-center">Can receive cash</TableHead>
              <TableHead className="text-center">Can verify a count</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                  {search
                    ? "No staff match that search."
                    : `Nobody is nominated for ${HOSPITAL_SCOPES.find((h) => h.key === scope)?.label}.`}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((u) => {
                const n = byId.get(u.id);
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="font-medium">{u.full_name || u.email}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        disabled={!canManage}
                        checked={!!n?.can_receive}
                        onCheckedChange={(v) =>
                          save.mutate({
                            userId: u.id, canReceive: v,
                            canVerify: !!n?.can_verify,
                            isActive: v || !!n?.can_verify,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        disabled={!canManage}
                        checked={!!n?.can_verify}
                        onCheckedChange={(v) =>
                          save.mutate({
                            userId: u.id, canReceive: !!n?.can_receive,
                            canVerify: v, isActive: v || !!n?.can_receive,
                          })
                        }
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          A person can never verify a count they submitted themselves, whatever is set here.
        </p>
        {!canManage && (
          <p className="mt-1 flex items-center gap-2 text-xs text-amber-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            You can see this list but not change it — only a director or administrator
            can decide who receives cash or verifies a count.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------- pharmacy */

/**
 * Hope Pharmacy's own drawer. Cash is what gets handed over; UPI and card are
 * shown beside it so the shift can be reconciled in full, but never added into
 * the drawer, because that money is in the bank and not in anyone's hand.
 */
function PharmacyPanel({
  rows, summary, isLoading,
}: {
  rows: import("@/lib/cashHandover").CashPosition[];
  summary: import("@/lib/cashHandover").PharmacySummary | undefined;
  isLoading: boolean;
}) {
  const drawer = rows.reduce((s, r) => s + Number(r.net_cash || 0), 0);
  const CASH_MODES = ["CASH"];
  // A total nobody can open is a total nobody can check.
  const [showTxns, setShowTxns] = useState(false);
  // Cash and online are different animals: one is counted and handed over, the
  // other is already in the bank. The list mixes them, so it needs a filter.
  const [txnMode, setTxnMode] = useState<"all" | "cash" | "online">("all");
  const txns = useQuery({
    queryKey: ["pharmacy-transactions"],
    queryFn: fetchPharmacyTransactions,
    enabled: showTxns,
  });

  const filteredTxns = (txns.data ?? []).filter((t) =>
    txnMode === "all"
      ? true
      : txnMode === "cash"
        ? CASH_MODES.includes(t.mode)
        : !CASH_MODES.includes(t.mode),
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-l-4 border-l-emerald-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cash in the till</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-3xl font-bold ${drawer < 0 ? "text-amber-700" : ""}`}>
              {inr(drawer)}
            </p>
            <p className="text-xs text-muted-foreground">
              {summary?.cashCount ?? 0} cash sale(s), less anything paid out
            </p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">UPI / online</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{inr(summary?.upiAmount ?? 0)}</p>
            <p className="text-xs text-muted-foreground">
              {summary?.upiCount ?? 0} payment(s) — reference only, not handed over
            </p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-violet-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Card</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{inr(summary?.cardAmount ?? 0)}</p>
            <p className="text-xs text-muted-foreground">
              {summary?.cardCount ?? 0} payment(s) — reference only
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Who is holding pharmacy cash</CardTitle>
          <p className="text-sm text-muted-foreground">
            Farhan, Ruchika, Lalit and Siddhanth work this till. A name appears
            once that person is signed in when the sale is made.
          </p>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <Button size="sm" variant="outline" onClick={() => setShowTxns((v) => !v)}>
              <Receipt className="mr-1 h-4 w-4" />
              {showTxns ? "Hide transactions" : "Show every transaction"}
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead className="text-right">Cash held</TableHead>
                <TableHead className="text-right">Entries</TableHead>
                <TableHead>Oldest</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No pharmacy cash outstanding.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((p) => (
                  <TableRow key={`${p.holder_user_id ?? "x"}-${p.holder_name}`}>
                    <TableCell className="font-medium">
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
                    </TableCell>
                    <TableCell className="text-right font-semibold">{inr(p.net_cash)}</TableCell>
                    <TableCell className="text-right">{p.receipt_count}</TableCell>
                    <TableCell>{when(p.oldest_uncollected)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {showTxns && (
            <div className="mt-4 rounded-md border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                <span className="text-sm font-medium">
                  Pharmacy transactions since counting began
                </span>
                <div className="flex items-center gap-2">
                  {([
                    { key: "all", label: "All" },
                    { key: "cash", label: "Cash" },
                    { key: "online", label: "Online" },
                  ] as const).map((m) => (
                    <Button
                      key={m.key}
                      size="sm"
                      variant={txnMode === m.key ? "default" : "outline"}
                      onClick={() => setTxnMode(m.key)}
                    >
                      {m.label}
                    </Button>
                  ))}
                  <span className="ml-1 text-sm text-muted-foreground">
                    {filteredTxns.length} · {inr(filteredTxns.reduce((a, t) => a + Number(t.amount || 0), 0))}
                  </span>
                </div>
              </div>
              <div className="max-h-[28rem] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Bill / ref</TableHead>
                      <TableHead className="text-xs">Patient</TableHead>
                      <TableHead className="text-xs">Received by</TableHead>
                      <TableHead className="text-xs">Mode</TableHead>
                      <TableHead className="text-xs">When</TableHead>
                      <TableHead className="text-right text-xs">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txns.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                          Loading…
                        </TableCell>
                      </TableRow>
                    ) : filteredTxns.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                          No pharmacy transactions yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredTxns.map((t) => (
                        <TableRow key={`${t.source_table}-${t.id}`}>
                          <TableCell className="font-mono text-xs">
                            {t.reference ?? "—"}
                            {t.source_table === "pharmacy_credit_payments" && (
                              <span className="ml-1 rounded bg-blue-100 px-1 text-[10px] text-blue-800">
                                credit bill
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">{t.label}</TableCell>
                          <TableCell className="text-xs">
                            {t.who ?? <span className="text-amber-700">Not recorded</span>}
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge
                              variant="secondary"
                              className={
                                t.mode === "CASH"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-blue-100 text-blue-800"
                              }
                            >
                              {t.mode || "—"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{when(t.at)}</TableCell>
                          <TableCell className="text-right text-xs font-medium">
                            {inr(t.amount)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- by person */

/**
 * Each person's own chain of custody: what they handed over, and what they
 * took in. The register is chronological, which answers "what happened
 * today"; this answers "what has passed through this person's hands", which
 * is the question asked when a shortage turns up.
 */
function ByPersonPanel({ rows }: { rows: CashHandover[] }) {
  const live = rows.filter((h) => h.status !== "CANCELLED");

  // One entry per person, holding both directions.
  const people = new Map<string, { name: string; given: CashHandover[]; taken: CashHandover[] }>();
  const slot = (id: string, name: string) => {
    if (!people.has(id)) people.set(id, { name, given: [], taken: [] });
    return people.get(id)!;
  };
  for (const h of live) {
    slot(h.from_user_id, h.from_user_name).given.push(h);
    slot(h.to_user_id, h.to_user_name).taken.push(h);
  }

  const sum = (list: CashHandover[]) =>
    list.reduce((a, h) => a + Number(h.counted_cash || 0), 0);

  const ordered = [...people.entries()].sort(
    (a, b) => sum(b[1].given) + sum(b[1].taken) - (sum(a[1].given) + sum(a[1].taken)),
  );

  if (ordered.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          No handovers yet, so there is nothing against anyone's name.
        </CardContent>
      </Card>
    );
  }

  const line = (h: CashHandover, direction: "given" | "taken") => {
    const diff = Number(h.variance || 0);
    return (
      <div
        key={`${direction}-${h.id}`}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2 last:border-b-0"
      >
        <span className="font-mono text-xs text-muted-foreground">{h.handover_no}</span>
        <span className="text-sm">
          {direction === "given" ? `→ ${h.to_user_name}` : `← ${h.from_user_name}`}
        </span>
        <Badge className={STATUS_TONE[h.status]} variant="secondary">
          {h.status}
        </Badge>
        {h.is_unmatched && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
            unmatched
          </span>
        )}
        {Math.round(diff * 100) !== 0 && (
          <span className="text-xs font-medium text-amber-700" title={h.variance_reason ?? ""}>
            {diff > 0 ? "+" : "−"}{inr(Math.abs(diff))} vs software
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{when(h.submitted_at)}</span>
        <span className="w-24 text-right font-semibold">{inr(h.counted_cash)}</span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {ordered.map(([id, p]) => (
        <Card key={id}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{p.name}</CardTitle>
            <p className="text-sm text-muted-foreground">
              Gave {p.given.length} ({inr(sum(p.given))}) · Took {p.taken.length} (
              {inr(sum(p.taken))})
            </p>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <div>
              <h4 className="mb-1 flex items-center gap-2 border-b pb-1 text-sm font-semibold text-rose-800">
                Handed over{" "}
                <span className="font-normal text-muted-foreground">
                  — cash that left {p.name.split(" ")[0]}
                </span>
              </h4>
              {p.given.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">Nothing handed over.</p>
              ) : (
                p.given.map((h) => line(h, "given"))
              )}
            </div>
            <div>
              <h4 className="mb-1 flex items-center gap-2 border-b pb-1 text-sm font-semibold text-emerald-800">
                Received{" "}
                <span className="font-normal text-muted-foreground">
                  — cash that came to {p.name.split(" ")[0]}
                </span>
              </h4>
              {p.taken.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">Nothing received.</p>
              ) : (
                p.taken.map((h) => line(h, "taken"))
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
