/**
 * Panel-wise mandatory documents — data access.
 *
 * Submitted / Pending is derived, never stored: a document counts as Submitted
 * when a `file_uploads` row exists for the patient with category
 * 'registration_document' whose notes JSON names that document. Only the
 * "Not Applicable" waivers are persisted, in `panel_document_waivers`.
 *
 * The panel -> required-documents map lives ONLY in
 * src/lib/registrationDocuments.ts and is shipped to the RPC as a jsonb
 * parameter on every call, so the SQL never carries a second copy that could
 * drift out of sync.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  REGISTRATION_PANEL_NAMES,
  getCorporateRegistrationDocuments,
  getPanelCorporateSpellings,
  normalizeCorporateName,
  resolveRegistrationPanel,
  type RegistrationPanelName,
} from '@/lib/registrationDocuments';

const db = supabase as any;

export type PanelDocumentState = 'submitted' | 'pending' | 'not_applicable';

export type PanelDocumentStatusFilter = 'pending' | 'complete' | 'all';

export interface PanelDocumentStatusRow {
  patientUuid: string;
  patientsId: string | null;
  patientName: string;
  corporate: string | null;
  panel: string;
  hospitalName: string | null;
  registeredAt: string | null;
  requiredCount: number;
  submittedCount: number;
  waivedCount: number;
  pendingCount: number;
  pendingDocuments: string[];
  submittedDocuments: string[];
  waivedDocuments: string[];
}

export interface PanelDocumentStatusResult {
  rows: PanelDocumentStatusRow[];
  /** Size of the filtered set BEFORE pagination — never the page length. */
  total: number;
}

export interface PanelDocumentQuery {
  hospitalName?: string | null;
  panel?: RegistrationPanelName | null;
  search?: string | null;
  status?: PanelDocumentStatusFilter;
  limit?: number;
  offset?: number;
  /** One exact patient. Ignores `status`, so the checklist still opens once
   *  every document is submitted. Used by the bell's deep link. */
  patientUuid?: string | null;
}

interface PanelPayloadEntry {
  panel: string;
  corporates: string[];
  documents: { key: string; label: string }[];
}

let cachedPayload: PanelPayloadEntry[] | null = null;

/**
 * The panel taxonomy in the shape `get_panel_document_status` expects. Keys are
 * normalized here (not in SQL) so both sides agree by construction. Memoized —
 * the map is a compile-time constant, so this only ever builds once.
 */
export function buildPanelDocumentPayload(): PanelPayloadEntry[] {
  if (cachedPayload) return cachedPayload;

  cachedPayload = REGISTRATION_PANEL_NAMES.map((panel) => ({
    panel,
    corporates: getPanelCorporateSpellings(panel).map(normalizeCorporateName),
    documents: getCorporateRegistrationDocuments(panel).map((label) => ({
      key: normalizeCorporateName(label),
      label,
    })),
  })).filter((entry) => entry.documents.length > 0);

  return cachedPayload;
}

function mapStatusRow(row: any): PanelDocumentStatusRow {
  return {
    patientUuid: row.patient_uuid,
    patientsId: row.patients_id ?? null,
    patientName: row.patient_name || 'Unnamed patient',
    corporate: row.corporate ?? null,
    panel: row.panel,
    hospitalName: row.hospital_name ?? null,
    registeredAt: row.registered_at ?? null,
    requiredCount: Number(row.required_count) || 0,
    submittedCount: Number(row.submitted_count) || 0,
    waivedCount: Number(row.waived_count) || 0,
    pendingCount: Number(row.pending_count) || 0,
    pendingDocuments: row.pending_documents || [],
    submittedDocuments: row.submitted_documents || [],
    waivedDocuments: row.waived_documents || [],
  };
}

export async function fetchPanelDocumentStatus({
  hospitalName = null,
  panel = null,
  search = null,
  status = 'pending',
  limit = 50,
  offset = 0,
  patientUuid = null,
}: PanelDocumentQuery = {}): Promise<PanelDocumentStatusResult> {
  const { data, error } = await db.rpc('get_panel_document_status', {
    p_panels: buildPanelDocumentPayload(),
    p_hospital_name: hospitalName,
    p_panel: panel,
    p_search: search,
    p_status: status,
    p_limit: limit,
    p_offset: offset,
    p_patient_uuid: patientUuid,
  });

  if (error) throw error;

  const rows = ((data || []) as any[]).map(mapStatusRow);
  // Every row carries the same window count; absent rows means an empty set.
  const total = data?.[0]?.total_count != null ? Number(data[0].total_count) : 0;
  return { rows, total };
}

/**
 * Patients with at least one pending mandatory document. Shared by the tablet
 * bell and the Director preview card so the two can never disagree.
 */
export function fetchPendingPanelDocumentPatients(
  options: Omit<PanelDocumentQuery, 'status'> = {},
): Promise<PanelDocumentStatusResult> {
  return fetchPanelDocumentStatus({ ...options, status: 'pending' });
}

export interface WaivePanelDocumentInput {
  patientUuid: string;
  documentName: string;
  corporate?: string | null;
  reason?: string | null;
  waivedBy?: string | null;
}

/** Mark a document Not Applicable. Idempotent — re-waiving is not an error. */
export async function waivePanelDocument({
  patientUuid,
  documentName,
  corporate = null,
  reason = null,
  waivedBy = null,
}: WaivePanelDocumentInput): Promise<void> {
  const { error } = await db.from('panel_document_waivers').insert({
    patient_id: patientUuid,
    document_name: documentName,
    corporate,
    reason,
    waived_by: waivedBy,
  });

  // 23505 = unique violation: already waived, which is the desired end state.
  if (error && error.code !== '23505') throw error;
}

/** Undo Not Applicable. A waiver row means nothing but "waived", so delete it. */
export async function unwaivePanelDocument(
  patientUuid: string,
  documentName: string,
): Promise<void> {
  const { error } = await db
    .from('panel_document_waivers')
    .delete()
    .eq('patient_id', patientUuid)
    .eq('document_name', documentName);

  if (error) throw error;
}

export interface CorporatePatientCount {
  corporate: string;
  patientCount: number;
}

export async function fetchCorporatePatientCounts(
  hospitalName: string | null = null,
): Promise<CorporatePatientCount[]> {
  const { data, error } = await db.rpc('get_corporate_patient_counts', {
    p_hospital_name: hospitalName,
  });

  if (error) throw error;

  return ((data || []) as any[]).map((row) => ({
    corporate: row.corporate,
    patientCount: Number(row.patient_count) || 0,
  }));
}

/**
 * Substrings that suggest a corporate name is one of the nine panels. This
 * mirrors the substring taxonomy in src/tablet/lib/panelColors.ts, and is a
 * DIAGNOSTIC ONLY — it never decides which documents a patient needs. That
 * stays exact-alias via resolveRegistrationPanel, because a loose match would
 * silently assign the wrong document list.
 */
const PANEL_LOOKALIKE_KEYWORDS = [
  'cghs',
  'central government health',
  'esic',
  'echs',
  'ex serviceman',
  'railway',
  'secr',
  'c.rly',
  'wcl',
  'coalfield',
  'police',
  'kutumb',
  'mpkay',
  'umeed',
  'tpa',
  'insurance',
  'yojana',
  'yojna',
];

/**
 * Corporate spellings that look like a panel but match no alias. Patients on
 * these are invisible to the checklist and the bell, because
 * getCorporateRegistrationDocuments returns [] for them.
 */
export function findUnmappedPanelCorporates(
  rows: CorporatePatientCount[],
): CorporatePatientCount[] {
  return rows.filter((row) => {
    if (resolveRegistrationPanel(row.corporate)) return false;
    const normalized = normalizeCorporateName(row.corporate);
    return PANEL_LOOKALIKE_KEYWORDS.some((keyword) => normalized.includes(keyword));
  });
}
