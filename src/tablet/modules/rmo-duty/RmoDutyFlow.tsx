import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Moon, Search, Sun, Sunset } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  addRmoDutyApproval,
  approveAndPostJV,
  deleteRmoDutyApproval,
  listRmoDutyApprovals,
  updateApprovalDetails,
} from "@/lib/approval-queue-service";
import { RMO_DUTY_EXPENSE_LEDGER, resolveRmoDutyPosting } from "@/lib/rmo/dutyLedgers";
import { printSpecialistInvoice } from "@/lib/printSpecialistInvoice";
import { fetchActiveAccounts } from "@/lib/fetchAccounts";
import { useCompanies } from "@/hooks/useCompanies";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput } from "@/tablet/ui/TabletInput";
import { shortDate } from "@/tablet/lib/format";
import { LedgerBadge, LedgerSearchField } from "@/components/LedgerSearchField";

const todayDate = () => new Date().toISOString().slice(0, 10);

type Shift = "morning" | "evening" | "night";

const SHIFTS: { id: Shift; label: string; icon: typeof Sun; rateKey: string }[] = [
  { id: "morning", label: "Morning", icon: Sun, rateKey: "morning_rate" },
  { id: "evening", label: "Evening", icon: Sunset, rateKey: "evening_rate" },
  { id: "night", label: "Night", icon: Moon, rateKey: "night_rate" },
];

interface RmoOption {
  id: string;
  name: string;
  specialty: string | null;
  daily_remuneration: number | null;
  morning_rate: number | null;
  evening_rate: number | null;
  night_rate: number | null;
  ledger_account_id: string | null;
  source: "Hope" | "Ayushman";
}

/**
 * RMO Duty (Gaurav) — its own tile, split out of OT scheduling.
 *
 * The person recording a duty picks only WHO and WHICH SHIFT — no amount is
 * shown or typed. The payable comes from the shift rate on the RMO master
 * (morning / evening / night, falling back to the daily remuneration), and
 * the bill lands in accounting Approvals as always. The Monthly Report
 * counts each RMO's duties per shift and totals what they earned.
 */
export default function RmoDutyFlow() {
  const { user, hospitalConfig } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState<"entry" | "report">("entry");
  const [dutyDate, setDutyDate] = useState(todayDate());
  const [rmoSearch, setRmoSearch] = useState("");
  const [selectedRmo, setSelectedRmo] = useState<RmoOption | null>(null);
  const [shift, setShift] = useState<Shift>("morning");
  const [savingDuty, setSavingDuty] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [reportMonth, setReportMonth] = useState(() => todayDate().slice(0, 7));
  // Approving from the report posts the JV; the bill needs a company and an
  // expense ledger — chosen once here and remembered.
  const [approveCompanyId, setApproveCompanyId] = useState(() => localStorage.getItem("rmo_duty_company") || "");
  const [approveExpenseId, setApproveExpenseId] = useState(() => localStorage.getItem("rmo_duty_expense_ledger") || "");
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const { data: companies = [] } = useCompanies();
  const expenseOptions = useQuery({
    queryKey: ["rmo-duty-expense-options", approveCompanyId],
    enabled: !!approveCompanyId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const all = await fetchActiveAccounts<{ id: string; account_name: string; account_group: string | null }>({
        columns: "id, account_name, account_group",
        companyId: approveCompanyId,
      });
      return all.filter((a) =>
        `${a.account_name} ${a.account_group || ""}`.toLowerCase().match(/salary|rmo|duty|professional/),
      );
    },
  });

  const approveDuty = async (bill: { id: string; amount: number; party_account_id: string | null; company_id: string | null; expense_account_id: string | null; party_name: string }) => {
    if (!bill.party_account_id) {
      toast({ title: "No ledger on the RMO", description: `Map ${bill.party_name}'s ledger on the RMO master first.`, variant: "destructive" });
      return;
    }
    const companyId = bill.company_id || approveCompanyId;
    const expenseId = bill.expense_account_id || approveExpenseId;
    if (!companyId || !expenseId) {
      toast({ title: "Pick company & expense ledger", description: "Select them above — remembered for next time.", variant: "destructive" });
      return;
    }
    setApprovingId(bill.id);
    try {
      if (!bill.company_id || !bill.expense_account_id) {
        await updateApprovalDetails(bill.id, {
          amount: bill.amount,
          companyId,
          expenseAccountId: expenseId,
          partyAccountId: bill.party_account_id,
        });
      }
      const { voucherNumber } = await approveAndPostJV(bill.id, user?.email || undefined);
      toast({ title: "Invoice approved", description: `JV ${voucherNumber} posted for ${bill.party_name}.` });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["rmo-duty-report", reportMonth] }),
        qc.invalidateQueries({ queryKey: ["rmo-duty-entries"] }),
      ]);
    } catch (error) {
      toast({ title: "Could not approve", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    } finally {
      setApprovingId(null);
    }
  };

  // Both masters; only RMOs whose accounting ledger is mapped are offered.
  const rmos = useQuery({
    queryKey: ["rmo-duty-master"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<RmoOption[]> => {
      const columns =
        "id, name, specialty, daily_remuneration, morning_rate, evening_rate, night_rate, ledger_account_id";
      // Every RMO in both masters. Filtering to those with a mapped ledger hid
      // most of the roster — 1 of 18 at Hope, none at Ayushman — so a duty
      // could not even be searched for, let alone recorded. Unmapped RMOs are
      // listed and their ledger is mapped from here.
      const [hope, ayushman] = await Promise.all([
        (supabase as any).from("hope_rmos").select(columns).order("name"),
        (supabase as any).from("ayushman_rmos").select(columns).order("name"),
      ]);
      if (hope.error) throw hope.error;
      if (ayushman.error) throw ayushman.error;
      return [
        ...(hope.data || []).map((r: any) => ({ ...r, source: "Hope" as const })),
        ...(ayushman.data || []).map((r: any) => ({ ...r, source: "Ayushman" as const })),
      ];
    },
  });

  const entries = useQuery({
    queryKey: ["rmo-duty-entries", dutyDate],
    queryFn: () => listRmoDutyApprovals(dutyDate),
  });

  // The month's duty bills, straight off the approval queue by reference.
  const report = useQuery({
    queryKey: ["rmo-duty-report", reportMonth],
    enabled: view === "report",
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("approval_queue")
        .select("id, party_name, amount, duty_shift, reference_no, status, is_paid, invoice_no, company_id, expense_account_id, party_account_id, jv_voucher_id")
        .like("reference_no", `RMO-DUTY-${reportMonth}%`)
        .neq("status", "REJECTED")
        .order("reference_no");
      if (error) throw error;
      return (data || []) as Array<{
        id: string;
        party_name: string;
        amount: number;
        duty_shift: string | null;
        reference_no: string | null;
        status: string;
        is_paid: boolean;
        invoice_no: string | null;
        company_id: string | null;
        expense_account_id: string | null;
        party_account_id: string | null;
        jv_voucher_id: string | null;
      }>;
    },
  });

  const reportGroups = useMemo(() => {
    const byRmo = new Map<string, { name: string; bills: NonNullable<typeof report.data> }>();
    for (const bill of report.data || []) {
      const key = bill.party_name.trim().toLowerCase();
      const group = byRmo.get(key) || { name: bill.party_name, bills: [] as any };
      group.bills.push(bill);
      byRmo.set(key, group);
    }
    return [...byRmo.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [report.data]);

  const search = rmoSearch.trim().toLowerCase();
  const suggestions = search
    ? (rmos.data || []).filter((r) => r.name.toLowerCase().includes(search)).slice(0, 8)
    : [];

  /** Write the ledger back onto the RMO's own master row, so it is mapped
   *  once and every later duty — and the monthly report — finds it. */
  const mapLedger = async (rmo: RmoOption, accountId: string) => {
    const table = rmo.source === "Ayushman" ? "ayushman_rmos" : "hope_rmos";
    const { error } = await (supabase as any)
      .from(table)
      .update({ ledger_account_id: accountId })
      .eq("id", rmo.id);
    if (error) {
      toast({
        title: "Could not map the ledger",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setSelectedRmo({ ...rmo, ledger_account_id: accountId });
    await qc.invalidateQueries({ queryKey: ["rmo-duty-master"] });
    toast({ title: "Ledger mapped", description: `${rmo.name} is ready for duty entries.` });
  };

  const rateFor = (rmo: RmoOption, s: Shift): number => {
    const shiftRate = Number((rmo as any)[SHIFTS.find((x) => x.id === s)!.rateKey]) || 0;
    return shiftRate > 0 ? shiftRate : Number(rmo.daily_remuneration) || 0;
  };

  const addDuty = async () => {
    if (!selectedRmo) {
      toast({ title: "Pick the RMO", description: "Search and select who did the duty.", variant: "destructive" });
      return;
    }
    const amount = rateFor(selectedRmo, shift);
    if (!(amount > 0)) {
      toast({
        title: "No rate on the master",
        description: `Set the ${shift} shift rate for ${selectedRmo.name} on the RMO master first.`,
        variant: "destructive",
      });
      return;
    }
    setSavingDuty(true);
    try {
      // The company and expense head come from the RMO's own ledger, so the
      // duty arrives in Approvals ready to approve instead of waiting on an
      // accountant to fill them in.
      const posting = await resolveRmoDutyPosting(selectedRmo.ledger_account_id);
      if (!posting) {
        toast({
          title: "Ledger not ready",
          description:
            `${selectedRmo.name}'s ledger has no company, or that company has no "${RMO_DUTY_EXPENSE_LEDGER}" head. ` +
            "Fix it in the chart of accounts, then record the duty.",
          variant: "destructive",
        });
        return;
      }
      const { created } = await addRmoDutyApproval({
        rmoName: selectedRmo.name,
        dutyDate,
        amount,
        shift,
        partyAccountId: selectedRmo.ledger_account_id,
        companyId: posting.companyId,
        expenseAccountId: posting.expenseAccountId,
        hospital: hospitalConfig.name,
        createdBy: user?.id ?? null,
      });
      toast(
        created
          ? { title: "Duty recorded", description: `${selectedRmo.name} — ${shift} shift, queued in accounting Approvals.` }
          : { title: "Already recorded", description: `${selectedRmo.name} already has a ${shift} duty on ${shortDate(dutyDate)}.` },
      );
      setSelectedRmo(null);
      setRmoSearch("");
      await qc.invalidateQueries({ queryKey: ["rmo-duty-entries", dutyDate] });
    } catch (error) {
      toast({
        title: "Could not record the duty",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingDuty(false);
    }
  };

  const removeDuty = async (id: string, name: string) => {
    setRemovingId(id);
    try {
      await deleteRmoDutyApproval(id);
      toast({ title: "Duty entry removed", description: name });
      await qc.invalidateQueries({ queryKey: ["rmo-duty-entries", dutyDate] });
    } catch (error) {
      toast({
        title: "Could not remove",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <FlowScaffold
      heading="RMO Duty - Gaurav"
      subheading="Record who did which shift — the payable comes from the shift rates on the RMO master."
      actions={
        <>
          <TabletButton
            variant={view === "entry" ? "default" : "outline"}
            className="flex-1"
            onClick={() => setView("entry")}
          >
            Duty entry
          </TabletButton>
          <TabletButton
            variant={view === "report" ? "default" : "outline"}
            className="flex-1"
            onClick={() => setView("report")}
          >
            Monthly report
          </TabletButton>
        </>
      }
    >
      {view === "entry" ? (
        <TabletCard>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-bold">Duty entry</h3>
            <label className="flex items-center gap-3">
              <span className="text-sm font-semibold">Duty date</span>
              <TabletInput type="date" value={dutyDate} onChange={(e) => setDutyDate(e.target.value)} className="w-44" />
            </label>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <TabletInput
              value={selectedRmo ? selectedRmo.name : rmoSearch}
              onChange={(e) => {
                setSelectedRmo(null);
                setRmoSearch(e.target.value);
              }}
              placeholder="Search every RMO — Hope and Ayushman"
              className="pl-11"
            />
            {suggestions.length > 0 ? (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border bg-background shadow-lg">
                {suggestions.map((rmo) => (
                  <button
                    key={`${rmo.source}-${rmo.id}`}
                    type="button"
                    className="block w-full border-b px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-muted/60"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setSelectedRmo(rmo);
                      setRmoSearch("");
                    }}
                  >
                    <span className="font-medium">{rmo.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {[rmo.source, rmo.specialty].filter(Boolean).join(" · ")}
                    </span>
                    {!rmo.ledger_account_id && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                        no ledger
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {selectedRmo ? (
            <div className="mt-2 rounded-xl border bg-muted/40 px-3 py-2">
              {selectedRmo.ledger_account_id ? (
                <LedgerBadge accountId={selectedRmo.ledger_account_id} />
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-amber-800">
                    {selectedRmo.name} has no ledger in the {selectedRmo.source} master. The duty
                    is a payable, so it needs one before it can be recorded — map it here and it
                    stays on the master.
                  </p>
                  <LedgerSearchField
                    value=""
                    onChange={(id) => id && void mapLedger(selectedRmo, id)}
                  />
                </div>
              )}
            </div>
          ) : null}

          {/* The shift IS the amount — no amount field is shown. */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {SHIFTS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setShift(id)}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                  shift === id ? "border-primary bg-primary/10 text-primary" : "hover:border-primary/50"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
          </div>

          <TabletButton className="mt-3 w-full" disabled={savingDuty || !selectedRmo} onClick={() => void addDuty()}>
            {savingDuty ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
            Add duty
          </TabletButton>

          {!rmos.isLoading && (rmos.data || []).length === 0 ? (
            <p className="mt-3 text-sm text-amber-700">
              No RMO has an accounting ledger mapped yet — map them on Masters → Hope RMOs / Ayushman RMOs.
            </p>
          ) : null}

          <div className="mt-4">
            {entries.isLoading ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Loading duty list...</p>
            ) : (entries.data || []).length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No duty recorded for {shortDate(dutyDate)} yet.</p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {(entries.data || []).map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{entry.party_name}</p>
                      <p className="text-sm capitalize text-muted-foreground">{entry.duty_shift || "shift not recorded"}</p>
                    </div>
                    {entry.status === "PENDING" ? (
                      <button
                        type="button"
                        onClick={() => void removeDuty(entry.id, entry.party_name)}
                        disabled={removingId === entry.id}
                        className="shrink-0 rounded-lg border px-2.5 py-1 text-xs font-semibold text-destructive hover:bg-destructive/10"
                      >
                        {removingId === entry.id ? "Removing..." : "Remove"}
                      </button>
                    ) : (
                      <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        {entry.status === "APPROVED" ? "Approved" : entry.status}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabletCard>
      ) : (
        <TabletCard>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold">Monthly report</h3>
              <p className="text-sm text-muted-foreground">
                Duties per shift and the amount earned, per RMO, from the duty bills.
              </p>
            </div>
            <TabletInput type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} className="w-44" />
          </div>

          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <select
              value={approveCompanyId}
              onChange={(e) => {
                setApproveCompanyId(e.target.value);
                localStorage.setItem("rmo_duty_company", e.target.value);
              }}
              className="h-11 rounded-xl border bg-background px-3 text-sm"
            >
              <option value="">Company for approvals…</option>
              {companies.map((c: any) => (
                <option key={c.id} value={c.id}>{c.company_name || c.name}</option>
              ))}
            </select>
            <select
              value={approveExpenseId}
              onChange={(e) => {
                setApproveExpenseId(e.target.value);
                localStorage.setItem("rmo_duty_expense_ledger", e.target.value);
              }}
              className="h-11 rounded-xl border bg-background px-3 text-sm"
            >
              <option value="">RMO expense ledger for approvals…</option>
              {(expenseOptions.data || []).map((l) => (
                <option key={l.id} value={l.id}>{l.account_name}</option>
              ))}
            </select>
          </div>

          {report.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : reportGroups.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No duties recorded in {reportMonth}.</p>
          ) : (
            <div className="space-y-4">
              {reportGroups.map((group) => {
                const total = group.bills.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
                const paid = group.bills.reduce((sum, b) => sum + (b.is_paid ? Number(b.amount) || 0 : 0), 0);
                return (
                  <div key={group.name} className="rounded-xl border">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-3 py-2">
                      <p className="font-bold">{group.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {group.bills.length} dut{group.bills.length === 1 ? "y" : "ies"} · ₹{total.toLocaleString("en-IN")}
                        {paid > 0 ? ` · paid ₹${paid.toLocaleString("en-IN")}` : ""}
                      </p>
                    </div>
                    <div className="divide-y">
                      {group.bills.map((bill) => (
                        <div key={bill.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                          <span className="w-24 font-mono text-xs">{(bill.reference_no || "").replace("RMO-DUTY-", "")}</span>
                          <span className="w-20 capitalize">{bill.duty_shift || "—"}</span>
                          <button
                            type="button"
                            className="font-mono text-xs font-semibold text-blue-600 hover:underline"
                            title="Open the invoice"
                            onClick={() => void printSpecialistInvoice(bill.id).catch((err) => toast({ title: "Invoice", description: err?.message || "Could not open", variant: "destructive" }))}
                          >
                            {bill.invoice_no || "invoice"}
                          </button>
                          <span className="ml-auto font-mono">₹{Number(bill.amount).toLocaleString("en-IN")}</span>
                          {bill.is_paid ? (
                            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">Paid</span>
                          ) : bill.status === "APPROVED" ? (
                            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">JV posted</span>
                          ) : (
                            <TabletButton
                              variant="outline"
                              className="h-9 px-3"
                              disabled={approvingId === bill.id}
                              onClick={() => void approveDuty(bill)}
                            >
                              {approvingId === bill.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"}
                            </TabletButton>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabletCard>
      )}
    </FlowScaffold>
  );
}
