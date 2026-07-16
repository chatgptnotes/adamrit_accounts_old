import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { PreauthCase, SelectOption } from "./types";

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mapVisitRow(row: any): PreauthCase {
  return {
    visitUuid: row.id,
    visitId: row.visit_id || "",
    patientUuid: row.patients?.id || "",
    patientName: row.patients?.name || "Unknown",
    patientId: row.patients?.patients_id || "",
    registrationId: row.patients?.registration_id || "",
    yojanaRegistrationId: row.yojana_registration_id || "",
    packageName: row.package_name || "",
    packageAmount: row.package_amount?.toString?.() || "",
    admissionDate: row.admission_date || null,
    dischargeDate: row.discharge_date || null,
    patientType: row.patient_type || null,
    age: row.patients?.age ?? null,
    gender: row.patients?.gender ?? null,
  };
}

export function usePreauthCases(term: string) {
  const { hospitalConfig } = useAuth();
  const hospitalName = hospitalConfig?.name || "";
  const normalized = useMemo(() => normalize(term), [term]);
  const safeTerm = useMemo(() => term.replace(/['",()]/g, ""), [term]);

  return useQuery({
    queryKey: ["tablet-preauth-cases", hospitalName, normalized],
    enabled: normalized.length >= 2 && !!hospitalName,
    staleTime: 1000 * 20,
    queryFn: async (): Promise<PreauthCase[]> => {
      const patientIds = new Set<string>();
      const byVisitId = new Map<string, PreauthCase>();

      const patientQuery = supabase
        .from("patients")
        .select("id")
        .eq("hospital_name", hospitalName)
        .or(`name.ilike.%${safeTerm}%,patients_id.ilike.%${safeTerm}%,registration_id.ilike.%${safeTerm}%`)
        .limit(20);

      const visitQuery = supabase
        .from("visits")
        .select(
          "id, visit_id, yojana_registration_id, package_name, package_amount, admission_date, discharge_date, patient_type, patients!inner(id, name, patients_id, registration_id, age, gender, hospital_name)",
        )
        .eq("patients.hospital_name", hospitalName)
        .or(
          `visit_id.ilike.%${safeTerm}%,yojana_registration_id.ilike.%${safeTerm}%,package_name.ilike.%${safeTerm}%`,
        )
        .order("admission_date", { ascending: false })
        .limit(20);

      const [patientsRes, visitsRes] = await Promise.all([patientQuery, visitQuery]);

      if (patientsRes.error) throw patientsRes.error;
      if (visitsRes.error) throw visitsRes.error;

      for (const patient of patientsRes.data || []) {
        if (patient?.id) patientIds.add(patient.id);
      }

      const patientVisitQuery = patientIds.size
        ? supabase
            .from("visits")
            .select(
              "id, visit_id, yojana_registration_id, package_name, package_amount, admission_date, discharge_date, patient_type, patients!inner(id, name, patients_id, registration_id, age, gender, hospital_name)",
            )
            .eq("patients.hospital_name", hospitalName)
            .in("patient_id", Array.from(patientIds))
            .order("admission_date", { ascending: false })
            .limit(20)
        : null;

      const patientVisitsRes = patientVisitQuery ? await patientVisitQuery : null;
      if (patientVisitsRes?.error) throw patientVisitsRes.error;

      for (const row of visitsRes.data || []) {
        const mapped = mapVisitRow(row);
        if (mapped.visitUuid) byVisitId.set(mapped.visitUuid, mapped);
      }

      for (const row of patientVisitsRes?.data || []) {
        const mapped = mapVisitRow(row);
        if (mapped.visitUuid) byVisitId.set(mapped.visitUuid, mapped);
      }

      return Array.from(byVisitId.values()).sort((a, b) => {
        const left = a.admissionDate || a.dischargeDate || "";
        const right = b.admissionDate || b.dischargeDate || "";
        return String(right).localeCompare(String(left));
      });
    },
  });
}

export function useImplantOptions() {
  return useQuery({
    queryKey: ["tablet-preauth-implants"],
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<SelectOption[]> => {
      const { data, error } = await supabase
        .from("implants")
        .select("id, name, nabh_nabl_rate, non_nabh_nabl_rate, private_rate")
        .order("name");
      if (error) throw error;
      return (data || []).map((row: any) => ({
        value: row.id,
        label: row.name,
        selectedLabel: row.name,
      }));
    },
  });
}

export function usePackageOptions() {
  return useQuery({
    queryKey: ["tablet-preauth-packages"],
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<SelectOption[]> => {
      const [pmjayRes, yojanaRes, cghsRes] = await Promise.all([
        supabase
          .from("pmjay_mjpjay_packages")
          .select("id, treatment_code, treatment_plan")
          .eq("is_active", true)
          .order("treatment_plan"),
        supabase
          .from("yojana_mh_procedures")
          .select("id, procedure_code, package_code, package_name, procedure_name, procedure_label")
          .order("package_name"),
        supabase.from("cghs_surgery").select("id, name").eq("is_active", true).order("name"),
      ]);

      if (pmjayRes.error) throw pmjayRes.error;
      if (yojanaRes.error) throw yojanaRes.error;
      if (cghsRes.error) throw cghsRes.error;

      const pmjay = (pmjayRes.data || [])
        .map((row: any) => ({
          value: row.treatment_plan || row.treatment_code || row.id,
          label: [row.treatment_code, row.treatment_plan].filter(Boolean).join(" - "),
        }))
        .filter((row: SelectOption) => row.label);

      const yojana = (yojanaRes.data || [])
        .map((row: any) => ({
          value: row.package_name || row.procedure_name || row.procedure_label || row.package_code || row.id,
          label: [
            row.procedure_code,
            row.package_name || row.procedure_name || row.procedure_label || row.package_code,
          ]
            .filter(Boolean)
            .join(" - "),
        }))
        .filter((row: SelectOption) => row.label);

      const cghs = (cghsRes.data || []).map((row: any) => ({
        value: row.name,
        label: row.name,
      }));

      const merged = new Map<string, SelectOption>();
      [...yojana, ...pmjay, ...cghs].forEach((opt) => {
        if (!merged.has(opt.label)) merged.set(opt.label, opt);
      });

      return Array.from(merged.values());
    },
  });
}
