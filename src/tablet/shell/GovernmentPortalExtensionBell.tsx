import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  ClipboardList,
  FileWarning,
  ImageIcon,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  fetchLatestGovernmentPortalExtensionAlerts,
  type GovernmentPortalExtensionAlertRow,
} from "@/lib/governmentPortalReportDb";
import {
  fetchPendingPanelDocumentPatients,
  type PanelDocumentStatusRow,
} from "@/lib/panelDocumentsDb";
import { panelFor } from "@/tablet/lib/panelColors";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useTabletTheme } from "@/tablet/theme/TabletTheme";
import { haptics } from "@/tablet/lib/haptics";

const QUERY_KEY = ["tablet-government-portal-extension-alerts"];
const SEEN_IMPORT_STORAGE_KEY = "tablet_seen_government_portal_extension_import";
const ADVANCE_IMAGE_CATEGORY = "advance_image";
const APPROVAL_LOOKBACK_MS = 24 * 60 * 60 * 1000;
/** Rows listed in the documents tab. The badge always uses the true total. */
const PENDING_DOC_LIST_LIMIT = 50;
/** Pending document names shown per patient card before collapsing to "+N more". */
const PENDING_DOC_CHIP_LIMIT = 4;

interface AdvanceApprovalRow {
  id: string;
  patientName: string;
  createdAt: string;
}

const formatProcedure = (row: GovernmentPortalExtensionAlertRow) => {
  if (row.procedureCode && row.procedureDetails) {
    return `${row.procedureCode} - ${row.procedureDetails}`;
  }
  return row.procedureCode || row.procedureDetails || "Procedure not available";
};

const formatAmount = (value: string) => {
  if (!value.trim()) return "";
  const numeric = Number(value.replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(numeric)) return value;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(numeric);
};

const formatImportedAt = (iso: string | undefined) => {
  if (!iso) return "No saved import";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Saved import";
  }
};

const formatTimeAgo = (iso: string) => {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "Recently";
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

async function fetchAdvanceApprovalUploads(): Promise<AdvanceApprovalRow[]> {
  const sinceIso = new Date(Date.now() - APPROVAL_LOOKBACK_MS).toISOString();
  const query = (supabase as any)
    .from("file_uploads")
    .select("id, patient_name, created_at")
    .eq("category", ADVANCE_IMAGE_CATEGORY)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(50);

  const { data, error } = await query;
  if (error) throw error;

  return ((data || []) as any[]).map((row) => ({
    id: row.id,
    patientName: row.patient_name || "Patient approval",
    createdAt: row.created_at,
  }));
}

export function GovernmentPortalExtensionBell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { theme } = useTabletTheme();
  const [open, setOpen] = useState(false);
  const [selectedView, setSelectedView] = useState<
    "extensions" | "approvals" | "documents"
  >("extensions");
  const [seenImportId, setSeenImportId] = useState(() => {
    try {
      return localStorage.getItem(SEEN_IMPORT_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });

  const { data, isFetching, refetch, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const [extensionResult, approvalsResult, documentsResult] = await Promise.allSettled([
        fetchLatestGovernmentPortalExtensionAlerts(),
        fetchAdvanceApprovalUploads(),
        // Cross-hospital, matching the Director view.
        fetchPendingPanelDocumentPatients({ limit: PENDING_DOC_LIST_LIMIT }),
      ]);

      const extensionData =
        extensionResult.status === "fulfilled" ? extensionResult.value : null;
      const approvalRows =
        approvalsResult.status === "fulfilled" ? approvalsResult.value : [];

      if (extensionResult.status === "rejected") {
        throw extensionResult.reason;
      }

      return {
        extensionData,
        approvalRows,
        docRows: documentsResult.status === "fulfilled" ? documentsResult.value.rows : [],
        docTotal: documentsResult.status === "fulfilled" ? documentsResult.value.total : 0,
        // Tracked separately so the tab can say "could not load" rather than
        // showing a confident zero that hides real pending documents.
        docError: documentsResult.status === "rejected",
      };
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  const extensionData = data?.extensionData ?? null;
  const approvalRows = data?.approvalRows ?? [];
  const docRows: PanelDocumentStatusRow[] = data?.docRows ?? [];
  const docTotal = data?.docTotal ?? 0;
  const docError = data?.docError ?? false;
  const extensionCount = extensionData?.count ?? 0;
  const approvalCount = approvalRows.length;
  // docTotal, not docRows.length — the list is capped at PENDING_DOC_LIST_LIMIT
  // but the badge must report every patient with a pending document.
  const count = extensionCount + approvalCount + docTotal;
  const rows = extensionData?.rows ?? [];
  const isNewImportWithPendingRows = Boolean(
    extensionData?.importId && extensionCount > 0 && extensionData.importId !== seenImportId,
  );
  const displayCount = count > 99 ? "99+" : String(count);
  const importedAt = formatImportedAt(extensionData?.createdAt);
  const sheetIsLight = theme === "light";
  const hasExtensions = rows.length > 0;
  const hasApprovals = approvalRows.length > 0;
  const hasPendingDocs = docRows.length > 0;

  const summaryText = useMemo(() => {
    const documentClause = docTotal
      ? ` ${docTotal} patient${docTotal === 1 ? "" : "s"} have pending panel documents.`
      : "";

    if (!extensionData && approvalCount === 0) {
      return `No government portal import has been saved yet.${documentClause}`;
    }
    if (extensionCount === 0) {
      return `Latest import has no pending extension patients. ${importedAt}.${documentClause}`;
    }
    return `${extensionCount} patient${extensionCount === 1 ? "" : "s"} need extension action. ${importedAt}.${documentClause}`;
  }, [approvalCount, docTotal, extensionCount, extensionData, importedAt]);

  const markSeen = () => {
    if (!extensionData?.importId) return;
    setSeenImportId(extensionData.importId);
    try {
      localStorage.setItem(SEEN_IMPORT_STORAGE_KEY, extensionData.importId);
    } catch {
      // localStorage can be unavailable in private browser modes.
    }
  };

  useEffect(() => {
    if (open) markSeen();
    // markSeen intentionally reads the latest data when open changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, extensionData?.importId]);

  // Open on whichever source actually has something, so a single-source alert
  // never lands the user on an empty tab.
  useEffect(() => {
    if (hasExtensions) {
      setSelectedView("extensions");
    } else if (hasApprovals) {
      setSelectedView("approvals");
    } else if (hasPendingDocs) {
      setSelectedView("documents");
    } else {
      setSelectedView("extensions");
    }
  }, [hasApprovals, hasExtensions, hasPendingDocs]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refetch]);

  useEffect(() => {
    const channel = (supabase as any)
      .channel("tablet-government-portal-extension-alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "government_portal_report_imports" },
        () => {
          queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "government_portal_report_rows" },
        () => {
          queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        },
      )
      .on(
        // "*" not "INSERT": deleting a registration document re-opens a pending
        // item, which has to raise the count again.
        "postgres_changes",
        { event: "*", schema: "public", table: "file_uploads" },
        () => {
          queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "panel_document_waivers" },
        () => {
          queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          onClick={() => haptics.tap()}
          aria-label={count > 0 ? `${count} total notifications` : "No alerts"}
          title="Alerts"
          className={cn(
            "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-all active:scale-95",
            count > 0
              ? "border-amber-300/70 bg-amber-500 text-slate-950 shadow-[0_12px_26px_-18px_rgba(245,158,11,0.9)]"
              : "border-border bg-secondary text-muted-foreground hover:text-foreground",
            isNewImportWithPendingRows && "animate-pulse",
          )}
        >
          <Bell className="h-5 w-5" />
          {count > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[0.62rem] font-bold leading-none text-white ring-2 ring-card">
              {displayCount}
            </span>
          ) : null}
        </button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className={cn(
          "flex h-full w-full flex-col gap-0 overflow-hidden border-l p-0 sm:max-w-md",
          sheetIsLight
            ? "border-slate-200 bg-white text-slate-950"
            : "border-slate-700 bg-slate-950 text-slate-50",
        )}
      >
        <SheetHeader
          className={cn(
            "border-b px-5 pb-4 pt-6 text-left",
            sheetIsLight ? "border-slate-200" : "border-slate-800",
          )}
        >
          <div className="flex items-start gap-3 pr-8">
            <span
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                count > 0
                  ? "bg-amber-500 text-slate-950"
                  : sheetIsLight
                    ? "bg-slate-100 text-slate-600"
                    : "bg-slate-800 text-slate-300",
              )}
            >
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <SheetTitle className={sheetIsLight ? "text-slate-950" : "text-slate-50"}>
                Alerts
              </SheetTitle>
              <SheetDescription
                className={cn("mt-1", sheetIsLight ? "text-slate-600" : "text-slate-400")}
              >
                {summaryText}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div
          className={cn(
            "flex items-center gap-3 border-b px-5 py-3 text-xs",
            sheetIsLight ? "border-slate-200 text-slate-600" : "border-slate-800 text-slate-400",
          )}
        >
          <CalendarClock className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {extensionData?.fileName ? `${extensionData.fileName} - ${importedAt}` : "Waiting for CSV import"}
          </span>
          <button
            type="button"
            onClick={() => void refetch()}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-all active:scale-95",
              sheetIsLight
                ? "border-slate-200 bg-slate-50 text-slate-700"
                : "border-slate-700 bg-slate-900 text-slate-200",
            )}
            aria-label="Refresh pending extensions"
          >
            {isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {error ? (
            <div
              className={cn(
                "rounded-xl border p-4 text-sm",
                sheetIsLight
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-red-900/70 bg-red-950/40 text-red-200",
              )}
            >
              Could not load pending extensions. Pull down a fresh import or tap refresh.
            </div>
          ) : rows.length === 0 && approvalRows.length === 0 && docRows.length === 0 && !docError ? (
            <div
              className={cn(
                "flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center",
                sheetIsLight
                  ? "border-slate-200 bg-slate-50 text-slate-600"
                  : "border-slate-800 bg-slate-900/70 text-slate-400",
              )}
            >
              <ClipboardList className="mb-3 h-8 w-8" />
              <p className={cn("text-base font-semibold", sheetIsLight ? "text-slate-900" : "text-slate-100")}>
                No alerts
              </p>
              <p className="mt-1 text-sm">
                No pending extensions, patient approvals, or pending panel documents.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div
                className={cn(
                  "grid grid-cols-3 gap-2 rounded-2xl border p-2",
                  sheetIsLight ? "border-slate-200 bg-slate-50" : "border-slate-800 bg-slate-900/80",
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelectedView("extensions")}
                  className={cn(
                    "rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
                    selectedView === "extensions"
                      ? sheetIsLight
                        ? "bg-white text-slate-950 shadow-sm"
                        : "bg-slate-800 text-slate-50"
                      : sheetIsLight
                        ? "text-slate-600"
                        : "text-slate-400",
                  )}
                >
                  Extensions
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedView("approvals")}
                  className={cn(
                    "rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
                    selectedView === "approvals"
                      ? sheetIsLight
                        ? "bg-white text-slate-950 shadow-sm"
                        : "bg-slate-800 text-slate-50"
                      : sheetIsLight
                        ? "text-slate-600"
                        : "text-slate-400",
                  )}
                >
                  Approvals
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedView("documents")}
                  className={cn(
                    "rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
                    selectedView === "documents"
                      ? sheetIsLight
                        ? "bg-white text-slate-950 shadow-sm"
                        : "bg-slate-800 text-slate-50"
                      : sheetIsLight
                        ? "text-slate-600"
                        : "text-slate-400",
                  )}
                >
                  Docs pending
                </button>
              </div>

              {selectedView === "extensions" ? (
                <section className="space-y-3">
                  <div className="flex items-center gap-2 px-1">
                    <AlertTriangle className={cn("h-4 w-4", sheetIsLight ? "text-amber-700" : "text-amber-300")} />
                    <h3 className={cn("text-sm font-semibold", sheetIsLight ? "text-slate-900" : "text-slate-100")}>
                      Pending extensions
                    </h3>
                  </div>
                  {rows.length > 0 ? (
                    rows.map((row) => {
                      const amount = formatAmount(row.preauthApprovedAmount);
                      return (
                        <article
                          key={`${extensionData?.importId}-${row.rowNumber}-${row.registrationId}`}
                          className={cn(
                            "rounded-2xl border p-4",
                            sheetIsLight
                              ? "border-slate-200 bg-white shadow-sm"
                              : "border-slate-800 bg-slate-900/80",
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-sm font-bold text-slate-950">
                              {row.daysSincePreauth ?? "-"}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className={cn("min-w-0 truncate text-sm font-semibold", sheetIsLight ? "text-slate-950" : "text-slate-50")}>
                                  {row.beneficiaryName || "Name not available"}
                                </h4>
                                <span
                                  className={cn(
                                    "rounded-full px-2 py-0.5 text-[0.65rem] font-semibold",
                                    sheetIsLight
                                      ? "bg-amber-100 text-amber-800"
                                      : "bg-amber-400/15 text-amber-200",
                                  )}
                                >
                                  Extension pending
                                </span>
                              </div>
                              <p className={cn("mt-1 text-xs", sheetIsLight ? "text-slate-600" : "text-slate-400")}>
                                {row.registrationId || "No Registration ID"} - {row.caseType || "Medical"}
                              </p>
                              <p className={cn("mt-1 text-[0.68rem]", sheetIsLight ? "text-slate-500" : "text-slate-500")}>
                                Source: {row.sourceFileName} · {formatImportedAt(row.sourceCreatedAt)}
                              </p>
                            </div>
                          </div>

                          <div
                            className={cn(
                              "mt-3 space-y-2 border-t pt-3 text-xs",
                              sheetIsLight ? "border-slate-100 text-slate-600" : "border-slate-800 text-slate-400",
                            )}
                          >
                            <p className="line-clamp-2">{formatProcedure(row)}</p>
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              {row.preauthDateLabel ? <span>Preauth: {row.preauthDateLabel}</span> : null}
                              {amount ? <span>Approved: {amount}</span> : null}
                            </div>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <div
                      className={cn(
                        "flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center",
                        sheetIsLight
                          ? "border-slate-200 bg-slate-50 text-slate-600"
                          : "border-slate-800 bg-slate-900/70 text-slate-400",
                      )}
                    >
                      <ClipboardList className="mb-3 h-8 w-8" />
                      <p className={cn("text-base font-semibold", sheetIsLight ? "text-slate-900" : "text-slate-100")}>
                        No pending extensions
                      </p>
                      <p className="mt-1 text-sm">
                        The latest saved government portal import has no patients marked for extension.
                      </p>
                    </div>
                  )}
                </section>
              ) : selectedView === "approvals" ? (
                <section className="space-y-3">
                  <div className="flex items-center gap-2 px-1 pt-1">
                    <ImageIcon className={cn("h-4 w-4", sheetIsLight ? "text-sky-700" : "text-sky-300")} />
                    <h3 className={cn("text-sm font-semibold", sheetIsLight ? "text-slate-900" : "text-slate-100")}>
                      Patient approvals
                    </h3>
                    <span className={cn("text-xs", sheetIsLight ? "text-slate-500" : "text-slate-400")}>
                      Last 24 hours
                    </span>
                  </div>
                  {approvalRows.length > 0 ? (
                    approvalRows.map((row) => (
                      <article
                        key={row.id}
                        className={cn(
                          "rounded-2xl border p-4",
                          sheetIsLight
                            ? "border-sky-200 bg-sky-50/70 shadow-sm"
                            : "border-sky-900/60 bg-sky-950/20",
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={cn(
                              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                              sheetIsLight ? "bg-sky-600 text-white" : "bg-sky-500/80 text-slate-950",
                            )}
                          >
                            <ImageIcon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className={cn("min-w-0 truncate text-sm font-semibold", sheetIsLight ? "text-slate-950" : "text-slate-50")}>
                                {row.patientName}
                              </h4>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[0.65rem] font-semibold",
                                  sheetIsLight
                                    ? "bg-sky-100 text-sky-800"
                                    : "bg-sky-400/15 text-sky-200",
                                )}
                              >
                                Approval uploaded
                              </span>
                            </div>
                            <p className={cn("mt-1 text-xs", sheetIsLight ? "text-slate-600" : "text-slate-400")}>
                              {formatTimeAgo(row.createdAt)}
                            </p>
                          </div>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div
                      className={cn(
                        "flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center",
                        sheetIsLight
                          ? "border-sky-200 bg-sky-50/50 text-slate-600"
                          : "border-sky-900/60 bg-sky-950/20 text-slate-400",
                      )}
                    >
                      <ImageIcon className="mb-3 h-8 w-8" />
                      <p className={cn("text-base font-semibold", sheetIsLight ? "text-slate-900" : "text-slate-100")}>
                        No patient approvals
                      </p>
                      <p className="mt-1 text-sm">
                        No approval uploads were added in the last 24 hours.
                      </p>
                    </div>
                  )}
                </section>
              ) : (
                <section className="space-y-3">
                  <div className="flex items-center gap-2 px-1 pt-1">
                    <FileWarning className={cn("h-4 w-4", sheetIsLight ? "text-amber-700" : "text-amber-300")} />
                    <h3 className={cn("text-sm font-semibold", sheetIsLight ? "text-slate-900" : "text-slate-100")}>
                      Pending panel documents
                    </h3>
                    {docTotal > docRows.length ? (
                      <span className={cn("text-xs", sheetIsLight ? "text-slate-500" : "text-slate-400")}>
                        Showing {docRows.length} of {docTotal.toLocaleString("en-IN")}
                      </span>
                    ) : null}
                  </div>

                  {docError ? (
                    <div
                      className={cn(
                        "rounded-xl border p-4 text-sm",
                        sheetIsLight
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-red-900/70 bg-red-950/40 text-red-200",
                      )}
                    >
                      Could not load pending panel documents. Tap refresh to try again.
                    </div>
                  ) : docRows.length > 0 ? (
                    docRows.map((row) => {
                      const panel = panelFor(row.corporate);
                      const visibleDocuments = row.pendingDocuments.slice(0, PENDING_DOC_CHIP_LIMIT);
                      const hiddenCount = row.pendingDocuments.length - visibleDocuments.length;

                      return (
                        <button
                          key={row.patientUuid}
                          type="button"
                          onClick={() => {
                            haptics.tap();
                            setOpen(false);
                            navigate(`/panel-documents?patient=${row.patientUuid}`);
                          }}
                          className={cn(
                            "w-full rounded-2xl border p-4 text-left transition-transform active:scale-[0.99]",
                            sheetIsLight
                              ? "border-amber-200 bg-amber-50/70 shadow-sm"
                              : "border-amber-900/60 bg-amber-950/20",
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-sm font-bold text-slate-950">
                              {row.pendingCount}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className={cn("min-w-0 truncate text-sm font-semibold", sheetIsLight ? "text-slate-950" : "text-slate-50")}>
                                  {row.patientName}
                                </h4>
                                <span className={cn("rounded-full px-2 py-0.5 text-[0.65rem] font-semibold", panel.badge)}>
                                  {row.panel}
                                </span>
                              </div>
                              <p className={cn("mt-1 text-xs", sheetIsLight ? "text-slate-600" : "text-slate-400")}>
                                {row.patientsId || "No UHID"}
                              </p>
                            </div>
                          </div>

                          <div
                            className={cn(
                              "mt-3 flex flex-wrap gap-1.5 border-t pt-3",
                              sheetIsLight ? "border-amber-100" : "border-amber-900/50",
                            )}
                          >
                            {visibleDocuments.map((name) => (
                              <span
                                key={name}
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[0.65rem] font-medium",
                                  sheetIsLight
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-amber-400/15 text-amber-200",
                                )}
                              >
                                {name}
                              </span>
                            ))}
                            {hiddenCount > 0 ? (
                              <span className={cn("text-[0.65rem] font-medium", sheetIsLight ? "text-slate-500" : "text-slate-400")}>
                                +{hiddenCount} more
                              </span>
                            ) : null}
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div
                      className={cn(
                        "flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center",
                        sheetIsLight
                          ? "border-amber-200 bg-amber-50/50 text-slate-600"
                          : "border-amber-900/60 bg-amber-950/20 text-slate-400",
                      )}
                    >
                      <FileWarning className="mb-3 h-8 w-8" />
                      <p className={cn("text-base font-semibold", sheetIsLight ? "text-slate-900" : "text-slate-100")}>
                        No pending panel documents
                      </p>
                      <p className="mt-1 text-sm">
                        Every panel patient has submitted or waived all mandatory documents.
                      </p>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
