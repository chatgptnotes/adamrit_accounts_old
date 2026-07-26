import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDebounce } from "use-debounce";
import { ChevronRight, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { panelFor } from "@/tablet/lib/panelColors";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput } from "@/tablet/ui/TabletInput";
import {
  REGISTRATION_PANEL_NAMES,
  type RegistrationPanelName,
} from "@/lib/registrationDocuments";
import {
  usePanelDocumentPatient,
  usePanelDocumentStatus,
} from "@/hooks/usePanelDocuments";
import type {
  PanelDocumentStatusFilter,
  PanelDocumentStatusRow,
} from "@/lib/panelDocumentsDb";
import { PanelDocumentChecklist } from "./PanelDocumentChecklist";
import { UnmappedCorporateBanner } from "./UnmappedCorporateBanner";

const PAGE_SIZE = 20;

const STATUS_FILTERS: { id: PanelDocumentStatusFilter; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "complete", label: "Complete" },
  { id: "all", label: "All" },
];

/** Hospital scope. Null covers both, matching the cross-hospital Director view. */
type HospitalScope = "both" | "hope" | "ayushman";

const HOSPITAL_SCOPES: { id: HospitalScope; label: string }[] = [
  { id: "both", label: "Both" },
  { id: "hope", label: "Hope" },
  { id: "ayushman", label: "Ayushman" },
];

function PatientRow({
  row,
  onOpen,
}: {
  row: PanelDocumentStatusRow;
  onOpen: () => void;
}) {
  const panel = panelFor(row.corporate);
  const visibleDocuments = row.pendingDocuments.slice(0, 3);
  const hiddenCount = row.pendingDocuments.length - visibleDocuments.length;

  return (
    <TabletCard interactive variant="flat" onClick={onOpen} className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate text-base font-semibold">{row.patientName}</h3>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", panel.badge)}>
              {row.panel}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.patientsId || "No UHID"}
            {row.hospitalName ? ` · ${row.hospitalName}` : ""}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-sm font-bold tabular-nums">
            {row.submittedCount}/{row.requiredCount}
          </div>
          <div className="text-[11px] text-muted-foreground">submitted</div>
        </div>

        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
      </div>

      {row.pendingCount > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {visibleDocuments.map((name) => (
            <span
              key={name}
              className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
            >
              {name}
            </span>
          ))}
          {hiddenCount > 0 ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              +{hiddenCount} more
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
          All mandatory documents submitted
          {row.waivedCount > 0 ? ` (${row.waivedCount} not applicable)` : ""}
        </p>
      )}
    </TabletCard>
  );
}

/**
 * Panel-wise mandatory documents — the list of patients and their document
 * progress, with a per-patient checklist behind each row.
 *
 * Pending is computed server-side by get_panel_document_status, which receives
 * the panel -> documents map as a parameter, so this screen and the yellow
 * bell always agree on who is pending.
 */
export default function PanelDocumentsFlow() {
  const [params, setParams] = useSearchParams();

  const [panel, setPanel] = useState<RegistrationPanelName | "all">("all");
  const [status, setStatus] = useState<PanelDocumentStatusFilter>("pending");
  const [scope, setScope] = useState<HospitalScope>("both");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<PanelDocumentStatusRow | null>(null);

  const [search] = useDebounce(term, 300);
  const hospitalName = scope === "both" ? null : scope;

  // The bell deep-links a single patient. Resolve it and open the checklist
  // directly, so the tap lands on the document list rather than the search view.
  const deepLinkedUuid = params.get("patient");
  const { data: deepLinked, isLoading: isResolvingDeepLink } =
    usePanelDocumentPatient(selected ? null : deepLinkedUuid);

  useEffect(() => {
    if (deepLinked) setSelected(deepLinked);
  }, [deepLinked]);

  // Any filter change invalidates the current page offset.
  useEffect(() => {
    setPage(0);
  }, [panel, status, scope, search]);

  const { data, isLoading, isFetching, error } = usePanelDocumentStatus({
    panel: panel === "all" ? null : panel,
    status,
    search: search || null,
    hospitalName,
    page,
    pageSize: PAGE_SIZE,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = page * PAGE_SIZE + rows.length;
  const hasNextPage = rangeEnd < total;

  const panelOptions = useMemo(
    () => ["all", ...REGISTRATION_PANEL_NAMES] as (RegistrationPanelName | "all")[],
    [],
  );

  const clearSelection = () => {
    setSelected(null);
    // Drop ?patient= so the effect above cannot immediately reopen the detail.
    if (deepLinkedUuid) {
      const next = new URLSearchParams(params);
      next.delete("patient");
      setParams(next, { replace: true });
    }
  };

  if (selected) {
    return <PanelDocumentChecklist row={selected} onBack={clearSelection} />;
  }

  if (deepLinkedUuid && isResolvingDeepLink) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-shrink-0 space-y-3 border-b p-4">
        <div>
          <h1 className="text-xl font-bold">Panel Documents</h1>
          <p className="text-sm text-muted-foreground">
            Mandatory documents per panel
            {/* Never assert a count while the query is failing or still in
                flight — "0 patients" next to an error reads as "all clear". */}
            {error
              ? " · count unavailable"
              : isLoading
                ? ""
                : ` · ${total.toLocaleString("en-IN")} ${total === 1 ? "patient" : "patients"}`}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setStatus(option.id)}
              className={cn(
                "min-h-[44px] rounded-xl border text-sm font-semibold transition-colors",
                status === option.id
                  ? "border-primary/50 bg-primary/10"
                  : "border-border bg-card/60 hover:bg-card",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {HOSPITAL_SCOPES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setScope(option.id)}
              className={cn(
                "min-h-[40px] rounded-xl border px-4 text-sm font-medium transition-colors",
                scope === option.id
                  ? "border-primary/50 bg-primary/10"
                  : "border-border bg-card/60 hover:bg-card",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <select
          value={panel}
          onChange={(e) => setPanel(e.target.value as RegistrationPanelName | "all")}
          className="min-h-[48px] w-full rounded-xl border border-border bg-card px-3 text-base font-medium"
          aria-label="Filter by panel"
        >
          {panelOptions.map((option) => (
            <option key={option} value={option}>
              {option === "all" ? "All panels" : option}
            </option>
          ))}
        </select>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <TabletInput
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search patient name or UHID"
            className="pl-11"
          />
        </div>
      </div>

      <div className="tablet-no-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <UnmappedCorporateBanner hospitalName={hospitalName} />

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <p className="py-10 text-center text-destructive">
            Could not load panel documents.
          </p>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">
            {search
              ? "No matches."
              : status === "pending"
                ? "Every panel patient has submitted or waived all mandatory documents."
                : "No panel patients to show."}
          </p>
        ) : (
          <>
            {rows.map((row) => (
              <PatientRow
                key={row.patientUuid}
                row={row}
                onOpen={() => setSelected(row)}
              />
            ))}

            <div className="flex items-center justify-between gap-3 py-2">
              <p className="text-xs text-muted-foreground">
                Showing {rangeStart.toLocaleString("en-IN")}–{rangeEnd.toLocaleString("en-IN")} of{" "}
                {total.toLocaleString("en-IN")}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page === 0 || isFetching}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="min-h-[40px] rounded-lg border border-border px-4 text-sm font-semibold disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={!hasNextPage || isFetching}
                  onClick={() => setPage((p) => p + 1)}
                  className="min-h-[40px] rounded-lg border border-border px-4 text-sm font-semibold disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
