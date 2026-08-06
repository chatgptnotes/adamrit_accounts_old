import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { modulesForUser } from "@/tablet/config/modules";
import { TabletWatermark } from "@/tablet/components/TabletWatermark";
import { useRecentlyDischargedVisits } from "@/tablet/hooks/useVisitLists";
import { useDialysisTracker } from "@/tablet/hooks/useDialysisTracker";
import { useAssignedTiles } from "@/tablet/hooks/useAssignedTiles";
import { DIALYSIS_SESSION_BILLING_QUERY_KEY, loadDialysisBillableSessions } from "@/lib/dialysisSessionBilling";

/** Home dashboard — gradient-iconed module tiles, role-filtered, with quick search. */
export function TabletHome() {
  const navigate = useNavigate();
  const { user, hospitalConfig } = useAuth();
  const [query, setQuery] = useState("");
  const modules = modulesForUser(user ?? undefined);
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
  // Tiles this person was mapped to in the Tile Configuration master. They are
  // lifted to the top of the grid; nothing is hidden if the set is empty.
  const { assigned } = useAssignedTiles();

  /** Pending-work count to badge on a tile, or 0 for tiles that have none. */
  const badgeFor = (moduleId: string) => {
    if (moduleId === "documents") return billing.count;
    if (moduleId === "dialysis") return dialysis.actionCount;
    if (moduleId === "panel-payment-received" && dialysisBillingAlertCount >= 3) return dialysisBillingAlertCount;
    return 0;
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return modules;
    return modules.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q),
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
            title={isDialysisBillingAlert ? `${badge} dialysis billing date${badge === 1 ? "" : "s"} pending` : `${badge} pending item${badge === 1 ? "" : "s"}`}
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
      <TabletWatermark />
      <div className="tablet-no-scrollbar h-full overflow-y-auto p-4 sm:p-6 lg:p-8">
        {/* Centring guard rail — caps width so the dashboard never
            over-stretches on large desktop / 4K monitors. */}
        <div className="mx-auto w-full max-w-[1800px]">
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
