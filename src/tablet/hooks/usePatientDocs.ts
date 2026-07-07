import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { geoToDbFields, type GeoCapture } from "@/lib/geotag";

/** The document tabs shown under a patient profile, in display order. */
export const PATIENT_DOC_CATEGORIES = [
  { id: "treatment_sheet", label: "Treatment Sheet" },
  { id: "monitor_chart", label: "Monitor Chart" },
  { id: "lab_investigation", label: "Lab Investigation" },
  { id: "radiology_investigation", label: "Radiology Investigation" },
  { id: "ot_notes", label: "OT Notes" },
  { id: "ot_photos", label: "OT Photos" },
  { id: "implant_invoice", label: "Implant Invoice" },
  { id: "implant_sticker", label: "Implant Sticker" },
] as const;

export type PatientDocCategory =
  (typeof PATIENT_DOC_CATEGORIES)[number]["id"];

export interface PatientDoc {
  id: string;
  fileName: string;
  fileUrl: string;
  fileType: string | null;
  storagePath: string | null;
  uploadedAt: string | null;
  latitude: number | null;
  longitude: number | null;
}

const BUCKET = "uploads";

function mapDoc(r: any): PatientDoc {
  return {
    id: r.id,
    fileName: r.file_name ?? "file",
    fileUrl: r.file_url ?? "",
    fileType: r.file_type ?? null,
    storagePath: r.storage_path ?? null,
    uploadedAt: r.created_at ?? null,
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
  };
}

/** All uploaded files for a patient in one category, newest first. */
export function usePatientDocs(
  patientId: string | undefined,
  category: PatientDocCategory,
) {
  return useQuery({
    queryKey: ["tablet-patient-docs", patientId, category],
    enabled: !!patientId,
    staleTime: 1000 * 15,
    queryFn: async (): Promise<PatientDoc[]> => {
      const { data, error } = await supabase
        .from("file_uploads")
        .select("id, file_name, file_url, file_type, storage_path, created_at, latitude, longitude")
        .eq("patient_id", patientId)
        .eq("category", category)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapDoc);
    },
  });
}

export interface PatientDocUploadItem {
  file: File;
  geo?: GeoCapture | null;
  captureSource?: "in_app_camera" | "file_picker";
}

interface UploadMeta {
  patientId: string;
  patientName: string | null;
  category: PatientDocCategory;
  uploadedBy?: string | null;
}

/**
 * Upload one or more files to the `uploads` bucket and record each in
 * `file_uploads`, tagged to the patient + category. Mirrors the write pattern
 * in src/components/CameraUpload.tsx. Throws on the first failure.
 */
export async function uploadPatientDocs(
  items: File[] | PatientDocUploadItem[],
  meta: UploadMeta,
): Promise<void> {
  const normalized: PatientDocUploadItem[] = items.map((item) =>
    item instanceof File ? { file: item, captureSource: "file_picker" } : item,
  );

  for (const { file, geo = null, captureSource = geo ? "in_app_camera" : "file_picker" } of normalized) {
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `uploads/${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}_${sanitizedName}`;

    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file);
    if (storageError) throw storageError;

    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(storagePath);

    const { error: insertError } = await supabase.from("file_uploads").insert({
      file_name: file.name,
      file_url: urlData?.publicUrl || "",
      file_type: file.type || "application/octet-stream",
      file_size: file.size,
      storage_path: storagePath,
      category: meta.category,
      patient_id: meta.patientId,
      patient_name: meta.patientName,
      uploaded_by: meta.uploadedBy ?? null,
      ...geoToDbFields(geo, captureSource),
    });
    if (insertError) throw insertError;
  }
}

/** Remove a file from storage and delete its file_uploads row. */
export async function deletePatientDoc(doc: PatientDoc): Promise<void> {
  if (doc.storagePath) {
    await supabase.storage.from(BUCKET).remove([doc.storagePath]);
  }
  const { error } = await supabase
    .from("file_uploads")
    .delete()
    .eq("id", doc.id);
  if (error) throw error;
}
