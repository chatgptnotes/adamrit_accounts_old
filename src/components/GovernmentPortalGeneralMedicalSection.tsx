import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, AlertTriangle, FileText, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchLatestGovernmentPortalReport } from "@/lib/governmentPortalReportDb";
import type { GovernmentPortalRow } from "@/lib/governmentPortalReport";
import { cn } from "@/lib/utils";
import { TabletCard } from "@/tablet/ui/TabletCard";

type Surface = "desktop" | "tablet";

interface Props {
  surface?: Surface;
  maxRows?: number;
}

const formatAmount = (value: string) => {
  if (!value.trim()) return "-";
  const numeric = Number(value.replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(numeric)) return value;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(numeric);
};

const compactProcedure = (row: GovernmentPortalRow) => {
  const code = row.values["Procedure Code"];
  const details = row.values["Procedure Details"];
  if (code && details) return `${code} - ${details}`;
  return code || details || "-";
};

const formatPreauth = (row: GovernmentPortalRow) =>
  row.preauthDateLabel || row.values["Preauth Initiated Date"] || "-";

function EmptyState({ surface }: { surface: Surface }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-dashed p-5 text-sm",
        surface === "tablet"
          ? "border-border/70 bg-card/60 text-muted-foreground"
          : "border-gray-200 bg-gray-50 text-gray-500",
      )}
    >
      No government portal import has been saved yet.
    </div>
  );
}

function LoadingState({ surface }: { surface: Surface }) {
  return (
    <div className="space-y-3">
      {[...Array(4)].map((_, index) => (
        <div
          key={index}
          className={cn(
            "grid gap-3 rounded-2xl border p-4",
            surface === "tablet"
              ? "border-border bg-card"
              : "border-gray-200 bg-white",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <Skeleton className="h-10 w-10 rounded-xl" />
              <div className="min-w-0 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-36" />
              </div>
            </div>
            <Skeleton className="h-6 w-28 rounded-full" />
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function GovernmentPortalGeneralMedicalSection({
  surface = "desktop",
  maxRows = 8,
}: Props) {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["latest-government-portal-report"],
    queryFn: () => fetchLatestGovernmentPortalReport(),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const rows = useMemo(
    () => (data?.report.rows || []).filter((row) => row.section === "generalMedical"),
    [data],
  );

  const visibleRows = rows.slice(0, maxRows);

  const Shell = surface === "tablet" ? TabletCard : Card;

  return (
    <Shell className={cn(surface === "tablet" ? "space-y-4" : "overflow-hidden")}>
      {surface === "desktop" ? (
        <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-gray-100 pb-4">
          <div className="space-y-1">
            <CardTitle className="text-lg">General Medical - Non Dialysis</CardTitle>
            <p className="text-sm text-gray-500">
              Latest saved government portal import.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              {isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileText className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
            <Button size="sm" onClick={() => navigate("/government-portal-report-import")}>
              Open import
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
      ) : (
        <header className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-base font-semibold">General Medical - Non Dialysis</h3>
            <p className="text-sm text-muted-foreground">
              Latest saved government portal import.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => void refetch()} aria-label="Refresh portal report">
            {isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
          </Button>
        </header>
      )}

      {surface === "desktop" ? (
        <CardContent className="space-y-4 p-0">
          {isLoading ? (
            <div className="p-4">
              <LoadingState surface={surface} />
            </div>
          ) : error ? (
            <div className="flex items-start gap-3 p-4 text-sm text-red-600">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p>Could not load the saved government portal report.</p>
                <button className="mt-1 underline" onClick={() => void refetch()}>
                  Retry
                </button>
              </div>
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="p-4">
              <EmptyState surface={surface} />
            </div>
          ) : (
            <div className="max-h-[32rem] overflow-y-auto px-4 pb-4">
              <div className="space-y-3">
                {visibleRows.map((row) => (
                  <article
                    key={`${row.rowNumber}-${row.values["Registration ID"]}`}
                    className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-gray-900">
                            {row.values["Beneficiary Name"] || "-"}
                          </div>
                          {row.extensionNeeded && (
                            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                              Extension Needed
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          Row {row.rowNumber} · Reg {row.values["Registration ID"] || "-"} ·{" "}
                          {formatPreauth(row)} · {row.daysSincePreauth ?? "-"} days
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-sm font-semibold text-gray-900">
                        {formatAmount(row.values["Preauth Approved Amount"])}
                      </div>
                    </div>
                    <div className="mt-3 text-sm text-gray-700">{compactProcedure(row)}</div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      ) : (
        <div className="space-y-4">
          {isLoading ? (
            <LoadingState surface={surface} />
          ) : error ? (
            <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p>Could not load the saved government portal report.</p>
                <button className="mt-1 underline" onClick={() => void refetch()}>
                  Retry
                </button>
              </div>
            </div>
          ) : visibleRows.length === 0 ? (
            <EmptyState surface={surface} />
          ) : (
            <div className="space-y-3">
              {visibleRows.map((row) => (
                <article
                  key={`${row.rowNumber}-${row.values["Registration ID"]}`}
                  className="rounded-2xl border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-foreground">
                          {row.values["Beneficiary Name"] || "-"}
                        </div>
                        {row.extensionNeeded && (
                          <Badge className="bg-amber-500/15 text-amber-200 hover:bg-amber-500/15">
                            Extension Needed
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Row {row.rowNumber} · Reg {row.values["Registration ID"] || "-"} ·{" "}
                        {formatPreauth(row)} · {row.daysSincePreauth ?? "-"} days
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
                      {formatAmount(row.values["Preauth Approved Amount"])}
                    </div>
                  </div>
                  <div className="mt-3 text-sm text-muted-foreground">
                    {compactProcedure(row)}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
