import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllByIn, fetchAllRows } from "@/utils/fetchAllRows";
import {
  DIRECTOR_HOSPITALS,
  VISIT_METRICS,
  getDateRange,
  type DateRange,
  type DirectorMetric,
  type KpiPeriod,
  type VisitMetricDef,
} from "@/lib/director-metrics";
import type { HospitalType } from "@/types/hospital";

// Untyped client: the generated Supabase types are stale for visits.patient_type and
// for the advance_payment / final_payments tables (see useDirectorKpis).
const sb = supabase as unknown as { from: (table: string) => any };

/** Hard cap so a "This year" drill can't try to render tens of thousands of rows. */
export const MAX_LIST_ROWS = 2000;

export interface DirectorVisitRow {
  kind: "visit";
  key: string;
  /** visits.id (uuid) */
  id: string;
  /** visits.visit_id (text business key used by the billing tables) */
  visitId: string;
  hospital: HospitalType;
  patientId: string | null;
  patientName: string;
  patientsId: string | null;
  age: number | null;
  gender: string | null;
  phone: string | null;
  patientType: string | null;
  visitType: string | null;
  visitDate: string | null;
  admissionDate: string | null;
  dischargeDate: string | null;
  dischargeMode: string | null;
  /** Readable ward name, resolved from room_management; falls back to the raw id. */
  ward: string | null;
  room: string | null;
  doctor: string | null;
  diagnosis: string | null;
  reasonForVisit: string | null;
  corporate: string | null;
  status: string | null;
  billingStatus: string | null;
  treatmentType: string | null;
  /** The date this metric sorts and displays by. */
  date: string | null;
  /** Days admitted: to discharge, or to now while still admitted. */
  stayDays: number | null;
}

export interface DirectorPaymentRow {
  kind: "payment";
  key: string;
  source: "advance" | "final";
  amount: number;
  mode: string | null;
  /** created_at — the column the period actually filters on. */
  receivedAt: string | null;
  visitId: string;
  hospital: HospitalType;
  patientName: string;
  patientsId: string | null;
}

export type DirectorListRowData = DirectorVisitRow | DirectorPaymentRow;

const isDirectorHospital = (v: unknown): v is HospitalType =>
  v === "hope" || v === "ayushman";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: string | null, to: string | null): number | null {
  if (!from) return null;
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

const VISIT_COLUMNS = `
  id, visit_id, patient_type, visit_type, visit_date, admission_date, discharge_date,
  discharge_mode, ward_allotted, room_allotted, appointment_with, reason_for_visit,
  corporate, status, billing_status, treatment_type,
  patients!inner(id, name, patients_id, age, gender, phone, corporate, hospital_name),
  diagnoses!diagnosis_id(name)
`;

/** ward_allotted holds a room_management.ward_id — swap it for the readable ward_type. */
async function resolveWardNames(wardIds: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(wardIds.filter(Boolean)));
  if (unique.length === 0) return {};
  const rows = await fetchAllByIn<{ ward_id: string; ward_type: string | null }>(
    unique,
    (chunk) => sb.from("room_management").select("ward_id, ward_type").in("ward_id", chunk),
  );
  const map: Record<string, string> = {};
  for (const r of rows) {
    if (r.ward_id && r.ward_type) map[r.ward_id] = r.ward_type;
  }
  return map;
}

function mapVisitRow(
  r: any,
  dateCol: VisitMetricDef["dateCol"],
  wardNames: Record<string, string>,
): DirectorVisitRow {
  return {
    kind: "visit",
    key: r.id,
    id: r.id,
    visitId: r.visit_id,
    hospital: r.patients.hospital_name as HospitalType,
    patientId: r.patients?.id ?? null,
    patientName: r.patients?.name ?? "—",
    patientsId: r.patients?.patients_id ?? null,
    age: r.patients?.age ?? null,
    gender: r.patients?.gender ?? null,
    phone: r.patients?.phone ?? null,
    patientType: r.patient_type ?? null,
    visitType: r.visit_type ?? null,
    visitDate: r.visit_date ?? null,
    admissionDate: r.admission_date ?? null,
    dischargeDate: r.discharge_date ?? null,
    dischargeMode: r.discharge_mode ?? null,
    ward: r.ward_allotted ? (wardNames[r.ward_allotted] ?? r.ward_allotted) : null,
    room: r.room_allotted ?? null,
    doctor: r.appointment_with ?? null,
    diagnosis: r.diagnoses?.name ?? null,
    reasonForVisit: r.reason_for_visit ?? null,
    corporate: r.corporate ?? r.patients?.corporate ?? null,
    status: r.status ?? null,
    billingStatus: r.billing_status ?? null,
    treatmentType: r.treatment_type ?? null,
    date: (r[dateCol] as string | null) ?? null,
    stayDays: daysBetween(r.admission_date ?? null, r.discharge_date ?? null),
  };
}

async function fetchVisitRows(
  metric: Exclude<DirectorMetric, "collections">,
  range: DateRange,
): Promise<DirectorVisitRow[]> {
  const def = VISIT_METRICS[metric];

  // Both hospitals in one query — the chips filter client-side, so switching between
  // Hope / Ayushman / Both never refetches. `.in(...)` rather than no filter at all:
  // an unfiltered query would also return rows with a null or legacy hospital_name,
  // and then Both would not equal Hope + Ayushman.
  const raw = await fetchAllRows<any>(
    () =>
      def
        .apply(
          sb.from("visits").select(VISIT_COLUMNS).in("patients.hospital_name", DIRECTOR_HOSPITALS),
          range,
        )
        // `.range()` paging over a non-unique ORDER BY duplicates and drops rows, so
        // every paged query needs a unique tiebreaker.
        .order(def.dateCol, { ascending: def.ascending })
        .order("id", { ascending: true }),
    1000,
    { maxRows: MAX_LIST_ROWS },
  );

  const wardNames = await resolveWardNames(raw.map((r) => r.ward_allotted));

  return raw
    .filter((r) => isDirectorHospital(r.patients?.hospital_name))
    .map((r) => mapVisitRow(r, def.dateCol, wardNames));
}

/**
 * Payment rows behind the Advance / Collections tile. Filters mirror the tile exactly
 * (advances: ACTIVE and not a refund; final payments: unfiltered; both on created_at),
 * so the rendered amounts sum to the number the director tapped.
 */
async function fetchPaymentRows(range: DateRange): Promise<DirectorPaymentRow[]> {
  const [advance, finalPay] = await Promise.all([
    fetchAllRows<any>(() =>
      sb
        .from("advance_payment")
        .select("id, advance_amount, payment_mode, created_at, visit_id, patient_name, patients_id")
        .eq("status", "ACTIVE")
        .eq("is_refund", false)
        .gte("created_at", range.startISO)
        .lt("created_at", range.endISO)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true }),
    ),
    fetchAllRows<any>(() =>
      sb
        .from("final_payments")
        .select("id, amount, mode_of_payment, created_at, visit_id")
        .gte("created_at", range.startISO)
        .lt("created_at", range.endISO)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true }),
    ),
  ]);

  const visitIds = [...advance, ...finalPay]
    .map((r) => r.visit_id)
    .filter((v): v is string => !!v);
  if (visitIds.length === 0) return [];

  // Resolve hospital + patient per visit. Only the visits these payments reference are
  // fetched — pulling every visit per hospital is what silently truncated the tile.
  const visits = await fetchAllByIn<any>(visitIds, (chunk) =>
    sb
      .from("visits")
      .select("visit_id, patients!inner(name, patients_id, hospital_name)")
      .in("patients.hospital_name", DIRECTOR_HOSPITALS)
      .in("visit_id", chunk)
      .order("visit_id", { ascending: true }),
  );
  const byVisit = new Map<string, { hospital: HospitalType; name: string; patientsId: string | null }>();
  for (const v of visits) {
    if (!isDirectorHospital(v.patients?.hospital_name)) continue;
    byVisit.set(v.visit_id, {
      hospital: v.patients.hospital_name as HospitalType,
      name: v.patients?.name ?? "—",
      patientsId: v.patients?.patients_id ?? null,
    });
  }

  const rows: DirectorPaymentRow[] = [];
  for (const r of advance) {
    const v = r.visit_id ? byVisit.get(r.visit_id) : undefined;
    if (!v) continue; // payment for a visit outside Hope/Ayushman — excluded from the tile too
    rows.push({
      kind: "payment",
      // One visit routinely has several advances, so visit_id is not a usable key.
      key: `adv:${r.id}`,
      source: "advance",
      amount: Number(r.advance_amount) || 0,
      mode: r.payment_mode ?? null,
      receivedAt: r.created_at ?? null,
      visitId: r.visit_id,
      hospital: v.hospital,
      patientName: r.patient_name || v.name,
      patientsId: r.patients_id || v.patientsId,
    });
  }
  for (const r of finalPay) {
    const v = r.visit_id ? byVisit.get(r.visit_id) : undefined;
    if (!v) continue;
    rows.push({
      kind: "payment",
      key: `fin:${r.id}`,
      source: "final",
      amount: Number(r.amount) || 0,
      mode: r.mode_of_payment ?? null,
      receivedAt: r.created_at ?? null,
      visitId: r.visit_id,
      hospital: v.hospital,
      patientName: v.name,
      patientsId: v.patientsId,
    });
  }

  rows.sort((a, b) => (b.receivedAt || "").localeCompare(a.receivedAt || ""));
  return rows;
}

/**
 * Rows behind a Director Dashboard tile, across both hospitals.
 *
 * The query key holds only the metric and period — never the selected hospital chip —
 * so switching Hope / Ayushman / Both is pure client-side filtering with no refetch.
 */
export function useDirectorList(metric: DirectorMetric, period: KpiPeriod) {
  const live = metric !== "collections" && VISIT_METRICS[metric].live;
  // Live metrics ignore the period, so it must not vary their cache key either.
  const effectivePeriod: KpiPeriod = live ? "today" : period;

  return useQuery({
    queryKey: ["director-list", metric, effectivePeriod],
    staleTime: 60_000,
    queryFn: async (): Promise<DirectorListRowData[]> => {
      const range = getDateRange(effectivePeriod, "");
      return metric === "collections"
        ? await fetchPaymentRows(range)
        : await fetchVisitRows(metric, range);
    },
  });
}

/**
 * Full visit record for one visit_id. Used by the detail view when it was opened from a
 * payment row, which only carries the visit_id.
 */
export function useVisitDetail(visitId: string | null | undefined) {
  return useQuery({
    queryKey: ["director-list-visit", visitId],
    enabled: !!visitId,
    staleTime: 60_000,
    queryFn: async (): Promise<DirectorVisitRow | null> => {
      const { data, error } = await sb
        .from("visits")
        .select(VISIT_COLUMNS)
        .eq("visit_id", visitId)
        .limit(1);
      if (error) throw error;
      const raw = (data || [])[0];
      if (!raw || !isDirectorHospital(raw.patients?.hospital_name)) return null;
      const wardNames = await resolveWardNames([raw.ward_allotted]);
      return mapVisitRow(raw, "admission_date", wardNames);
    },
  });
}

export interface VisitFinancials {
  advanceTotal: number;
  finalTotal: number;
  billAmount: number | null;
  receivedAmount: number | null;
  outstanding: number | null;
}

/**
 * Money for one visit — advances, final payments and the submitted bill. Fetched lazily,
 * only once a detail view is opened, so the list itself stays a single query.
 */
export function useVisitFinancials(visitId: string | null | undefined) {
  return useQuery({
    queryKey: ["director-list-financials", visitId],
    enabled: !!visitId,
    staleTime: 60_000,
    queryFn: async (): Promise<VisitFinancials> => {
      const [advance, finalPay, prep] = await Promise.all([
        sb
          .from("advance_payment")
          .select("advance_amount")
          .eq("visit_id", visitId)
          .eq("status", "ACTIVE")
          .eq("is_refund", false),
        sb.from("final_payments").select("amount").eq("visit_id", visitId),
        sb
          .from("bill_preparation")
          .select("bill_amount, received_amount, deduction_amount, tds_amount")
          .eq("visit_id", visitId)
          .maybeSingle(),
      ]);
      if (advance.error) throw advance.error;
      if (finalPay.error) throw finalPay.error;
      // A visit with no submitted bill is normal — don't fail the panel over it.

      const bill = prep.error ? null : prep.data;
      const billAmount = bill ? Number(bill.bill_amount) || 0 : null;
      const receivedAmount = bill ? Number(bill.received_amount) || 0 : null;

      return {
        advanceTotal: (advance.data || []).reduce(
          (s: number, r: any) => s + (Number(r.advance_amount) || 0),
          0,
        ),
        finalTotal: (finalPay.data || []).reduce(
          (s: number, r: any) => s + (Number(r.amount) || 0),
          0,
        ),
        billAmount,
        receivedAmount,
        // Matches useBillAgingReport: deductions and TDS are settled, not outstanding.
        outstanding: bill
          ? (Number(bill.bill_amount) || 0) -
            (Number(bill.received_amount) || 0) -
            (Number(bill.deduction_amount) || 0) -
            (Number(bill.tds_amount) || 0)
          : null,
      };
    },
  });
}
