import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, BedDouble, Loader2, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOccupancy, type WardOccupancy } from "@/hooks/useOccupancy";
import { PatientTypeBadge } from "@/tablet/components/PatientTypeBadge";
import { TabletCard } from "@/tablet/ui/TabletCard";

function occupancyColor(occupied: number, capacity: number): string {
  if (capacity <= 0) return "bg-slate-400";
  const ratio = occupied / capacity;
  if (ratio >= 1) return "bg-rose-500";
  if (ratio >= 0.75) return "bg-amber-500";
  return "bg-emerald-500";
}

/** Module 8 — live bed occupancy board (read-only). */
export default function OccupancyBoard() {
  const [params] = useSearchParams();
  // The director dashboard shows both hospitals, so it links here with ?hospital=<slug>
  // to see the other one's beds without switching the logged-in hospital. Defaults to
  // the logged-in hospital when absent.
  const hospital = params.get("hospital");
  const { data, isLoading, error } = useOccupancy(
    hospital === "hope" || hospital === "ayushman" ? hospital : undefined,
  );
  const [ward, setWard] = useState<WardOccupancy | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-destructive">
        Could not load occupancy. Check the connection.
      </div>
    );
  }

  if (ward) {
    return (
      <div className="tablet-no-scrollbar h-full overflow-y-auto p-4">
        <button
          type="button"
          onClick={() => setWard(null)}
          className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All wards
        </button>
        <h2 className="text-xl font-bold">{ward.wardType}</h2>
        <p className="mb-4 text-muted-foreground">
          {ward.location || "—"} · {ward.occupied}/{ward.capacity} occupied
        </p>
        {ward.occupants.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">
            No patients currently in this ward.
          </p>
        ) : (
          <div className="space-y-3">
            {ward.occupants.map((o) => (
              <TabletCard key={o.visitId} className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold">{o.name}</p>
                    <PatientTypeBadge type={o.patientType} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Visit {o.visitId} · Room {o.room || "—"}
                  </p>
                </div>
              </TabletCard>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="tablet-no-scrollbar h-full overflow-y-auto p-4">
      <div className="mb-4 grid grid-cols-3 gap-3">
        <TabletCard className="text-center">
          <p className="text-3xl font-bold">{data.totalOccupied}</p>
          <p className="text-sm text-muted-foreground">Admitted</p>
        </TabletCard>
        <TabletCard className="text-center">
          <p className="text-3xl font-bold">{data.totalCapacity}</p>
          <p className="text-sm text-muted-foreground">Total beds</p>
        </TabletCard>
        <TabletCard className="text-center">
          <p className="text-3xl font-bold">{data.unassigned}</p>
          <p className="text-sm text-muted-foreground">Unassigned</p>
        </TabletCard>
      </div>

      {data.wards.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">
          No wards configured for this hospital.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.wards.map((w) => (
            <TabletCard
              key={w.id}
              interactive
              onClick={() => setWard(w)}
              className="flex items-center gap-3"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                <BedDouble className="h-6 w-6 text-sky-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{w.wardType}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {w.location || "—"}
                </p>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full", occupancyColor(w.occupied, w.capacity))}
                    style={{
                      width: `${Math.min(100, w.capacity ? (w.occupied / w.capacity) * 100 : 0)}%`,
                    }}
                  />
                </div>
              </div>
              <span className="text-lg font-bold">
                {w.occupied}/{w.capacity}
              </span>
            </TabletCard>
          ))}
        </div>
      )}
    </div>
  );
}
