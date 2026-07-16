export interface PreauthCase {
  visitUuid: string;
  visitId: string;
  patientUuid: string;
  patientName: string;
  patientId: string;
  registrationId: string;
  yojanaRegistrationId: string;
  packageName: string;
  admissionDate: string;
  dischargeDate: string;
  surgeryDate: string;
  age: number | null;
  gender: string;
}

