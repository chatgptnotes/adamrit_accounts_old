/**
 * The generated discharge summary, as plain lines.
 *
 * Two places render this: the printable page at /discharge-summary-print, and
 * the Documents & Images section, which now folds it into the combined export
 * and offers it as its own PDF. They must not drift apart -- a summary that
 * reads differently depending on which button produced it is worse than one
 * that is merely plain -- so the wording lives here rather than in either.
 */

export interface DischargeSummarySource {
  patientName?: string;
  age?: string | number;
  gender?: string;
  visitId?: string;
  admissionDate?: string;
  dischargeDate?: string;
  primaryDiagnosis?: string;
  secondaryDiagnoses?: string[];
  medications?: string[];
  complaints?: string[];
  vitals?: string[];
  investigations?: string[];
  treatmentCourse?: string[];
  condition?: string[];
}

const list = (values: string[] | undefined): string =>
  values && values.length > 0 ? values.join(', ') : 'N/A';

/** One "Label: value" line per field, in the order the printed page shows them. */
export function buildDischargeSummaryLines(data: DischargeSummarySource): string[] {
  return [
    `Name: ${data.patientName}`,
    `Age: ${data.age}`,
    `Gender: ${data.gender}`,
    `Visit ID: ${data.visitId}`,
    `Admission Date: ${data.admissionDate}`,
    `Discharge Date: ${data.dischargeDate}`,
    `Primary Diagnosis: ${data.primaryDiagnosis}`,
    `Secondary Diagnosis: ${list(data.secondaryDiagnoses)}`,
    `Medications: ${list(data.medications)}`,
    `Presenting Complaints: ${list(data.complaints)}`,
    `Vital Signs: ${list(data.vitals)}`,
    `Investigations: ${list(data.investigations)}`,
    `Treatment Course: ${list(data.treatmentCourse)}`,
    `Discharge Condition: ${list(data.condition)}`,
  ];
}

/** The same content as one block, which is what the printable page renders. */
export function buildDischargeSummaryText(data: DischargeSummarySource): string {
  return buildDischargeSummaryLines(data).join('\n');
}
