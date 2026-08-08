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
