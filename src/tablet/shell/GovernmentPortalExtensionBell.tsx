import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  ClipboardList,
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

export function GovernmentPortalExtensionBell() {
  const queryClient = useQueryClient();
  const { theme } = useTabletTheme();
  const [open, setOpen] = useState(false);
  const [seenImportId, setSeenImportId] = useState(() => {
    try {
      return localStorage.getItem(SEEN_IMPORT_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });

  const { data, isFetching, refetch, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchLatestGovernmentPortalExtensionAlerts(),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  const count = data?.count ?? 0;
  const rows = data?.rows ?? [];
  const isNewImportWithPendingRows = Boolean(
    data?.importId && count > 0 && data.importId !== seenImportId,
  );
  const displayCount = count > 99 ? "99+" : String(count);
  const importedAt = formatImportedAt(data?.createdAt);
  const sheetIsLight = theme === "light";

  const summaryText = useMemo(() => {
    if (!data) return "No government portal import has been saved yet.";
    if (count === 0) return `Latest import has no pending extension patients. ${importedAt}.`;
    return `${count} patient${count === 1 ? "" : "s"} need extension action. ${importedAt}.`;
  }, [count, data, importedAt]);

  const markSeen = () => {
    if (!data?.importId) return;
    setSeenImportId(data.importId);
    try {
      localStorage.setItem(SEEN_IMPORT_STORAGE_KEY, data.importId);
    } catch {
      // localStorage can be unavailable in private browser modes.
    }
  };

  useEffect(() => {
    if (open) markSeen();
    // markSeen intentionally reads the latest data when open changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data?.importId]);

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
          aria-label={
            count > 0
              ? `${count} pending extension patients`
              : "No pending extension patients"
          }
          title="Pending extensions"
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
                Pending Extensions
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
            {data?.fileName ? `${data.fileName} - ${importedAt}` : "Waiting for CSV import"}
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
          ) : rows.length === 0 ? (
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
                No pending extensions
              </p>
              <p className="mt-1 text-sm">
                The latest saved government portal import has no patients marked for extension.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => {
                const amount = formatAmount(row.preauthApprovedAmount);
                return (
                  <article
                    key={`${data?.importId}-${row.rowNumber}-${row.registrationId}`}
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
                          <h3 className={cn("min-w-0 truncate text-sm font-semibold", sheetIsLight ? "text-slate-950" : "text-slate-50")}>
                            {row.beneficiaryName || "Name not available"}
                          </h3>
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
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
