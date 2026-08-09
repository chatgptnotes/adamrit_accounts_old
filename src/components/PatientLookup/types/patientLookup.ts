
export interface Patient {
  id: string;
  name: string;
  patients_id?: string;
  primary_diagnosis?: string;
  admission_date?: string;
  created_at: string;
  surgeon?: string;
  consultant?: string;
  // Contact + demographic details shown in search results.
  phone?: string;
  age?: number | string;
  gender?: string;
  address?: string;
  corporate?: string;
  email?: string;
  aadhaar_number?: string | null;
}

export interface PatientLookupProps {
  isOpen: boolean;
  onClose: () => void;
  onPatientSelected?: (patient: Patient) => void;
  onNewPatientRegistration?: () => void;
}

export interface SearchCriteria {
  mobile: string;
  name: string;
  patientId: string;
  aadhaar: string;
}
