import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { captureGeolocation, geoToDbFields, type GeoCapture } from "@/lib/geotag";
import { stampGeotagOnImage } from "@/lib/geotagImage";
import {
  getRegistrationDocumentDisplayName,
  REGISTRATION_DOCUMENT_CATEGORY,
  REGISTRATION_DOCUMENT_SECTION_LABEL,
} from "@/lib/registrationDocuments";

/** The document tabs shown under a patient profile, in display order. */
export const PATIENT_DOC_CATEGORIES = [
  { id: "treatment_sheet", label: "Treatment Sheet" },
  { id: "monitor_chart", label: "Monitor Chart" },
  { id: "dialysis", label: "Dialysis" },
  { id: "lab_investigation", label: "Lab Investigation" },
  { id: "radiology_investigation", label: "Radiology Investigation" },
  { id: "ot_notes", label: "OT Notes" },
  { id: "ot_photos", label: "OT Photos" },
  { id: "implant_invoice", label: "Implant Invoice" },
  { id: "implant_sticker", label: "Implant Sticker" },
  { id: "discharge_summary", label: "Discharge Summary" },
] as const;

export const DOCUMENTS_AND_PHOTOS_CATEGORIES = [
  ...PATIENT_DOC_CATEGORIES,
  { id: REGISTRATION_DOCUMENT_CATEGORY, label: REGISTRATION_DOCUMENT_SECTION_LABEL },
] as const;

export type PatientDocCategory =
  | (typeof PATIENT_DOC_CATEGORIES)[number]["id"]
  | typeof REGISTRATION_DOCUMENT_CATEGORY
  | "clinic_notes"
  | "advance_image"
  | "discharge_thumb_confirmation"
  | "payment_proof"
  | "referee_feedback"
  | "referee_viji"
  | "patient_feedback";

export interface PatientDoc {
  id: string;
  fileName: string;
  displayName: string;
  fileUrl: string;
  fileType: string | null;
  storagePath: string | null;
  uploadedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  notes?: string | null;
}

const BUCKET = "uploads";

function mapDoc(r: any): PatientDoc {
  return {
    id: r.id,
    fileName: r.file_name ?? "file",
    displayName: getRegistrationDocumentDisplayName(r.category, r.file_name, r.notes),
    fileUrl: r.file_url ?? "",
    fileType: r.file_type ?? null,
    storagePath: r.storage_path ?? null,
    uploadedAt: r.created_at ?? null,
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    notes: r.notes ?? null,
  };
}

/** All uploaded files for a patient in one category, newest first. */
export function usePatientDocs(
  patientId: string | undefined,
  category: PatientDocCategory,
  notesFilter?: string | null,
) {
  return useQuery({
    queryKey: ["tablet-patient-docs", patientId, category, notesFilter ?? null],
    enabled: !!patientId,
    staleTime: 1000 * 15,
    queryFn: async (): Promise<PatientDoc[]> => {
      const buildQuery = (matchNotes: boolean) => {
        let query = supabase
          .from("file_uploads")
          .select("id, file_name, file_url, file_type, storage_path, created_at, latitude, longitude, notes, category")
          .eq("patient_id", patientId)
          .eq("category", category);
        if (matchNotes && notesFilter) query = query.eq("notes", notesFilter);
        return query.order("created_at", { ascending: false });
      };

      if (notesFilter) {
        const exact = await buildQuery(true);
        if (exact.error) throw exact.error;
        if ((exact.data || []).length > 0) return (exact.data || []).map(mapDoc);
      }

      const fallback = await buildQuery(false);
      if (fallback.error) throw fallback.error;
      return (fallback.data || []).map(mapDoc);
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
  placeLabel?: string | null;
  notes?: string | null;
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
    let uploadFile = file;
    let uploadGeo = geo;

    if (file.type.startsWith("image/")) {
      uploadGeo = uploadGeo || await captureGeolocation();
      const stamped = await stampGeotagOnImage(file, uploadGeo, {
        fileName: file.name,
        fileType: file.type,
        placeLabel: meta.placeLabel ?? undefined,
      });
      uploadFile = new File([stamped.blob], stamped.fileName, {
        type: stamped.fileType,
      });
    }

    const sanitizedName = uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `uploads/${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}_${sanitizedName}`;

    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, uploadFile, { contentType: uploadFile.type || "application/octet-stream" });
    if (storageError) throw storageError;

    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(storagePath);

    const { error: insertError } = await supabase.from("file_uploads").insert({
      file_name: uploadFile.name,
      file_url: urlData?.publicUrl || "",
      file_type: uploadFile.type || "application/octet-stream",
      file_size: uploadFile.size,
      storage_path: storagePath,
      category: meta.category,
      patient_id: meta.patientId,
      patient_name: meta.patientName,
      uploaded_by: meta.uploadedBy ?? null,
      notes: meta.notes ?? null,
      ...geoToDbFields(uploadGeo, captureSource),
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
