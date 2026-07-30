import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, Droplets, FlaskConical, Loader2, Printer, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { shortDate } from "@/tablet/lib/format";
import { DIALYSIS_QUERY_KEY, useDialysisTracker } from "@/tablet/hooks/useDialysisTracker";
import {
  CYCLES_PER_BILL,
  LAB_REPORT_INTERVAL_DAYS,
  markCyclesBilled,
  type DialysisTrackerRow,
} from "@/lib/nephroplus/dialysisTracker";
import { printDialysisLabReport } from "@/lib/nephroplus/dialysisLabReport";

type Filter = "action" | "bill" | "lab" | "all";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "action", label: "Needs action" },
  { id: "bill", label: "Bill due" },
  { id: "lab", label: "Lab due" },
  { id: "all", label: "All" },
];

/**
 * Dialysis — who is due a bill (every 6 cycles) and whose mandatory 30-day
 * lab report has run out.
 */
export default function DialysisFlow() {
  const { hospitalConfig } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { rows, billsDue, labsDue, loading, error, refetch } = useDialysisTracker();
  const [filter, setFilter] = useState<Filter>("action");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const visible = useMemo(() => {
    if (filter === "bill") return rows.filter((r) => r.billsDue > 0);
    if (filter === "lab") return rows.filter((r) => r.labDue);
    if (filter === "action") return rows.filter((r) => r.billsDue > 0 || r.labDue);
    return rows;
  }, [rows, filter]);

  const refresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleMarkBilled = async (row: DialysisTrackerRow) => {
    const upTo = row.billedCycles + row.billsDue * CYCLES_PER_BILL;
    const carryOver = row.unbilledCycles % CYCLES_PER_BILL;
    setBusyKey(row.key);
    try {
      await markCyclesBilled(hospitalConfig.name, row, upTo);
      await queryClient.invalidateQueries({ queryKey: [DIALYSIS_QUERY_KEY] });
      toast({
        title: `Billed ${row.billsDue * CYCLES_PER_BILL} cycles for ${row.patientName}`,
        description: carryOver > 0 ? `${carryOver} cycle(s) carry over to the next bill.` : undefined,
      });
    } catch (err) {
      toast({
        title: "Could not save",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
    setBusyKey(null);
  };

  const handlePrintLab = async (row: DialysisTrackerRow) => {
    setBusyKey(row.key);
    try {
      const problem = await printDialysisLabReport(row);
      if (problem) {
        toast({ title: "Cannot print lab report", description: problem, variant: "destructive" });
      }
    } catch (err) {
      toast({
        title: "Could not print lab report",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
    setBusyKey(null);
  };

  return (
    <FlowScaffold
      heading="Dialysis"
      subheading={`Bill every ${CYCLES_PER_BILL} cycles · lab report every ${LAB_REPORT_INTERVAL_DAYS} days`}
      actions={
        <TabletButton variant="outline" className="flex-1" onClick={refresh} disabled={refreshing}>
          {refreshing ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-5 w-5" />
          )}
          Refresh
        </TabletButton>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <TabletCard
            variant="flat"
            className={cn("py-3", billsDue > 0 && "border-rose-200 bg-rose-50")}
          >
            <p className="text-xs text-muted-foreground">Bills to prepare</p>
            <p className={cn("mt-1 text-2xl font-bold", billsDue > 0 && "text-rose-600")}>
              {loading ? "…" : billsDue}
            </p>
          </TabletCard>
          <TabletCard
            variant="flat"
            className={cn("py-3", labsDue > 0 && "border-amber-200 bg-amber-50")}
          >
            <p className="text-xs text-muted-foreground">Lab reports due</p>
            <p className={cn("mt-1 text-2xl font-bold", labsDue > 0 && "text-amber-600")}>
              {loading ? "…" : labsDue}
            </p>
          </TabletCard>
        </div>

        <TabletCard variant="flat" className="space-y-3">
          <div className="flex items-center gap-2">
            <Droplets className="h-5 w-5 text-sky-600" />
            <span className="text-sm font-semibold">Show</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  "min-w-[64px] rounded-full border px-4 py-2 text-sm font-semibold transition-colors active:scale-[0.98]",
                  filter === f.id
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "bg-background hover:bg-muted/60",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </TabletCard>

        {loading ? (
          <TabletCard variant="flat" className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading dialysis patients…</span>
          </TabletCard>
        ) : null}

        {error ? (
          <TabletCard variant="flat" className="border-red-200 bg-red-50">
            <p className="text-sm font-semibold text-red-700">Unable to load dialysis patients.</p>
            <p className="mt-1 text-sm text-red-600">{error.message || "Please retry."}</p>
          </TabletCard>
        ) : null}

        {!loading && !error && visible.length === 0 ? (
          <TabletCard variant="flat">
            <p className="text-sm text-muted-foreground">
              {filter === "all"
                ? "No dialysis patients found."
                : "Nothing pending — every dialysis patient is billed and has a current lab report."}
            </p>
          </TabletCard>
        ) : null}

        {visible.map((row) => (
          <PatientCard
            key={row.key}
            row={row}
            busy={busyKey === row.key}
            onPrintLab={() => handlePrintLab(row)}
            onMarkBilled={() => handleMarkBilled(row)}
          />
        ))}
      </div>
    </FlowScaffold>
  );
}

function PatientCard({
  row,
  busy,
  onPrintLab,
  onMarkBilled,
}: {
  row: DialysisTrackerRow;
  busy: boolean;
  onPrintLab: () => void;
  onMarkBilled: () => void;
}) {
  return (
    <TabletCard
      variant="flat"
      className={cn("space-y-3", row.billsDue > 0 && "border-rose-200 bg-rose-50/50")}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-bold">{row.patientName}</p>
          <p className="text-xs text-muted-foreground">
            {row.patientsId ? `${row.patientsId} · ` : ""}last session {shortDate(row.lastSessionDate)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {row.billsDue > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-3 py-1 text-xs font-bold text-white">
              <BellRing className="h-3.5 w-3.5" />
              Prepare bill{row.billsDue > 1 ? ` ×${row.billsDue}` : ""}
            </span>
          ) : null}
          {row.labDue ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
              <FlaskConical className="h-3.5 w-3.5" />
              {row.lastLabDate ? `Lab ${row.daysSinceLab}d old` : "No lab report"}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Figure label="Cycles" value={String(row.totalCycles)} />
        <Figure label="To bill" value={String(row.unbilledCycles)} />
        <Figure
          label="Lab due in"
          value={row.labDue ? "now" : `${row.daysUntilLabDue}d`}
        />
      </div>

      <div className="flex gap-3">
        <TabletButton variant="outline" className="flex-1" onClick={onPrintLab} disabled={busy}>
          <Printer className="mr-2 h-5 w-5" />
          Lab report
        </TabletButton>
        {row.billsDue > 0 ? (
          <TabletButton className="flex-1" onClick={onMarkBilled} disabled={busy}>
            Mark {row.billsDue * CYCLES_PER_BILL} billed
          </TabletButton>
        ) : null}
      </div>
    </TabletCard>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-background/70 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-bold tracking-tight">{value}</p>
    </div>
  );
}
