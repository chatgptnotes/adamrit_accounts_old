import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, Search } from "lucide-react";
import {
  DIRECTOR_HOSPITALS,
  METRIC_LABELS,
  VISIT_METRICS,
  type DirectorMetric,
  type KpiPeriod,
} from "@/lib/director-metrics";
import type { HospitalType } from "@/types/hospital";
import { inr } from "@/tablet/lib/format";
import { TabletInput } from "@/tablet/ui/TabletInput";
import { PullToRefresh } from "@/tablet/components/PullToRefresh";
import { DirectorListDetail } from "./DirectorListDetail";
import { DirectorListRow, shortLabel } from "./DirectorListRow";
import {
  MAX_LIST_ROWS,
  useDirectorList,
  type DirectorListRowData,
} from "./useDirectorList";

const METRICS: DirectorMetric[] = [
  "opd",
  "admissions",
  "discharges",
  "admitted",
  "collections",
];
const PERIODS: KpiPeriod[] = ["today", "month", "year", "specific"];

const PERIOD_LABEL: Record<KpiPeriod, string> = {
  today: "Today",
  month: "This month",
  year: "This year",
  specific: "Selected month",
};

/** "both" plus one entry per hospital — the chip row above the list. */
type Scope = HospitalType | "both";
const SCOPES: Scope[] = [...DIRECTOR_HOSPITALS, "both"];

function parse<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * The list behind a Director Dashboard tile — which patients were admitted or
 * discharged, who came to OPD, who is currently admitted, and what was collected.
 *
 * Driven entirely by the URL (`?metric=&hospital=&period=`) so the dashboard's selected
 * period travels with the tap. Both hospitals load in one query and the chips filter
 * client-side, so switching between them is instant and never changes the logged-in
 * hospital.
 */
export default function DirectorListFlow() {
  const [params] = useSearchParams();
  const metric = parse<DirectorMetric>(params.get("metric"), METRICS, "admissions");
  const period = parse<KpiPeriod>(params.get("period"), PERIODS, "today");
  const tapped = parse<Scope>(params.get("hospital"), SCOPES, "both");

  const [scope, setScope] = useState<Scope>(tapped);
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<DirectorListRowData | null>(null);

  // Tapping a different tile can reuse this same mounted component (the route is
  // /:moduleId, so only the query string changes). Re-sync to the new tile rather than
  // leaving the previous tile's hospital chip, search and open row in place.
  useEffect(() => {
    setScope(tapped);
    setTerm("");
    setSelected(null);
  }, [metric, period, tapped]);

  const { data = [], isLoading, error, refetch } = useDirectorList(metric, period);

  const isMoney = metric === "collections";
  const live = !isMoney && VISIT_METRICS[metric].live;

  // Chip totals over the whole dataset — counts, plus money for the collections list so
  // the ₹ figure the director tapped is on screen.
  const totals = useMemo(() => {
    const value: Record<Scope, number> = { hope: 0, ayushman: 0, both: 0 };
    const counts: Record<Scope, number> = { hope: 0, ayushman: 0, both: 0 };
    for (const row of data) {
      const amount = row.kind === "payment" ? row.amount : 1;
      value[row.hospital] += amount;
      value.both += amount;
      counts[row.hospital] += 1;
      counts.both += 1;
    }
    return { value, counts };
  }, [data]);

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    return data.filter((row) => {
      if (scope !== "both" && row.hospital !== scope) return false;
      if (!t) return true;
      return (
        row.patientName?.toLowerCase().includes(t) ||
        row.patientsId?.toLowerCase().includes(t) ||
        row.visitId?.toLowerCase().includes(t)
      );
    });
  }, [data, scope, term]);

  if (selected) {
    return <DirectorListDetail row={selected} onBack={() => setSelected(null)} />;
  }

  const label = METRIC_LABELS[metric];

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 space-y-3 border-b p-4">
        <div>
          <h1 className="text-xl font-bold">{label}</h1>
          <p className="text-sm text-muted-foreground">
            {live ? "Live · as of now" : PERIOD_LABEL[period]}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {SCOPES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`rounded-xl border p-3 text-center transition-colors ${
                scope === s
                  ? "border-primary/50 bg-primary/10"
                  : "border-border bg-card/60 hover:bg-card"
              }`}
            >
              <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {s === "both" ? "Both" : shortLabel(s)}
              </div>
              <div className="mt-1 text-xl font-bold">
                {isMoney ? inr(totals.value[s]) : totals.counts[s]}
              </div>
              {isMoney ? (
                <div className="text-[11px] text-muted-foreground">
                  {totals.counts[s]} {totals.counts[s] === 1 ? "payment" : "payments"}
                </div>
              ) : null}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <TabletInput
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search name, patient ID or visit ID"
            className="pl-11"
          />
        </div>
      </div>

      <PullToRefresh onRefresh={refetch} className="p-4">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <p className="py-10 text-center text-destructive">
            Could not load {label.toLowerCase()}.
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">
            {term ? "No matches." : `No ${label.toLowerCase()} to show.`}
          </p>
        ) : (
          <div className="space-y-3">
            {filtered.map((row) => (
              <DirectorListRow key={row.key} row={row} onOpen={() => setSelected(row)} />
            ))}
            {data.length >= MAX_LIST_ROWS ? (
              <p className="py-2 text-center text-xs text-muted-foreground">
                Showing the first {MAX_LIST_ROWS.toLocaleString("en-IN")} records for this
                period.
              </p>
            ) : null}
          </div>
        )}
      </PullToRefresh>
    </div>
  );
}
