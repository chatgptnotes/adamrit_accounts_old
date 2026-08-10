import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  BellRing,
  CheckCheck,
  Smartphone,
  IndianRupee,
  Inbox,
  Loader2,
  Pill,
  RefreshCw,
  User as UserIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { useTabletTheme } from "@/tablet/theme/TabletTheme";
import { haptics } from "@/tablet/lib/haptics";
import { usePushNotifications } from "@/pwa/usePushNotifications";
import { useInstallPrompt } from "@/tablet/hooks/useInstallPrompt";

const QUERY_KEY = ["tablet-notifications"];
/** One books-health run per device per day — the function itself dedupes findings. */
const BOOKS_CHECK_STORAGE_KEY = "adamrit_books_health_last_run";

interface NotificationRow {
  id: string;
  notification_type: string;
  title: string;
  message: string;
  recipient_user_id: string | null;
  hospital_name: string | null;
  patient_id: string | null;
  patient_name: string | null;
  visit_id: string | null;
  payload: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

const formatInr = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(numeric);
};

const formatTimeAgo = (iso: string) => {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "Recently";
  const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
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

/**
 * Notification bell for every logged-in user (pharmacy threshold alerts and
 * future notification types). Rows come from public.notifications — one shared
 * row per event, inserted by check_pharmacy_threshold_after_sale. Read state is
 * global: whoever marks a notification read clears it for everyone.
 */
export function TabletNotificationBell() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { theme } = useTabletTheme();
  const [open, setOpen] = useState(false);
  const push = usePushNotifications();
  const { isIOS, isStandalone } = useInstallPrompt();

  const { data: rows = [], isFetching, refetch, error } = useQuery({
    queryKey: QUERY_KEY,
    enabled: Boolean(user),
    queryFn: async () => {
      // The books checks run at most once a day (the function dedupes its own
      // findings), so the first person to open the app each day is what makes
      // a money problem announce itself. Never blocks the bell.
      const lastRun = localStorage.getItem(BOOKS_CHECK_STORAGE_KEY);
      const today = new Date().toISOString().slice(0, 10);
      if (lastRun !== today) {
        localStorage.setItem(BOOKS_CHECK_STORAGE_KEY, today);
        const { error: healthError } = await (supabase as any).rpc("notify_books_health");
        if (healthError) console.warn("Books health check failed:", healthError.message);
      }

      const { data, error: queryError } = await (supabase as any)
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (queryError) throw queryError;
      return (data || []) as NotificationRow[];
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    if (!user) return;
    const channel = (supabase as any)
      .channel("tablet-notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        () => {
          queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  if (!user) return null;

  const unreadCount = rows.filter((row) => !row.is_read).length;
  const displayCount = unreadCount > 99 ? "99+" : String(unreadCount);
  const sheetIsLight = theme === "light";

  const markRead = async (row: NotificationRow) => {
    if (row.is_read) return;
    const { error: updateError } = await (supabase as any)
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", row.id);
    if (updateError) {
      console.error("Failed to mark notification as read:", updateError);
      return;
    }
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  };

  const markAllRead = async () => {
    const unreadIds = rows.filter((row) => !row.is_read).map((row) => row.id);
    if (unreadIds.length === 0) return;
    const { error: updateError } = await (supabase as any)
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .in("id", unreadIds);
    if (updateError) {
      console.error("Failed to mark notifications as read:", updateError);
      return;
    }
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  };

  const openModule = (path: string, row: NotificationRow) => {
    void markRead(row);
    setOpen(false);
    navigate(path);
  };

  const pharmacyRows = rows.filter(
    (row) => row.notification_type === "pharmacy_threshold",
  );
  const otSurgicalRows = rows.filter(
    (row) => row.notification_type === "ot_surgical_threshold",
  );
  // Nightly books checks: openings that stopped netting to zero, unbalanced
  // vouchers, obligations quietly regenerating money. Their own group, so a
  // money problem is never buried under routine threshold alerts.
  const booksRows = rows.filter((row) => row.notification_type === "books_health");
  const otherRows = rows.filter(
    (row) =>
      row.notification_type !== "pharmacy_threshold" &&
      row.notification_type !== "ot_surgical_threshold" &&
      row.notification_type !== "books_health",
  );

  const renderNotificationCard = (row: NotificationRow) => {
    const payload = row.payload || {};
    const isPharmacyThreshold = row.notification_type === "pharmacy_threshold";
    const isOtThreshold = row.notification_type === "ot_surgical_threshold";
    const isThreshold = isPharmacyThreshold || isOtThreshold;
    const totalAmount = formatInr(payload.total_pharmacy_amount);
    const totalOtAmount = formatInr(payload.total_ot_surgical_amount);
    const latestBillAmount = formatInr(payload.latest_bill_amount);

    return (
      <article
        key={row.id}
        onClick={() => void markRead(row)}
        className={cn(
          "rounded-2xl border p-4",
          row.is_read
            ? sheetIsLight
              ? "border-slate-200 bg-white"
              : "border-slate-800 bg-slate-900/60"
            : sheetIsLight
              ? "border-rose-200 bg-rose-50/70 shadow-sm"
              : "border-rose-900/60 bg-rose-950/20",
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              row.is_read
                ? sheetIsLight
                  ? "bg-slate-100 text-slate-600"
                  : "bg-slate-800 text-slate-300"
                : "bg-rose-500 text-white",
            )}
          >
            {isThreshold ? (
              <IndianRupee className="h-4 w-4" />
            ) : (
              <BellRing className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4
                className={cn(
                  "min-w-0 text-sm font-semibold",
                  sheetIsLight ? "text-slate-950" : "text-slate-50",
                )}
              >
                {row.title}
              </h4>
              {!row.is_read ? (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[0.65rem] font-semibold",
                    sheetIsLight
                      ? "bg-rose-100 text-rose-800"
                      : "bg-rose-400/15 text-rose-200",
                  )}
                >
                  New
                </span>
              ) : null}
            </div>
            <p
              className={cn(
                "mt-1 text-xs",
                sheetIsLight ? "text-slate-600" : "text-slate-400",
              )}
            >
              {row.message}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {formatTimeAgo(row.created_at)}
            </p>
          </div>
        </div>

        {isThreshold ? (
          <div
            className={cn(
              "mt-3 space-y-1 border-t pt-3 text-xs",
              sheetIsLight
                ? "border-slate-100 text-slate-600"
                : "border-slate-800 text-slate-400",
            )}
          >
            <p
              className={cn(
                "text-sm font-semibold",
                sheetIsLight ? "text-slate-900" : "text-slate-100",
              )}
            >
              {String(payload.patient_name || row.patient_name || "Patient")}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {payload.uhid || payload.patient_id ? (
                <span>UHID: {String(payload.uhid || payload.patient_id)}</span>
              ) : null}
              {payload.admission_number ? (
                <span>Admission: {String(payload.admission_number)}</span>
              ) : null}
              {payload.patient_category ? (
                <span>Category: {String(payload.patient_category)}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {isPharmacyThreshold && totalAmount ? (
                <span>Total pharmacy: {totalAmount}</span>
              ) : null}
              {isOtThreshold && totalOtAmount ? (
                <span>Total OT sales: {totalOtAmount}</span>
              ) : null}
              {payload.latest_bill_number ? (
                <span>
                  {isOtThreshold ? "OT bill" : "Latest bill"}:{" "}
                  {String(payload.latest_bill_number)}
                  {latestBillAmount ? ` (${latestBillAmount})` : ""}
                </span>
              ) : null}
            </div>
            {payload.created_by ? (
              <p>Billed by: {String(payload.created_by)}</p>
            ) : null}

            {row.visit_id ? (
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openModule(`/patient-profile?visit_id=${row.visit_id}`, row);
                  }}
                  className={cn(
                    "flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-all active:scale-95",
                    sheetIsLight
                      ? "border-slate-200 bg-slate-50 text-slate-700"
                      : "border-slate-700 bg-slate-900 text-slate-200",
                  )}
                >
                  <UserIcon className="h-3.5 w-3.5" />
                  Patient
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openModule(`/pharmacy-dispense?visit_id=${row.visit_id}`, row);
                  }}
                  className={cn(
                    "flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-all active:scale-95",
                    sheetIsLight
                      ? "border-slate-200 bg-slate-50 text-slate-700"
                      : "border-slate-700 bg-slate-900 text-slate-200",
                  )}
                >
                  <Pill className="h-3.5 w-3.5" />
                  Pharmacy
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </article>
    );
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          onClick={() => haptics.tap()}
          aria-label={
            unreadCount > 0
              ? `${unreadCount} unread notifications`
              : "No unread notifications"
          }
          title="Notifications"
          className={cn(
            "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-all active:scale-95",
            unreadCount > 0
              ? "border-rose-300/70 bg-rose-500 text-white shadow-[0_12px_26px_-18px_rgba(244,63,94,0.9)]"
              : "border-border bg-secondary text-muted-foreground hover:text-foreground",
          )}
        >
          <BellRing className="h-5 w-5" />
          {unreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[0.62rem] font-bold leading-none text-white ring-2 ring-card">
              {displayCount}
            </span>
          ) : null}
        </button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className={cn(
          "flex h-full w-full flex-col gap-0 overflow-hidden border-l p-0 sm:max-w-4xl",
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
                unreadCount > 0
                  ? "bg-rose-500 text-white"
                  : sheetIsLight
                    ? "bg-slate-100 text-slate-600"
                    : "bg-slate-800 text-slate-300",
              )}
            >
              <BellRing className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <SheetTitle className={sheetIsLight ? "text-slate-950" : "text-slate-50"}>
                Notifications
              </SheetTitle>
              <SheetDescription
                className={cn("mt-1", sheetIsLight ? "text-slate-600" : "text-slate-400")}
              >
                {unreadCount > 0
                  ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}.`
                  : "You are all caught up."}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* Phone-alert opt-in. Hidden once this device is subscribed. On an
            iPhone still running in the Safari tab, PushManager doesn't exist
            (Apple only grants push to Home Screen apps, iOS 16.4+), so we show
            the install steps instead of an Allow button. */}
        {push.status !== "subscribed" && !(push.status === "unsupported" && !isIOS) ? (
          <div
            className={cn(
              "border-b px-5 py-3",
              sheetIsLight ? "border-slate-200" : "border-slate-800",
            )}
          >
            <div
              className={cn(
                "flex items-start gap-3 rounded-xl border p-3",
                sheetIsLight
                  ? "border-emerald-200 bg-emerald-50 text-slate-800"
                  : "border-emerald-800 bg-emerald-950/40 text-slate-100",
              )}
            >
              <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div className="min-w-0 flex-1 text-xs">
                {isIOS && !isStandalone ? (
                  <>
                    <p className="font-semibold">Get alerts on this iPhone/iPad</p>
                    <p className="mt-1">
                      Tap Safari's <span className="font-semibold">Share</span> button,
                      choose <span className="font-semibold">Add to Home Screen</span>,
                      then open Adamrit from the new icon and enable alerts here.
                    </p>
                  </>
                ) : push.status === "denied" ? (
                  <>
                    <p className="font-semibold">Notifications are blocked</p>
                    <p className="mt-1">
                      Allow notifications for Adamrit in this device's browser
                      settings, then try again.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold">Get alerts on this phone</p>
                    <p className="mt-1">
                      Bills due, approvals waiting and incoming patients will
                      buzz this device even when the app is closed.
                    </p>
                    {push.error ? (
                      <p className="mt-1 text-rose-500">{push.error}</p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        haptics.tap();
                        void push.enable();
                      }}
                      disabled={push.status === "subscribing"}
                      className="mt-2 flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
                    >
                      {push.status === "subscribing" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <BellRing className="h-4 w-4" />
                      )}
                      Enable phone alerts
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}

        <div
          className={cn(
            "flex items-center gap-2 border-b px-5 py-3 text-xs",
            sheetIsLight ? "border-slate-200 text-slate-600" : "border-slate-800 text-slate-400",
          )}
        >
          <span className="min-w-0 flex-1 truncate">Latest 50 notifications</span>
          <button
            type="button"
            onClick={() => void markAllRead()}
            disabled={unreadCount === 0}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-lg border px-2.5 font-semibold transition-all active:scale-95 disabled:opacity-40",
              sheetIsLight
                ? "border-slate-200 bg-slate-50 text-slate-700"
                : "border-slate-700 bg-slate-900 text-slate-200",
            )}
          >
            <CheckCheck className="h-4 w-4" />
            Mark all read
          </button>
          <button
            type="button"
            onClick={() => void refetch()}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-all active:scale-95",
              sheetIsLight
                ? "border-slate-200 bg-slate-50 text-slate-700"
                : "border-slate-700 bg-slate-900 text-slate-200",
            )}
            aria-label="Refresh notifications"
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
              Could not load notifications. Tap refresh to try again.
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
              <Inbox className="mb-3 h-8 w-8" />
              <p className={cn("text-base font-semibold", sheetIsLight ? "text-slate-900" : "text-slate-100")}>
                No notifications yet
              </p>
              <p className="mt-1 text-sm">
                Pharmacy threshold alerts for package patients will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                {[
                  { title: "Pharmacy", items: pharmacyRows },
                  { title: "OT Surgical", items: otSurgicalRows },
                  ...(booksRows.length ? [{ title: "Books Check", items: booksRows }] : []),
                ].map((group) => (
                  <section
                    key={group.title}
                    className={cn(
                      "flex min-h-64 flex-col rounded-2xl border p-3",
                      sheetIsLight
                        ? "border-slate-200 bg-slate-50/70"
                        : "border-slate-800 bg-slate-900/40",
                    )}
                  >
                    <div className="mb-3 flex items-center justify-between px-1">
                      <h3
                        className={cn(
                          "text-sm font-semibold",
                          sheetIsLight ? "text-slate-900" : "text-slate-100",
                        )}
                      >
                        {group.title}
                      </h3>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-semibold",
                          sheetIsLight
                            ? "bg-white text-slate-600"
                            : "bg-slate-800 text-slate-300",
                        )}
                      >
                        {group.items.length}
                      </span>
                    </div>
                    <div className="max-h-[58vh] space-y-3 overflow-y-auto pr-1">
                      {group.items.length > 0 ? (
                        group.items.map(renderNotificationCard)
                      ) : (
                        <div
                          className={cn(
                            "flex min-h-44 items-center justify-center rounded-xl border border-dashed p-4 text-center text-xs",
                            sheetIsLight
                              ? "border-slate-200 text-slate-500"
                              : "border-slate-700 text-slate-400",
                          )}
                        >
                          No {group.title} notifications.
                        </div>
                      )}
                    </div>
                  </section>
                ))}
              </div>

              {otherRows.length > 0 ? (
                <section>
                  <h3
                    className={cn(
                      "mb-3 px-1 text-sm font-semibold",
                      sheetIsLight ? "text-slate-900" : "text-slate-100",
                    )}
                  >
                    Other notifications
                  </h3>
                  <div className="space-y-3">
                    {otherRows.map(renderNotificationCard)}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
