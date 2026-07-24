import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, History, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAdmittedVisits, type TabletVisit } from "@/tablet/hooks/useVisitLists";
import { useBedBoard, type Bed } from "@/tablet/hooks/useBedBoard";
import { TabletVisitList } from "@/tablet/components/TabletVisitList";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletConfirm } from "@/tablet/components/TabletConfirm";
import { BedBoard, type ColourBy } from "@/tablet/components/BedBoard";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { panelFor } from "@/tablet/lib/panelColors";
import { ShiftHistorySheet, useShiftHistory } from "./ShiftHistorySheet";

/** datetime-local value for "now", in local time. */
function nowLocal(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function placeLabel(bed: Bed | undefined | null): string {
  if (!bed) return "—";
  const room = bed.roomNumber ? ` · Room ${bed.roomNumber}` : "";
  return `${bed.wardType}${room} · Bed ${bed.bedNumber}`;
}

/**
 * Bed Shifting — drag an admitted patient from their current bed onto any free
 * bed. Saving updates visits (the single source every occupancy view derives
 * from) and appends a from → to row to ward_shiftings.
 */
export default function BedShiftingFlow() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { hospitalConfig, user } = useAuth();
  const visits = useAdmittedVisits();

  const [selected, setSelected] = useState<TabletVisit | null>(null);
  const [colourBy, setColourBy] = useState<ColourBy>("status");
  const [target, setTarget] = useState<Bed | null>(null);
  const [shiftAt, setShiftAt] = useState(nowLocal());
  const [remark, setRemark] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const board = useBedBoard(selected?.ward || null);
  const history = useShiftHistory(selected?.id);

  const currentBed =
    selected?.ward && selected?.room
      ? board.data?.bedsById[`${selected.ward}#${String(selected.room).trim()}`]
      : undefined;
  const panel = panelFor(currentBed?.occupant?.corporate);

  const shift = useMutation({
    mutationFn: async () => {
      if (!selected || !target) throw new Error("Select a patient and a free bed");

      // Re-check the destination right before writing — the board may be stale.
      const { data: clash, error: clashErr } = await supabase
        .from("visits")
        .select("id")
        .eq("ward_allotted", target.wardId)
        .eq("room_allotted", target.bedNumber)
        .is("discharge_date", null)
        .limit(1);
      if (clashErr) throw clashErr;
      if ((clash || []).length > 0) {
        throw new Error("That bed was just taken by another patient. Pick another bed.");
      }

      const { data: booking, error: bookErr } = await supabase
        .from("bed_bookings")
        .select("id, visit_id, patient_name")
        .eq("ward_id", target.wardId)
        .eq("bed_number", target.bedNumber)
        .eq("status", "booked")
        .limit(1);
      // A missing bed_bookings table is not fatal — the shift still proceeds.
      if (bookErr) console.warn("bed_bookings check skipped:", bookErr.message);
      const live = (booking || [])[0] as { id: string; visit_id: string | null } | undefined;
      if (live && live.visit_id !== selected.id) {
        throw new Error("That bed is booked for another patient. Pick another bed.");
      }

      const { error: updErr } = await supabase
        .from("visits")
        .update({
          ward_allotted: target.wardId,
          room_allotted: target.bedNumber,
        })
        .eq("id", selected.id);
      if (updErr) throw updErr;

      const { error: histErr } = await supabase.from("ward_shiftings").insert([
        {
          visit_id: selected.id,
          patient_name: selected.patientName,
          hospital_name: hospitalConfig.name,
          shifting_date: new Date(shiftAt).toISOString(),
          // from_ward / shifting_ward stay ward_type NAMES — the desktop
          // Shifting page and FinalBill accommodation generation read them.
          from_ward: currentBed?.wardType || selected.ward || null,
          shifting_ward: target.wardType,
          from_ward_id: currentBed?.wardId || selected.ward || null,
          from_room: currentBed?.roomNumber || null,
          from_bed: currentBed?.bedNumber || selected.room || null,
          to_ward_id: target.wardId,
          to_room: target.roomNumber,
          to_bed: target.bedNumber,
          remark: remark.trim() || null,
          shifted_by: user?.email || user?.username || null,
        },
      ]);
      if (histErr) throw histErr;

      if (live) {
        await supabase
          .from("bed_bookings")
          .update({ status: "converted" })
          .eq("id", live.id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tablet-bed-board"] });
      qc.invalidateQueries({ queryKey: ["tablet-admitted-visits"] });
      qc.invalidateQueries({ queryKey: ["tablet-occupancy"] });
      qc.invalidateQueries({ queryKey: ["tablet-ward-occupancy"] });
      qc.invalidateQueries({ queryKey: ["tablet-shift-history"] });
      qc.invalidateQueries({ queryKey: ["ward-shiftings"] });
      qc.invalidateQueries({ queryKey: ["visits"] });
    },
  });

  if (!selected) {
    return (
      <TabletVisitList
        visits={visits.data || []}
        loading={visits.isLoading}
        error={visits.isError}
        onSelect={(v) => {
          setSelected(v);
          setTarget(null);
          setRemark("");
          setShiftAt(nowLocal());
        }}
        emptyText="No admitted patients."
        metaKind="admitted"
      />
    );
  }

  if (shift.isSuccess && target) {
    return (
      <TabletConfirm
        status="success"
        title="Patient shifted"
        message={`${selected.patientName} is now in ${placeLabel(target)}. The old bed is free again.`}
        primaryAction={{
          label: "Shift another patient",
          onClick: () => {
            shift.reset();
            setSelected(null);
            setTarget(null);
          },
        }}
        secondaryAction={{ label: "Back to Home", onClick: () => navigate("/") }}
      />
    );
  }

  return (
    <FlowScaffold
      heading="Bed Shifting"
      subheading="Drag the patient onto any empty (red) bed"
      actions={
        <>
          <TabletButton
            variant="outline"
            className="flex-1"
            onClick={() => {
              setSelected(null);
              setTarget(null);
            }}
          >
            Change patient
          </TabletButton>
          <TabletButton
            variant="outline"
            className="flex-1"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="mr-2 h-5 w-5" />
            History ({history.data?.length ?? 0})
          </TabletButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-bold">{selected.patientName}</h3>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-bold",
                    panel.badge,
                  )}
                >
                  {panel.short}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                UHID {selected.patientsId || "—"} · Registration ID{" "}
                {selected.visitId || "—"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="rounded-xl bg-muted px-3 py-2 text-sm font-semibold"
            >
              Shifted {history.data?.length ?? 0}× this admission
            </button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              { label: "Current ward", value: currentBed?.wardType || selected.ward || "—" },
              {
                label: "Current room",
                value: currentBed?.roomNumber ? `Room ${currentBed.roomNumber}` : "—",
              },
              { label: "Current bed", value: selected.room || "—" },
            ].map((f) => (
              <div key={f.label} className="rounded-xl bg-muted px-3 py-2">
                <p className="text-xs font-medium text-muted-foreground">{f.label}</p>
                <p className="font-semibold">{f.value}</p>
              </div>
            ))}
          </div>
          {!currentBed ? (
            <p className="mt-3 rounded-xl bg-amber-100 px-3 py-2 text-sm font-medium text-amber-800">
              This patient has no bed assigned yet — tap any empty bed to place them.
            </p>
          ) : null}
        </div>

        {board.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : board.isError ? (
          <p className="py-10 text-center text-destructive">
            Could not load the bed board.
          </p>
        ) : (
          <BedBoard
            groups={board.data?.groups || []}
            colourBy={colourBy}
            onColourByChange={setColourBy}
            draggableVisitUuid={selected.id}
            targetBedId={target?.id}
            onSelectBed={(bed) => {
              setTarget(bed);
              setShiftAt(nowLocal());
            }}
          />
        )}
      </div>

      <Dialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open) {
            setTarget(null);
            shift.reset();
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm bed shift</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-lg bg-muted px-2 py-1 font-medium">
                {placeLabel(currentBed)}
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="rounded-lg bg-emerald-100 px-2 py-1 font-medium text-emerald-800">
                {placeLabel(target)}
              </span>
            </div>
            <div>
              <TabletLabel htmlFor="shift_at">Shift date &amp; time</TabletLabel>
              <TabletInput
                id="shift_at"
                type="datetime-local"
                value={shiftAt}
                onChange={(e) => setShiftAt(e.target.value)}
              />
            </div>
            <div>
              <TabletLabel htmlFor="shift_remark">Remark</TabletLabel>
              <TabletInput
                id="shift_remark"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="Optional"
              />
            </div>
            {shift.isError ? (
              <p className="text-destructive">
                {(shift.error as Error)?.message || "Could not save the shift."}
              </p>
            ) : null}
            <div className="flex gap-3">
              <TabletButton
                variant="outline"
                className="flex-1"
                onClick={() => setTarget(null)}
                disabled={shift.isPending}
              >
                Cancel
              </TabletButton>
              <TabletButton
                className="flex-1"
                onClick={() => shift.mutate()}
                disabled={shift.isPending}
              >
                {shift.isPending ? "Saving…" : "Save shift"}
              </TabletButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ShiftHistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        patientName={selected.patientName}
        rows={history.data || []}
        loading={history.isLoading}
      />
    </FlowScaffold>
  );
}
