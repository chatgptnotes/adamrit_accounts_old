import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { modulesForUser } from "@/tablet/config/modules";
import { TabletWatermark } from "@/tablet/components/TabletWatermark";

/** Home dashboard — gradient-iconed module tiles, role-filtered, with quick search. */
export function TabletHome() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const modules = modulesForUser(user ?? undefined);

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
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {filtered.map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => navigate(`/${m.id}`, { viewTransition: true })}
                    className="tablet-tile tablet-glass flex min-h-[148px] flex-col gap-2 rounded-2xl p-4 text-left sm:min-h-[156px] sm:p-5"
                  >
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
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
