/**
 * Photos of Gaurav's handwritten collection list.
 *
 * Gaurav works the ward off a sheet of paper: patient names down one side, how
 * much to collect from each down the other. That sheet is where the day's
 * collection actually lives, and until it is typed in, it exists nowhere the
 * hospital can see. Avani types it in, and she was doing it from a photo passed
 * around on WhatsApp -- outside the system, unattributed, and gone when the
 * chat scrolled.
 *
 * So the photo is stored where the work is done, against the day it belongs to,
 * with the name of whoever took it. It is deliberately NOT tied to a patient:
 * one sheet lists many, and picking one of them to hang it on would be a lie.
 *
 * Nothing here reads the handwriting. The photo is a source document for a
 * person to type from; the amounts on it are not the record until Avani has
 * entered them against a patient and they have been through the normal
 * collection path.
 */
import { supabase } from "@/integrations/supabase/client";

/** file_uploads.category for these sheets. Their own, so nothing else matches. */
export const VASOOLI_LIST_CATEGORY = "vasooli_collection_list";

const BUCKET = "uploads";
const MAX_FILE_SIZE = 12 * 1024 * 1024;

export interface VasooliListPhoto {
  id: string;
  fileName: string;
  fileUrl: string;
  fileType: string | null;
  storagePath: string | null;
  uploadedAt: string | null;
  /** The hospital the sheet was taken at, kept in notes. */
  hospital: string | null;
  uploadedBy: string | null;
}

const mapRow = (r: any): VasooliListPhoto => ({
  id: r.id,
  fileName: r.file_name ?? "list",
  fileUrl: r.file_url ?? "",
  fileType: r.file_type ?? null,
  storagePath: r.storage_path ?? null,
  uploadedAt: r.created_at ?? null,
  hospital: r.notes ?? null,
  uploadedBy: r.uploaded_by ?? null,
});

/**
 * The sheets photographed for this hospital, newest first.
 *
 * Capped rather than unbounded: Avani needs today's list and yesterday's to
 * check against, not every sheet since the tile was built.
 */
export async function fetchVasooliListPhotos(
  hospital: string | null,
  limit = 12,
): Promise<VasooliListPhoto[]> {
  let q = (supabase as any)
    .from("file_uploads")
    .select("id, file_name, file_url, file_type, storage_path, created_at, notes, uploaded_by")
    .eq("category", VASOOLI_LIST_CATEGORY)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (hospital) q = q.eq("notes", hospital);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

/** Store one photographed sheet. Images and PDFs only, 12 MB like every other upload. */
export async function uploadVasooliListPhoto(input: {
  file: File;
  hospital: string | null;
  uploadedBy: string | null;
}): Promise<void> {
  const { file } = input;
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!file.type.startsWith("image/") && !isPdf) {
    throw new Error("Take a photo, or choose an image or PDF");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("That photo is over 12 MB — take it again at a smaller size");
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `vasooli-lists/${Date.now()}_${crypto.randomUUID()}_${safeName}`;

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (storageError) throw new Error(storageError.message);

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

  const { error: insertError } = await (supabase as any).from("file_uploads").insert({
    file_name: file.name,
    file_url: urlData?.publicUrl || "",
    file_type: file.type || (isPdf ? "application/pdf" : "application/octet-stream"),
    file_size: file.size,
    storage_path: storagePath,
    category: VASOOLI_LIST_CATEGORY,
    // One sheet lists many patients, so it belongs to none of them.
    patient_id: null,
    notes: input.hospital,
    uploaded_by: input.uploadedBy,
  });
  // The row is what makes the photo findable. A file in the bucket with no row
  // is invisible, so take it back out rather than leave it orphaned.
  if (insertError) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw new Error(insertError.message);
  }
}
