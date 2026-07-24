import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { BedDouble, GripVertical, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { panelFor, PANEL_LEGEND } from "@/tablet/lib/panelColors";
import type { Bed, WardGroup } from "@/tablet/hooks/useBedBoard";

export type ColourBy = "status" | "panel";

/** Red = empty, green = occupied, orange = booked (product-defined). */
const STATUS_FILL: Record<Bed["status"], string> = {
  available: "bg-rose-500 text-white border-rose-600",
  occupied: "bg-emerald-600 text-white border-emerald-700",
  booked: "bg-orange-500 text-white border-orange-600",
};

const STATUS_LEGEND: { label: string; className: string }[] = [
  { label: "Empty", className: STATUS_FILL.available },
  { label: "Occupied", className: STATUS_FILL.occupied },
  { label: "Booked", className: STATUS_FILL.booked },
];

function bedFill(bed: Bed, colourBy: ColourBy): string {
  if (colourBy === "panel" && bed.status === "occupied") {
    return cn(panelFor(bed.occupant?.corporate).fill, "border-black/10");
  }
  return STATUS_FILL[bed.status];
}

function bedCaption(bed: Bed): string {
  if (bed.status === "occupied") return bed.occupant?.patientName || "Occupied";
  if (bed.status === "booked") return `Booked · ${bed.booking?.patientName || ""}`.trim();
  return "Available";
}

interface BedTileProps {
  bed: Bed;
  colourBy: ColourBy;
  /** The visit whose chip can be dragged out of its bed. */
  draggableVisitUuid?: string | null;
  /** Bed is highlighted as the pending destination. */
  isTarget: boolean;
  /** A move is armed (drag or tap), so free beds should stand out. */
  isArmed: boolean;
  onTap: (bed: Bed) => void;
}

function BedTile({
  bed,
  colourBy,
  draggableVisitUuid,
  isTarget,
  isArmed,
  onTap,
}: BedTileProps) {
  const droppable = useDroppable({
    id: bed.id,
    disabled: bed.status !== "available",
  });

  const isDraggableOccupant =
    bed.status === "occupied" &&
    !!draggableVisitUuid &&
    bed.occupant?.visitUuid === draggableVisitUuid;

  const draggable = useDraggable({
    id: `patient:${bed.id}`,
    disabled: !isDraggableOccupant,
  });

  const panel = bed.status === "occupied" ? panelFor(bed.occupant?.corporate) : null;

  return (
    <button
      type="button"
      ref={droppable.setNodeRef}
      onClick={() => onTap(bed)}
      className={cn(
        "relative flex h-24 w-full flex-col justify-between rounded-xl border-2 p-2 text-left transition-all",
        bedFill(bed, colourBy),
        bed.status === "available" && isArmed && "ring-2 ring-offset-1 ring-rose-300",
        droppable.isOver && "scale-[1.03] ring-4 ring-white ring-offset-2 ring-offset-primary",
        isTarget && "ring-4 ring-primary ring-offset-2",
        isDraggableOccupant && "ring-2 ring-white",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide opacity-90">
          <BedDouble className="h-3.5 w-3.5" />
          {bed.bedNumber}
        </span>
        {panel && colourBy === "status" ? (
          <span className="rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-slate-800">
            {panel.short}
          </span>
        ) : null}
      </div>

      {isDraggableOccupant ? (
        <span
          ref={draggable.setNodeRef}
          {...draggable.listeners}
          {...draggable.attributes}
          onClick={(e) => {
            // The chip sits inside the bed button — handle the tap once.
            e.stopPropagation();
            onTap(bed);
          }}
          className={cn(
            "flex cursor-grab items-center gap-1 rounded-lg bg-white/95 px-1.5 py-1 text-[11px] font-bold text-slate-900 active:cursor-grabbing",
            draggable.isDragging && "opacity-40",
          )}
        >
          <GripVertical className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate">{bed.occupant?.patientName}</span>
        </span>
      ) : (
        <span className="line-clamp-2 text-[11px] font-semibold leading-tight opacity-95">
          {bedCaption(bed)}
        </span>
      )}
    </button>
  );
}

interface BedBoardProps {
  groups: WardGroup[];
  colourBy: ColourBy;
  onColourByChange: (value: ColourBy) => void;
  /** Visit whose patient chip is draggable (Bed Shifting). */
  draggableVisitUuid?: string | null;
  /** Fired when the patient is dropped on — or a bed is tapped into — a free bed. */
  onSelectBed: (bed: Bed) => void;
  /** Bed currently pending confirmation. */
  targetBedId?: string | null;
  /** Also fire onSelectBed for occupied / booked beds (Bed Booking detail view). */
  selectAnyBed?: boolean;
}

/**
 * Ward → room → bed grid with drag-and-drop. Shared by the Bed Shifting and Bed
 * Booking tiles. Purely presentational: it never writes to the database.
 */
export function BedBoard({
  groups,
  colourBy,
  onColourByChange,
  draggableVisitUuid,
  onSelectBed,
  targetBedId,
  selectAnyBed,
}: BedBoardProps) {
  const [dragging, setDragging] = useState<string | null>(null);
  // Tap fallback: tap the patient chip's bed to arm, then tap a free bed.
  const [armed, setArmed] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 6 },
    }),
  );

  const bedsById = useMemo(() => {
    const map: Record<string, Bed> = {};
    groups.forEach((g) =>
      g.rooms.forEach((r) => r.beds.forEach((b) => (map[b.id] = b))),
    );
    return map;
  }, [groups]);

  const draggedName = dragging ? bedsById[dragging]?.occupant?.patientName : null;

  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) return;
    const bed = bedsById[overId];
    if (bed && bed.status === "available") onSelectBed(bed);
  };

  const handleTap = (bed: Bed) => {
    if (bed.status === "available") {
      if (armed || !draggableVisitUuid || selectAnyBed) {
        setArmed(false);
        onSelectBed(bed);
      }
      return;
    }
    if (
      draggableVisitUuid &&
      bed.status === "occupied" &&
      bed.occupant?.visitUuid === draggableVisitUuid
    ) {
      setArmed((a) => !a);
      return;
    }
    if (selectAnyBed) onSelectBed(bed);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => setDragging(String(e.active.id).replace(/^patient:/, ""))}
      onDragCancel={() => setDragging(null)}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {(colourBy === "status" ? STATUS_LEGEND : []).map((l) => (
              <span key={l.label} className="flex items-center gap-1.5 text-xs font-semibold">
                <span className={cn("h-3.5 w-3.5 rounded", l.className)} />
                {l.label}
              </span>
            ))}
            {colourBy === "panel"
              ? PANEL_LEGEND.map((p) => (
                  <span key={p.key} className="flex items-center gap-1.5 text-xs font-semibold">
                    <span className={cn("h-3.5 w-3.5 rounded", p.fill)} />
                    {p.short}
                  </span>
                ))
              : null}
          </div>
          <div className="flex items-center gap-1 rounded-xl bg-muted p-1">
            <span className="px-2 text-xs font-semibold text-muted-foreground">
              Colour by
            </span>
            {(["status", "panel"] as ColourBy[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onColourByChange(value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-semibold capitalize",
                  colourBy === value
                    ? "bg-card text-foreground shadow"
                    : "text-muted-foreground",
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        {armed ? (
          <p className="rounded-xl bg-primary/10 px-3 py-2 text-sm font-semibold text-primary">
            Now tap an empty (red) bed to move the patient there.
          </p>
        ) : null}

        {groups.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">
            No wards or beds configured for this hospital.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="rounded-2xl border bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-base font-bold">{group.label}</h3>
                <span className="text-sm text-muted-foreground">
                  {group.occupied}/{group.totalBeds} occupied
                </span>
              </div>
              <div className="space-y-3">
                {group.rooms.map((room) => (
                  <div key={room.wardId}>
                    <p className="mb-1.5 text-sm font-semibold text-muted-foreground">
                      {room.label}
                    </p>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8">
                      {room.beds.map((bed) => (
                        <BedTile
                          key={bed.id}
                          bed={bed}
                          colourBy={colourBy}
                          draggableVisitUuid={draggableVisitUuid}
                          isTarget={targetBedId === bed.id}
                          isArmed={armed || !!dragging}
                          onTap={handleTap}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <DragOverlay>
        {draggedName ? (
          <span className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground shadow-lg">
            <User className="h-4 w-4" />
            {draggedName}
          </span>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
