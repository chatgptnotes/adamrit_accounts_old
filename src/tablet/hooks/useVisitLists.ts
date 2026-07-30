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
  plannedDischargeDate: string | null;
  billPaid: boolean | null;
  ward: string | null;
  room: string | null;
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
    plannedDischargeDate: v.planned_discharge_date ?? null,
    billPaid: v.bill_paid ?? null,
    ward: v.ward_allotted ?? null,
    room: v.room_allotted ?? null,
    patientName: v.patients?.name ?? "Unknown",
    patientUuid: v.patients?.id ?? null,
    patientsId: v.patients?.patients_id ?? null,
    age: v.patients?.age ?? null,
    gender: v.patients?.gender ?? null,
  };
}

const SELECT =
  "id, visit_id, patient_type, admission_date, discharge_date, discharge_mode, planned_discharge_date, bill_paid, ward_allotted, room_allotted, patients!inner(id, name, patients_id, age, gender, hospital_name)";

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

/** "Today" in the browser's timezone, matched against planned_discharge_date. */
function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The billing desk's worklist — patients discharged but not yet billed, plus the
 *  ones planned for discharge today. Billing happens straight after discharge, so
 *  these are the patients Azher must be intimated about.
 *
 *  The discharged half requires planned_discharge_marked_at, which scopes it to
 *  visits that actually went through the discharge worklist — without it the query
 *  dredges up the whole legacy backlog of visits that never had bill_paid written.
 *  These filters mirror pendingBillingRows in AdvanceFlow.tsx; keep them in step or
 *  the two screens will show different counts. */
export function useBillingWorklist() {
  const { hospitalConfig } = useAuth();
  const today = todayIso();

  const discharged = useQuery({
    queryKey: ["tablet-billing-worklist-discharged", hospitalConfig.name],
    staleTime: 30_000,
    queryFn: async (): Promise<TabletVisit[]> => {
      const { data, error } = await supabase
        .from("visits")
        .select(SELECT)
        .eq("patient_type", "IPD")
        .not("discharge_date", "is", null)
        .not("planned_discharge_marked_at", "is", null)
        .not("bill_paid", "is", true)
        .eq("patients.hospital_name", hospitalConfig.name)
        .order("discharge_date", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapRow);
    },
  });

  const plannedToday = useQuery({
    queryKey: ["tablet-billing-worklist-planned", hospitalConfig.name, today],
    staleTime: 30_000,
    queryFn: async (): Promise<TabletVisit[]> => {
      const { data, error } = await supabase
        .from("visits")
        .select(SELECT)
        .eq("patient_type", "IPD")
        .eq("planned_discharge_date", today)
        .is("discharge_date", null)
        .eq("patients.hospital_name", hospitalConfig.name)
        .order("admission_date", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapRow);
    },
  });

  return {
    discharged: discharged.data || [],
    plannedToday: plannedToday.data || [],
    count: (discharged.data?.length || 0) + (plannedToday.data?.length || 0),
    isLoading: discharged.isLoading || plannedToday.isLoading,
    isError: discharged.isError || plannedToday.isError,
  };
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
