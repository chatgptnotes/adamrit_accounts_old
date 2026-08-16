import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { modulesForUser } from "@/tablet/config/modules";
import { UnbilledPaymentAlert } from "@/components/UnbilledPaymentAlert";
import { TabletWatermark } from "@/tablet/components/TabletWatermark";
import { useRecentlyDischargedVisits } from "@/tablet/hooks/useVisitLists";
import { useDialysisTracker } from "@/tablet/hooks/useDialysisTracker";
import { useAssignedTiles } from "@/tablet/hooks/useAssignedTiles";
import { useCashHandoverAccess } from "@/tablet/hooks/useCashHandoverAccess";
import { OpeningCashBanner } from "@/tablet/components/OpeningCashBanner";

// Both cash tiles answer to the same roster: opening cash writes the figure
// that the handover is later measured against, so it is no less restricted.
const CASH_TILES = new Set([
  "cash-handover", "opening-cash", "cash-shift-report",
  // The daily report shows the whole day's cash and raises a shortage to the
  // directors. Same roster: it is a cash screen, not a reporting one.
  "daily-cash-report-avani",
]);
import { DIALYSIS_SESSION_BILLING_QUERY_KEY, loadDialysisBillableSessions } from "@/lib/dialysisSessionBilling";
import { loadDialysisPatients } from "@/lib/dialysis/scheme";
import { supabase } from "@/integrations/supabase/client";

/** Home dashboard — gradient-iconed module tiles, role-filtered, with quick search. */
export function TabletHome() {
  const navigate = useNavigate();
  const { user, hospitalConfig } = useAuth();
  const [query, setQuery] = useState("");
  // One call, read twice: it gates the cash tiles below, and every cashier
  // also sees every voucher tile. The roster is the authority, so somebody put
  // on a counter gets both without a code change.
  const cashHandover = useCashHandoverAccess();
  const allModules = modulesForUser(user ?? undefined, undefined, cashHandover.allowed);
  // Cash Handover is restricted to the named cash roster (and cashiers), so it
  // is dropped from the grid for everyone else rather than shown and refused.
  const modules = useMemo(
    () => allModules.filter((m) => !CASH_TILES.has(m.id) || cashHandover.allowed),
    [allModules, cashHandover.allowed],
  );
  // Recently-discharged intimation for the billing desk, badged on their tile.
  const billing = useRecentlyDischargedVisits();
  // Dialysis patients due a bill or a 30-day lab report, badged on their tile.
  const dialysis = useDialysisTracker();
  // A hard billing alert is shown on Shashank's tile once three dialysis dates
  // are unbilled across the hospital. Its badge is the number of dates left.
  const dialysisBilling = useQuery({
    queryKey: [DIALYSIS_SESSION_BILLING_QUERY_KEY, "home", hospitalConfig.name],
    queryFn: () => loadDialysisBillableSessions(hospitalConfig.name),
    staleTime: 30_000,
  });
  const dialysisBillingAlertCount = useMemo(
    () => (dialysisBilling.data ?? []).filter((session) => !session.billed).length,
    [dialysisBilling.data],
  );
  // Shashank's tile counts PATIENTS ready to claim, not unbilled dates: the
  // block he must wait for differs by scheme (PMJAY 3, MJPJAY 6), so a count
  // of dates would badge patients who are not claimable yet.
  const dialysisReady = useQuery({
    queryKey: ["dialysis-ready-to-bill", "home"],
    queryFn: () => loadDialysisPatients("hope"),
    staleTime: 30_000,
  });
  const dialysisReadyCount = useMemo(
    () => (dialysisReady.data ?? []).filter((patient) => patient.readyToBill).length,
    [dialysisReady.data],
  );
  // Diksha's tile: dialysis patients registered in the last 24 hours whose
  // thumb has not been taken. They cannot start until it is.
  const dialysisThumbsPending = useQuery({
    queryKey: ["dialysis-thumbs-pending", "home"],
    staleTime: 30_000,
    queryFn: async (): Promise<number> => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: visits } = await supabase
        .from("visits")
        .select("id, patients!inner(hospital_name)")
        .eq("patient_type", "Dialysis")
        .eq("patients.hospital_name", "hope")
        .gte("created_at", since);
      const ids = (visits ?? []).map((v: any) => v.id);
      if (ids.length === 0) return 0;
      const { data: done } = await (supabase as any)
        .from("dialysis_front_office")
        .select("visit_id")
        .in("visit_id", ids)
        .not("thumb_done_at", "is", null);
      return ids.length - (done ?? []).length;
    },
  });
  // Tiles this person was mapped to in the Tile Configuration master. They are
  // lifted to the top of the grid; nothing is hidden if the set is empty.
  const { assigned } = useAssignedTiles();

  /** Pending-work count to badge on a tile, or 0 for tiles that have none. */
  const badgeFor = (moduleId: string) => {
    if (moduleId === "documents") return billing.count;
    if (moduleId === "dialysis") return dialysis.actionCount;
    if (moduleId === "panel-payment-received" && dialysisBillingAlertCount >= 3) return dialysisBillingAlertCount;
    if (moduleId === "dialysis-billing") return dialysisReadyCount;
    if (moduleId === "dialysis-front-office") return dialysisThumbsPending.data ?? 0;
    return 0;
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return modules;
    return modules.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.keywords || []).some((k) => k.toLowerCase().includes(q)),
    );
  }, [modules, query]);

  // The tiles this person was mapped to, lifted out of the grid into their own
  // band. Both halves keep the module order, so a tile's neighbours only change
  // when someone maps it.
  const mine = useMemo(
    () => filtered.filter((m) => assigned.has(m.id)),
    [filtered, assigned],
  );
  const rest = useMemo(
    () => filtered.filter((m) => !assigned.has(m.id)),
    [filtered, assigned],
  );

  /** One module tile. Identical in both bands — being assigned changes where a
      tile sits, never how it looks. */
  const renderTile = (m: (typeof modules)[number]) => {
    const Icon = m.icon;
    const badge = badgeFor(m.id);
    const isDialysisBillingAlert = m.id === "panel-payment-received" && badge > 0;
    return (
      <button
        key={m.id}
        type="button"
        onClick={() => navigate(`/${m.id}`, { viewTransition: true })}
        className="tablet-tile tablet-glass relative flex min-h-[148px] flex-col gap-2 rounded-2xl p-4 text-left sm:min-h-[156px] sm:p-5"
      >
        {badge > 0 ? (
          <span
            title={
              isDialysisBillingAlert
                ? `${badge} dialysis billing date${badge === 1 ? "" : "s"} pending`
                : m.id === "dialysis-billing"
                  ? `${badge} patient${badge === 1 ? "" : "s"} ready to claim`
                  : m.id === "dialysis-front-office"
                    ? `${badge} thumb impression${badge === 1 ? "" : "s"} pending`
                    : `${badge} pending item${badge === 1 ? "" : "s"}`
            }
            className={cn(
              "absolute right-3 top-3 inline-flex min-w-[1.75rem] items-center justify-center rounded-full bg-destructive px-2 py-1 text-sm font-bold text-destructive-foreground shadow",
              isDialysisBillingAlert && "animate-pulse ring-2 ring-destructive/30 ring-offset-2 ring-offset-background",
            )}
          >
            {badge}
          </span>
        ) : null}
        <span
          className={cn(
            "inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br shadow-lg sm:h-12 sm:w-12",
            m.tint,
          )}
        >
          <Icon className="h-5 w-5 text-white sm:h-6 sm:w-6" />
        </span>
        <span className="min-w-0">
          <span className="block text-[1.05rem] font-semibold leading-tight text-foreground">
            {m.label}
          </span>
          <span className="mt-1 line-clamp-2 min-h-[2.25rem] text-[0.92rem] leading-snug text-muted-foreground">
            {m.description}
          </span>
        </span>
      </button>
    );
  };

  const gridClass =
    "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5";

  return (
    <div className="relative isolate h-full">
      {/* Raised once a day to management: money that left with no bill. */}
      <UnbilledPaymentAlert />
      <TabletWatermark />
      <div className="tablet-no-scrollbar h-full overflow-y-auto p-4 sm:p-6 lg:p-8">
        {/* Centring guard rail — caps width so the dashboard never
            over-stretches on large desktop / 4K monitors. */}
        <div className="mx-auto w-full max-w-[1800px]">
          {/* Shown only to the people who work a drawer. A nurse being told to
              declare opening cash is noise, and noise is how a warning stops
              being read. */}
          {cashHandover.allowed && <OpeningCashBanner className="mb-4" />}

          {/* Quick search — filter tiles by name / description / id. */}
          <div className="sticky top-0 z-10 -mx-1 mb-4 px-1">
            <div className="tablet-glass relative flex items-center">
              <Search className="pointer-events-none absolute left-3.5 h-5 w-5 text-muted-foreground sm:h-6 sm:w-6" />
              <input
                type="search"
                inputMode="search"
                enterKeyHint="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${modules.length} tiles…`}
                aria-label="Search tablet tiles"
                className="tablet-glass h-14 w-full rounded-2xl border border-border bg-card/80 pl-11 pr-11 text-lg text-foreground shadow-sm outline-none backdrop-blur-md placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary sm:h-16 sm:pl-12"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2 inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:right-2.5"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-center">
              <Search className="h-10 w-10 text-muted-foreground/60" />
              <p className="text-lg font-semibold text-foreground">No tiles found</p>
              <p className="text-sm text-muted-foreground">
                No tiles match “{query}”. Try a different search.
              </p>
              <button
                type="button"
                onClick={() => setQuery("")}
                className="mt-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                Clear search
              </button>
            </div>
          ) : mine.length === 0 ? (
            /* Nobody has mapped this person to anything yet, so the grid stays
               exactly as it always was - one block, no headings. */
            <div className={gridClass}>{filtered.map(renderTile)}</div>
          ) : (
            <>
              <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Your Work
              </h2>
              <div className={gridClass}>{mine.map(renderTile)}</div>
              {rest.length > 0 && (
                <>
                  <h2 className="mb-2 mt-6 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    All Modules
                  </h2>
                  <div className={gridClass}>{rest.map(renderTile)}</div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
