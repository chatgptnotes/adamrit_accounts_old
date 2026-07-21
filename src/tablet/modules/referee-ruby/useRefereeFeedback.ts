import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { uploadPatientDocs } from "@/tablet/hooks/usePatientDocs";

/** Append-only feedback row — how a patient came to know about the hospital. */
export interface RefereeFeedbackRow {
  id: string;
  visit_uuid: string | null;
  visit_id: string | null;
  patient_name: string | null;
  how_they_knew: string | null;
  created_by: string | null;
  created_at: string;
}

const table = () => (supabase as any).from("referee_feedback");

export interface VisitReferralRow {
  id: string; // visits.id (UUID)
  visitId: string | null; // visits.visit_id
  patientType: string | null;
  admissionDate: string | null;
  opdDate: string | null;
  patientName: string;
  patientUuid: string | null;
  patientsId: string | null;
  age: number | null;
  gender: string | null;
  referee: string | null; // referees.name
  relationshipManager: string | null; // relationship_managers.name
}

const VISIT_SELECT = `
  id,
  visit_id,
  patient_type,
  admission_date,
  created_at,
  patients!inner (
    id,
    name,
    patients_id,
    age,
    gender,
    hospital_name
  ),
  referees:referring_doctor_id ( name ),
  relationship_managers:relationship_manager_id ( name )
`;

function mapVisit(v: any): VisitReferralRow {
  const p = v.patients;
  return {
    id: v.id,
    visitId: v.visit_id ?? null,
    patientType: v.patient_type ?? null,
    admissionDate: v.admission_date ?? null,
    opdDate: v.created_at ?? null,
    patientName: p?.name ?? "Unknown",
    patientUuid: p?.id ?? null,
    patientsId: p?.patients_id ?? null,
    age: p?.age ?? null,
    gender: p?.gender ?? null,
    referee: v.referees?.name ?? null,
    relationshipManager: v.relationship_managers?.name ?? null,
  };
}

/**
 * Recent OPD visits + recent admissions for the active hospital, with the
 * referee + relationship manager surfaced. Limit is split so a busy hospital
 * never starves one list for the other.
 */
export function useReferralVisits(limitPerType = 50) {
  const { hospitalConfig } = useAuth();
  return useQuery({
    queryKey: ["referee-ruby-visits", hospitalConfig.name, limitPerType],
    staleTime: 1000 * 30,
    queryFn: async (): Promise<VisitReferralRow[]> => {
      const [adm, opd] = await Promise.all([
        supabase
          .from("visits")
          .select(VISIT_SELECT)
          .not("admission_date", "is", null)
          .eq("patients.hospital_name", hospitalConfig.name)
          .order("admission_date", { ascending: false })
          .limit(limitPerType),
        supabase
          .from("visits")
          .select(VISIT_SELECT)
          .in("patient_type", ["OPD", "OPD (Outpatient)"])
          .eq("patients.hospital_name", hospitalConfig.name)
          .order("created_at", { ascending: false })
          .limit(limitPerType),
      ]);
      if (adm.error) throw adm.error;
      if (opd.error) throw opd.error;

      const merged = [...(adm.data || []), ...(opd.data || [])];
      // De-dupe by visit UUID (a visit could in theory match both filters).
      const seen = new Set<string>();
      const rows = merged
        .filter((v) => {
          if (seen.has(v.id)) return false;
          seen.add(v.id);
          return true;
        })
        .map(mapVisit);

      // Newest first: prefer admission_date, then opd created_at.
      rows.sort((a, b) => {
        const ax = new Date(a.admissionDate || a.opdDate || 0).getTime();
        const bx = new Date(b.admissionDate || b.opdDate || 0).getTime();
        return bx - ax;
      });
      return rows;
    },
  });
}

/** All referee feedback rows (newest first), grouped by visit UUID for easy lookup. */
export function useRefereeFeedback() {
  return useQuery({
    queryKey: ["referee-ruby-feedback"],
    staleTime: 1000 * 15,
    queryFn: async (): Promise<Record<string, RefereeFeedbackRow[]>> => {
      const { data, error } = await table()
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const grouped: Record<string, RefereeFeedbackRow[]> = {};
      for (const row of (data || []) as RefereeFeedbackRow[]) {
        const key = row.visit_uuid || row.visit_id || "";
        (grouped[key] ||= []).push(row);
      }
      return grouped;
    },
  });
}

export interface AddFeedbackArgs {
  visitUuid: string;
  visitId: string | null;
  patientName: string;
  howTheyKnew: string;
  patientUuid?: string | null;
}

export function useRefereeFeedbackActions() {
  const qc = useQueryClient();
  const { user } = useAuth();

  const addFeedback = async (args: AddFeedbackArgs) => {
    const { error } = await table().insert({
      visit_uuid: args.visitUuid,
      visit_id: args.visitId ?? null,
      patient_name: args.patientName ?? null,
      how_they_knew: args.howTheyKnew.trim(),
      created_by: user?.email || user?.username || null,
    });
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["referee-ruby-feedback"] });
  };

  const uploadFeedbackFiles = async (
    files: File[],
    args: { patientId: string; patientName: string },
  ) => {
    await uploadPatientDocs(files, {
      patientId: args.patientId,
      patientName: args.patientName,
      category: "referee_feedback",
      uploadedBy: user?.email || user?.username || null,
    });
    await qc.invalidateQueries({ queryKey: ["referee-feedback-docs", args.patientId] });
  };

  return { addFeedback, uploadFeedbackFiles };
}