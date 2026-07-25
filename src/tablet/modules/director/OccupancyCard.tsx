import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, BedDouble, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { useOccupancy } from "@/hooks/useOccupancy";
import type { HospitalType } from "@/types/hospital";

interface OccupancyCardProps {
  /** Read this hospital's occupancy instead of the logged-in one. */
  hospital?: HospitalType;
  /** Hospital-aware drill (switches context when needed). Falls back to plain navigate. */
  onOpen?: () => void;
}

/** Compact ward occupancy summary — links to the full /occupancy module. */
export function OccupancyCard({ hospital, onOpen }: OccupancyCardProps = {}) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useOccupancy(hospital);
  const open = onOpen ?? (() => navigate("/occupancy"));

  const topWards = useMemo(() => {
    if (!data) return [];
    return [...data.wards]
      .filter((w) => w.capacity > 0)
      .map((w) => ({ ...w, ratio: w.capacity > 0 ? w.occupied / w.capacity : 0 }))
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 3);
  }, [data]);

  const overallPct =
    data && data.totalCapacity > 0
      ? Math.round((data.totalOccupied / data.totalCapacity) * 100)
      : 0;

  return (
    <TabletCard
      interactive
      onClick={open}
      className="space-y-3"
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BedDouble className="h-5 w-5 text-sky-600" />
          <h3 className="text-base font-semibold">Bed occupancy</h3>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="text-sm text-destructive">Failed to load occupancy.</div>
      ) : !data || data.totalCapacity === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">
          No ward data
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-border bg-card/60 p-3 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Occupied
              </div>
              <div className="mt-1 text-xl font-bold">{data.totalOccupied}</div>
            </div>
            <div className="rounded-xl border border-border bg-card/60 p-3 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Capacity
              </div>
              <div className="mt-1 text-xl font-bold">{data.totalCapacity}</div>
            </div>
            <div className="rounded-xl border border-border bg-card/60 p-3 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Overall
              </div>
              <div className="mt-1 text-xl font-bold">{overallPct}%</div>
            </div>
          </div>

          {topWards.length > 0 && (
            <ul className="space-y-1.5">
              {topWards.map((w) => {
                const pct = Math.round(w.ratio * 100);
                const tone =
                  pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500";
                return (
                  <li key={w.id} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate font-medium">{w.wardType}</span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {w.occupied}/{w.capacity} · {pct}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-border/50">
                      <div
                        className={cn("h-full rounded-full transition-all", tone)}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {data.unassigned > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {data.unassigned} admitted patient
              {data.unassigned === 1 ? "" : "s"} not assigned to a ward
            </div>
          )}
        </>
      )}
    </TabletCard>
  );
}
