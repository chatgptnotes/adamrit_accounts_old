import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ShiftRow {
  id: string;
  shifting_date: string | null;
  created_at: string | null;
  from_ward: string | null;
  shifting_ward: string;
  from_ward_id: string | null;
  from_room: string | null;
  from_bed: string | null;
  to_ward_id: string | null;
  to_room: string | null;
  to_bed: string | null;
  remark: string | null;
  shifted_by: string | null;
}

/** All shift records for a visit, newest first. */
export function useShiftHistory(visitUuid: string | null | undefined) {
  return useQuery({
    queryKey: ["tablet-shift-history", visitUuid],
    enabled: !!visitUuid,
    queryFn: async (): Promise<ShiftRow[]> => {
      const { data, error } = await supabase
        .from("ward_shiftings")
        .select("*")
        .eq("visit_id", visitUuid as string)
        .order("shifting_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ShiftRow[];
    },
  });
}

function stamp(row: ShiftRow): string {
  const value = row.shifting_date || row.created_at;
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "General Ward · Room 22 · Bed 3" — parts missing on legacy rows show as —. */
function place(ward: string | null, room: string | null, bed: string | null): string {
  const parts = [ward || "—", room ? `Room ${room}` : null, `Bed ${bed || "—"}`].filter(
    Boolean,
  );
  return parts.join(" · ");
}

interface ShiftHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientName: string;
  rows: ShiftRow[];
  loading: boolean;
}

/** Complete bed-shifting history for the current admission. */
export function ShiftHistorySheet({
  open,
  onOpenChange,
  patientName,
  rows,
  loading,
}: ShiftHistorySheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Shift history — {patientName}
            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-sm font-semibold text-muted-foreground">
              {rows.length} shift{rows.length === 1 ? "" : "s"}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">
              No shifts recorded for this admission yet.
            </p>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="rounded-xl border p-3">
                <p className="text-sm font-semibold text-muted-foreground">
                  {stamp(row)}
                  {row.shifted_by ? ` · ${row.shifted_by}` : ""}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-lg bg-muted px-2 py-1 font-medium">
                    {place(row.from_ward, row.from_room, row.from_bed)}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <span className="rounded-lg bg-emerald-100 px-2 py-1 font-medium text-emerald-800">
                    {place(row.shifting_ward, row.to_room, row.to_bed)}
                  </span>
                </div>
                {row.remark ? (
                  <p className="mt-1.5 text-sm text-muted-foreground">{row.remark}</p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
