
// @ts-nocheck
import { useState } from 'react';
import { PatientFormData } from './types';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { generatePatientId } from '@/utils/patientIdGenerator';
import { useAuth } from '@/contexts/AuthContext';
import { logActivity } from '@/lib/activity-logger';

export const usePatientRegistration = (onClose: () => void) => {
  const [dateOfBirth, setDateOfBirth] = useState<Date>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
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
    relationshipManager: '',
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

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const normalizedCorporate = formData.corporate.trim().toLowerCase();
  const isEsicCorporate = normalizedCorporate.includes('esic');

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
      relationshipManager: '',
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

    setIsSubmitting(true);

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
      const { newPatient, customPatientId } = await createPatientWithRetry();


      // Log patient creation activity
      logActivity('patient_create', {
        patient_id: newPatient.id,
        patients_id: customPatientId,
        patient_name: formData.patientName,
      });

      // IMPORTANT: Create initial record in patient_data table with proper patient_id
      try {
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

      toast({
        title: "Success",
        description: `Patient registered successfully! Patient ID: ${customPatientId}`,
      });

      // Refresh the patients list
      queryClient.invalidateQueries({ queryKey: ['dashboard-patients'] });
      queryClient.invalidateQueries({ queryKey: ['patients', hospitalConfig.name] });
      queryClient.invalidateQueries({ queryKey: ['patient-data'] });
      queryClient.invalidateQueries({ queryKey: ['spreadsheet-data'] });

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
    handleInputChange,
    setDateOfBirth,
    handleSubmit,
    handleCancel
  };
};
