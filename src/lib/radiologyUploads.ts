export const RADIOLOGY_UPLOAD_CATEGORIES = [
  'radiology_investigation',
  'xray',
  'mri_report',
  'ct_scan_report',
] as const;

export const RADIOLOGY_UPLOAD_CATEGORY_LABELS: Record<string, string> = {
  radiology_investigation: 'Radiology',
  xray: 'X-Ray',
  mri_report: 'MRI',
  ct_scan_report: 'CT',
};
