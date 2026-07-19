import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
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

const normalizeRegistrationId = (value: string | null | undefined) =>
  (value || '').trim().toUpperCase();

const normalizeMatchValue = (value: string | null | undefined) =>
  (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export type GovernmentPortalReportKind = 'under_treatment' | 'claims_to_be_submitted';

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

export interface GovernmentPortalPackageSyncResult {
  inserted: number;
  skippedExisting: number;
  skippedInvalid: number;
  error?: string;
}

export interface SaveGovernmentPortalReportResult {
  importId: string;
  packageSync: GovernmentPortalPackageSyncResult;
  skippedDuplicates: number;
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
    registration_id: normalizeRegistrationId(row.values['Registration ID']) || null,
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
  reportKind: GovernmentPortalReportKind = 'under_treatment',
): Promise<{ header: ImportRow | null; rows: DbReportRow[] }> {
  const { data: imports, error: importsError } = await db
    .from('government_portal_report_imports')
    .select(importSelect)
    .eq('report_kind', reportKind)
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

type ExistingPackageRow = {
  scheme: string | null;
  treatment_code: string | null;
  treatment_plan: string | null;
};

type PortalPackageCandidate = {
  scheme: string;
  treatment_code: string | null;
  treatment_plan: string | null;
  category: string | null;
  package_price: number | null;
  patient_name_example: string | null;
  is_active: boolean;
};

const emptyPackageSyncResult = (): GovernmentPortalPackageSyncResult => ({
  inserted: 0,
  skippedExisting: 0,
  skippedInvalid: 0,
});

const cleanPortalPackageText = (value: string | null | undefined): string =>
  [
    ...new Set(
      (value || '')
        .split('|')
        .map((part) => part.trim().replace(/\s+/g, ' '))
        .filter(Boolean),
    ),
  ].join(', ');

const normalizePackageKeyPart = (value: string | null | undefined): string =>
  (value || '').trim().replace(/\s+/g, ' ').toUpperCase();

const packageIdentityKey = (
  scheme: string | null | undefined,
  treatmentCode: string | null | undefined,
  treatmentPlan: string | null | undefined,
): string | null => {
  const normalizedScheme = normalizePackageKeyPart(scheme);
  const normalizedCode = normalizePackageKeyPart(treatmentCode);
  const normalizedPlan = normalizePackageKeyPart(treatmentPlan);

  if (!normalizedScheme) return null;
  if (normalizedCode) return `${normalizedScheme}:CODE:${normalizedCode}`;
  if (normalizedPlan) return `${normalizedScheme}:PLAN:${normalizedPlan}`;
  return null;
};

const inferSchemeFromProgramId = (programId: string): string => {
  const normalized = normalizePackageKeyPart(programId);
  if (/MJP|MAHATMA|JYOTIRAO|JYOTIBA|PHULE/.test(normalized)) return 'MJPJAY';
  if (/PM[\s-]*JAY|PRADHAN|AYUSHMAN|AB[\s-]*PM/.test(normalized)) return 'PMJAY';
  return 'PMJAY';
};

const inferCategoryFromCaseType = (caseType: string): string | null => {
  const normalized = caseType.trim().toLowerCase();
  if (normalized.includes('surgical') || normalized.includes('surgery')) return 'SURGICAL';
  if (normalized.includes('medical')) return 'CONSERVATIVE';
  return null;
};

const parsePackagePrice = (amount: string): number | null => {
  const numeric = amount.replace(/[^0-9.]/g, '');
  if (!numeric) return null;
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : null;
};

const portalRowToPackageCandidate = (row: GovernmentPortalRow): PortalPackageCandidate | null => {
  const treatmentCode = cleanPortalPackageText(row.values['Procedure Code']) || null;
  const treatmentPlan = cleanPortalPackageText(row.values['Procedure Details']) || null;
  if (!treatmentCode && !treatmentPlan) return null;

  return {
    scheme: inferSchemeFromProgramId(row.values['Program ID']),
    treatment_code: treatmentCode,
    treatment_plan: treatmentPlan,
    category: inferCategoryFromCaseType(row.values['Case Type']),
    package_price: parsePackagePrice(row.values['Preauth Approved Amount']),
    patient_name_example: cleanPortalPackageText(row.values['Beneficiary Name']) || null,
    is_active: true,
  };
};

async function syncGovernmentPortalPackagesToMaster(
  report: GovernmentPortalReport,
): Promise<GovernmentPortalPackageSyncResult> {
  const result = emptyPackageSyncResult();
  const existingRows = await fetchAllRows<ExistingPackageRow>((from, to) =>
    db
      .from('pmjay_mjpjay_packages')
      .select('scheme, treatment_code, treatment_plan')
      .in('scheme', ['PMJAY', 'MJPJAY'])
      .range(from, to),
  );

  const seenKeys = new Set<string>();
  for (const row of existingRows) {
    const key = packageIdentityKey(row.scheme, row.treatment_code, row.treatment_plan);
    if (key) seenKeys.add(key);
  }

  const pendingInserts: PortalPackageCandidate[] = [];
  for (const row of report.rows) {
    const candidate = portalRowToPackageCandidate(row);
    if (!candidate) {
      result.skippedInvalid += 1;
      continue;
    }

    const key = packageIdentityKey(
      candidate.scheme,
      candidate.treatment_code,
      candidate.treatment_plan,
    );
    if (!key) {
      result.skippedInvalid += 1;
      continue;
    }

    if (seenKeys.has(key)) {
      result.skippedExisting += 1;
      continue;
    }

    seenKeys.add(key);
    pendingInserts.push(candidate);
  }

  for (let index = 0; index < pendingInserts.length; index += 500) {
    const chunk = pendingInserts.slice(index, index + 500);
    const { error } = await db.from('pmjay_mjpjay_packages').insert(chunk);
    if (error) throw error;
    result.inserted += chunk.length;
  }

  return result;
}

export async function saveGovernmentPortalReport(
  fileName: string,
  report: GovernmentPortalReport,
  reportDateLabel: string,
  reportKind: GovernmentPortalReportKind = 'under_treatment',
): Promise<SaveGovernmentPortalReportResult> {
  const packageSync = emptyPackageSyncResult();
  let skippedDuplicates = 0;

  const { data: header, error: headerError } = await db
    .from('government_portal_report_imports')
    .insert({
      file_name: fileName,
      report_date_label: reportDateLabel,
      report_kind: reportKind,
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
    const existingRows = await fetchAllRows<{ registration_id: string | null }>((from, to) =>
      db
        .from('government_portal_report_rows')
        .select('registration_id')
        .not('registration_id', 'is', null)
        .range(from, to),
    );

    const existingIds = new Set<string>();
    for (const row of existingRows) {
      if (row.registration_id) {
        existingIds.add(row.registration_id.trim().toUpperCase());
      }
    }

    const dedupedRows = report.rows.filter((row) => {
      const regId = row.values['Registration ID'].trim().toUpperCase();
      if (regId && existingIds.has(regId)) {
        skippedDuplicates += 1;
        return false;
      }
      return true;
    });

    if (dedupedRows.length > 0) {
      const payload = dedupedRows.map((row) => rowToDbRecord(importId, row));
      const { error: rowsError } = await db.from('government_portal_report_rows').insert(payload);
      if (rowsError) {
        const isDuplicateError =
          rowsError.code === '23505' ||
          (rowsError.message && rowsError.message.includes('unique'));
        if (isDuplicateError) {
          for (const record of payload) {
            const { error: singleError } = await db
              .from('government_portal_report_rows')
              .insert(record);
            if (singleError) {
              if (
                singleError.code === '23505' ||
                (singleError.message && singleError.message.includes('unique'))
              ) {
                skippedDuplicates += 1;
              } else {
                console.error('Unexpected insert error during dedup fallback:', singleError);
              }
            }
          }
        } else {
          await db.from('government_portal_report_imports').delete().eq('id', importId);
          throw rowsError;
        }
      }
    }

    if (reportKind === 'under_treatment') {
      try {
        await syncGovernmentPortalReportToVisits(report);
      } catch (syncError) {
        console.error('Error syncing portal report to visits:', syncError);
      }

      try {
        Object.assign(packageSync, await syncGovernmentPortalPackagesToMaster(report));
      } catch (syncError) {
        console.error('Error syncing portal report packages to master:', syncError);
        packageSync.error =
          syncError instanceof Error ? syncError.message : 'Package master sync failed';
      }
    }
  }

  return { importId, packageSync, skippedDuplicates };
}

export async function fetchLatestGovernmentPortalReport(
  reportKind: GovernmentPortalReportKind = 'under_treatment',
): Promise<SavedGovernmentPortalImport | null> {
  const { header, rows } = await loadLatestImportWithRows(
    '*',
    '*',
    (query) => query,
    undefined,
    reportKind,
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
  reportKind: GovernmentPortalReportKind = 'under_treatment',
): Promise<GovernmentPortalExtensionAlertSummary | null> {
  const { data: imports, error: importsError } = await db
    .from('government_portal_report_imports')
    .select('id, file_name, report_date_label, count_extension_needed, created_at')
    .eq('report_kind', reportKind)
    .order('created_at', { ascending: false })
    .limit(1);

  if (importsError) throw importsError;

  const header = ((imports || []) as ImportRow[])[0] || null;

  if (!header) return null;

  let rowQuery = db
    .from('government_portal_report_rows')
    .select('id, row_number, status, registration_id, beneficiary_name, case_type, preauth_date_label, days_since_preauth, procedure_code, procedure_details, preauth_approved_amount')
    .eq('import_id', header.id)
    .eq('section', 'generalMedical')
    .eq('extension_needed', true)
    .eq('status', 'pending')
    .order('row_number', { ascending: true });

  if (rowLimit !== undefined) {
    rowQuery = rowQuery.limit(rowLimit);
  }

  const { data: rows, error: rowsError } = await rowQuery;
  if (rowsError) throw rowsError;

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
  reportKind: GovernmentPortalReportKind = 'under_treatment',
  limit = 20,
): Promise<Array<{ id: string; fileName: string; createdAt: string; totalRows: number }>> {
  const { data, error } = await db
    .from('government_portal_report_imports')
    .select('id, file_name, created_at, total_rows')
    .eq('report_kind', reportKind)
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
  program_id: string | null;
  case_type: string | null;
  procedure_code: string | null;
  procedure_details: string | null;
  preauth_approved_amount: string | null;
  preauth_initiated_date: string | null;
  beneficiary_name: string | null;
};

function normalizePortalPackageName(raw: string | null): string {
  return [
    ...new Set((raw || '').split('|').map((part) => part.trim()).filter(Boolean)),
  ].join(', ');
}

function normalizePortalPipeText(raw: string | null): string {
  return [
    ...new Set((raw || '').split('|').map((part) => part.trim()).filter(Boolean)),
  ].join(', ');
}

function portalDateToIso(raw: string | null): string | null {
  const parsed = parsePortalDate(raw || '');
  if (!parsed) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

function buildPatientPreauthKey(patientName: string | null | undefined, dateValue: string | null | undefined) {
  const name = normalizeMatchValue(patientName);
  const date = portalDateToIso(dateValue || null);
  return name && date ? `${name}|${date}` : '';
}

function buildPortalSyncSource(row: GovernmentPortalRow): PortalSyncSource {
  const registrationId = normalizeRegistrationId(row.values['Registration ID']);
  return {
    registration_id: registrationId,
    program_id: row.values['Program ID'] || null,
    case_type: row.values['Case Type'] || null,
    procedure_code: row.values['Procedure Code'] || null,
    procedure_details: row.values['Procedure Details'] || null,
    preauth_approved_amount: row.values['Preauth Approved Amount'] || null,
    preauth_initiated_date: row.values['Preauth Initiated Date'] || null,
    beneficiary_name: row.values['Beneficiary Name'] || null,
  };
}

async function ensurePortalPackageSavedToMaster(row: PortalSyncSource): Promise<void> {
  const scheme = inferSchemeFromProgramId(row.program_id || '');
  const treatmentCode = cleanPortalPackageText(row.procedure_code) || null;
  const treatmentPlan = cleanPortalPackageText(row.procedure_details) || null;

  const identityKey = packageIdentityKey(scheme, treatmentCode, treatmentPlan);
  if (!identityKey) return;

  let existingQuery = db
    .from('pmjay_mjpjay_packages')
    .select('id')
    .eq('scheme', scheme)
    .limit(1);

  if (treatmentCode) {
    existingQuery = existingQuery.eq('treatment_code', treatmentCode);
  } else {
    existingQuery = existingQuery.is('treatment_code', null);
  }

  if (treatmentPlan) {
    existingQuery = existingQuery.eq('treatment_plan', treatmentPlan);
  } else {
    existingQuery = existingQuery.is('treatment_plan', null);
  }

  const { data: existingRows, error: existingError } = await existingQuery;
  if (existingError) throw existingError;
  if ((existingRows || []).length > 0) return;

  const { error: insertError } = await db.from('pmjay_mjpjay_packages').insert({
    scheme,
    treatment_code: treatmentCode,
    treatment_plan: treatmentPlan,
    category: inferCategoryFromCaseType(row.case_type || ''),
    package_price: parsePackagePrice(row.preauth_approved_amount || ''),
    patient_name_example: cleanPortalPackageText(row.beneficiary_name) || null,
    is_active: true,
  });

  if (insertError) throw insertError;
}

async function applyPortalRowToVisit(
  visit: { id: string; visit_id: string | null },
  row: PortalSyncSource,
): Promise<boolean> {
  await ensurePortalPackageSavedToMaster(row);

  const visitUpdate: Record<string, string> = {};
  // Portal exports repeat the value pipe-separated, e.g. "Severe sepsis|Severe sepsis"
  const packageName = normalizePortalPackageName(row.procedure_details);
  if (packageName) visitUpdate.package_name = packageName;
  const packageCode = normalizePortalPipeText(row.procedure_code).toUpperCase();
  if (packageCode) visitUpdate.package_code = packageCode;
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
    .select('registration_id, program_id, case_type, procedure_code, procedure_details, preauth_approved_amount, preauth_initiated_date, beneficiary_name')
    .ilike('registration_id', trimmed)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!row) return false;

  const { data: visits, error: visitsError } = await db
    .from('visits')
    .select('id, visit_id')
    .ilike('yojana_registration_id', trimmed);

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
  const rowsByPatientPreauthDate = new Map<string, PortalSyncSource>();
  const rowsByPatientName = new Map<string, PortalSyncSource>();

  for (const row of report.rows) {
    const source = buildPortalSyncSource(row);
    if (source.registration_id) rowsByRegistrationId.set(source.registration_id, source);

    const patientNameKey = normalizeMatchValue(source.beneficiary_name);
    if (patientNameKey && !rowsByPatientName.has(patientNameKey)) {
      rowsByPatientName.set(patientNameKey, source);
    }

    const patientDateKey = buildPatientPreauthKey(
      source.beneficiary_name,
      source.preauth_initiated_date,
    );
    if (patientDateKey && !rowsByPatientPreauthDate.has(patientDateKey)) {
      rowsByPatientPreauthDate.set(patientDateKey, source);
    }
  }

  if (
    rowsByRegistrationId.size === 0 &&
    rowsByPatientPreauthDate.size === 0 &&
    rowsByPatientName.size === 0
  ) return 0;

  const syncedVisitIds = new Set<string>();
  let updated = 0;

  if (rowsByRegistrationId.size > 0) {
    const registrationFilters = [...rowsByRegistrationId.keys()]
      .map((registrationId) => `yojana_registration_id.ilike.${registrationId},thumb_registration_no.ilike.${registrationId}`)
      .join(',');

    const { data: visits, error } = await db
      .from('visits')
      .select('id, visit_id, yojana_registration_id, thumb_registration_no')
      .or(registrationFilters);

    if (error) throw error;

    for (const visit of visits || []) {
      const row =
        rowsByRegistrationId.get(normalizeRegistrationId(visit.yojana_registration_id)) ||
        rowsByRegistrationId.get(normalizeRegistrationId(visit.thumb_registration_no));
      if (!row || syncedVisitIds.has(visit.id)) continue;
      if (await applyPortalRowToVisit(visit, row)) updated += 1;
      syncedVisitIds.add(visit.id);
    }
  }

  if (rowsByPatientPreauthDate.size > 0 || rowsByPatientName.size > 0) {
    const { data: visits, error } = await db
      .from('visits')
      .select('id, visit_id, admission_date, visit_date, patients!inner(name)')
      .eq('patient_type', 'IPD')
      .not('admission_date', 'is', null)
      .order('admission_date', { ascending: false })
      .limit(5000);

    if (error) throw error;

    const visitIds = (visits || [])
      .map((visit: { visit_id: string | null }) => visit.visit_id)
      .filter((visitId: string | null): visitId is string => Boolean(visitId));

    const billPrepByVisitId = new Map<string, string>();
    for (let index = 0; index < visitIds.length; index += 500) {
      const chunk = visitIds.slice(index, index + 500);
      const { data: billPrepRows, error: billPrepError } = await db
        .from('bill_preparation')
        .select('visit_id, intimation_date')
        .in('visit_id', chunk);

      if (billPrepError) throw billPrepError;
      for (const row of billPrepRows || []) {
        if (row.visit_id && row.intimation_date) {
          billPrepByVisitId.set(row.visit_id, row.intimation_date);
        }
      }
    }

    for (const visit of visits || []) {
      if (syncedVisitIds.has(visit.id)) continue;

      const patientName = visit.patients?.name || '';
      const dateCandidates = [
        visit.visit_id ? billPrepByVisitId.get(visit.visit_id) : null,
        visit.admission_date,
        visit.visit_date,
      ].filter(Boolean) as string[];

      const row = dateCandidates
        .map((dateValue) => buildPatientPreauthKey(patientName, dateValue))
        .filter(Boolean)
        .map((key) => rowsByPatientPreauthDate.get(key))
        .find(Boolean) ||
        rowsByPatientName.get(normalizeMatchValue(patientName));

      if (!row) continue;
      if (await applyPortalRowToVisit(visit, row)) updated += 1;
      syncedVisitIds.add(visit.id);
    }
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
