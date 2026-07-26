import { useNavigate } from "react-router-dom";
import { ArrowRight, ClipboardCheck, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { panelFor } from "@/tablet/lib/panelColors";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { usePendingPanelDocumentPatients } from "@/hooks/usePanelDocuments";

const PREVIEW_ROWS = 5;

/**
 * Patients with pending panel documents, read-only. Tap to drill into the
 * checklist where documents are actually marked.
 *
 * Cross-hospital (hospitalName null) to match the rest of the Director view,
 * which always shows Hope and Ayushman together.
 */
export function PanelDocumentsPreview() {
  const navigate = useNavigate();
  const { data, isLoading } = usePendingPanelDocumentPatients(null, PREVIEW_ROWS);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <TabletCard
      interactive
      onClick={() => navigate("/panel-documents")}
      className="space-y-3"
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-cyan-600" />
          <h3 className="text-base font-semibold">Panel documents pending</h3>
        </div>
        <div className="flex items-center gap-2">
          {total > 0 ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold tabular-nums text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              {total.toLocaleString("en-IN")}
            </span>
          ) : null}
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <div className="py-4 text-center text-sm text-muted-foreground">
          No pending panel documents
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {rows.map((row) => {
              const panel = panelFor(row.corporate);
              return (
                <li
                  key={row.patientUuid}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{row.patientName}</div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                          panel.badge,
                        )}
                      >
                        {row.panel}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {row.patientsId || "No UHID"}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-bold tabular-nums text-amber-700 dark:text-amber-300">
                      {row.pendingCount}
                    </div>
                    <div className="text-[10px] text-muted-foreground">pending</div>
                  </div>
                </li>
              );
            })}
          </ul>

          {total > rows.length ? (
            <p className="text-center text-xs text-muted-foreground">
              Showing {rows.length} of {total.toLocaleString("en-IN")}
            </p>
          ) : null}
        </>
      )}
    </TabletCard>
  );
}
