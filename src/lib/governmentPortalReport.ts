export const GOVERNMENT_PORTAL_REQUIRED_COLUMNS = [
  'Registration ID',
  'Program ID',
  'Beneficiary Name',
  'Case Type',
  'Preauth Initiated Date',
  'Speciality Code',
  'Category Details',
  'Procedure Code',
  'Procedure Details',
  'Hospital Name',
  'Preauth Approved Amount',
] as const;

export type GovernmentPortalColumn = typeof GOVERNMENT_PORTAL_REQUIRED_COLUMNS[number];

export type GovernmentPortalSection =
  | 'dialysis'
  | 'generalMedical'
  | 'surgical'
  | 'unclassified';

export type GovernmentPortalPatientStatus =
  | 'pending'
  | 'extension_requested'
  | 'approved'
  | 'rejected'
  | 'closed';

export interface GovernmentPortalRow {
  id?: string;
  rowNumber: number;
  values: Record<GovernmentPortalColumn, string>;
  section: GovernmentPortalSection;
  sectionLabel: string;
  issues: string[];
  isHopeHospital: boolean;
  isMedicalCase: boolean;
  isDialysis: boolean;
  daysSincePreauth: number | null;
  extensionNeeded: boolean;
  preauthDateLabel: string;
  status: GovernmentPortalPatientStatus;
}

export interface GovernmentPortalReport {
  rows: GovernmentPortalRow[];
  fatalErrors: string[];
  missingColumns: GovernmentPortalColumn[];
  totalRows: number;
  counts: {
    dialysis: number;
    generalMedical: number;
    surgical: number;
    extensionNeeded: number;
    unclassified: number;
  };
  whatsApp: {
    medicalPatients: string;
    urgentExtensions: string;
    dialysisBatchStatus: string;
  };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const SECTION_LABELS: Record<GovernmentPortalSection, string> = {
  dialysis: 'Dialysis',
  generalMedical: 'General Medical',
  surgical: 'Surgical',
  unclassified: 'Unclassified/Error',
};

const DIALYSIS_TERMS = [
  'dialysis',
  'hemodialysis',
  'haemodialysis',
  'haemo dialysis',
  'hemo dialysis',
  'renal dialysis',
];

const cleanCell = (value: string): string => {
  const trimmed = value.replace(/^\uFEFF/, '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const normalizeHeader = (value: string): string =>
  cleanCell(value).replace(/\s+/g, ' ').toLowerCase();

const normalizeValue = (value: string): string =>
  cleanCell(value).replace(/\s+/g, ' ').toLowerCase();

const splitCaretLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === '^' && !inQuotes) {
      cells.push(cleanCell(current));
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(cleanCell(current));
  return cells;
};

export const parsePortalDate = (rawValue: string): Date | null => {
  const value = cleanCell(rawValue);
  if (!value) return null;

  const firstPart = value.split(/\s+/)[0];
  const ymd = firstPart.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const dmy = firstPart.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);

  let year: number;
  let month: number;
  let day: number;

  if (ymd) {
    year = Number(ymd[1]);
    month = Number(ymd[2]);
    day = Number(ymd[3]);
  } else if (dmy) {
    day = Number(dmy[1]);
    month = Number(dmy[2]);
    year = Number(dmy[3]);
    if (year < 100) year += 2000;
  } else {
    const fallback = new Date(value);
    if (Number.isNaN(fallback.getTime())) return null;
    return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  }

  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
};

const getDaysSince = (date: Date | null, today: Date): number | null => {
  if (!date) return null;
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.floor((todayStart.getTime() - dateStart.getTime()) / MS_PER_DAY);
};

const classifyRow = (
  values: Record<GovernmentPortalColumn, string>,
  issues: string[],
  today: Date,
): Omit<GovernmentPortalRow, 'rowNumber' | 'values'> => {
  const hasStructuralIssue = issues.length > 0;
  const caseType = normalizeValue(values['Case Type']);
  const hospitalName = normalizeValue(values['Hospital Name']);
  const procedureCode = normalizeValue(values['Procedure Code']);
  const procedureDetails = normalizeValue(values['Procedure Details']);
  const categoryDetails = normalizeValue(values['Category Details']);
  const specialityCode = normalizeValue(values['Speciality Code']);
  const dialysisHaystack = [
    procedureCode,
    procedureDetails,
    categoryDetails,
    specialityCode,
  ].join(' ');

  const isHopeHospital = hospitalName.includes('hope hospital');
  const isMedicalCase = caseType === 'medical' || caseType.includes('medical');
  const isSurgicalCase =
    caseType === 'surgical' ||
    caseType.includes('surgical') ||
    caseType.includes('surgery');
  const isDialysis = DIALYSIS_TERMS.some((term) => dialysisHaystack.includes(term));
  const parsedDate = parsePortalDate(values['Preauth Initiated Date']);
  const daysSincePreauth = getDaysSince(parsedDate, today);

  if (isMedicalCase && values['Preauth Initiated Date'].trim() && daysSincePreauth === null) {
    issues.push('Preauth Initiated Date could not be read');
  }

  let section: GovernmentPortalSection = 'unclassified';
  if (!isHopeHospital) {
    issues.push('Hospital Name does not contain Hope Hospital');
  } else if (hasStructuralIssue) {
    section = 'unclassified';
  } else if (isDialysis) {
    section = 'dialysis';
  } else if (isMedicalCase) {
    section = 'generalMedical';
  } else if (isSurgicalCase) {
    section = 'surgical';
  } else {
    issues.push('Case Type did not match Medical or Surgical');
  }

  const extensionNeeded =
    section === 'generalMedical' &&
    daysSincePreauth !== null &&
    daysSincePreauth > 5;

  return {
    section,
    sectionLabel: SECTION_LABELS[section],
    issues,
    isHopeHospital,
    isMedicalCase,
    isDialysis,
    daysSincePreauth,
    extensionNeeded,
    preauthDateLabel: parsedDate ? parsedDate.toLocaleDateString('en-IN') : '',
    status: 'pending',
  };
};

const procedureLabel = (row: GovernmentPortalRow): string => {
  const code = row.values['Procedure Code'];
  const details = row.values['Procedure Details'];
  if (code && details) return `${code} - ${details}`;
  return code || details || 'Procedure not available';
};

const patientLine = (row: GovernmentPortalRow, includeDays = false): string => {
  const name = row.values['Beneficiary Name'] || 'Name not available';
  const registrationId = row.values['Registration ID'] || 'No Registration ID';
  const days =
    includeDays && row.daysSincePreauth !== null
      ? ` - ${row.daysSincePreauth} days since preauth`
      : '';
  return `${name} - ${registrationId} - ${procedureLabel(row)}${days}`;
};

const numberedLines = (rows: GovernmentPortalRow[], includeDays = false): string[] =>
  rows.map((row, index) => `${index + 1}. ${patientLine(row, includeDays)}`);

const buildWhatsAppText = (rows: GovernmentPortalRow[]): GovernmentPortalReport['whatsApp'] => {
  const medicalDialysis = rows.filter(
    (row) => row.isMedicalCase && row.section === 'dialysis',
  );
  const generalMedical = rows.filter((row) => row.section === 'generalMedical');
  const extensionNeeded = generalMedical.filter((row) => row.extensionNeeded);
  const dialysis = rows.filter((row) => row.section === 'dialysis');

  const medicalPatients = [
    'Medical Patients',
    '',
    `Dialysis (${medicalDialysis.length})`,
    ...(medicalDialysis.length ? numberedLines(medicalDialysis) : ['No dialysis patients found.']),
    '',
    `General Medical - Non Dialysis (${generalMedical.length})`,
    ...(generalMedical.length ? numberedLines(generalMedical) : ['No general medical patients found.']),
  ].join('\n');

  const urgentExtensions = [
    'Urgent Extensions Needed',
    '',
    ...(extensionNeeded.length
      ? numberedLines(extensionNeeded, true)
      : ['No urgent extensions needed.']),
  ].join('\n');

  const dialysisBatchStatus = [
    'Dialysis Batch Status',
    '',
    ...(dialysis.length ? numberedLines(dialysis) : ['No dialysis rows found.']),
  ].join('\n');

  return {
    medicalPatients,
    urgentExtensions,
    dialysisBatchStatus,
  };
};

export const parseGovernmentPortalReport = (
  fileText: string,
  today = new Date(),
): GovernmentPortalReport => {
  const lines = fileText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0);

  const emptyReport: GovernmentPortalReport = {
    rows: [],
    fatalErrors: [],
    missingColumns: [],
    totalRows: 0,
    counts: {
      dialysis: 0,
      generalMedical: 0,
      surgical: 0,
      extensionNeeded: 0,
      unclassified: 0,
    },
    whatsApp: {
      medicalPatients: 'Medical Patients\n\nNo medical patients found.',
      urgentExtensions: 'Urgent Extensions Needed\n\nNo urgent extensions needed.',
      dialysisBatchStatus: 'Dialysis Batch Status\n\nNo dialysis rows found.',
    },
  };

  if (lines.length < 2) {
    return {
      ...emptyReport,
      fatalErrors: ['File must contain a header row and at least one data row.'],
    };
  }

  const headers = splitCaretLine(lines[0]);
  const normalizedHeaderMap = new Map<string, number>();
  headers.forEach((header, index) => {
    normalizedHeaderMap.set(normalizeHeader(header), index);
  });

  const missingColumns = GOVERNMENT_PORTAL_REQUIRED_COLUMNS.filter(
    (column) => !normalizedHeaderMap.has(normalizeHeader(column)),
  );

  if (missingColumns.length > 0) {
    return {
      ...emptyReport,
      missingColumns,
      totalRows: lines.length - 1,
      fatalErrors: [`Missing required columns: ${missingColumns.join(', ')}`],
    };
  }

  const rows = lines.slice(1).map((line, lineIndex) => {
    const cells = splitCaretLine(line);
    const values = {} as Record<GovernmentPortalColumn, string>;
    GOVERNMENT_PORTAL_REQUIRED_COLUMNS.forEach((column) => {
      const index = normalizedHeaderMap.get(normalizeHeader(column));
      values[column] = index === undefined ? '' : cleanCell(cells[index] || '');
    });

    const issues: string[] = [];
    if (cells.length !== headers.length) {
      issues.push(`Column count mismatch: expected ${headers.length}, found ${cells.length}`);
    }

    const classified = classifyRow(values, issues, today);
    return {
      rowNumber: lineIndex + 2,
      values,
      ...classified,
    };
  });

  const hasHopeHospitalRows = rows.some((row) => row.isHopeHospital);
  const fatalErrors = hasHopeHospitalRows
    ? []
    : ['At least one row must have Hospital Name containing Hope Hospital.'];

  const counts = {
    dialysis: rows.filter((row) => row.section === 'dialysis').length,
    generalMedical: rows.filter((row) => row.section === 'generalMedical').length,
    surgical: rows.filter((row) => row.section === 'surgical').length,
    extensionNeeded: rows.filter((row) => row.extensionNeeded).length,
    unclassified: rows.filter((row) => row.section === 'unclassified').length,
  };

  return {
    rows,
    fatalErrors,
    missingColumns,
    totalRows: rows.length,
    counts,
    whatsApp: buildWhatsAppText(rows),
  };
};
