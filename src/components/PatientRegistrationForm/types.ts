
export interface PatientFormData {
  patientName: string;
  corporate: string;
  insurancePersonNo: string;
  age: string;
  gender: string;
  phone: string;
  address: string;
  emergencyContactName: string;
  emergencyContactMobile: string;
  secondEmergencyContactName: string;
  secondEmergencyContactMobile: string;
  aadharPassport: string;
  ayushmanId: string;
  aadharId: string;
  quarterPlotNo: string;
  ward: string;
  panchayat: string;
  relationshipManager: string;
  pinCode: string;
  state: string;
  cityTown: string;
  bloodGroup: string;
  spouseName: string;
  allergies: string;
  relativePhoneNo: string;
  instructions: string;
  identityType: string;
  email: string;
  privilegeCardNumber: string;
  billingLink: string;
  patientPhoto: string;
  hospitalName: string;
}

export interface PatientRegistrationFormProps {
  isOpen: boolean;
  onClose: () => void;
  selectedReferral?: {
    id: string;
    is_direct: boolean;
    referee_initials?: string | null;
  } | null;
  onRegistrationComplete?: (patientId: string) => void;
}

export interface RegistrationDocumentSelection {
  label: string;
  file: File | null;
}
