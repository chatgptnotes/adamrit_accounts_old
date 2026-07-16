import { useQuery } from "@tanstack/react-query";
import type { SearchableSelectOption } from "@/components/ui/searchable-select";
import type { Patient } from "@/components/PatientLookup/types/patientLookup";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { PreauthCase } from "@/tablet/modules/preauth/types";

type PatientRow = {
  id?: string | null;
  name?: string | null;
  patients_id?: string | null;
  age?: number | null;
  gender?: string | null;
  created_at?: string | null;
  hospital_name?: string | null;
};

const normalize = (value: string | null | undefined) => (value || "").trim();

export function usePreauthCases(searchTerm: string) {
  const { hospitalConfig } = useAuth();
  const term = searchTerm.trim().toLowerCase();

  return useQuery({
    queryKey: ["tablet-preauth-cases", hospitalConfig.name, term],
    staleTime: 1000 * 30,
    queryFn: async (): Promise<PreauthCase[]> => {
      let patientQuery = supabase
        .from("patients")
        .select("id, name, patients_id, age, gender, created_at, hospital_name")
        .eq("hospital_name", hospitalConfig.name)
        .order("created_at", { ascending: false });

      if (term) {
        patientQuery = patientQuery.or(
          `name.ilike.%${term}%,patients_id.ilike.%${term}%`,
        );
      }

      const { data: patients, error: patientError } = await patientQuery.limit(term ? 50 : 25);
      if (patientError) throw patientError;

      return ((patients || []) as PatientRow[])
        .map((patient) => ({
          visitUuid: "",
          visitId: "",
          patientUuid: normalize(patient.id),
          patientName: normalize(patient.name),
          patientId: normalize(patient.patients_id),
          registrationId: normalize(patient.patients_id),
          yojanaRegistrationId: "",
          packageName: "",
          admissionDate: "",
          dischargeDate: "",
          surgeryDate: "",
          age: typeof patient.age === "number" ? patient.age : null,
          gender: normalize(patient.gender),
        }) satisfies PreauthCase)
        .filter((item) => item.patientName && item.patientUuid)
        .slice(0, 25);
    },
  });
}

export function useImplantOptions() {
  return useQuery({
    queryKey: ["tablet-implant-options"],
    staleTime: 1000 * 60 * 10,
    queryFn: async (): Promise<SearchableSelectOption[]> => {
      const { data, error } = await supabase
        .from("visits")
        .select("package_name")
        .not("package_name", "is", null)
        .order("package_name")
        .limit(200);

      if (error) throw error;

      const seen = new Set<string>();
      const options: SearchableSelectOption[] = [];

      for (const row of (data || []) as Array<{ package_name?: string | null }>) {
        const value = row.package_name?.trim();
        if (!value) continue;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        options.push({ value, label: value });
      }

      return options;
    },
  });
}

export async function fetchLatestPreauthCaseForPatient(
  patient: Pick<Patient, "id" | "name" | "patients_id" | "age" | "gender">,
): Promise<PreauthCase | null> {
  const { data: visit, error } = await supabase
    .from("visits")
    .select(
      "id, patient_id, visit_id, yojana_registration_id, package_name, admission_date, discharge_date, surgery_date, created_at",
    )
    .eq("patient_id", patient.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!visit?.id) return null;

  return {
    visitUuid: normalize(visit.id),
    visitId: normalize(visit.visit_id),
    patientUuid: normalize(patient.id),
    patientName: normalize(patient.name),
    patientId: normalize(patient.patients_id),
    registrationId: normalize(patient.patients_id),
    yojanaRegistrationId: normalize(visit.yojana_registration_id),
    packageName: normalize(visit.package_name),
    admissionDate: normalize(visit.admission_date),
    dischargeDate: normalize(visit.discharge_date),
    surgeryDate: normalize(visit.surgery_date),
    age: typeof patient.age === "number" ? patient.age : null,
    gender: normalize(patient.gender),
  };
}
