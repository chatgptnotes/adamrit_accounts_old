import { supabase } from '@/integrations/supabase/client';
import {
  GOVERNMENT_PORTAL_REQUIRED_COLUMNS,
  type GovernmentPortalColumn,
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
  row_number: number;
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
    if (rowsError) throw rowsError;
  }

  return importId;
}

export async function fetchLatestGovernmentPortalReport(): Promise<SavedGovernmentPortalImport | null> {
  const { data: header, error: headerError } = await db
    .from('government_portal_report_imports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (headerError) throw headerError;
  if (!header) return null;

  const { data: rows, error: rowsError } = await db
    .from('government_portal_report_rows')
    .select('*')
    .eq('import_id', header.id)
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

export async function fetchLatestGovernmentPortalExtensionAlerts(
  rowLimit = 100,
): Promise<GovernmentPortalExtensionAlertSummary | null> {
  const { data: header, error: headerError } = await db
    .from('government_portal_report_imports')
    .select('id, file_name, report_date_label, count_extension_needed, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (headerError) throw headerError;
  if (!header) return null;

  const importId = header.id as string;
  const count = Number(header.count_extension_needed || 0);

  const { data: rows, error: rowsError } = await db
    .from('government_portal_report_rows')
    .select(
      [
        'row_number',
        'registration_id',
        'beneficiary_name',
        'case_type',
        'preauth_date_label',
        'days_since_preauth',
        'procedure_code',
        'procedure_details',
        'preauth_approved_amount',
      ].join(', '),
    )
    .eq('import_id', importId)
    .eq('extension_needed', true)
    .order('days_since_preauth', { ascending: false, nullsFirst: false })
    .order('row_number', { ascending: true })
    .limit(rowLimit);

  if (rowsError) throw rowsError;

  return {
    importId,
    fileName: header.file_name,
    reportDateLabel: header.report_date_label,
    createdAt: header.created_at,
    count,
    rows: (rows || []).map((row: DbReportRow) => ({
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

/** Guard for type exports used only in this module */
export const _GOVERNMENT_PORTAL_COLUMNS = GOVERNMENT_PORTAL_REQUIRED_COLUMNS;
