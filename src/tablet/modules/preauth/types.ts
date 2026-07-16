export interface PreauthCase {
  visitUuid: string;
  visitId: string;
  patientUuid: string;
  patientName: string;
  patientId: string;
  registrationId: string;
  yojanaRegistrationId: string;
  packageName: string;
  packageAmount: string;
  admissionDate: string | null;
  dischargeDate: string | null;
  patientType: string | null;
  age: number | null;
  gender: string | null;
}

export interface SelectOption {
  value: string;
  label: string;
  selectedLabel?: string;
}
