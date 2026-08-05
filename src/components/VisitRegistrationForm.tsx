import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { VisitDetailsSection } from '@/components/visit/VisitDetailsSection';
import { VisitFormActions } from '@/components/visit/VisitFormActions';
import { logActivity } from '@/lib/activity-logger';
import { generateVisitId } from '@/utils/visitIdGenerator';
import { RegistrationDocumentSelection } from '@/components/PatientRegistrationForm/types';
import {
  buildRegistrationDocumentNotes,
  getCorporateRegistrationDocuments,
  REGISTRATION_DOCUMENT_CATEGORY,
} from '@/lib/registrationDocuments';
import { uploadPatientDocs, usePatientDocs } from '@/tablet/hooks/usePatientDocs';
import { isYojanaPanel } from '@/lib/yojanaPanel';

interface VisitRegistrationFormProps {
  isOpen: boolean;
  onClose: () => void;
  patient: {
    id: string;
    name: string;
    patients_id?: string;
  };
  existingVisit?: any;  // Optional existing visit data for editing
  editMode?: boolean;   // Flag to indicate edit mode
  defaultPatientType?: string;
}

export const VisitRegistrationForm: React.FC<VisitRegistrationFormProps> = ({
  isOpen,
  onClose,
  patient,
  existingVisit,
  editMode = false,
  defaultPatientType = '',
}) => {
  const initialPatientType = defaultPatientType || 'OPD';
  const initialVisitType = initialPatientType === 'Emergency'
    ? 'emergency'
    : initialPatientType === 'IPD'
      ? 'patient-admission'
      : initialPatientType === 'Dialysis'
        ? 'routine-checkup'
        : 'consultation';
  const [visitDate, setVisitDate] = useState<Date>(new Date());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  
  const [formData, setFormData] = useState({
    visitType: initialVisitType,
    appointmentWith: '',
    reasonForVisit: '',
    relationWithEmployee: '',
    status: '',
    referringDoctor: '',
    relationshipManager: '',
    claimId: '',
    cardNo: '',
    thumbRegistrationNo: '',
    yojanaRegistrationId: '',
    treatmentType: '',
    patientType: initialPatientType,
    wardAllotted: '',
    roomAllotted: '',
    diagnosisId: '',
    billingCategoryOverride: '',
  });

  const [patientCorporate, setPatientCorporate] = useState('');
  const [registrationDocuments, setRegistrationDocuments] = useState<RegistrationDocumentSelection[]>([]);
  const { data: uploadedRegistrationDocuments = [] } = usePatientDocs(
    patient.id,
    REGISTRATION_DOCUMENT_CATEGORY,
  );

  useEffect(() => {
    const requiredDocuments = getCorporateRegistrationDocuments(patientCorporate);
    setRegistrationDocuments((existing) =>
      requiredDocuments.map((label) => ({
        label,
        file: existing.find((document) => document.label === label)?.file || null,
      })),
    );
  }, [patientCorporate]);

  const handleRegistrationDocumentSelect = (label: string, file: File | null) => {
    setRegistrationDocuments((existing) =>
      existing.map((document) =>
        document.label === label ? { ...document, file } : document,
      ),
    );
  };

  const handleRegistrationDocumentRemove = (label: string) => {
    handleRegistrationDocumentSelect(label, null);
  };

  const uploadPendingRegistrationDocuments = async (): Promise<string[]> => {
    const failedDocuments: string[] = [];

    for (const document of registrationDocuments.filter((item) => item.file)) {
      try {
        await uploadPatientDocs([document.file!], {
          patientId: patient.id,
          patientName: patient.name,
          category: REGISTRATION_DOCUMENT_CATEGORY,
          notes: buildRegistrationDocumentNotes({
            source: 'patient_registration',
            corporate: patientCorporate,
            documentName: document.label,
          }),
        });
      } catch (error) {
        failedDocuments.push(document.label);
        console.error(`Error uploading visit registration document ${document.label}:`, error);
      }
    }

    if (registrationDocuments.some((document) => document.file)) {
      await queryClient.invalidateQueries({
        queryKey: ['tablet-patient-docs', patient.id, REGISTRATION_DOCUMENT_CATEGORY],
      });
    }

    return failedDocuments;
  };

  // Keep track of selected IDs for foreign keys
  const [selectedIds, setSelectedIds] = useState({
    referringDoctorId: '' as string,
    relationshipManagerId: '' as string
  });

  // Populate form with existing data when in edit mode
  React.useEffect(() => {
    if (editMode && existingVisit) {

      const populatedData = {
        visitType: existingVisit.visit_type || 'Follow-up',
        appointmentWith: existingVisit.appointment_with || 'Dr. Unknown',
        reasonForVisit: existingVisit.reason_for_visit || '',
        relationWithEmployee: existingVisit.relation_with_employee || 'Self',
        status: existingVisit.status || 'scheduled',
        referringDoctor: existingVisit.referring_doctor || '',
        relationshipManager: existingVisit.relationship_manager || '',
        claimId: existingVisit.claim_id || '',
        cardNo: existingVisit.card_no || '',
        thumbRegistrationNo: existingVisit.thumb_registration_no || '',
        yojanaRegistrationId: existingVisit.yojana_registration_id || '',
        treatmentType: existingVisit.treatment_type || '',
        patientType: existingVisit.patient_type || 'OPD',
        wardAllotted: existingVisit.ward_allotted || '',
        roomAllotted: existingVisit.room_allotted || '',
        diagnosisId: existingVisit.diagnosis_id || '',
        billingCategoryOverride: existingVisit.billing_category_override || existingVisit.corporate || '',
      };

      setFormData(populatedData);

      // Set visit date if available
      if (existingVisit.visit_date) {
        setVisitDate(new Date(existingVisit.visit_date));
      }
    }
  }, [editMode, existingVisit]);

  // Fetch patient's corporate/yojna category (billing override).
  useEffect(() => {
    const fetchPatientCorporate = async () => {
      const { data } = await (supabase as any)
        .from('patients')
        .select('corporate')
        .eq('id', patient.id)
        .maybeSingle();
      if (data?.corporate) setPatientCorporate(data.corporate);
    };
    fetchPatientCorporate();
  }, [patient.id]);

  // Dialysis visits default to the nephrology unit: Dr. Milind Dekate as the
  // appointment/referring doctor and DIRECT as RM. The referee and RM rows are
  // live data (not seeded), so resolve their exact name + id from the DB.
  // Only fills fields that are still empty — never overwrites a user's choice.
  const applyDialysisDefaults = async () => {
    if (!formData.appointmentWith) {
      const { data: consultant } = await supabase
        .from('hope_consultants')
        .select('name')
        .ilike('name', '%milind dekate%')
        .limit(1)
        .maybeSingle();
      const consultantName = consultant?.name || 'Dr. Milind Dekate';
      setFormData(prev => prev.appointmentWith ? prev : { ...prev, appointmentWith: consultantName });
    }

    if (!formData.referringDoctor) {
      const { data: referee } = await supabase
        .from('referees')
        .select('id, name')
        .ilike('name', '%milind dekhate%')
        .limit(1)
        .maybeSingle();
      if (referee) {
        setFormData(prev => prev.referringDoctor ? prev : { ...prev, referringDoctor: referee.name });
        setSelectedIds(prev => prev.referringDoctorId ? prev : { ...prev, referringDoctorId: referee.id });
      }
    }

    if (!formData.relationshipManager) {
      const { data: manager } = await supabase
        .from('relationship_managers')
        .select('id, name')
        .ilike('name', 'direct')
        .limit(1)
        .maybeSingle();
      if (manager) {
        setFormData(prev => prev.relationshipManager ? prev : { ...prev, relationshipManager: manager.name });
        setSelectedIds(prev => prev.relationshipManagerId ? prev : { ...prev, relationshipManagerId: manager.id });
      }
    }
  };

  // When the form opens already set to Dialysis (Todays Dialysis page), the
  // dropdown never fires handleInputChange, so apply the defaults on mount.
  useEffect(() => {
    if (!editMode && defaultPatientType === 'Dialysis') {
      applyDialysisDefaults();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    if (field === 'patientType' && value === 'Dialysis') {
      applyDialysisDefaults();
    }

    // Handle referring doctor ID mapping
    if (field === 'referringDoctor') {
      // Find the referee by name to get the ID
      const findRefereeId = async () => {
        if (value && value !== 'none') {
          const { data: referees } = await supabase
            .from('referees')
            .select('id, name')
            .eq('name', value)
            .single();

          if (referees) {
            setSelectedIds(prev => ({ ...prev, referringDoctorId: referees.id }));
          }
        } else {
          setSelectedIds(prev => ({ ...prev, referringDoctorId: '' }));
        }
      };
      findRefereeId();
    }

    // Handle relationship manager ID mapping
    if (field === 'relationshipManager') {
      const findRelationshipManagerId = async () => {
        if (value && value !== 'none') {
          const { data: manager } = await supabase
            .from('relationship_managers')
            .select('id, name')
            .eq('name', value)
            .single();

          if (manager) {
            setSelectedIds(prev => ({ ...prev, relationshipManagerId: manager.id }));
          }
        } else {
          setSelectedIds(prev => ({ ...prev, relationshipManagerId: '' }));
        }
      };
      findRelationshipManagerId();
    }
  };



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();


    // Validate required fields with more detailed error messaging
    const missingFields = [];
    if (!formData.visitType || formData.visitType.trim() === '') missingFields.push('Visit Type');

    // For edit mode, be more lenient with appointment_with validation
    if (!editMode && (!formData.appointmentWith || formData.appointmentWith.trim() === '')) {
      missingFields.push('Appointment With');
    } else if (editMode && (!formData.appointmentWith || formData.appointmentWith.trim() === '' || formData.appointmentWith === 'Select Doctor')) {
      // In edit mode, set a default value if appointment_with is missing
      formData.appointmentWith = 'Dr. Unknown';
    }

    if (!formData.reasonForVisit || formData.reasonForVisit.trim() === '') missingFields.push('Reason for Visit');
    if (!formData.patientType || formData.patientType.trim() === '') missingFields.push('Patient Type');
    if (!formData.claimId || formData.claimId.trim() === '') missingFields.push('Claim Id');
    if (!formData.thumbRegistrationNo || formData.thumbRegistrationNo.trim() === '') missingFields.push('Thumb Registration No.');
    if (!formData.treatmentType || formData.treatmentType.trim() === '') missingFields.push('Treatment Type');
    if (!formData.referringDoctor || formData.referringDoctor.trim() === '' || formData.referringDoctor === 'none') missingFields.push('Referring Doctor');
    if (!formData.relationshipManager || formData.relationshipManager.trim() === '' || formData.relationshipManager === 'none') missingFields.push('Relationship Manager');

    // A Yojana patient without their registration ID cannot be matched to the
    // government portal — claims and extension alerts then rely on the
    // patient's name, which drifts between the portal and our records.
    //
    // Only for an ADMISSION though: the portal issues the registration ID per
    // IPD case, so an OPD visit has none to give and requiring it would block
    // registration outright.
    const billingCategory = formData.billingCategoryOverride === 'private'
      ? 'private'
      : (patientCorporate || '');
    const isAdmissionVisit = formData.patientType === 'IPD'
      || formData.patientType === 'IPD (Inpatient)'
      || formData.patientType === 'Emergency';
    if (isAdmissionVisit
        && isYojanaPanel(billingCategory)
        && (!formData.yojanaRegistrationId || formData.yojanaRegistrationId.trim() === '')) {
      missingFields.push('Yojana Registration ID');
    }

    // Validate ward and room only for IPD/Emergency patients
    const requiresWardRoom = formData.patientType === 'IPD' ||
                             formData.patientType === 'IPD (Inpatient)' ||
                             formData.patientType === 'Emergency';

    if (requiresWardRoom) {
      if (!formData.wardAllotted || formData.wardAllotted.trim() === '') missingFields.push('Ward Allotted');
      if (!formData.roomAllotted || formData.roomAllotted.trim() === '') missingFields.push('Room Allotted');
    }

    if (missingFields.length > 0) {
      console.error('Missing required fields:', missingFields);
      toast({
        title: "Error",
        description: `Please fill in the following required fields: ${missingFields.join(', ')}`,
        variant: "destructive"
      });
      return;
    }

    // Warn if this patient already has a visit registered very recently —
    // catches accidental double-registration without blocking a genuinely
    // new admission (e.g. a recurring dialysis patient) days/weeks later.
    if (!editMode) {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data: recentVisits } = await supabase
        .from('visits')
        .select('visit_id, room_allotted, created_at')
        .eq('patient_id', patient.id)
        .gte('created_at', twoHoursAgo)
        .order('created_at', { ascending: false })
        .limit(1);

      const recentVisit = recentVisits?.[0];
      if (recentVisit) {
        const minutesAgo = Math.max(1, Math.round((Date.now() - new Date(recentVisit.created_at).getTime()) / 60000));
        const proceed = window.confirm(
          `${patient.name} already has a visit registered ${minutesAgo} minute(s) ago (Visit ID: ${recentVisit.visit_id}, Room: ${recentVisit.room_allotted || 'N/A'}).\n\nRegister another visit anyway?`
        );
        if (!proceed) return;
      }
    }

    setIsSubmitting(true);

    try {
      if (editMode && existingVisit?.visit_id) {
        // Update existing visit
        // For IPD/Emergency patients, set admission_date if not already set
        const isIPDOrEmergency = formData.patientType === 'IPD' ||
                                  formData.patientType === 'IPD (Inpatient)' ||
                                  formData.patientType === 'Emergency';

        // Only set admission_date if it's IPD/Emergency and not already set
        const admissionDate = isIPDOrEmergency && !existingVisit.admission_date
          ? new Date().toISOString()
          : existingVisit.admission_date;

        console.log('Update data:', {
          visit_date: format(visitDate, 'yyyy-MM-dd'),
          visit_type: formData.visitType,
          appointment_with: formData.appointmentWith,
          reason_for_visit: formData.reasonForVisit,
          relation_with_employee: formData.relationWithEmployee || null,
          status: formData.status || 'scheduled',
          patient_type: formData.patientType,
          referring_doctor_id: selectedIds.referringDoctorId || null,
          relationship_manager_id: selectedIds.relationshipManagerId || null,
          claim_id: formData.claimId,
          card_no: formData.cardNo || null,
          admission_date: admissionDate
        });

        const { data: updateData, error: updateError } = await supabase
          .from('visits')
          .update({
            visit_date: format(visitDate, 'yyyy-MM-dd'),
            visit_type: formData.visitType,
            appointment_with: formData.appointmentWith,
            reason_for_visit: formData.reasonForVisit,
            relation_with_employee: formData.relationWithEmployee || null,
            status: formData.status || 'scheduled',
            patient_type: formData.patientType,
            referring_doctor_id: selectedIds.referringDoctorId || null,
            relationship_manager_id: selectedIds.relationshipManagerId || null,
            claim_id: formData.claimId || null,
            card_no: formData.cardNo || null,
            thumb_registration_no: formData.thumbRegistrationNo,
            yojana_registration_id: formData.yojanaRegistrationId?.trim() || null,
            treatment_type: formData.treatmentType,
            ward_allotted: formData.wardAllotted || null,
            room_allotted: formData.roomAllotted || null,
            admission_date: admissionDate,
            diagnosis_id: formData.diagnosisId || null,
          })
          .eq('visit_id', existingVisit.visit_id)
          .select();

        if (updateError) {
          console.error('Error updating visit:', updateError);
          toast({
            title: "Error",
            description: `Failed to update visit: ${updateError.message}`,
            variant: "destructive"
          });
          return;
        }


        // Save billing category override (non-blocking — column may not exist yet)
        if (formData.billingCategoryOverride && formData.billingCategoryOverride !== 'same_as_registration') {
          supabase.from('visits').update({ corporate: formData.billingCategoryOverride } as any)
            .eq('visit_id', existingVisit.visit_id).then(() => {});
        }

        const failedDocumentUploads = await uploadPendingRegistrationDocuments();

        // Log visit edit activity
        logActivity('visit_edit', {
          patient_id: patient.id,
          patients_id: patient.patients_id,
          patient_name: patient.name,
          visit_id: existingVisit.visit_id,
          visit_type: formData.visitType,
          patient_type: formData.patientType,
        });

        toast({
          title: failedDocumentUploads.length > 0 ? "Visit updated with upload issues" : "Success",
          description: failedDocumentUploads.length > 0
            ? `Visit updated, but these documents failed: ${failedDocumentUploads.join(', ')}`
            : "Visit updated successfully",
        });

        // Invalidate queries to refresh data
        await queryClient.invalidateQueries({ queryKey: ['opd-patients'] });
        await queryClient.invalidateQueries({ queryKey: ['todays-visits'] });
        await queryClient.invalidateQueries({ queryKey: ['currently-admitted-visits'] });
        await queryClient.invalidateQueries({ queryKey: ['discharged-visits'] });
        await queryClient.invalidateQueries({ queryKey: ['discharged-patients'] });
        await queryClient.invalidateQueries({ queryKey: ['admission-notes'] });
        await queryClient.invalidateQueries({ queryKey: ['visits'] });
        await queryClient.invalidateQueries({ queryKey: ['patients'] });

        // Close the form
        onClose();

        // Redirect to appropriate dashboard based on patient type
        setTimeout(() => {
          if (formData.patientType === 'OPD' || formData.patientType === 'OPD (Outpatient)') {
            navigate('/todays-opd');
          } else if (formData.patientType === 'IPD' || formData.patientType === 'IPD (Inpatient)') {
            navigate('/todays-ipd');
          } else if (formData.patientType === 'Emergency') {
            // For emergency, redirect to IPD dashboard as well
            navigate('/todays-ipd');
          } else if (formData.patientType === 'Dialysis') {
            navigate('/dialysis');
          }
        }, 1500); // Wait 1.5 seconds to let user see the success message

      } else {
        // Create new visit (existing code)
        const visitId = await generateVisitId(visitDate);

        // For IPD/Emergency patients, set admission_date to visit_date
        const isIPDOrEmergency = formData.patientType === 'IPD' ||
                                  formData.patientType === 'IPD (Inpatient)' ||
                                  formData.patientType === 'Emergency';

        // Insert the visit record
        const { data: visitData, error: visitError } = await supabase
          .from('visits')
          .insert({
            visit_id: visitId, // TEXT field for custom ID
            patient_id: patient.id,
            visit_date: format(visitDate, 'yyyy-MM-dd'),
            visit_type: formData.visitType,
            appointment_with: formData.appointmentWith,
            reason_for_visit: formData.reasonForVisit,
            relation_with_employee: formData.relationWithEmployee || null,
            status: formData.status || 'scheduled',
            patient_type: formData.patientType,
            referring_doctor_id: selectedIds.referringDoctorId || null,
            relationship_manager_id: selectedIds.relationshipManagerId || null,
            claim_id: formData.claimId,
          card_no: formData.cardNo || null,
            thumb_registration_no: formData.thumbRegistrationNo,
            yojana_registration_id: formData.yojanaRegistrationId?.trim() || null,
            treatment_type: formData.treatmentType,
            ward_allotted: formData.wardAllotted || null,
            room_allotted: formData.roomAllotted || null,
            admission_date: isIPDOrEmergency ? new Date().toISOString() : null,
            diagnosis_id: formData.diagnosisId || null,
          })
          .select('id, visit_id')
          .single();

      if (visitError) {
        console.error('Error registering visit:', visitError);
        toast({
          title: "Error",
          description: `Failed to register visit: ${visitError.message}`,
          variant: "destructive"
        });
        return;
      }

      // Save billing category override (non-blocking — column may not exist yet)
      if (formData.billingCategoryOverride) {
        supabase.from('visits').update({ corporate: formData.billingCategoryOverride } as any)
          .eq('visit_id', visitData.visit_id).then(() => {});
      }

      const failedDocumentUploads = await uploadPendingRegistrationDocuments();

      // Get the database-generated UUID for junction table references
      const dbVisitUUID = visitData.id; // This is the UUID primary key

      // Log visit creation activity
      logActivity('visit_create', {
        patient_id: patient.id,
        patients_id: patient.patients_id,
        patient_name: patient.name,
        visit_id: visitData.visit_id,
        visit_type: formData.visitType,
        patient_type: formData.patientType,
      });

      // Now fetch patient data from patients table using patient_id reference
      const { data: patientData, error: patientFetchError } = await supabase
        .from('patients')
        .select('*')
        .eq('id', patient.id)
        .single();

      if (patientFetchError) {
        console.error('Error fetching patient data:', patientFetchError);
        // Continue with visit creation even if patient fetch fails
      }

      // Get the readable patient_id for use in patient_data
      const readablePatientId = patient.patients_id || patientData?.patients_id || patient.id;

      // Update patient_data table with visit information - ENSURE patient_id is readable ID
      try {
        // First, find the patient_data record by patient_id (using readable ID)
        const { data: patientDataRecord, error: findError } = await supabase
          .from('patient_data')
          .select('sr_no')
          .eq('patient_id', readablePatientId)
          .single();

        if (findError || !patientDataRecord) {
          // If patient doesn't exist in patient_data, create a new record
          const insertData = {
            patient_name: patientData?.name || patient.name,
            patient_id: readablePatientId, // CRITICAL: Use readable patient_id, not UUID
            mrn: visitData.visit_id, // Store visit_id in MRN field
            age: patientData?.age?.toString() || '',
            sex: patientData?.gender || '',
            patient_type: patientData?.corporate || '',
            date_of_admission: format(visitDate, 'yyyy-MM-dd'),
            diagnosis_and_surgery_performed: '',
            surgery_performed_by: formData.appointmentWith,
            reff_dr_name: formData.referringDoctor,
            claim_id: formData.claimId || visitData.visit_id,
            card_no: formData.cardNo || null,
            intimation_done_not_done: 'Done',
            payment_status: 'Pending',
            // Map additional fields from patient data
            sst_or_secondary_treatment: patientData?.corporate === 'esic' ? 'ESIC' : 'Private',
            referral_original_yes_no: 'No',
            e_pahachan_card_yes_no: 'No',
            hitlabh_or_entitelment_benefits_yes_no: 'No',
            adhar_card_yes_no: patientData?.aadhar_passport ? 'Yes' : 'No',
            // Add visit_id and patient_id for tracking
            remark_1: `Visit ID: ${visitData.visit_id}`,
            remark_2: `Patient ID: ${readablePatientId}`
          };
          
          
          const { data: insertedData, error: insertError } = await supabase
            .from('patient_data')
            .insert(insertData)
            .select()
            .single();

          if (insertError) {
            console.error('Error inserting patient_data record:', insertError);
          } else {
          }
        } else {
          // Update existing patient_data record - ENSURE readable patient_id
          const updateData = {
            patient_name: patientData?.name || patient.name,
            patient_id: readablePatientId, // CRITICAL: Ensure readable patient_id, not UUID
            mrn: visitData.visit_id, // Store visit_id in MRN field
            age: patientData?.age?.toString() || '',
            sex: patientData?.gender || '',
            patient_type: patientData?.corporate || '',
            date_of_admission: format(visitDate, 'yyyy-MM-dd'),
            diagnosis_and_surgery_performed: '',
            surgery_performed_by: formData.appointmentWith,
            reff_dr_name: formData.referringDoctor,
            claim_id: formData.claimId || visitData.visit_id,
            card_no: formData.cardNo || null,
            intimation_done_not_done: 'Done',
            payment_status: 'Pending',
            // Map additional fields from patient data
            sst_or_secondary_treatment: patientData?.corporate === 'esic' ? 'ESIC' : 'Private',
            referral_original_yes_no: 'No',
            e_pahachan_card_yes_no: 'No',
            hitlabh_or_entitelment_benefits_yes_no: 'No',
            adhar_card_yes_no: patientData?.aadhar_passport ? 'Yes' : 'No',
            // Update visit_id and patient_id for tracking
            remark_1: `Visit ID: ${visitData.visit_id}`,
            remark_2: `Patient ID: ${readablePatientId}`
          };
          
          
          const { data: updatedData, error: updateError } = await supabase
            .from('patient_data')
            .update(updateData)
            .eq('sr_no', patientDataRecord.sr_no)
            .select()
            .single();

          if (updateError) {
            console.error('Error updating patient_data record:', updateError);
          } else {
          }
        }
      } catch (error) {
        console.error('Error handling patient_data:', error);
        // Don't fail the whole process if patient_data update fails
      }



      toast({
        title: "Success",
        description: failedDocumentUploads.length > 0
          ? `Visit registered, but these documents failed: ${failedDocumentUploads.join(', ')}`
          : `Visit registered successfully! Visit ID: ${visitData.visit_id}`,
      });

      // Invalidate queries to refresh data - INCLUDING REPORTS DATA
      queryClient.invalidateQueries({ queryKey: ['visits'] });
      queryClient.invalidateQueries({ queryKey: ['todays-visits'] });
      queryClient.invalidateQueries({ queryKey: ['currently-admitted-visits'] });
      queryClient.invalidateQueries({ queryKey: ['discharged-visits'] });
      queryClient.invalidateQueries({ queryKey: ['discharged-patients'] });
      queryClient.invalidateQueries({ queryKey: ['admission-notes'] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      queryClient.invalidateQueries({ queryKey: ['patient-data'] }); // This will refresh Reports page data
      queryClient.invalidateQueries({ queryKey: ['spreadsheet-data'] }); // Refresh spreadsheet data

      handleCancel();

      // Show success message with confirmation
      toast({
        title: failedDocumentUploads.length > 0 ? "Visit saved with upload issues" : "Data Stored Successfully",
        description: failedDocumentUploads.length > 0
          ? `Patient ID ${readablePatientId} and Visit ID ${visitData.visit_id} saved. Please retry failed documents.`
          : `Patient ID ${readablePatientId} and Visit ID ${visitData.visit_id} stored properly!`,
      });

      // Redirect to appropriate dashboard based on patient type
      setTimeout(() => {
        if (formData.patientType === 'OPD' || formData.patientType === 'OPD (Outpatient)') {
          navigate('/todays-opd');
        } else if (formData.patientType === 'IPD' || formData.patientType === 'IPD (Inpatient)') {
          navigate('/todays-ipd');
        } else if (formData.patientType === 'Emergency') {
          // For emergency, redirect to IPD dashboard as well
          navigate('/todays-ipd');
        } else if (formData.patientType === 'Dialysis') {
          navigate('/dialysis');
        }
      }, 1500); // Wait 1.5 seconds to let user see the success message
      }  // Close the else block for create new visit

    } catch (error) {
      console.error('Error registering visit:', error);
      toast({
        title: "Error",
        description: "Failed to register visit",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setFormData({
      visitType: initialVisitType,
      appointmentWith: '',
      reasonForVisit: '',
      relationWithEmployee: '',
      status: '',
      referringDoctor: '',
      relationshipManager: '',
      claimId: '',
      cardNo: '',
      thumbRegistrationNo: '',
      yojanaRegistrationId: '',
      treatmentType: '',
      patientType: initialPatientType,
      wardAllotted: '',
      roomAllotted: '',
      diagnosisId: '',
      billingCategoryOverride: '',
    });
    setSelectedIds({
      referringDoctorId: '',
      relationshipManagerId: ''
    });
    setRegistrationDocuments([]);
    setVisitDate(new Date());
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-blue-600">
            {editMode ? 'Edit Visit' : 'Register New Visit'}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Patient: {patient.name} {patient.patients_id ? `(${patient.patients_id})` : ''} {formData.patientType}
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
        <VisitDetailsSection
            visitDate={visitDate}
            setVisitDate={setVisitDate}
            formData={formData}
            handleInputChange={handleInputChange}
            existingVisit={existingVisit}
            patientCorporate={patientCorporate}
            registrationDocuments={registrationDocuments}
            uploadedRegistrationDocuments={uploadedRegistrationDocuments}
            onRegistrationDocumentSelect={handleRegistrationDocumentSelect}
            onRegistrationDocumentRemove={handleRegistrationDocumentRemove}
          />

          <VisitFormActions
            isSubmitting={isSubmitting}
            onCancel={handleCancel}
            onSubmit={handleSubmit}
            editMode={editMode}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default VisitRegistrationForm;
