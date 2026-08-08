import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { uploadPatientDocs } from "@/tablet/hooks/usePatientDocs";

/**
 * Patient feedback photos and videos.
 *
 * These ride the existing `file_uploads` table and the public `uploads`
 * bucket — the caption lives in `notes` and this category separates them from
 * every other per-patient attachment, so no new table or bucket is needed.
 */
export const PATIENT_FEEDBACK_CATEGORY = "patient_feedback" as const;

/**
 * Supabase rejects an oversize object with an opaque error, so the guard is
 * here where the message can name the file and its size.
 */
export const MAX_FEEDBACK_FILE_BYTES = 50 * 1024 * 1024;

/** Newest-first cap for the combined "All feedback" view. */
const ALL_FEEDBACK_LIMIT = 200;

export interface PatientFeedbackItem {
  id: string;
  fileName: string;
  fileUrl: string;
  fileType: string | null;
  patientId: string | null;
  patientName: string | null;
  caption: string | null;
  uploadedBy: string | null;
  createdAt: string | null;
}

function mapItem(r: any): PatientFeedbackItem {
  return {
    id: r.id,
    fileName: r.file_name ?? "file",
    fileUrl: r.file_url ?? "",
    fileType: r.file_type ?? null,
    patientId: r.patient_id ?? null,
    patientName: r.patient_name ?? null,
    caption: r.notes ?? null,
    uploadedBy: r.uploaded_by ?? null,
    createdAt: r.created_at ?? null,
  };
}

/**
 * Feedback for one patient, or — when no patient id is given — the combined
 * feed across every patient, newest first.
 */
export function usePatientFeedbackList(patientId?: string) {
  return useQuery({
    queryKey: ["patient-feedback", patientId ?? "all"],
    staleTime: 1000 * 15,
    queryFn: async (): Promise<PatientFeedbackItem[]> => {
      let query = supabase
        .from("file_uploads")
        .select(
          "id, file_name, file_url, file_type, patient_id, patient_name, notes, uploaded_by, created_at",
        )
        .eq("category", PATIENT_FEEDBACK_CATEGORY)
        .order("created_at", { ascending: false });

      if (patientId) {
        query = query.eq("patient_id", patientId);
      } else {
        query = query.limit(ALL_FEEDBACK_LIMIT);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map(mapItem);
    },
  });
}

export function isFeedbackVideo(fileType: string | null | undefined) {
  return !!fileType?.startsWith("video/");
}

export function isFeedbackImage(fileType: string | null | undefined) {
  return !!fileType?.startsWith("image/");
}

interface UploadFeedbackArgs {
  files: File[];
  patientId: string;
  patientName: string | null;
  caption: string;
  uploadedBy?: string | null;
}

/**
 * Validate then hand the files to the shared uploader, which stamps a geotag
 * on images and passes video straight through.
 */
export async function uploadPatientFeedback({
  files,
  patientId,
  patientName,
  caption,
  uploadedBy,
}: UploadFeedbackArgs): Promise<void> {
  for (const file of files) {
    if (!isFeedbackImage(file.type) && !isFeedbackVideo(file.type)) {
      throw new Error(`${file.name} is not a photo or a video.`);
    }
    if (file.size > MAX_FEEDBACK_FILE_BYTES) {
      const mb = Math.round(file.size / (1024 * 1024));
      throw new Error(`${file.name} is ${mb} MB — the limit is 50 MB.`);
    }
  }

  await uploadPatientDocs(files, {
    patientId,
    patientName,
    category: PATIENT_FEEDBACK_CATEGORY,
    uploadedBy: uploadedBy ?? null,
    notes: caption.trim() || null,
  });
}
