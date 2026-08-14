import * as XLSX from 'xlsx';

export type CorporateClaimFileType =
  | 'under_treatment'
  | 'claims_to_be_submitted'
  | 'claims_sent_to_bank'
  | 'pending_with_payer'
  | 'claims_approved_from_bank'
  | 'claims_rejected'
  | 'unknown';

export type CorporateClaimStage =
  | 'under_treatment' | 'claims_to_be_submitted' | 'claims_sent_to_bank'
  | 'pending_with_payer' | 'payment_initiated' | 'payment_accomplished' | 'rejected';

export interface CorporateClaimParsedRow {
  rowNumber: number;
  originalValues: Record<string, string>;
  normalizedValues: Record<string, string | number | null>;
  issues: string[];
  fingerprintInput: string;
}

export interface CorporateClaimParsedFile {
  fileName: string;
  fileType: CorporateClaimFileType;
  delimiter: string | null;
  headers: string[];
  reportDate: string | null;
  rows: CorporateClaimParsedRow[];
  fatalErrors: string[];
}

const REQUIRED = ['Registration ID', 'Program ID', 'Beneficiary Name', 'Hospital Name'];
const aliases: Record<string, string> = {
  'registration id': 'Registration ID', 'program id': 'Program ID', 'beneficiary name': 'Beneficiary Name',
  'case type': 'Case Type', 'preauth initiated date': 'Preauth Initiated Date', 'hospital name': 'Hospital Name',
  'claim initiated amount': 'Claim Initiated Amount', 'claim approved amount': 'Claim Approved Amount',
  'claim paid amount': 'Claim Paid Amount', 'case status': 'Case Status', 'payment date': 'Payment Date',
  'claim rejected date': 'Claim Rejected Date', 'utr': 'UTR', 'tds amount': 'TDS Amount', 'rf amount': 'RF Amount',
  'preauth approved amount': 'Preauth Approved Amount', 'procedure code': 'Procedure Code', 'procedure details': 'Procedure Details',
};

const clean = (value: unknown) => String(value ?? '').replace(/^\uFEFF/, '').trim().replace(/\s+/g, ' ');
const headerKey = (value: unknown) => clean(value).toLowerCase();
export const normalizeIdentifier = (value: unknown) => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
export const normalizeName = (value: unknown) => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim();

/** Portal IDs are classified only by their normalized prefix.  Never guess. */
export function schemeForProgramId(value: unknown): 'PMJAY' | 'MJPJAY' | 'UNRESOLVED' {
  const programId = normalizeIdentifier(value);
  if (programId.startsWith('PJ')) return 'PMJAY';
  if (programId.startsWith('MJ')) return 'MJPJAY';
  return 'UNRESOLVED';
}

/** Stable content identity deliberately excludes a file name, so renamed copies are duplicates. */
export async function corporateClaimFileFingerprint(file: CorporateClaimParsedFile): Promise<string> {
  const content = JSON.stringify({ type: file.fileType, reportDate: file.reportDate, headers: file.headers, rows: file.rows.map((row) => row.originalValues) });
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)));
  return Array.from(bytes).map((item) => item.toString(16).padStart(2, '0')).join('');
}

export function parseClaimAmount(value: unknown): number | null {
  const cleaned = clean(value).replace(/,/g, '').replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : null;
}

export function parseClaimDate(value: unknown): string | null {
  const text = clean(value).split(' ')[0];
  if (!text) return null;
  const ymd = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const dmy = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  const parts = ymd ? [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])] : dmy ? [Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]), Number(dmy[2]), Number(dmy[1])] : null;
  if (!parts) return null;
  const [year, month, day] = parts;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function detectClaimFileType(fileName: string, headers: string[]): CorporateClaimFileType {
  const name = fileName.toLowerCase().replace(/[^a-z]/g, '');
  const has = (header: string) => headers.some((item) => headerKey(item) === headerKey(header));
  if (has('Claim Rejected Date') || name.includes('rejected')) return 'claims_rejected';
  if (has('Case Status') || has('Claim Paid Amount') || name.includes('approvedfrombank')) return 'claims_approved_from_bank';
  if (name.includes('senttobank')) return 'claims_sent_to_bank';
  if (name.includes('pendingwithpayer')) return 'pending_with_payer';
  if (name.includes('claimstobesubmitted')) return 'claims_to_be_submitted';
  if (name.includes('undertreatment')) return 'under_treatment';
  return 'unknown';
}

export function stageForFile(fileType: CorporateClaimFileType, values: Record<string, string>): CorporateClaimStage | null {
  if (fileType === 'claims_approved_from_bank') {
    const status = clean(values['Case Status']).toLowerCase();
    if (status.includes('accomplished')) return 'payment_accomplished';
    if (status.includes('initiated')) return 'payment_initiated';
    return null;
  }
  const map: Partial<Record<CorporateClaimFileType, CorporateClaimStage>> = {
    under_treatment: 'under_treatment', claims_to_be_submitted: 'claims_to_be_submitted',
    claims_sent_to_bank: 'claims_sent_to_bank', pending_with_payer: 'pending_with_payer', claims_rejected: 'rejected',
  };
  return map[fileType] || null;
}

function splitCaret(line: string): string[] {
  const cells: string[] = []; let current = ''; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') { quoted = !quoted; continue; }
    if (char === '^' && !quoted) { cells.push(clean(current)); current = ''; continue; }
    current += char;
  }
  cells.push(clean(current)); return cells;
}

function sourceRows(text: string, fileName: string): string[][] {
  if (/\.csv$/i.test(fileName) && text.includes('^')) return text.replace(/\r/g, '').split('\n').filter(Boolean).map(splitCaret);
  const workbook = XLSX.read(text, { type: 'string', raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }).map((row) => row.map(clean));
}

export function parseCorporateClaimText(fileName: string, text: string): CorporateClaimParsedFile {
  let rows: string[][];
  try { rows = sourceRows(text, fileName); } catch { return { fileName, fileType: 'unknown', delimiter: null, headers: [], reportDate: null, rows: [], fatalErrors: ['The file could not be read.'] }; }
  const headers = rows[0] || [];
  const canonicalHeaders = headers.map((header) => aliases[headerKey(header)] || clean(header));
  const duplicateHeaders = canonicalHeaders.filter((header, index) => canonicalHeaders.indexOf(header) !== index);
  const missing = REQUIRED.filter((required) => !canonicalHeaders.includes(required));
  const fatalErrors = [
    ...(rows.length < 2 ? ['The file must contain a header and at least one data row.'] : []),
    ...(missing.length ? [`Missing required headers: ${missing.join(', ')}`] : []),
    ...(duplicateHeaders.length ? [`Duplicate headers: ${[...new Set(duplicateHeaders)].join(', ')}`] : []),
  ];
  const fileType = detectClaimFileType(fileName, canonicalHeaders);
  if (fileType === 'unknown') fatalErrors.push('This is not a recognized government claim export.');
  const reportDateMatch = fileName.match(/(\d{2})_(\d{2})_(\d{4})/);
  const reportDate = reportDateMatch ? `${reportDateMatch[3]}-${reportDateMatch[2]}-${reportDateMatch[1]}` : null;
  const parsedRows = fatalErrors.length ? [] : rows.slice(1).map((cells, index) => {
    const originalValues = Object.fromEntries(canonicalHeaders.map((header, cellIndex) => [header, clean(cells[cellIndex])]));
    const registrationId = normalizeIdentifier(originalValues['Registration ID']);
    const programId = normalizeIdentifier(originalValues['Program ID']);
    const name = normalizeName(originalValues['Beneficiary Name']);
    const issues: string[] = [];
    if (!registrationId) issues.push('Registration ID is required.');
    if (!programId) issues.push('Program ID is required.');
    if (!name) issues.push('Beneficiary Name is required.');
    if (!clean(originalValues['Hospital Name'])) issues.push('Hospital Name is required.');
    for (const key of ['Preauth Approved Amount','Claim Initiated Amount','Claim Approved Amount','Claim Paid Amount','TDS Amount','RF Amount']) {
      if (clean(originalValues[key]) && parseClaimAmount(originalValues[key]) === null) issues.push(`${key} is not a valid amount.`);
    }
    for (const key of ['Preauth Initiated Date','Payment Date','Claim Rejected Date']) {
      if (clean(originalValues[key]) && parseClaimDate(originalValues[key]) === null) issues.push(`${key} is not a valid date.`);
    }
    const normalizedValues = { registration_id: registrationId, program_id: programId, patient_name: name, preauth_date: parseClaimDate(originalValues['Preauth Initiated Date']), claim_amount: parseClaimAmount(originalValues['Claim Initiated Amount']) ?? parseClaimAmount(originalValues['Preauth Approved Amount']), approved_amount: parseClaimAmount(originalValues['Claim Approved Amount']), paid_amount: parseClaimAmount(originalValues['Claim Paid Amount']), payment_date: parseClaimDate(originalValues['Payment Date']), utr: clean(originalValues.UTR) || null, tds_amount: parseClaimAmount(originalValues['TDS Amount']), rf_amount: parseClaimAmount(originalValues['RF Amount']) };
    return { rowNumber: index + 2, originalValues, normalizedValues, issues, fingerprintInput: JSON.stringify({ fileType, reportDate, values: originalValues }) };
  });
  return { fileName, fileType, delimiter: fileName.toLowerCase().endsWith('.csv') ? '^' : null, headers: canonicalHeaders, reportDate, rows: parsedRows, fatalErrors };
}

export async function parseCorporateClaimFile(file: File): Promise<CorporateClaimParsedFile> {
  if (!/\.(csv|xls|xlsx)$/i.test(file.name)) return { fileName: file.name, fileType: 'unknown', delimiter: null, headers: [], reportDate: null, rows: [], fatalErrors: ['Only CSV, XLS, and XLSX files are accepted.'] };
  if (/\.csv$/i.test(file.name)) return parseCorporateClaimText(file.name, await file.text());
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false });
  const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]], { FS: '^' });
  return parseCorporateClaimText(`${file.name}.csv`, csv);
}

/**
 * Check payment status from existing Adamrit billing data
 * Queries bill_preparation and patient_payment_transactions tables
 */
export async function checkPaymentStatus(patientId: string, visitId: string): Promise<{
  hasBill: boolean;
  billDetails?: { bill_amount?: number; received_amount?: number; tds_amount?: number; date_of_submission?: string };
  paymentCount: number;
  totalPaid: number;
}> {
  try {
    const { createClient } = await import('@/integrations/supabase/client');
    const supabase = createClient();

    // Check bill preparation
    const { data: bill } = await supabase
      .from('bill_preparation')
      .select('bill_amount, received_amount, tds_amount, date_of_submission')
      .eq('visit_id', visitId)
      .maybeSingle();

    // Check payment transactions
    const { data: payments } = await supabase
      .from('patient_payment_transactions')
      .select('amount')
      .eq('patient_id', patientId)
      .eq('visit_id', visitId);

    const totalPaid = (payments || []).reduce((sum: number, p: { amount?: number }) => sum + (p.amount || 0), 0);

    return {
      hasBill: !!bill,
      billDetails: bill || undefined,
      paymentCount: payments?.length || 0,
      totalPaid
    };
  } catch (error) {
    // Error during payment status check - return default values
    return {
      hasBill: false,
      paymentCount: 0,
      totalPaid: 0
    };
  }
}

/**
 * Auto-match claim by patient name + visit date
 * Searches for patients with matching name and visit date within allowed range
 */
export async function autoMatchClaimByNameAndDate(
  patientName: string,
  claimDate: string | null,
  hospitalName: string
): Promise<{ patient_id: string; match_type: 'name_date' } | null> {
  try {
    const { createClient } = await import('@/integrations/supabase/client');
    const supabase = createClient();

    // Normalize patient name (uppercase, trim spaces)
    const normalizedName = clean(patientName).toUpperCase().trim().replace(/\s+/g, ' ');

    // Search for patients with exact name match
    const { data: patients } = await supabase
      .from('patients')
      .select('id, name')
      .eq('name', normalizedName)
      .limit(10);

    if (!patients || patients.length === 0) {
      return null;  // No name match
    }

    // If only one patient with this name, use it
    if (patients.length === 1) {
      return { patient_id: patients[0].id, match_type: 'name_date' };
    }

    // Multiple patients with same name: try to disambiguate by date
    if (!claimDate) {
      return null;  // Can't disambiguate without date
    }

    const claimDateObj = new Date(claimDate);
    const allowedDays = 30;  // Within 30 days

    // Check each patient for visits around the claim date
    for (const patient of patients) {
      const { data: visits } = await supabase
        .from('visits')
        .select('admission_date, discharge_date')
        .eq('patient_id', patient.id)
        .order('admission_date', { ascending: false, nullsFirst: false })
        .limit(5);

      if (visits && visits.length > 0) {
        // Find visit closest to claim date
        for (const visit of visits) {
          if (!visit.admission_date) continue;

          const admitDate = new Date(visit.admission_date);
          const daysDiff = Math.abs((claimDateObj.getTime() - admitDate.getTime()) / (1000 * 60 * 60 * 24));

          if (daysDiff <= allowedDays) {
            return { patient_id: patient.id, match_type: 'name_date' };
          }
        }
      }
    }

    return null;  // No good date match found
  } catch (error) {
    return null;  // Error during search
  }
}

/**
 * Store a linkage between government ID and patient
 */
export async function storePatientLinkage(
  hospitalName: string,
  patientId: string,
  governmentId: string,
  idType: 'registration_id' | 'program_id',
  matchType: 'auto_name_date' | 'manual'
): Promise<boolean> {
  try {
    const { createClient } = await import('@/integrations/supabase/client');
    const supabase = createClient();

    const { error } = await supabase.from('patient_government_linkage').insert({
      hospital_name: hospitalName.toLowerCase(),
      patient_id: patientId,
      government_id: governmentId,
      id_type: idType,
      matched_by: matchType
    });

    return !error;
  } catch (error) {
    return false;
  }
}
