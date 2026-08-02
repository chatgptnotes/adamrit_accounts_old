import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Moon, Search, Sun, Sunset } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  addRmoDutyApproval,
  deleteRmoDutyApproval,
  listRmoDutyApprovals,
} from "@/lib/approval-queue-service";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput } from "@/tablet/ui/TabletInput";
import { shortDate } from "@/tablet/lib/format";
import { LedgerBadge } from "@/components/LedgerSearchField";

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

  // Both masters; only RMOs whose accounting ledger is mapped are offered.
  const rmos = useQuery({
    queryKey: ["rmo-duty-master"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<RmoOption[]> => {
      const columns =
        "id, name, specialty, daily_remuneration, morning_rate, evening_rate, night_rate, ledger_account_id";
      const [hope, ayushman] = await Promise.all([
        (supabase as any).from("hope_rmos").select(columns).not("ledger_account_id", "is", null).order("name"),
        (supabase as any).from("ayushman_rmos").select(columns).not("ledger_account_id", "is", null).order("name"),
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
        .select("party_name, amount, duty_shift, reference_no, status, is_paid")
        .like("reference_no", `RMO-DUTY-${reportMonth}%`)
        .neq("status", "REJECTED");
      if (error) throw error;
      return (data || []) as Array<{
        party_name: string;
        amount: number;
        duty_shift: string | null;
        is_paid: boolean;
      }>;
    },
  });

  const reportRows = useMemo(() => {
    const byRmo = new Map<
      string,
      { name: string; morning: number; evening: number; night: number; other: number; total: number; paid: number }
    >();
    for (const r of report.data || []) {
      const key = r.party_name.trim().toLowerCase();
      const row =
        byRmo.get(key) || { name: r.party_name, morning: 0, evening: 0, night: 0, other: 0, total: 0, paid: 0 };
      const s = (r.duty_shift || "").toLowerCase();
      if (s === "morning") row.morning += 1;
      else if (s === "evening") row.evening += 1;
      else if (s === "night") row.night += 1;
      else row.other += 1;
      row.total += Number(r.amount) || 0;
      if (r.is_paid) row.paid += Number(r.amount) || 0;
      byRmo.set(key, row);
    }
    return [...byRmo.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [report.data]);

  const search = rmoSearch.trim().toLowerCase();
  const suggestions = search
    ? (rmos.data || []).filter((r) => r.name.toLowerCase().includes(search)).slice(0, 8)
    : [];

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
      const { created } = await addRmoDutyApproval({
        rmoName: selectedRmo.name,
        dutyDate,
        amount,
        shift,
        partyAccountId: selectedRmo.ledger_account_id,
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
              placeholder="Search the RMO master (only RMOs with a mapped ledger appear)"
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
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {selectedRmo?.ledger_account_id ? (
            <div className="mt-2 rounded-xl border bg-muted/40 px-3 py-2">
              <LedgerBadge accountId={selectedRmo.ledger_account_id} />
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

          {report.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : reportRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No duties recorded in {reportMonth}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                    <th className="px-2 py-2">RMO</th>
                    <th className="px-2 py-2 text-right">Morning</th>
                    <th className="px-2 py-2 text-right">Evening</th>
                    <th className="px-2 py-2 text-right">Night</th>
                    <th className="px-2 py-2 text-right">Duties</th>
                    <th className="px-2 py-2 text-right">Amount (₹)</th>
                    <th className="px-2 py-2 text-right">Paid (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {reportRows.map((row) => (
                    <tr key={row.name} className="border-b">
                      <td className="px-2 py-2 font-semibold">{row.name}</td>
                      <td className="px-2 py-2 text-right">{row.morning || ""}</td>
                      <td className="px-2 py-2 text-right">{row.evening || ""}</td>
                      <td className="px-2 py-2 text-right">{row.night || ""}</td>
                      <td className="px-2 py-2 text-right font-semibold">
                        {row.morning + row.evening + row.night + row.other}
                      </td>
                      <td className="px-2 py-2 text-right font-mono">{row.total.toLocaleString("en-IN")}</td>
                      <td className="px-2 py-2 text-right font-mono text-emerald-700">{row.paid.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabletCard>
      )}
    </FlowScaffold>
  );
}
