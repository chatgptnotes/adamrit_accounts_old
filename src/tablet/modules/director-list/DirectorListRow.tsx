import { CalendarDays, ChevronRight, User, Wallet } from "lucide-react";
import { HOSPITAL_CONFIGS, type HospitalType } from "@/types/hospital";
import { PatientTypeBadge } from "@/tablet/components/PatientTypeBadge";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { inr, shortDate } from "@/tablet/lib/format";
import type { DirectorListRowData } from "./useDirectorList";

/** "Hope" / "Ayushman" — the first word of the configured full name. */
export const shortLabel = (h: HospitalType) => HOSPITAL_CONFIGS[h].fullName.split(" ")[0];

export const HOSPITAL_TINT: Record<HospitalType, string> = {
  hope: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  ayushman: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
};

export function HospitalChip({ hospital }: { hospital: HospitalType }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${HOSPITAL_TINT[hospital]}`}
    >
      {shortLabel(hospital)}
    </span>
  );
}

/** One tappable row in a director drill list. Opens the full-screen detail view. */
export function DirectorListRow({
  row,
  onOpen,
}: {
  row: DirectorListRowData;
  onOpen: () => void;
}) {
  if (row.kind === "payment") {
    return (
      <TabletCard interactive onClick={onOpen} className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
          <Wallet className="h-6 w-6 text-emerald-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold">{row.patientName}</p>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              {row.source === "advance" ? "Advance" : "Final"}
            </span>
            <HospitalChip hospital={row.hospital} />
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {row.patientsId || row.visitId}
            {row.mode ? ` · ${row.mode}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="font-semibold">{inr(row.amount)}</p>
          <p className="text-xs text-muted-foreground">{shortDate(row.receivedAt)}</p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      </TabletCard>
    );
  }

  const bed = [row.ward, row.room].filter(Boolean).join(" / ");

  return (
    <TabletCard interactive onClick={onOpen} className="flex items-center gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <User className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold">{row.patientName}</p>
          <PatientTypeBadge type={row.patientType} />
          <HospitalChip hospital={row.hospital} />
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {row.patientsId || row.visitId} · {row.age ?? "—"}/{row.gender || "—"}
          {bed ? ` · ${bed}` : ""}
        </p>
        {row.doctor ? (
          <p className="truncate text-xs text-muted-foreground">{row.doctor}</p>
        ) : null}
      </div>
      <div className="text-right">
        <p className="flex items-center gap-1 text-sm font-medium">
          <CalendarDays className="h-4 w-4" />
          {shortDate(row.date)}
        </p>
        {row.stayDays != null ? (
          <p className="text-xs text-muted-foreground">
            {row.stayDays} {row.stayDays === 1 ? "day" : "days"}
          </p>
        ) : null}
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
    </TabletCard>
  );
}
