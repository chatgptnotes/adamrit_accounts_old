import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  Smartphone,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput } from "@/tablet/ui/TabletInput";
import { shortDate } from "@/tablet/lib/format";
import { importStatement } from "@/lib/recon/statementScan";

// DATA SOURCE: recon_sources / recon_uploads / recon_transactions +
// v_recon_alerts + v_recon_handover_today.
//
// Tilak's reconciliation. Money may only leave against a bill that is in the
// system, so every debit read off a phone or a bank statement is matched to a
// payment voucher the books already carry. What cannot be matched is listed
// here: either the bill was never raised, or the payment was not ours to make.

export default function ReconciliationTilakFlow() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"alerts" | "bank">("alerts");
  const [bankSourceId, setBankSourceId] = useState("");
  const [bankSearch, setBankSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const bankInput = useRef<HTMLInputElement>(null);

  const handover = useQuery({
    queryKey: ["recon-handover-all"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("v_recon_handover_today")
        .select("source_id, label, holder, handed_in, uploaded_at");
      return data || [];
    },
  });

  const alerts = useQuery({
    queryKey: ["recon-alerts"],
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_recon_alerts")
        .select("*")
        .limit(200);
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const banks = useQuery({
    queryKey: ["recon-bank-sources"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("recon_sources")
        .select("id, label, holder")
        .eq("kind", "BANK_ACCOUNT")
        .eq("is_active", true)
        .order("label");
      return data || [];
    },
  });

  const rematch = async () => {
    setBusy(true);
    try {
      const { data, error } = await (supabase as any).rpc("match_recon_transactions", { p_days: 3 });
      if (error) throw new Error(error.message);
      toast.success(
        `${data?.matched ?? 0} newly matched. ${data?.unmatched ?? 0} still without a bill` +
          (data?.unmatched_value ? ` (₹${Number(data.unmatched_value).toLocaleString("en-IN")}).` : "."),
      );
      await queryClient.invalidateQueries({ queryKey: ["recon-alerts"] });
    } catch (error: any) {
      toast.error(error?.message || "Could not run the match");
    } finally {
      setBusy(false);
    }
  };

  const onBankFile = async (file?: File) => {
    if (!file || !bankSourceId) return;
    setBusy(true);
    try {
      const result = await importStatement({
        sourceId: bankSourceId,
        file,
        note: "Monthly bank statement",
        uploadedBy: user?.email || user?.id || null,
      });
      toast.success(
        `${result.read} lines read, ${result.matched} matched, ${result.unmatched} without a bill.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["recon-alerts"] });
    } catch (error: any) {
      toast.error(error?.message || "Could not read the statement");
    } finally {
      setBusy(false);
      if (bankInput.current) bankInput.current.value = "";
    }
  };

  const settle = async (id: string, note: string) => {
    const { error } = await (supabase as any)
      .from("recon_transactions")
      .update({
        status: "IGNORED",
        match_note: note,
        reviewed_by: user?.email || user?.id || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Marked as reviewed.");
      await queryClient.invalidateQueries({ queryKey: ["recon-alerts"] });
    }
  };

  const visibleAlerts = (alerts.data || []).filter((a: any) => {
    const term = bankSearch.trim().toLowerCase();
    if (!term) return true;
    return [a.counterparty, a.source_label, a.reference]
      .filter(Boolean)
      .some((v: string) => String(v).toLowerCase().includes(term));
  });
  const alertTotal = visibleAlerts.reduce((sum: number, a: any) => sum + Number(a.amount || 0), 0);

  return (
    <FlowScaffold
      step={1}
      totalSteps={1}
      heading="Reconciliation - Tilak"
      subheading="Phone and bank payments against the bills the system holds"
    >
      <div className="space-y-3">
        {/* Did each phone hand its history in today? */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(handover.data || []).map((h: any) => (
            <TabletCard
              key={h.source_id}
              variant="flat"
              className={h.handed_in ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}
            >
              <div className="flex items-center gap-2">
                {h.handed_in ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                ) : (
                  <Clock className="h-5 w-5 shrink-0 text-amber-600" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{h.holder || h.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {h.handed_in
                      ? new Date(h.uploaded_at).toLocaleTimeString("en-IN")
                      : "History not in today"}
                  </p>
                </div>
              </div>
            </TabletCard>
          ))}
        </div>

        <div className="flex gap-2">
          <TabletButton
            size="sm"
            variant={tab === "alerts" ? "default" : "outline"}
            onClick={() => setTab("alerts")}
          >
            <Smartphone className="mr-1 h-4 w-4" /> Payments without a bill
          </TabletButton>
          <TabletButton
            size="sm"
            variant={tab === "bank" ? "default" : "outline"}
            onClick={() => setTab("bank")}
          >
            <Building2 className="mr-1 h-4 w-4" /> Monthly bank statement
          </TabletButton>
        </div>

        {tab === "alerts" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <TabletInput
                value={bankSearch}
                onChange={(e) => setBankSearch(e.target.value)}
                placeholder="Search payee, phone or reference…"
                className="flex-1"
              />
              <TabletButton size="sm" variant="outline" disabled={busy} onClick={() => void rematch()}>
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
                Re-run match
              </TabletButton>
            </div>

            {visibleAlerts.length > 0 && (
              <p className="text-sm font-medium text-red-700">
                {visibleAlerts.length} payment{visibleAlerts.length === 1 ? "" : "s"} with no bill —
                ₹{alertTotal.toLocaleString("en-IN")}
              </p>
            )}

            {alerts.isLoading ? (
              <p className="py-10 text-center text-muted-foreground">Loading…</p>
            ) : visibleAlerts.length === 0 ? (
              <TabletCard variant="flat" className="py-10 text-center text-muted-foreground">
                Every payment read so far ties to a bill.
              </TabletCard>
            ) : (
              visibleAlerts.map((a: any) => (
                <TabletCard key={a.id} variant="flat" className="space-y-2 border-red-200">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-base font-semibold">
                        {a.counterparty || "Unnamed payee"}
                      </h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[
                          a.source_holder || a.source_label,
                          shortDate(a.txn_date),
                          a.txn_time,
                          a.reference,
                          a.days_old > 0 ? `${a.days_old} day${a.days_old === 1 ? "" : "s"} ago` : "today",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <p className="shrink-0 text-base font-semibold text-red-700">
                      ₹{Number(a.amount).toLocaleString("en-IN")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <TabletButton
                      size="sm"
                      variant="outline"
                      onClick={() => void settle(a.id, "Reviewed by management — allowed without a bill")}
                    >
                      Authorise anyway
                    </TabletButton>
                    <TabletButton
                      size="sm"
                      variant="outline"
                      onClick={() => void settle(a.id, "Not a hospital payment")}
                    >
                      Not ours
                    </TabletButton>
                  </div>
                </TabletCard>
              ))
            )}
          </>
        ) : (
          <>
            <TabletCard variant="flat" className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Upload the month's statement for one account. Each line is read and matched against
                the payments the books carry; what does not match joins the list beside this tab.
              </p>
              <select
                value={bankSourceId}
                onChange={(e) => setBankSourceId(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-base"
              >
                <option value="">Pick the bank account…</option>
                {(banks.data || []).map((b: any) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                    {b.holder ? ` — ${b.holder}` : ""}
                  </option>
                ))}
              </select>
              <TabletButton
                className="w-full"
                disabled={!bankSourceId || busy}
                onClick={() => bankInput.current?.click()}
              >
                {busy ? <Loader2 className="mr-1 h-5 w-5 animate-spin" /> : <Upload className="mr-1 h-5 w-5" />}
                Upload statement
              </TabletButton>
            </TabletCard>
            <input
              ref={bankInput}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => void onBankFile(e.target.files?.[0])}
            />
          </>
        )}
      </div>
    </FlowScaffold>
  );
}
