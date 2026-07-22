import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BedDouble, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { inr, shortDate } from "@/tablet/lib/format";
import {
  CORRECTION_COMMENT_STATUS,
  EXTRA_PACKAGE_STATUS,
  STATUS_ORDER,
  getPaymentStatus,
  parseExtraPackage,
  statusMeta,
  toNumber,
  type PaymentStatus,
} from "@/tablet/lib/vasooli";

interface ChargeRow {
  visitUuid: string;
  visitId: string;
  patientName: string;
  uhid: string;
  room: string;
  /** Date the extra charge was recorded; admission date when never assessed. */
  date: string | null;
  extraCharge: number;
  amountPaid: number;
  pendingAmount: number;
  paymentStatus: PaymentStatus;
}

const chunk = <T,>(items: T[], size = 350): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

async function fetchByValues(table: string, select: string, column: string, values: string[]) {
  const uniqueValues = [...new Set(values.filter(Boolean))];
  if (uniqueValues.length === 0) return [];
  const results = await Promise.all(
    chunk(uniqueValues).map(async (part) => {
      const { data, error } = await supabase
        .from(table as any)
        .select(select)
        .in(column, part);
      if (error) throw error;
      return data || [];
    }),
  );
  return results.flat();
}

/** Day key (YYYY-MM-DD) in local time, so grouping matches the ward's calendar. */
function dayKey(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const offset = parsed.getTimezoneOffset();
  return new Date(parsed.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

async function loadPrivateRoomCharges(hospitalName: string): Promise<ChargeRow[]> {
  // Private wards come from room_management per hospital — never a hardcoded
  // room list, which would be wrong for every tenant but the one it was
  // written for.
  // Restricted to the six Second Floor private rooms from the Private Room
  // Master. select('*') + client-side filter keeps this resilient if the
  // room_number/is_private columns aren't present yet.
  const ALLOWED_PRIVATE_ROOMS = ["22", "24", "26", "27", "28", "29"];
  const { data: wards, error: wardError } = await supabase
    .from("room_management")
    .select("*")
    .eq("hospital_name", hospitalName);
  if (wardError) throw wardError;

  const privateRooms = (wards || []).filter((ward: any) =>
    ALLOWED_PRIVATE_ROOMS.includes(String(ward.room_number ?? "").trim()),
  );

  // visits.ward_allotted stores `ward_id || ward_type` (see IcuAdmissionFlow),
  // so both forms have to be matched.
  const wardKeys = [
    ...privateRooms.map((ward: any) => String(ward.ward_id || "")),
    ...privateRooms.map((ward: any) => String(ward.ward_type || "")),
  ].filter(Boolean);
  if (wardKeys.length === 0) return [];

  const visits = await fetchByValues(
    "visits",
    "id, visit_id, patient_id, admission_date, visit_date, discharge_date, ward_allotted, room_allotted, patients!inner(id, name, patients_id, hospital_name)",
    "ward_allotted",
    wardKeys,
  );

  const admitted = visits.filter((visit: any) => {
    const patient = Array.isArray(visit.patients) ? visit.patients[0] : visit.patients;
    return !visit.discharge_date && patient?.hospital_name === hospitalName;
  });
  if (admitted.length === 0) return [];

  const visitKeys = [
    ...admitted.map((visit: any) => String(visit.visit_id || "")),
    ...admitted.map((visit: any) => String(visit.id || "")),
  ].filter(Boolean);

  // Same records Gaurav writes from the Vasooli tile — read, never re-entered.
  const advances = await fetchByValues(
    "advance_payment",
    "id, visit_id, advance_amount, returned_amount, is_refund, payment_date, reference_number, remarks, status, created_at",
    "visit_id",
    visitKeys,
  );

  const rows: ChargeRow[] = [];
  for (const visit of admitted) {
    const patient = Array.isArray(visit.patients) ? visit.patients[0] : visit.patients;
    const visitPaymentKeys = new Set(
      [String(visit.visit_id || ""), String(visit.id || "")].filter(Boolean),
    );

    const ledger = advances
      .filter((payment: any) => visitPaymentKeys.has(String(payment.visit_id || "")))
      .sort(
        (left: any, right: any) =>
          new Date(right.payment_date || right.created_at || 0).getTime() -
          new Date(left.payment_date || left.created_at || 0).getTime(),
      );

    const latestExtra = ledger.find(
      (payment: any) => String(payment.status || "") === EXTRA_PACKAGE_STATUS,
    );
    const extraCharge = latestExtra ? parseExtraPackage(latestExtra) : 0;

    const amountPaid = ledger
      .filter((payment: any) => {
        const status = String(payment.status || "");
        return status !== EXTRA_PACKAGE_STATUS && status !== CORRECTION_COMMENT_STATUS;
      })
      .reduce((sum: number, payment: any) => {
        const amount = toNumber(payment.advance_amount);
        return sum + (payment.is_refund ? -Math.abs(amount) : amount);
      }, 0);

    rows.push({
      visitUuid: String(visit.id || ""),
      visitId: String(visit.visit_id || visit.id || ""),
      patientName: patient?.name || "-",
      uhid: patient?.patients_id || "-",
      room: String(visit.room_allotted || "").trim() || "-",
      date:
        latestExtra?.payment_date ||
        latestExtra?.created_at ||
        visit.admission_date ||
        visit.visit_date ||
        null,
      extraCharge,
      amountPaid,
      pendingAmount: Math.max(extraCharge - amountPaid, 0),
      paymentStatus: getPaymentStatus(extraCharge, amountPaid),
    });
  }

  return rows.sort((left, right) => {
    const dateDiff = (dayKey(right.date) || "").localeCompare(dayKey(left.date) || "");
    if (dateDiff !== 0) return dateDiff;
    if (STATUS_ORDER[left.paymentStatus] !== STATUS_ORDER[right.paymentStatus]) {
      return STATUS_ORDER[left.paymentStatus] - STATUS_ORDER[right.paymentStatus];
    }
    return right.pendingAmount - left.pendingAmount;
  });
}

export default function PrivateRoomChargesReenaFlow() {
  const { hospitalConfig } = useAuth();
  const [bed, setBed] = useState<string>("");

  const charges = useQuery({
    queryKey: ["tablet-private-room-charges-reena", hospitalConfig.name],
    queryFn: () => loadPrivateRoomCharges(hospitalConfig.name),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const rows = useMemo(() => charges.data || [], [charges.data]);

  // Bed options are whatever private rooms actually hold patients, sorted
  // numerically so 9 does not sort after 22.
  const bedOptions = useMemo(() => {
    const seen = [...new Set(rows.map((row) => row.room).filter((room) => room && room !== "-"))];
    return seen.sort((left, right) => {
      const leftNum = Number(left);
      const rightNum = Number(right);
      if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) return leftNum - rightNum;
      return left.localeCompare(right);
    });
  }, [rows]);

  const filteredRows = useMemo(
    () => (bed ? rows.filter((row) => row.room === bed) : rows),
    [rows, bed],
  );

  const groups = useMemo(() => {
    const byDate = new Map<string, ChargeRow[]>();
    for (const row of filteredRows) {
      const key = dayKey(row.date);
      const bucket = byDate.get(key);
      if (bucket) bucket.push(row);
      else byDate.set(key, [row]);
    }
    return [...byDate.entries()];
  }, [filteredRows]);

  const totals = useMemo(
    () => ({
      patients: filteredRows.length,
      charge: filteredRows.reduce((sum, row) => sum + row.extraCharge, 0),
      paid: filteredRows.reduce((sum, row) => sum + row.amountPaid, 0),
      pending: filteredRows.reduce((sum, row) => sum + row.pendingAmount, 0),
    }),
    [filteredRows],
  );

  return (
    <FlowScaffold
      heading="Private Room Extra Charges - Reena"
      subheading="Date-wise extra charges for private beds, synced from Payment Collection (Vasooli)"
      actions={
        <TabletButton
          variant="outline"
          className="flex-1"
          onClick={() => charges.refetch()}
          disabled={charges.isFetching}
        >
          {charges.isFetching ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-5 w-5" />
          )}
          Refresh
        </TabletButton>
      }
    >
      <div className="space-y-4">
        <TabletCard variant="flat" className="space-y-3">
          <div className="flex items-center gap-2">
            <BedDouble className="h-5 w-5 text-indigo-600" />
            <span className="text-sm font-semibold">Filter by bed number</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterChip label="All beds" active={!bed} onClick={() => setBed("")} />
            {bedOptions.map((option) => (
              <FilterChip
                key={option}
                label={option}
                active={bed === option}
                onClick={() => setBed(bed === option ? "" : option)}
              />
            ))}
          </div>
          {bedOptions.length === 0 && !charges.isLoading ? (
            <p className="text-sm text-muted-foreground">
              No private beds are currently occupied.
            </p>
          ) : null}
        </TabletCard>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile label="Patients" value={String(totals.patients)} />
          <SummaryTile label="Extra Charge" value={inr(totals.charge)} />
          <SummaryTile label="Amount Paid" value={inr(totals.paid)} />
          <SummaryTile label="Pending" value={inr(totals.pending)} />
        </div>

        {charges.isLoading ? (
          <TabletCard variant="flat" className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading private room charges…</span>
          </TabletCard>
        ) : null}

        {charges.isError ? (
          <TabletCard variant="flat" className="border-red-200 bg-red-50">
            <p className="text-sm font-semibold text-red-700">
              Unable to load private room charges.
            </p>
            <p className="mt-1 text-sm text-red-600">
              {(charges.error as Error)?.message || "Please retry."}
            </p>
          </TabletCard>
        ) : null}

        {!charges.isLoading && !charges.isError && groups.length === 0 ? (
          <TabletCard variant="flat">
            <p className="text-sm text-muted-foreground">
              {bed
                ? `No private room extra charges found for bed ${bed}.`
                : "No private room extra charges found."}
            </p>
          </TabletCard>
        ) : null}

        {groups.map(([date, dateRows]) => (
          <div key={date || "undated"} className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-bold">
                {date ? shortDate(date) : "Date not recorded"}
              </h3>
              <span className="text-xs text-muted-foreground">
                {dateRows.length} patient{dateRows.length === 1 ? "" : "s"}
              </span>
            </div>
            {dateRows.map((row) => (
              <ChargeCard key={row.visitUuid} row={row} />
            ))}
          </div>
        ))}
      </div>
    </FlowScaffold>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-w-[64px] rounded-full border px-4 py-2 text-sm font-semibold transition-colors active:scale-[0.98]",
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "bg-background hover:bg-muted/60",
      )}
    >
      {label}
    </button>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <TabletCard variant="flat" className="py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold tracking-tight">{value}</p>
    </TabletCard>
  );
}

function ChargeCard({ row }: { row: ChargeRow }) {
  const meta = statusMeta(row.paymentStatus);
  return (
    <TabletCard variant="flat" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-bold">{row.patientName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.uhid} · Bed {row.room}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-semibold",
            meta.className,
          )}
        >
          {meta.label}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Figure label="Extra Charge" value={inr(row.extraCharge)} />
        <Figure label="Amount Paid" value={inr(row.amountPaid)} />
        <Figure
          label="Pending"
          value={inr(row.pendingAmount)}
          className={row.pendingAmount > 0 ? "text-red-600" : undefined}
        />
      </div>
    </TabletCard>
  );
}

function Figure({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-sm font-bold", className)}>{value}</p>
    </div>
  );
}
