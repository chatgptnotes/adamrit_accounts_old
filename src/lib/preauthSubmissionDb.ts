import { supabase } from '@/integrations/supabase/client';
import type { ExtractedPreauthCase } from '@/lib/extractPreauthSubmissionList';

const db = supabase as any;

export type PreauthSubmissionStatus = 'pending' | 'submitted';
export type PreauthListType = 'to_be_submitted' | 'pending';

export interface PreauthSubmissionRow {
  id: string;
  uploadId: string;
  patientName: string;
  ageLabel: string;
  gender: string;
  programId: string;
  registrationId: string;
  registrationDate: string;
  status: PreauthSubmissionStatus;
  createdAt: string;
}

export interface PreauthSubmissionUpload {
  id: string;
  fileName: string;
  imageUrl: string;
  uploadedBy: string | null;
  createdAt: string;
  rows: PreauthSubmissionRow[];
}

type DbUploadRow = {
  id: string;
  file_name: string;
  image_url: string;
  uploaded_by: string | null;
  list_type: PreauthListType;
  created_at: string;
};

type DbCaseRow = {
  id: string;
  upload_id: string;
  patient_name: string | null;
  age_label: string | null;
  gender: string | null;
  program_id: string | null;
  registration_id: string | null;
  registration_date: string | null;
  status: string;
  created_at: string;
};

const mapRow = (row: DbCaseRow): PreauthSubmissionRow => ({
  id: row.id,
  uploadId: row.upload_id,
  patientName: row.patient_name || '',
  ageLabel: row.age_label || '',
  gender: row.gender || '',
  programId: row.program_id || '',
  registrationId: row.registration_id || '',
  registrationDate: row.registration_date || '',
  status: (row.status as PreauthSubmissionStatus) || 'pending',
  createdAt: row.created_at,
});

// Upload the screenshot to storage, then save the upload record + AI-extracted
// case rows in one call. Storage failure aborts before any DB write.
export async function savePreauthSubmissionUpload(
  file: File,
  cases: ExtractedPreauthCase[],
  uploadedBy: string | null,
  listType: PreauthListType = 'to_be_submitted',
): Promise<PreauthSubmissionUpload> {
  const safeName = file.name.replace(/[^a-z0-9.\-_]/gi, '_');
  const path = `preauth-${listType}/${Date.now()}-${safeName}`;
  const { error: uploadError } = await supabase.storage.from('uploads').upload(path, file, {
    upsert: false,
    cacheControl: '3600',
  });
  if (uploadError) throw uploadError;
  const { data: publicUrlData } = supabase.storage.from('uploads').getPublicUrl(path);

  const { data: uploadRow, error: insertUploadError } = await db
    .from('government_portal_preauth_uploads')
    .insert({
      file_name: file.name,
      image_url: publicUrlData.publicUrl,
      uploaded_by: uploadedBy,
      list_type: listType,
    })
    .select('*')
    .single();
  if (insertUploadError) throw insertUploadError;

  const { data: caseRows, error: insertRowsError } = await db
    .from('government_portal_preauth_rows')
    .insert(
      cases.map(c => ({
        upload_id: uploadRow.id,
        patient_name: c.patientName || null,
        age_label: c.ageLabel || null,
        gender: c.gender || null,
        program_id: c.programId || null,
        registration_id: c.registrationId || null,
        registration_date: c.registrationDate || null,
      })),
    )
    .select('*');
  if (insertRowsError) throw insertRowsError;

  return {
    id: uploadRow.id,
    fileName: uploadRow.file_name,
    imageUrl: uploadRow.image_url,
    uploadedBy: uploadRow.uploaded_by,
    createdAt: uploadRow.created_at,
    rows: (caseRows as DbCaseRow[]).map(mapRow),
  };
}

export async function fetchPreauthSubmissionUploads(
  listType: PreauthListType = 'to_be_submitted',
): Promise<PreauthSubmissionUpload[]> {
  const [{ data: uploads, error: uploadsError }, { data: rows, error: rowsError }] = await Promise.all([
    db
      .from('government_portal_preauth_uploads')
      .select('*')
      .eq('list_type', listType)
      .order('created_at', { ascending: false }),
    db
      .from('government_portal_preauth_rows')
      .select('*, government_portal_preauth_uploads!inner(list_type)')
      .eq('government_portal_preauth_uploads.list_type', listType)
      .order('created_at', { ascending: true }),
  ]);
  if (uploadsError) throw uploadsError;
  if (rowsError) throw rowsError;

  const rowsByUpload = new Map<string, PreauthSubmissionRow[]>();
  ((rows as DbCaseRow[]) || []).forEach(row => {
    const mapped = mapRow(row);
    const bucket = rowsByUpload.get(mapped.uploadId) || [];
    bucket.push(mapped);
    rowsByUpload.set(mapped.uploadId, bucket);
  });

  return ((uploads as DbUploadRow[]) || []).map(upload => ({
    id: upload.id,
    fileName: upload.file_name,
    imageUrl: upload.image_url,
    uploadedBy: upload.uploaded_by,
    createdAt: upload.created_at,
    rows: rowsByUpload.get(upload.id) || [],
  }));
}

export async function updatePreauthSubmissionRowStatus(
  rowId: string,
  status: PreauthSubmissionStatus,
): Promise<void> {
  const { error } = await db
    .from('government_portal_preauth_rows')
    .update({ status })
    .eq('id', rowId);
  if (error) throw error;
}
