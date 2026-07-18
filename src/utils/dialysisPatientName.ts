export const DIALYSIS_PATIENT_SUFFIX = '(dialysis)';

const DIALYSIS_TERMS = [
  'dialysis',
  'hemodialysis',
  'haemodialysis',
  'hemo dialysis',
  'haemo dialysis',
  'renal dialysis',
];

const YOJANA_TERMS = [
  'yojana',
  'mjpjy',
  'pmjay',
  'pm-jay',
  'ayushman',
  'ab-pmjay',
  'ab pmjay',
  'mahatma jyotiba',
  'maharashtra yojana',
];

const normalize = (value: unknown) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

export const isDialysisText = (value: unknown): boolean => {
  const text = normalize(value);
  return !!text && DIALYSIS_TERMS.some((term) => text.includes(term));
};

export const isYojanaText = (value: unknown): boolean => {
  const text = normalize(value);
  return !!text && YOJANA_TERMS.some((term) => text.includes(term));
};

const visitSurgeryIndicatesDialysis = (surgery: any): boolean => {
  return [
    surgery?.name,
    surgery?.surgery_name,
    surgery?.cghs_surgery?.name,
    surgery?.yojana_mh_procedures?.procedure_name,
    surgery?.yojana_mh_procedures?.package_name,
    surgery?.yojana_mh_procedures?.specialty,
  ].some(isDialysisText);
};

export const visitIndicatesDialysisPackage = (visit: any): boolean => {
  if (!visit) return false;

  const directFields = [
    visit.package_name,
    visit.treatment_type,
    visit.reason_for_visit,
    visit.sst_treatment,
    visit.cghs_code,
  ];

  return directFields.some(isDialysisText) || (visit.visit_surgeries || []).some(visitSurgeryIndicatesDialysis);
};

export const visitBelongsToYojana = (visit: any): boolean => {
  if (!visit) return false;

  return [
    visit.corporate,
    visit.insurance_type,
    visit.patients?.corporate,
    visit.patient?.corporate,
  ].some(isYojanaText);
};

export const shouldShowDialysisSuffixForVisit = (visit: any): boolean => {
  return visitBelongsToYojana(visit) && visitIndicatesDialysisPackage(visit);
};

export const appendDialysisSuffix = (name: unknown, shouldAppend: boolean): string => {
  const patientName = String(name ?? '').trim();
  if (!patientName) return '';
  if (!shouldAppend) return patientName;

  const lowerName = patientName.toLowerCase();
  if (lowerName.endsWith('(dialysis)') || lowerName.endsWith('[dialysis]')) return patientName;

  return `${patientName} ${DIALYSIS_PATIENT_SUFFIX}`;
};

export const formatDialysisPatientName = (name: unknown, visit: any): string => {
  return appendDialysisSuffix(name, shouldShowDialysisSuffixForVisit(visit));
};
