import { supabase } from '@/integrations/supabase/client';
import {
  GOVERNMENT_PORTAL_REQUIRED_COLUMNS,
  parsePortalDate,
  type GovernmentPortalColumn,
  type GovernmentPortalPatientStatus,
  type GovernmentPortalReport,
  type GovernmentPortalRow,
  type GovernmentPortalSection,
} from '@/lib/governmentPortalReport';

const db = supabase as any;

export interface SavedGovernmentPortalImport {
  id: string;
  fileName: string;
  reportDateLabel: string | null;
  createdAt: string;
  report: GovernmentPortalReport;
}

export interface GovernmentPortalExtensionAlertRow {
  status: GovernmentPortalPatientStatus;
  rowNumber: number;
  registrationId: string;
  beneficiaryName: string;
  caseType: string;
  preauthDateLabel: string;
  daysSincePreauth: number | null;
  procedureCode: string;
  procedureDetails: string;
  preauthApprovedAmount: string;
}

export interface GovernmentPortalExtensionAlertSummary {
  importId: string;
  fileName: string;
  reportDateLabel: string | null;
  createdAt: string;
  count: number;
  rows: GovernmentPortalExtensionAlertRow[];
}

type ImportRow = {
  id: string;
  file_name: string;
  report_date_label: string | null;
  total_rows: number;
  count_dialysis: number;
  count_general_medical: number;
  count_surgical: number;
  count_extension_needed: number;
  count_unclassified: number;
  whatsapp_medical_patients: string | null;
  whatsapp_urgent_extensions: string | null;
  whatsapp_dialysis_batch_status: string | null;
  fatal_errors: string[] | null;
  missing_columns: string[] | null;
  created_at: string;
};

type DbReportRow = {
  id: string;
  row_number: number;
  status: string | null;
  registration_id: string | null;
  program_id: string | null;
  beneficiary_name: string | null;
  case_type: string | null;
  preauth_initiated_date: string | null;
  speciality_code: string | null;
  category_details: string | null;
  procedure_code: string | null;
  procedure_details: string | null;
  hospital_name: string | null;
  preauth_approved_amount: string | null;
  section: string;
  section_label: string | null;
  issues: string[] | null;
  is_hope_hospital: boolean;
  is_medical_case: boolean;
  is_dialysis: boolean;
  days_since_preauth: number | null;
  extension_needed: boolean;
  preauth_date_label: string | null;
};

function rowToDbRecord(importId: string, row: GovernmentPortalRow) {
  return {
    import_id: importId,
    row_number: row.rowNumber,
    status: row.status || 'pending',
    registration_id: row.values['Registration ID'] || null,
    program_id: row.values['Program ID'] || null,
    beneficiary_name: row.values['Beneficiary Name'] || null,
    case_type: row.values['Case Type'] || null,
    preauth_initiated_date: row.values['Preauth Initiated Date'] || null,
    speciality_code: row.values['Speciality Code'] || null,
    category_details: row.values['Category Details'] || null,
    procedure_code: row.values['Procedure Code'] || null,
    procedure_details: row.values['Procedure Details'] || null,
    hospital_name: row.values['Hospital Name'] || null,
    preauth_approved_amount: row.values['Preauth Approved Amount'] || null,
    section: row.section,
    section_label: row.sectionLabel,
    issues: row.issues,
    is_hope_hospital: row.isHopeHospital,
    is_medical_case: row.isMedicalCase,
    is_dialysis: row.isDialysis,
    days_since_preauth: row.daysSincePreauth,
    extension_needed: row.extensionNeeded,
    preauth_date_label: row.preauthDateLabel || null,
  };
}

function dbRowToGovernmentPortalRow(row: DbReportRow): GovernmentPortalRow {
  const values = {} as Record<GovernmentPortalColumn, string>;
  values['Registration ID'] = row.registration_id || '';
  values['Program ID'] = row.program_id || '';
  values['Beneficiary Name'] = row.beneficiary_name || '';
  values['Case Type'] = row.case_type || '';
  values['Preauth Initiated Date'] = row.preauth_initiated_date || '';
  values['Speciality Code'] = row.speciality_code || '';
  values['Category Details'] = row.category_details || '';
  values['Procedure Code'] = row.procedure_code || '';
  values['Procedure Details'] = row.procedure_details || '';
  values['Hospital Name'] = row.hospital_name || '';
  values['Preauth Approved Amount'] = row.preauth_approved_amount || '';

  return {
    id: row.id,
    rowNumber: row.row_number,
    values,
    section: row.section as GovernmentPortalSection,
    sectionLabel: row.section_label || row.section,
    issues: row.issues || [],
    isHopeHospital: row.is_hope_hospital,
    isMedicalCase: row.is_medical_case,
    isDialysis: row.is_dialysis,
    daysSincePreauth: row.days_since_preauth,
    extensionNeeded: row.extension_needed,
    preauthDateLabel: row.preauth_date_label || '',
    status: (row.status as GovernmentPortalPatientStatus) || 'pending',
  };
}

function importToReport(header: ImportRow, rows: DbReportRow[]): GovernmentPortalReport {
  const mappedRows = rows
    .sort((a, b) => a.row_number - b.row_number)
    .map(dbRowToGovernmentPortalRow);

  return {
    rows: mappedRows,
    fatalErrors: header.fatal_errors || [],
    missingColumns: (header.missing_columns || []) as GovernmentPortalColumn[],
    totalRows: header.total_rows,
    counts: {
      dialysis: header.count_dialysis,
      generalMedical: header.count_general_medical,
      surgical: header.count_surgical,
      extensionNeeded: header.count_extension_needed,
      unclassified: header.count_unclassified,
    },
    whatsApp: {
      medicalPatients: header.whatsapp_medical_patients || '',
      urgentExtensions: header.whatsapp_urgent_extensions || '',
      dialysisBatchStatus: header.whatsapp_dialysis_batch_status || '',
    },
  };
}

async function loadLatestImportWithRows(
  importSelect: string,
  rowSelect: string,
  rowFilter: (query: any) => any,
  rowLimit?: number,
): Promise<{ header: ImportRow | null; rows: DbReportRow[] }> {
  const { data: imports, error: importsError } = await db
    .from('government_portal_report_imports')
    .select(importSelect)
    .order('created_at', { ascending: false })
    .limit(20);

  if (importsError) throw importsError;

  for (const header of (imports || []) as ImportRow[]) {
    let rowQuery = db
      .from('government_portal_report_rows')
      .select(rowSelect)
      .eq('import_id', header.id)
      .order('row_number', { ascending: true });

    rowQuery = rowFilter(rowQuery);

    if (rowLimit !== undefined) {
      rowQuery = rowQuery.limit(rowLimit);
    }

    const { data: rows, error: rowsError } = await rowQuery;
    if (rowsError) throw rowsError;

    if ((rows || []).length > 0) {
      return { header, rows: rows as DbReportRow[] };
    }
  }

  return { header: null, rows: [] };
}

function getUploadedBy(): string | null {
  try {
    const raw = localStorage.getItem('hmis_user');
    if (!raw) return null;
    const user = JSON.parse(raw);
    return user?.id || user?.email || null;
  } catch {
    return null;
  }
}

export async function saveGovernmentPortalReport(
  fileName: string,
  report: GovernmentPortalReport,
  reportDateLabel: string,
): Promise<string> {
  const { data: header, error: headerError } = await db
    .from('government_portal_report_imports')
    .insert({
      file_name: fileName,
      report_date_label: reportDateLabel,
      total_rows: report.totalRows,
      count_dialysis: report.counts.dialysis,
      count_general_medical: report.counts.generalMedical,
      count_surgical: report.counts.surgical,
      count_extension_needed: report.counts.extensionNeeded,
      count_unclassified: report.counts.unclassified,
      whatsapp_medical_patients: report.whatsApp.medicalPatients,
      whatsapp_urgent_extensions: report.whatsApp.urgentExtensions,
      whatsapp_dialysis_batch_status: report.whatsApp.dialysisBatchStatus,
      fatal_errors: report.fatalErrors,
      missing_columns: report.missingColumns,
      uploaded_by: getUploadedBy(),
    })
    .select('id')
    .single();

  if (headerError) throw headerError;
  const importId = header.id as string;

  if (report.rows.length > 0) {
    const payload = report.rows.map((row) => rowToDbRecord(importId, row));
    const { error: rowsError } = await db.from('government_portal_report_rows').insert(payload);
    if (rowsError) {
      await db.from('government_portal_report_imports').delete().eq('id', importId);
      throw rowsError;
    }

    try {
      await syncGovernmentPortalReportToVisits(report);
    } catch (syncError) {
      console.error('Error syncing portal report to visits:', syncError);
    }
  }

  return importId;
}

export async function fetchLatestGovernmentPortalReport(): Promise<SavedGovernmentPortalImport | null> {
  const { header, rows } = await loadLatestImportWithRows(
    '*',
    '*',
    (query) => query,
  );

  if (!header) return null;

  return {
    id: header.id,
    fileName: header.file_name,
    reportDateLabel: header.report_date_label,
    createdAt: header.created_at,
    report: importToReport(header, rows),
  };
}

export async function fetchLatestGovernmentPortalExtensionAlerts(
  rowLimit = 100,
): Promise<GovernmentPortalExtensionAlertSummary | null> {
  const { header, rows } = await loadLatestImportWithRows(
    'id, file_name, report_date_label, count_extension_needed, created_at',
    'id, row_number, status, registration_id, beneficiary_name, case_type, preauth_date_label, days_since_preauth, procedure_code, procedure_details, preauth_approved_amount',
    (query) => query.eq('extension_needed', true).eq('status', 'pending'),
    rowLimit,
  );

  if (!header) return null;

  return {
    importId: header.id,
    fileName: header.file_name,
    reportDateLabel: header.report_date_label,
    createdAt: header.created_at,
    count: (rows || []).length,
    rows: (rows || []).map((row: DbReportRow) => ({
      status: (row.status as GovernmentPortalPatientStatus) || 'pending',
      rowNumber: row.row_number,
      registrationId: row.registration_id || '',
      beneficiaryName: row.beneficiary_name || '',
      caseType: row.case_type || '',
      preauthDateLabel: row.preauth_date_label || '',
      daysSincePreauth: row.days_since_preauth,
      procedureCode: row.procedure_code || '',
      procedureDetails: row.procedure_details || '',
      preauthApprovedAmount: row.preauth_approved_amount || '',
    })),
  };
}

export async function fetchGovernmentPortalImportHistory(
  limit = 20,
): Promise<Array<{ id: string; fileName: string; createdAt: string; totalRows: number }>> {
  const { data, error } = await db
    .from('government_portal_report_imports')
    .select('id, file_name, created_at, total_rows')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data || []).map((row: ImportRow) => ({
    id: row.id,
    fileName: row.file_name,
    createdAt: row.created_at,
    totalRows: row.total_rows,
  }));
}

export async function fetchGovernmentPortalReportById(
  importId: string,
): Promise<SavedGovernmentPortalImport | null> {
  const { data: header, error: headerError } = await db
    .from('government_portal_report_imports')
    .select('*')
    .eq('id', importId)
    .maybeSingle();

  if (headerError) throw headerError;
  if (!header) return null;

  const { data: rows, error: rowsError } = await db
    .from('government_portal_report_rows')
    .select('*')
    .eq('import_id', importId)
    .order('row_number', { ascending: true });

  if (rowsError) throw rowsError;

  return {
    id: header.id,
    fileName: header.file_name,
    reportDateLabel: header.report_date_label,
    createdAt: header.created_at,
    report: importToReport(header as ImportRow, (rows || []) as DbReportRow[]),
  };
}

type PortalSyncSource = {
  registration_id: string | null;
  procedure_details: string | null;
  preauth_approved_amount: string | null;
  preauth_initiated_date: string | null;
};

function portalDateToIso(raw: string | null): string | null {
  const parsed = parsePortalDate(raw || '');
  if (!parsed) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

async function applyPortalRowToVisit(
  visit: { id: string; visit_id: string | null },
  row: PortalSyncSource,
): Promise<boolean> {
  const visitUpdate: Record<string, string> = {};
  // Portal exports repeat the value pipe-separated, e.g. "Severe sepsis|Severe sepsis"
  const procedureDetails = [
    ...new Set((row.procedure_details || '').split('|').map((part) => part.trim()).filter(Boolean)),
  ].join(', ');
  if (procedureDetails) visitUpdate.package_name = procedureDetails;
  const amount = (row.preauth_approved_amount || '').replace(/[^0-9.]/g, '');
  if (amount) visitUpdate.package_amount = amount;

  if (Object.keys(visitUpdate).length > 0) {
    const { error } = await db.from('visits').update(visitUpdate).eq('id', visit.id);
    if (error) throw error;
  }

  const intimationDate = portalDateToIso(row.preauth_initiated_date);
  if (intimationDate && visit.visit_id) {
    const { error } = await db
      .from('bill_preparation')
      .upsert(
        { visit_id: visit.visit_id, intimation_date: intimationDate },
        { onConflict: 'visit_id' },
      );
    if (error) throw error;
  }

  return Object.keys(visitUpdate).length > 0 || Boolean(intimationDate);
}

/**
 * Pull the latest uploaded portal row matching a registration ID into every
 * visit tagged with that ID (package name/amount + intimation date).
 * Returns true when a portal row matched and something was synced.
 */
export async function syncPortalDataForRegistrationId(registrationId: string): Promise<boolean> {
  const trimmed = registrationId.trim();
  if (!trimmed) return false;

  const { data: row, error } = await db
    .from('government_portal_report_rows')
    .select('registration_id, procedure_details, preauth_approved_amount, preauth_initiated_date')
    .eq('registration_id', trimmed)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!row) return false;

  const { data: visits, error: visitsError } = await db
    .from('visits')
    .select('id, visit_id')
    .eq('yojana_registration_id', trimmed);

  if (visitsError) throw visitsError;

  let synced = false;
  for (const visit of visits || []) {
    if (await applyPortalRowToVisit(visit, row)) synced = true;
  }
  return synced;
}

/**
 * After a portal file upload, push each row's data into visits whose
 * yojana_registration_id matches. Returns the number of visits updated.
 */
export async function syncGovernmentPortalReportToVisits(
  report: GovernmentPortalReport,
): Promise<number> {
  const rowsByRegistrationId = new Map<string, PortalSyncSource>();
  for (const row of report.rows) {
    const registrationId = (row.values['Registration ID'] || '').trim();
    if (!registrationId) continue;
    rowsByRegistrationId.set(registrationId, {
      registration_id: registrationId,
      procedure_details: row.values['Procedure Details'] || null,
      preauth_approved_amount: row.values['Preauth Approved Amount'] || null,
      preauth_initiated_date: row.values['Preauth Initiated Date'] || null,
    });
  }

  if (rowsByRegistrationId.size === 0) return 0;

  const { data: visits, error } = await db
    .from('visits')
    .select('id, visit_id, yojana_registration_id')
    .in('yojana_registration_id', [...rowsByRegistrationId.keys()]);

  if (error) throw error;

  let updated = 0;
  for (const visit of visits || []) {
    const row = rowsByRegistrationId.get((visit.yojana_registration_id || '').trim());
    if (!row) continue;
    if (await applyPortalRowToVisit(visit, row)) updated += 1;
  }
  return updated;
}

export async function updateGovernmentPortalRowStatus(
  rowId: string,
  status: GovernmentPortalPatientStatus,
): Promise<void> {
  const { error } = await db
    .from('government_portal_report_rows')
    .update({ status })
    .eq('id', rowId);

  if (error) throw error;
}

/** Guard for type exports used only in this module */
export const _GOVERNMENT_PORTAL_COLUMNS = GOVERNMENT_PORTAL_REQUIRED_COLUMNS;
