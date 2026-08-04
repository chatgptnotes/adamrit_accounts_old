import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface TabletVisit {
  id: string; // visits.id (UUID)
  visitId: string; // visits.visit_id (text)
  patientType: string | null;
  admissionDate: string | null;
  dischargeDate: string | null;
  dischargeMode: string | null;
  isDischarged: boolean | null;
  status: string | null;
  plannedDischargeDate: string | null;
  todaysDischargeMarked: boolean;
  billPaid: boolean | null;
  billingClearedAt: string | null;
  ward: string | null;
  room: string | null;
  doctorName: string | null;
  patientName: string;
  patientUuid: string | null; // patients.id (UUID) — FK for ipd_discharge_summary.patient_id
  patientsId: string | null;
  age: number | null;
  gender: string | null;
}

function mapRow(v: any): TabletVisit {
  return {
    id: v.id,
    visitId: v.visit_id,
    patientType: v.patient_type ?? null,
    admissionDate: v.admission_date ?? null,
    dischargeDate: v.discharge_date ?? null,
    dischargeMode: v.discharge_mode ?? null,
    isDischarged: v.is_discharged ?? null,
    status: v.status ?? null,
    plannedDischargeDate: v.planned_discharge_date ?? null,
    todaysDischargeMarked: Boolean(v.planned_discharge_date),
    billPaid: v.bill_paid ?? null,
    billingClearedAt: v.billing_cleared_at ?? null,
    ward: v.ward_allotted ?? null,
    room: v.room_allotted ?? null,
    doctorName: v.appointment_with ?? null,
    patientName: v.patients?.name ?? "Unknown",
    patientUuid: v.patients?.id ?? null,
    patientsId: v.patients?.patients_id ?? null,
    age: v.patients?.age ?? null,
    gender: v.patients?.gender ?? null,
  };
}

const SELECT =
  "id, visit_id, patient_type, admission_date, discharge_date, discharge_mode, is_discharged, status, planned_discharge_date, bill_paid, billing_cleared_at, ward_allotted, room_allotted, appointment_with, patients!inner(id, name, patients_id, age, gender, hospital_name)";

/** Currently admitted IPD + Emergency visits for the active hospital. */
export function useAdmittedVisits() {
  const { hospitalConfig } = useAuth();
  return useQuery({
    queryKey: ["tablet-admitted-visits", hospitalConfig.name],
    staleTime: 1000 * 30,
    queryFn: async (): Promise<TabletVisit[]> => {
      const { data, error } = await supabase
        .from("visits")
        .select(SELECT)
        .in("patient_type", ["IPD", "IPD (Inpatient)", "Emergency"])
        .is("discharge_date", null)
        .eq("patients.hospital_name", hospitalConfig.name)
        .order("admission_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []).map(mapRow);
    },
  });
}

/** A date N days back and today, in the browser's timezone, as YYYY-MM-DD. */
function dateWindow(days: number) {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - days);
  return { from: iso(from), to: iso(today) };
}

/** Azher's billing worklist: patients discharged in the last week, plus the
 *  ones ticked "Discharge today" in the Arshiya advance statement but not yet
 *  marked off the government portal. Billing happens the moment a patient is
 *  discharged, so the desk needs both — the ones already out and the ones about
 *  to be — and neither may have been cleared by the billing desk yet.
 *
 *  Deliberately does NOT filter on bill_paid or planned_discharge_marked_at.
 *  bill_paid is already true on every recent discharge before billing sees the
 *  patient, and planned_discharge_marked_at is set on a handful of rows in the
 *  whole table — filtering on either returns an empty list. billing_cleared_at,
 *  written only by this tile's "Billing done" button, is the one honest signal.
 *
 *  The window is bounded at both ends because discharge_date holds junk future
 *  values (5202-07-28, 5022-10-03) that an open-ended range would drag in. */
export function useRecentlyDischargedVisits() {
  const { hospitalConfig } = useAuth();
  const { from, to } = dateWindow(7);

  const query = useQuery({
    queryKey: ["tablet-recently-discharged", hospitalConfig.name, from, to],
    staleTime: 30_000,
    queryFn: async (): Promise<TabletVisit[]> => {
      const base = () =>
        supabase
          .from("visits")
          .select(SELECT)
          .in("patient_type", ["IPD", "IPD (Inpatient)", "Emergency"])
          .is("billing_cleared_at", null)
          .eq("patients.hospital_name", hospitalConfig.name);

      const [dischargedRes, plannedRes] = await Promise.all([
        base()
          .gte("discharge_date", from)
          .lte("discharge_date", to)
          .order("discharge_date", { ascending: false }),
        // Still admitted, but planned for discharge today or already overdue —
        // the bill has to be ready by the time they walk out.
        base()
          .is("discharge_date", null)
          .not("planned_discharge_date", "is", null)
          .lte("planned_discharge_date", to)
          .order("planned_discharge_date", { ascending: false }),
      ]);
      if (dischargedRes.error) throw dischargedRes.error;
      if (plannedRes.error) throw plannedRes.error;

      const seen = new Set<string>();
      return [...(dischargedRes.data || []), ...(plannedRes.data || [])].reduce<TabletVisit[]>(
        (rows, row: any) => {
          if (seen.has(row.id)) return rows;
          seen.add(row.id);
          rows.push(mapRow(row));
          return rows;
        },
        [],
      );
    },
  });

  return {
    visits: query.data || [],
    count: query.data?.length || 0,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/**
 * Azher's "Today's Expected Discharge" view: exactly the patients Arshiya has
 * ticked "Discharge today" on the advance-statement tile, live from
 * visits.planned_discharge_date. There is no copy step to go stale — ticking
 * puts a patient here, unticking removes them, and completing the discharge
 * (discharge_date set) drops them off on the next refresh. To cap Supabase
 * usage, it makes its two small reads only while Azhar has this view open and
 * polls once per minute.
 */
export function useTodaysDischarges(enabled: boolean) {
  const { hospitalConfig } = useAuth();
  const { from: today, to } = dateWindow(0);
  const query = useQuery({
    queryKey: ["tablet-todays-discharges", hospitalConfig.name, today],
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 60_000 : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    queryFn: async (): Promise<{ expected: TabletVisit[]; discharged: TabletVisit[] }> => {
      const base = () =>
        supabase
          .from("visits")
          .select(SELECT)
          .in("patient_type", ["IPD", "IPD (Inpatient)", "Emergency"])
          .eq("patients.hospital_name", hospitalConfig.name);

      const [expectedResult, dischargedResult] = await Promise.all([
        base()
          .is("discharge_date", null)
          .or("is_discharged.is.null,is_discharged.eq.false")
          .or("status.is.null,status.neq.discharged")
          .eq("planned_discharge_date", today)
          .order("admission_date", { ascending: true }),
        base()
          .gte("discharge_date", today)
          .lte("discharge_date", to)
          .order("discharge_date", { ascending: false }),
      ]);
      if (expectedResult.error) throw expectedResult.error;
      if (dischargedResult.error) throw dischargedResult.error;

      return {
        expected: (expectedResult.data || []).map(mapRow),
        discharged: (dischargedResult.data || []).map(mapRow),
      };
    },
  });

  return {
    expectedVisits: query.data?.expected || [],
    dischargedVisits: query.data?.discharged || [],
    count: (query.data?.expected.length || 0) + (query.data?.discharged.length || 0),
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

/** ward_allotted holds room_management ids; resolve them to ward names once. */
export function useWardNames() {
  return useQuery({
    queryKey: ["tablet-ward-names"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await supabase
        .from("room_management")
        .select("ward_id, ward_type");
      if (error) throw error;
      const map = new Map<string, string>();
      for (const r of (data || []) as { ward_id: string; ward_type: string | null }[]) {
        if (r.ward_id && r.ward_type?.trim() && !map.has(r.ward_id)) {
          map.set(r.ward_id, r.ward_type.trim());
        }
      }
      return map;
    },
  });
}

/** Recently discharged visits for the active hospital. */
export function useDischargedVisits() {
  const { hospitalConfig } = useAuth();
  return useQuery({
    queryKey: ["tablet-discharged-visits", hospitalConfig.name],
    staleTime: 1000 * 60,
    queryFn: async (): Promise<TabletVisit[]> => {
      const { data, error } = await supabase
        .from("visits")
        .select(SELECT)
        .not("discharge_date", "is", null)
        .in("patient_type", ["IPD", "IPD (Inpatient)", "Emergency"])
        .eq("patients.hospital_name", hospitalConfig.name)
        .order("discharge_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []).map(mapRow);
    },
  });
}
