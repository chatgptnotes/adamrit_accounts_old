
// @ts-nocheck
import { useEffect, useState } from 'react';
import { PatientFormData } from './types';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  EMPTY_SIMILAR_STATE,
  contactChanges,
  similarPatientsBlockSubmit,
  type SimilarPatientsState,
} from './SimilarPatientsPrompt';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { generatePatientId } from '@/utils/patientIdGenerator';
import { useAuth } from '@/contexts/AuthContext';
import { logActivity } from '@/lib/activity-logger';
import { uploadPatientDocs } from '@/tablet/hooks/usePatientDocs';
import {
  buildRegistrationDocumentNotes,
  getCorporateRegistrationDocuments,
  REGISTRATION_DOCUMENT_CATEGORY,
} from '@/lib/registrationDocuments';
import { RegistrationDocumentSelection } from './types';

export const usePatientRegistration = (
  onClose: () => void,
  initialRelationshipManager?: string,
  onRegistrationComplete?: (patientId: string) => void,
) => {
  const [dateOfBirth, setDateOfBirth] = useState<Date>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  // Duplicate-name guard. The form cannot be submitted while patients of the
  // same name are on screen and the user has neither picked one nor said this
  // is somebody else.
  const [similarPatients, setSimilarPatients] = useState<SimilarPatientsState>(EMPTY_SIMILAR_STATE);
  const queryClient = useQueryClient();
  const { hospitalConfig } = useAuth();
  
  const [formData, setFormData] = useState<PatientFormData>({
    patientName: '',
    corporate: '',
    insurancePersonNo: '',
    age: '',
    gender: '',
    phone: '',
    address: '',
    emergencyContactName: '',
    emergencyContactMobile: '',
    secondEmergencyContactName: '',
    secondEmergencyContactMobile: '',
    aadharPassport: '',
    ayushmanId: '',
    aadharId: '',
    quarterPlotNo: '',
    ward: '',
    panchayat: '',
    relationshipManager: initialRelationshipManager || '',
    pinCode: '',
    state: '',
    cityTown: '',
    bloodGroup: '',
    spouseName: '',
    allergies: '',
    relativePhoneNo: '',
    instructions: '',
    identityType: '',
    email: '',
    privilegeCardNumber: '',
    billingLink: '',
    patientPhoto: '',
    hospitalName: hospitalConfig.name
  });

  const [registrationDocuments, setRegistrationDocuments] = useState<RegistrationDocumentSelection[]>([]);
  const [patientPhotoFile, setPatientPhotoFile] = useState<File | null>(null);

  const normalizedCorporate = formData.corporate.trim().toLowerCase();
  const isEsicCorporate = normalizedCorporate.includes('esic');

  useEffect(() => {
    if (initialRelationshipManager !== undefined && !formData.relationshipManager) {
      setFormData((prev) => ({ ...prev, relationshipManager: initialRelationshipManager }));
    }
  }, [initialRelationshipManager, formData.relationshipManager]);

  const syncRegistrationDocuments = (corporate: string, existing: RegistrationDocumentSelection[]) => {
    const requiredDocuments = getCorporateRegistrationDocuments(corporate);
    if (requiredDocuments.length === 0) return [];

    return requiredDocuments.map((label) => ({
      label,
      file: existing.find((document) => document.label === label)?.file || null,
    }));
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (field === 'corporate') {
      setRegistrationDocuments((prev) => syncRegistrationDocuments(value, prev));
    }
  };

  const resetForm = () => {
    setFormData({
      patientName: '',
      corporate: '',
      insurancePersonNo: '',
      age: '',
      gender: '',
      phone: '',
      address: '',
      emergencyContactName: '',
      emergencyContactMobile: '',
      secondEmergencyContactName: '',
      secondEmergencyContactMobile: '',
      aadharPassport: '',
      ayushmanId: '',
      aadharId: '',
      quarterPlotNo: '',
      ward: '',
      panchayat: '',
      relationshipManager: initialRelationshipManager || '',
      pinCode: '',
      state: '',
      cityTown: '',
      bloodGroup: '',
      spouseName: '',
      allergies: '',
      relativePhoneNo: '',
      instructions: '',
      identityType: '',
      email: '',
      privilegeCardNumber: '',
      billingLink: '',
      patientPhoto: '',
      hospitalName: hospitalConfig.name
    });
    setDateOfBirth(undefined);
    setPatientPhotoFile(null);
    setRegistrationDocuments([]);
  };

  const handleRegistrationDocumentSelect = (label: string, file: File | null) => {
    setRegistrationDocuments((prev) =>
      prev.map((document) =>
        document.label === label ? { ...document, file } : document,
      ),
    );
  };

  const handleRegistrationDocumentRemove = (label: string) => {
    handleRegistrationDocumentSelect(label, null);
  };

  const handlePatientPhotoSelect = (file: File | null) => {
    setPatientPhotoFile(file);
  };

  const validateForm = (): boolean => {
    if (!formData.patientName || !formData.corporate || !formData.age || !formData.gender || 
        !formData.phone || !formData.address || !formData.emergencyContactName || 
        !formData.emergencyContactMobile) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return false;
    }

    // Check if ESIC is selected but Insurance Person No. is empty
    if (isEsicCorporate && !formData.insurancePersonNo) {
      toast({
        title: "Error",
        description: "Insurance Person No. is required for ESIC patients",
        variant: "destructive"
      });
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    if (similarPatientsBlockSubmit(similarPatients)) {
      toast({
        title: 'This name is already registered',
        description:
          'Pick the existing patient so the visit joins their history, or tick "This is a different person" to register a new record.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    // Reuse an already-registered patient when the submitted details match one,
    // so repeat visitors (e.g. recurring dialysis patients) keep a single record
    // and their sittings are counted together instead of splitting across duplicates.
    const findExistingPatient = async (): Promise<any | null> => {
      // The user picked a patient off the duplicate-name list: that record is
      // the answer, no guessing from phone or Aadhaar needed.
      if (similarPatients.chosen) {
        // Their file keeps what it has unless the user asked to refresh it.
        const changes = similarPatients.updateContact
          ? contactChanges(similarPatients.chosen, formData.phone, formData.address)
          : {};
        if (Object.keys(changes).length > 0) {
          await supabase.from('patients').update(changes).eq('id', similarPatients.chosen.id);
        }
        const { data } = await supabase
          .from('patients')
          .select('*')
          .eq('id', similarPatients.chosen.id)
          .limit(1);
        if (data && data.length > 0) return data[0];
      }

      const aadhaarDigits = (formData.aadharId || '').replace(/\D/g, '');
      if (aadhaarDigits) {
        const { data } = await supabase
          .from('patients')
          .select('*')
          .eq('hospital_name', formData.hospitalName)
          .eq('aadhaar_number', aadhaarDigits)
          .limit(1);
        if (data && data.length > 0) return data[0];
      }

      const phoneDigits = formData.phone.replace(/\D/g, '');
      const trimmedName = formData.patientName.trim();
      if (!phoneDigits || !trimmedName) return null;

      const { data } = await supabase
        .from('patients')
        .select('*')
        .eq('hospital_name', formData.hospitalName)
        .ilike('phone', `%${phoneDigits}%`)
        .ilike('name', trimmedName)
        .limit(1);
      return data && data.length > 0 ? data[0] : null;
    };

    const createPatientWithRetry = async (maxRetries = 3): Promise<any> => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Generate custom patient ID for each attempt
          const customPatientId = await generatePatientId(hospitalConfig.id);

          // Create record in patients table
          const patientData = {
            patients_id: customPatientId,
            name: formData.patientName,
            insurance_person_no: isEsicCorporate ? formData.insurancePersonNo : null,
            corporate: formData.corporate,
            age: formData.age ? parseInt(formData.age) : null,
            gender: formData.gender,
            phone: formData.phone,
            address: formData.address,
            emergency_contact_name: formData.emergencyContactName,
            emergency_contact_mobile: formData.emergencyContactMobile,
            second_emergency_contact_name: formData.secondEmergencyContactName || null,
            second_emergency_contact_mobile: formData.secondEmergencyContactMobile || null,
            date_of_birth: dateOfBirth ? format(dateOfBirth, 'yyyy-MM-dd') : null,
            aadhar_passport: formData.aadharPassport || null,
            aadhaar_number: formData.aadharId || null,
            quarter_plot_no: formData.quarterPlotNo || null,
            ward: formData.ward || null,
            panchayat: formData.panchayat || null,
            relationship_manager: formData.relationshipManager || null,
            pin_code: formData.pinCode || null,
            state: formData.state || null,
            city_town: formData.cityTown || null,
            blood_group: formData.bloodGroup || null,
            spouse_name: formData.spouseName || null,
            allergies: formData.allergies || null,
            relative_phone_no: formData.relativePhoneNo || null,
            instructions: formData.instructions || null,
            identity_type: formData.identityType || null,
            email: formData.email || null,
            privilege_card_number: formData.privilegeCardNumber || null,
            billing_link: formData.billingLink || null,
            hospital_name: formData.hospitalName
          };

          const { data: newPatient, error } = await supabase
            .from('patients')
            .insert(patientData)
            .select()
            .single();

          if (error) {
            // Check if it's a duplicate key error
            if (error.code === '23505' && error.message.includes('patients_patients_id_key')) {
              console.warn(`Attempt ${attempt}: Duplicate patient ID ${customPatientId}, retrying...`);
              if (attempt === maxRetries) {
                throw new Error(`Failed to generate unique patient ID after ${maxRetries} attempts. Please try again.`);
              }
              // Wait a brief moment before retrying
              await new Promise(resolve => setTimeout(resolve, 100));
              continue;
            }
            console.error('Error creating patient:', error);
            throw error;
          }

          return { newPatient, customPatientId };
        } catch (error) {
          if (attempt === maxRetries) {
            throw error;
          }
        }
      }
    };

    try {
      const existingPatient = await findExistingPatient();

      const { newPatient, customPatientId } = existingPatient
        ? { newPatient: existingPatient, customPatientId: existingPatient.patients_id }
        : await createPatientWithRetry();

      if (!existingPatient) {
        // Log patient creation activity
        logActivity('patient_create', {
          patient_id: newPatient.id,
          patients_id: customPatientId,
          patient_name: formData.patientName,
        });
      }

      // IMPORTANT: Create initial record in patient_data table with proper patient_id
      if (!existingPatient) try {
        const patientDataRecord = {
          patient_name: formData.patientName,
          patient_id: customPatientId, // CRITICAL: Use readable patient_id, not UUID
          age: formData.age || '',
          sex: formData.gender || '',
          patient_type: formData.corporate || '',
          // Set default values for required fields
          mrn: '', // Will be set when first visit is created
          sst_or_secondary_treatment: formData.corporate === 'esic' ? 'ESIC' : 'Private',
          referral_original_yes_no: 'No',
          e_pahachan_card_yes_no: 'No',
          hitlabh_or_entitelment_benefits_yes_no: 'No',
          adhar_card_yes_no: 'Yes',
          remark_1: `Patient ID: ${customPatientId}`,
          remark_2: `Registered: ${new Date().toLocaleDateString()}`
        };


        const { data: patientDataResult, error: patientDataError } = await supabase
          .from('patient_data')
          .insert(patientDataRecord)
          .select()
          .single();

        if (patientDataError) {
          console.error('Error creating patient_data record:', patientDataError);
          // Don't fail the whole process for this
        } else {
        }
      } catch (patientDataError) {
        console.error('Error handling patient_data creation:', patientDataError);
      }

      const selectedRegistrationDocuments = registrationDocuments.filter((document) => document.file);
      const failedDocumentUploads: string[] = [];
      let uploadedDocumentCount = 0;

      if (patientPhotoFile) {
        try {
          await uploadPatientDocs([patientPhotoFile], {
            patientId: newPatient.id,
            patientName: formData.patientName,
            category: REGISTRATION_DOCUMENT_CATEGORY,
            notes: buildRegistrationDocumentNotes({
              source: 'patient_registration',
              corporate: formData.corporate,
              documentName: 'Patient Photo',
            }),
          });
          uploadedDocumentCount += 1;
        } catch (uploadError) {
          failedDocumentUploads.push('Patient Photo');
          console.error('Error uploading patient photo:', uploadError);
        }
      }

      for (const document of selectedRegistrationDocuments) {
        try {
          await uploadPatientDocs([document.file!], {
            patientId: newPatient.id,
            patientName: formData.patientName,
            category: REGISTRATION_DOCUMENT_CATEGORY,
            notes: buildRegistrationDocumentNotes({
              source: 'patient_registration',
              corporate: formData.corporate,
              documentName: document.label,
            }),
          });
          uploadedDocumentCount += 1;
        } catch (uploadError) {
          failedDocumentUploads.push(document.label);
          console.error(`Error uploading registration document ${document.label}:`, uploadError);
        }
      }

      toast({
        title: failedDocumentUploads.length > 0
          ? "Patient saved with upload issues"
          : existingPatient ? "Patient already registered" : "Success",
        description: failedDocumentUploads.length > 0
          ? `Patient ID: ${customPatientId}. Uploaded ${uploadedDocumentCount}/${selectedRegistrationDocuments.length + (patientPhotoFile ? 1 : 0)} registration documents.`
          : existingPatient
            ? `Patient ID: ${customPatientId}. Visit will be counted on the same patient record.`
            : `Patient registered successfully! Patient ID: ${customPatientId}`,
      });

      // Refresh the patients list
      queryClient.invalidateQueries({ queryKey: ['dashboard-patients'] });
      queryClient.invalidateQueries({ queryKey: ['patients', hospitalConfig.name] });
      queryClient.invalidateQueries({ queryKey: ['patient-data'] });
      queryClient.invalidateQueries({ queryKey: ['spreadsheet-data'] });

      onRegistrationComplete?.(newPatient.id);

      resetForm();
      onClose();
    } catch (error) {
      console.error('Error submitting form:', error);
      toast({
        title: "Error",
        description: "Failed to register patient. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    resetForm();
    onClose();
  };

  return {
    formData,
    dateOfBirth,
    isSubmitting,
    registrationDocuments,
    handlePatientPhotoSelect,
    handleInputChange,
    setDateOfBirth,
    handleRegistrationDocumentSelect,
    handleRegistrationDocumentRemove,
    handleSubmit,
    handleCancel,
    similarPatients,
    setSimilarPatients
  };
};
