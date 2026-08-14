import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Send, TrendingUp } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { inr } from "@/tablet/lib/format";
import {
  CASH_BOOKS,
  bookLabel,
  fetchDailyCashSummary,
  fetchSentReports,
  reportDailyCash,
  type CashBookKey,
  type DayKind,
} from "@/tablet/lib/dailyCashReport";

// DATA SOURCE: daily_cash_summary (read) and report_daily_cash (send). Every
// figure is computed in the database; this screen types none of them.

const istToday = () =>
  new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60_000)
    .toISOString()
    .slice(0, 10);

const stamp = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      })
    : "—";

const KIND_TONE: Record<DayKind, string> = {
  SHORTAGE: "border-red-300 bg-red-50 text-red-800",
  EXCESS: "border-amber-300 bg-amber-50 text-amber-900",
  BALANCED: "border-emerald-300 bg-emerald-50 text-emerald-800",
};

/**
 * Avani's daily cash report.
 *
 * A shortage was already being recorded — at the handover, with a reason — and
 * then sitting in a register nobody opens until month end. This is the step
 * that was missing: somebody looks at the day and tells the directors.
 *
 * Avani chooses the day and the counter and nothing else. The figures are the
 * database's, and the shortage is the sum of that day's handover variances
 * rather than a fresh calculation, so the hospital has one answer to "how much
 * was missing" instead of two.
 */
export default function DailyCashReportAvaniFlow() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [date, setDate] = useState(istToday());
  const [counter, setCounter] = useState<CashBookKey>("hope");
  const [note, setNote] = useState("");

  const summary = useQuery({
    queryKey: ["daily-cash-summary", date, counter],
    queryFn: () => fetchDailyCashSummary(date, counter),
  });

  const sent = useQuery({
    queryKey: ["daily-cash-reports-sent", date, counter],
    queryFn: () => fetchSentReports(date, counter),
  });

  const send = useMutation({
    mutationFn: () =>
      reportDailyCash({
        date, hospitalType: counter, userId: user?.id ?? null,
        note: note.trim() || null,
      }),
    onSuccess: ({ kind, variance, directorsTold }) => {
      toast.success(
        kind === "BALANCED"
          ? `Reported as balanced. ${directorsTold} director${directorsTold === 1 ? "" : "s"} told.`
          : `Reported ${kind.toLowerCase()} of ${inr(Math.abs(variance))}. ${directorsTold} director${directorsTold === 1 ? "" : "s"} told.`,
      );
      setNote("");
      qc.invalidateQueries({ queryKey: ["daily-cash-reports-sent"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not send the report"),
  });

  const s = summary.data;
  const needsNote = !!s && s.kind !== "BALANCED";

  return (
    <FlowScaffold
      heading="Avani Daily Cash Report"
      subheading="The day's cash for one counter, and the shortage or excess reported to the directors"
    >
      <div className="space-y-4">
        <TabletCard variant="flat" className="space-y-3">
          <div>
            <TabletLabel>Which counter?</TabletLabel>
            <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {CASH_BOOKS.map((b) => (
                <TabletButton
                  key={b.key}
                  variant={counter === b.key ? "default" : "outline"}
                  onClick={() => setCounter(b.key)}
                >
                  {b.label}
                </TabletButton>
              ))}
            </div>
          </div>
          <div>
            <TabletLabel htmlFor="dcr-date">Which day?</TabletLabel>
            <TabletInput
              id="dcr-date"
              type="date"
              value={date}
              max={istToday()}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </TabletCard>

        {summary.isLoading ? (
          <TabletCard className="flex min-h-40 items-center justify-center">
            <Loader2 className="mr-3 h-6 w-6 animate-spin" /> Working out the day
          </TabletCard>
        ) : summary.isError ? (
          <TabletCard className="border-red-200 bg-red-50 text-red-700">
            {(summary.error as Error)?.message || "Could not load the day."}
          </TabletCard>
        ) : s ? (
          <>
            <TabletCard className={`border-2 ${KIND_TONE[s.kind]}`}>
              <div className="flex flex-wrap items-center gap-3">
                {s.kind === "BALANCED" ? (
                  <CheckCircle2 className="h-7 w-7" />
                ) : (
                  <AlertTriangle className="h-7 w-7" />
                )}
                <div>
                  <p className="text-2xl font-bold">
                    {s.kind === "BALANCED"
                      ? "The drawer balanced"
                      : `${s.kind === "SHORTAGE" ? "Short" : "Over"} by ${inr(Math.abs(s.variance))}`}
                  </p>
                  <p className="text-sm">
                    {bookLabel(s.hospitalType)} · {s.date}
                    {s.handovers.length === 0 && " · nothing was handed over on this day"}
                  </p>
                </div>
              </div>
              {s.handovers.length === 0 && s.collected > 0 && (
                <p className="mt-3 rounded-lg border border-red-300 bg-white/70 p-2 text-sm font-semibold text-red-800">
                  {inr(s.collected)} was collected and none of it handed over. There is
                  no count to compare against, so "balanced" here means unchecked,
                  not correct.
                </p>
              )}
            </TabletCard>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              <Figure label="Opened with" value={inr(s.opening)} />
              <Figure label="Collected" value={inr(s.collected)} />
              <Figure label="Paid out" value={inr(s.paidOut)} />
              <Figure label="Banked" value={inr(s.deposited)} />
              <Figure label="Handed over" value={inr(s.handedOver)} />
              <Figure label="Still in drawer" value={inr(s.stillInDrawer)} />
            </div>

            <TabletCard variant="flat" className="space-y-2">
              <h3 className="flex items-center gap-2 text-lg font-bold">
                <TrendingUp className="h-5 w-5 text-slate-600" />
                Who took the cash
              </h3>
              {s.byCashier.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No cash was collected at this counter on this day.
                </p>
              ) : (
                <div className="divide-y">
                  {s.byCashier.map((c) => (
                    <div key={c.who} className="flex items-center justify-between py-2">
                      <span className="font-medium">{c.who}</span>
                      <span className="text-sm text-muted-foreground">
                        {c.count} receipt{c.count === 1 ? "" : "s"}
                      </span>
                      <span className="w-32 text-right font-bold">{inr(c.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </TabletCard>

            <TabletCard variant="flat" className="space-y-2">
              <h3 className="text-lg font-bold">Handovers on this day</h3>
              {s.handovers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  None. The drawer was never counted.
                </p>
              ) : (
                <div className="space-y-2">
                  {s.handovers.map((h) => (
                    <div key={h.handoverNo} className="rounded-xl border p-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono text-xs text-muted-foreground">{h.handoverNo}</span>
                        <span className="font-medium">{h.from}</span>
                        <span className="text-muted-foreground">→ {h.to}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] uppercase">
                          {h.status}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground">{stamp(h.at)}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                        <Figure small label="Expected" value={inr(h.expected)} />
                        <Figure small label="Counted" value={inr(h.counted)} />
                        <Figure small label="Locker" value={inr(h.locker)} />
                        <Figure small label="Banked" value={inr(h.deposit)} />
                        <Figure
                          small
                          label="Difference"
                          value={Math.round(h.variance * 100) === 0 ? "—" : inr(h.variance)}
                        />
                      </div>
                      {h.reason && (
                        <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                          <span className="font-semibold">Cashier said: </span>{h.reason}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabletCard>

            <TabletCard variant="flat" className="space-y-3">
              <h3 className="text-lg font-bold">Report this day to the directors</h3>
              <div>
                <TabletLabel htmlFor="dcr-note">
                  What happened?{" "}
                  {needsNote ? (
                    <span className="text-red-600">Required — the day is out</span>
                  ) : (
                    <span className="text-muted-foreground">(optional)</span>
                  )}
                </TabletLabel>
                <textarea
                  id="dcr-note"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-1 w-full resize-none rounded-xl border bg-background p-3 text-base outline-none focus:ring-2 focus:ring-ring"
                  placeholder={
                    needsNote
                      ? "e.g. recounted with Nisha, ₹400 paid out for stationery with no slip"
                      : "Anything the directors should know"
                  }
                />
              </div>
              <TabletButton
                className="w-full"
                disabled={send.isPending || (needsNote && !note.trim())}
                onClick={() => send.mutate()}
              >
                {send.isPending ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <Send className="mr-2 h-5 w-5" />
                )}
                Send to the directors
              </TabletButton>

              {(sent.data ?? []).length > 0 && (
                <div className="space-y-1 border-t pt-3">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    Already sent for this day
                  </p>
                  {(sent.data ?? []).map((r) => (
                    <p key={r.id} className="text-sm">
                      <span className="font-semibold">{r.kind}</span>
                      {Math.round(r.variance * 100) !== 0 && ` ${inr(Math.abs(r.variance))}`}
                      {" — "}{r.reportedByName} at {stamp(r.createdAt)}, {r.directorsTold} told
                      {r.note && <span className="text-muted-foreground"> · {r.note}</span>}
                    </p>
                  ))}
                </div>
              )}
            </TabletCard>
          </>
        ) : null}
      </div>
    </FlowScaffold>
  );
}

function Figure({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className={small ? "" : "rounded-xl border bg-card p-3"}>
      <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
      <p className={small ? "font-semibold" : "text-lg font-bold"}>{value}</p>
    </div>
  );
}
