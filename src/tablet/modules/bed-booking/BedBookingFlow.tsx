import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useBedBoard, type Bed } from "@/tablet/hooks/useBedBoard";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { BedBoard, type ColourBy } from "@/tablet/components/BedBoard";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";

function nowLocal(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function bedLabel(bed: Bed | null): string {
  if (!bed) return "—";
  const room = bed.roomNumber ? ` · Room ${bed.roomNumber}` : "";
  return `${bed.wardType}${room} · Bed ${bed.bedNumber}`;
}

/**
 * Bed Booking — reserve a free bed for an incoming patient. Booked beds render
 * orange everywhere and the Bed Shifting board refuses to drop a patient on them
 * until the booking is released or converted.
 */
export default function BedBookingFlow() {
  const qc = useQueryClient();
  const { hospitalConfig, user } = useAuth();
  const board = useBedBoard();

  const [colourBy, setColourBy] = useState<ColourBy>("status");
  const [bed, setBed] = useState<Bed | null>(null);
  const [patientName, setPatientName] = useState("");
  const [patientsId, setPatientsId] = useState("");
  const [bookedFrom, setBookedFrom] = useState(nowLocal());
  const [bookedUntil, setBookedUntil] = useState("");
  const [remark, setRemark] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tablet-bed-board"] });
    qc.invalidateQueries({ queryKey: ["tablet-occupancy"] });
  };

  const closeSheet = () => {
    setBed(null);
    setPatientName("");
    setPatientsId("");
    setBookedFrom(nowLocal());
    setBookedUntil("");
    setRemark("");
    bookMutation.reset();
    releaseMutation.reset();
  };

  const bookMutation = useMutation({
    mutationFn: async () => {
      if (!bed) throw new Error("Pick a bed");
      if (!patientName.trim()) throw new Error("Enter the patient name");
      const { error } = await supabase.from("bed_bookings").insert([
        {
          hospital_name: hospitalConfig.name,
          ward_id: bed.wardId,
          bed_number: bed.bedNumber,
          patient_name: patientName.trim(),
          patients_id: patientsId.trim() || null,
          booked_from: new Date(bookedFrom).toISOString(),
          booked_until: bookedUntil ? new Date(bookedUntil).toISOString() : null,
          remark: remark.trim() || null,
          created_by: user?.email || user?.username || null,
        },
      ]);
      if (error) {
        throw new Error(
          error.code === "23505"
            ? "That bed was just booked by someone else."
            : error.message,
        );
      }
    },
    onSuccess: () => {
      invalidate();
      closeSheet();
    },
  });

  const releaseMutation = useMutation({
    mutationFn: async () => {
      if (!bed?.booking) throw new Error("No booking on this bed");
      const { error } = await supabase
        .from("bed_bookings")
        .update({ status: "released" })
        .eq("id", bed.booking.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      closeSheet();
    },
  });

  return (
    <FlowScaffold
      heading="Bed Booking"
      subheading="Tap an empty (red) bed to reserve it · tap an orange bed to release"
    >
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
          targetBedId={bed?.id}
          selectAnyBed
          onSelectBed={(b) => {
            if (b.status === "occupied") return;
            setBed(b);
            setBookedFrom(nowLocal());
          }}
        />
      )}

      <Dialog open={!!bed} onOpenChange={(open) => (open ? null : closeSheet())}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {bed?.status === "booked" ? "Booked bed" : "Book bed"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="rounded-xl bg-muted px-3 py-2 font-semibold">
              {bedLabel(bed)}
            </p>

            {bed?.status === "booked" ? (
              <>
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">Patient: </span>
                    <span className="font-semibold">{bed.booking?.patientName}</span>
                  </p>
                  {bed.booking?.patientsId ? (
                    <p>
                      <span className="text-muted-foreground">UHID: </span>
                      {bed.booking.patientsId}
                    </p>
                  ) : null}
                  <p>
                    <span className="text-muted-foreground">From: </span>
                    {bed.booking?.bookedFrom
                      ? new Date(bed.booking.bookedFrom).toLocaleString("en-IN")
                      : "—"}
                  </p>
                  {bed.booking?.bookedUntil ? (
                    <p>
                      <span className="text-muted-foreground">Until: </span>
                      {new Date(bed.booking.bookedUntil).toLocaleString("en-IN")}
                    </p>
                  ) : null}
                  {bed.booking?.remark ? (
                    <p className="text-muted-foreground">{bed.booking.remark}</p>
                  ) : null}
                </div>
                {releaseMutation.isError ? (
                  <p className="text-destructive">
                    {(releaseMutation.error as Error)?.message ||
                      "Could not release the booking."}
                  </p>
                ) : null}
                <div className="flex gap-3">
                  <TabletButton variant="outline" className="flex-1" onClick={closeSheet}>
                    Close
                  </TabletButton>
                  <TabletButton
                    className="flex-1"
                    onClick={() => releaseMutation.mutate()}
                    disabled={releaseMutation.isPending}
                  >
                    {releaseMutation.isPending ? "Releasing…" : "Release booking"}
                  </TabletButton>
                </div>
              </>
            ) : (
              <>
                <div>
                  <TabletLabel htmlFor="book_name">Patient name *</TabletLabel>
                  <TabletInput
                    id="book_name"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    placeholder="Incoming patient"
                  />
                </div>
                <div>
                  <TabletLabel htmlFor="book_uhid">UHID</TabletLabel>
                  <TabletInput
                    id="book_uhid"
                    value={patientsId}
                    onChange={(e) => setPatientsId(e.target.value)}
                    placeholder="Optional — for an already registered patient"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <TabletLabel htmlFor="book_from">Booked from *</TabletLabel>
                    <TabletInput
                      id="book_from"
                      type="datetime-local"
                      value={bookedFrom}
                      onChange={(e) => setBookedFrom(e.target.value)}
                    />
                  </div>
                  <div>
                    <TabletLabel htmlFor="book_until">Booked until</TabletLabel>
                    <TabletInput
                      id="book_until"
                      type="datetime-local"
                      value={bookedUntil}
                      onChange={(e) => setBookedUntil(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <TabletLabel htmlFor="book_remark">Remark</TabletLabel>
                  <TabletInput
                    id="book_remark"
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
                {bookMutation.isError ? (
                  <p className="text-destructive">
                    {(bookMutation.error as Error)?.message || "Could not book the bed."}
                  </p>
                ) : null}
                <div className="flex gap-3">
                  <TabletButton
                    variant="outline"
                    className="flex-1"
                    onClick={closeSheet}
                    disabled={bookMutation.isPending}
                  >
                    Cancel
                  </TabletButton>
                  <TabletButton
                    className="flex-1"
                    onClick={() => bookMutation.mutate()}
                    disabled={bookMutation.isPending}
                  >
                    {bookMutation.isPending ? "Booking…" : "Book bed"}
                  </TabletButton>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </FlowScaffold>
  );
}
