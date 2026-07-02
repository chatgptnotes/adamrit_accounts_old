
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { BasicInfoFields } from './EditPatientDialog/BasicInfoFields';
import { MedicalDataForm } from './MedicalDataForm';
import { EnhancedDatePicker } from '@/components/ui/enhanced-date-picker';
import { Patient } from '@/types/patient';
import { saveVisitMedicalData, getVisitMedicalData, MedicalJunctionData } from '@/utils/medicalJunctionHelpers';
import { isUuid } from '@/utils/visitId';

interface EditPatientDialogProps {
  isOpen: boolean;
  onClose: () => void;
  patient: Patient;
  onSave: (updatedPatient: Patient) => void;
}

// Helper function to extract UUID from composite ID
const extractPatientUUID = (id: string): string | null => {
  if (!id) return null;
  
  // If it's already a valid UUID, return it
  if (isUuid(id)) {
    return id;
  }

  // If it contains underscores, extract the first UUID part
  if (id.includes('_')) {
    const parts = id.split('_');
    for (const part of parts) {
      if (isUuid(part)) {
        return part;
      }
    }
  }
  
  // Try to find UUID pattern anywhere in the string
  const uuidMatch = id.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuidMatch) {
    return uuidMatch[0];
  }
  
  return null;
};

export const EditPatientDialog: React.FC<EditPatientDialogProps> = ({
  isOpen,
  onClose,
  patient,
  onSave
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Form state
  const [formData, setFormData] = useState<Patient>({ ...patient });

  // Fetch visits data for this patient
  const { data: visits = [] } = useQuery({
    queryKey: ['patient-visits-edit', patient.patientUuid || patient.id],
    queryFn: async () => {
      const patientUuid = patient.patientUuid || patient.id;
      if (!patientUuid) return [];
      
      console.log('🔍 EditPatientDialog fetching visits for patient UUID:', patientUuid);
      
      const { data, error } = await supabase
        .from('visits')
        .select(`
          *,
          referees(name)
        `)
        .eq('patient_id', patientUuid)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Error fetching visits:', error);
        return [];
      }
      
      return data || [];
    },
    enabled: isOpen && !!(patient.patientUuid || patient.id)
  });

  // Update form data when dialog opens or patient changes
  useEffect(() => {
    if (isOpen) {
      
      // Start with core patient fields
      const validPatientFields: any = {
        id: patient.id,
        patientUuid: patient.patientUuid,
        name: patient.name,
        patients_id: patient.patients_id,
        insurance_person_no: patient.insurance_person_no,
        // Use existing patient data as fallback
        primaryDiagnosis: patient.primaryDiagnosis || 'No diagnosis',
        admissionDate: patient.admissionDate || '',
        surgeryDate: patient.surgeryDate || '',
        dischargeDate: patient.dischargeDate || '',
        surgery: patient.sstTreatment || patient.surgery || '',
        sanctionStatus: patient.sanctionStatus || 'Not Sanctioned',
        complications: patient.complications || '',
        surgeon: patient.surgeon || '',
        consultant: patient.consultant || '',
        hopeSurgeon: patient.hopeSurgeon || '',
        hopeConsultants: patient.hopeConsultants || '',
        relationshipManager: patient.relationshipManager || ''
      };

      // If we have visit data, populate visit-related fields from the current visit
      if (patient.visitId && visits.length > 0) {
        // @ts-expect-error - Temporary fix for Supabase type issues
        const currentVisit = (visits as any[]).find((v: any) => v.id === patient.visitId);
        if (currentVisit) {
          // @ts-expect-error - Temporary fix for Supabase type issues
          validPatientFields.primaryDiagnosis = currentVisit.reason_for_visit || validPatientFields.primaryDiagnosis;
          // @ts-expect-error - Temporary fix for Supabase type issues
          validPatientFields.admissionDate = currentVisit.admission_date || validPatientFields.admissionDate;
          // @ts-expect-error - Temporary fix for Supabase type issues
          validPatientFields.surgeryDate = currentVisit.surgery_date || validPatientFields.surgeryDate;
          // @ts-expect-error - Temporary fix for Supabase type issues
          validPatientFields.dischargeDate = currentVisit.discharge_date || validPatientFields.dischargeDate;
          // @ts-expect-error - Temporary fix for Supabase type issues
          validPatientFields.surgery = currentVisit.sst_treatment || validPatientFields.surgery;
          // @ts-expect-error - Temporary fix for Supabase type issues
          validPatientFields.complications = currentVisit.remark1 || validPatientFields.complications;
          
          // Parse remark2 to extract individual fields
          // @ts-expect-error - Temporary fix for Supabase type issues
          if (currentVisit.remark2) {
            // @ts-expect-error - Temporary fix for Supabase type issues
            const remarks = currentVisit.remark2.split('; ');
            remarks.forEach(remark => {
              if (remark.startsWith('ESIC Surgeons: ')) {
                validPatientFields.surgeon = remark.replace('ESIC Surgeons: ', '');
              } else if (remark.startsWith('Referee: ')) {
                validPatientFields.consultant = remark.replace('Referee: ', '');
              } else if (remark.startsWith('Hope Surgeon: ')) {
                validPatientFields.hopeSurgeon = remark.replace('Hope Surgeon: ', '');
              } else if (remark.startsWith('Hope Consultants: ')) {
                validPatientFields.hopeConsultants = remark.replace('Hope Consultants: ', '');
              } else if (remark.startsWith('Surgery Status: ')) {
                validPatientFields.sanctionStatus = remark.replace('Surgery Status: ', '');
              } else if (remark.startsWith('Relationship Manager: ')) {
                validPatientFields.relationshipManager = remark.replace('Relationship Manager: ', '');
              }
            });
          }
        }
      }
      
      setFormData(validPatientFields);
    }
  }, [isOpen, patient.id, patient.sstTreatment, patient.surgery, visits]);


  // Unified save mutation that handles all data types
  const saveAllChangesMutation = useMutation({
    mutationFn: async () => {
      console.log('🚀 Starting save mutation...');
      console.log('🔍 Current formData:', formData);
      console.log('🔍 Current patient:', patient);
      console.log('🔍 Patient ID:', patient.id);
      console.log('🔍 Patient UUID:', patient.patientUuid);
      
      const results = {
        patient: null as any,
        visit: null as any,
        medical: null as any
      };

      // Extract the actual patient UUID more carefully
      let patientUuidForSave = patient.patientUuid;
      
      // If patientUuid is not available, try to extract from patient.id
      if (!patientUuidForSave && patient.id) {
        patientUuidForSave = extractPatientUUID(patient.id);
      }
      
      // Final validation - make sure we have a valid UUID
      if (!patientUuidForSave) {
        console.error('❌ CRITICAL ERROR: No valid patient UUID found!');
        console.error('Patient object:', patient);
        throw new Error('Cannot update patient: No valid patient UUID found. Please refresh and try again.');
      }
      
      
      // 1. Update patient basic information
      const patientUpdateData = {
        name: formData.name,
        insurance_person_no: formData.insurance_person_no,
        patients_id: formData.patients_id
      };

      const hasPatientChanges = Object.keys(patientUpdateData).some(key => {
        const newValue = patientUpdateData[key];
        const oldValue = patient[key];
        
        if (newValue == null && oldValue == null) return false;
        if (newValue == null || oldValue == null) return true;
        
        return String(newValue) !== String(oldValue);
      });

      if (hasPatientChanges) {
        const cleanedPatientData = Object.fromEntries(
          Object.entries(patientUpdateData).filter(([_, value]) => value != null)
        );
        
        const { data: patientResult, error: patientError } = await supabase
          .from('patients')
          .update(cleanedPatientData)
          .eq('id', patientUuidForSave)
          .select()
          .single();

        if (patientError) {
          console.error('Patient update error:', patientError);
          throw new Error(`Patient update failed: ${patientError.message || 'Unknown database error'}`);
        }
        results.patient = patientResult;
      }

      // 2. Update or create visit data
      if (patient.visitId) {
        // Lookup relationship manager ID by name
        let relationshipManagerId = null;
        if (formData.relationshipManager) {
          const { data: rmData } = await supabase
            .from('relationship_managers')
            .select('id')
            .eq('name', formData.relationshipManager)
            .single();
          relationshipManagerId = rmData?.id || null;
        }

        const visitUpdateData = {
          // Primary diagnosis - store as diagnosis_id if we need to link to diagnoses table
          // For now, storing as text in a custom field
          reason_for_visit: formData.primaryDiagnosis || null,
          
          // Dates
          admission_date: formData.admissionDate || null,
          surgery_date: formData.surgeryDate || null,
          discharge_date: formData.dischargeDate || null,
          
          // Medical data as text fields (can be moved to junction tables later)
          sst_treatment: formData.surgery || null, // Surgery Assigned
          remark1: formData.complications || null, // Complications
          remark2: [
            formData.surgeon ? `ESIC Surgeons: ${formData.surgeon}` : null,
            formData.consultant ? `Referee: ${formData.consultant}` : null,
            formData.hopeSurgeon ? `Hope Surgeon: ${formData.hopeSurgeon}` : null,
            formData.hopeConsultants ? `Hope Consultants: ${formData.hopeConsultants}` : null,
            formData.sanctionStatus ? `Surgery Status: ${formData.sanctionStatus}` : null,
            formData.relationshipManager ? `Relationship Manager: ${formData.relationshipManager}` : null
          ].filter(Boolean).join('; ') || null,

          // Relationship Manager as FK
          relationship_manager_id: relationshipManagerId,

          updated_at: new Date().toISOString()
        };

        // Filter out null values
        const cleanedVisitData = Object.fromEntries(
          Object.entries(visitUpdateData).filter(([_, value]) => value !== null)
        );

        if (Object.keys(cleanedVisitData).length > 1) { // More than just updated_at
          const { data: visitResult, error: visitError } = await supabase
            .from('visits')
            .update(cleanedVisitData)
            .eq('id', patient.visitId)
            .select()
            .single();

          if (visitError) {
            console.error('Visit update error:', visitError);
            throw new Error(`Visit update failed: ${visitError.message || 'Unknown database error'}`);
          }
          results.visit = visitResult;
        }
      }

      return results;
    },
    onSuccess: (results) => {
      // Invalidate relevant queries to refresh patient cards
      queryClient.invalidateQueries({ queryKey: ['patient-visits-edit'] });
      queryClient.invalidateQueries({ queryKey: ['patient-data-edit'] });
      queryClient.invalidateQueries({ queryKey: ['patients'] }); // Main patient list query
      queryClient.invalidateQueries({ queryKey: ['dashboard-patients'] }); // Dashboard patient list query
      queryClient.invalidateQueries({ queryKey: ['todays-visits'] }); // IPD Dashboard
      queryClient.invalidateQueries({ queryKey: ['discharged-patients'] }); // Discharged Patients

      // Force refetch of patient data to ensure UI updates
      setTimeout(() => {
        queryClient.refetchQueries({ queryKey: ['patients'] });
        queryClient.refetchQueries({ queryKey: ['todays-visits'] });
      }, 100);

      // Call the parent onSave callback
      if (results.patient && onSave) {
        onSave(results.patient);
      }

      toast({
        title: "Success",
        description: `Successfully saved ${[
          results.patient ? 'patient information' : null,
          results.visit ? 'visit data' : null
        ].filter(Boolean).join(' and ')}. Patient cards will refresh automatically.`,
      });

      // Close the modal after successful save
      onClose();
    },
    onError: (error: any) => {
      console.error('Save error:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
        cause: error.cause
      });
      
      // Log current state for debugging
      console.error('Current state during error:', {
        formData,
        patientIdForError: patient.patientUuid || patient.id
      });
      
      toast({
        title: "Error",
        description: `Failed to update patient: ${error.message || 'Unknown error'}. Check console for details.`,
        variant: "destructive"
      });
    }
  });

  // Individual field handlers
  const handleChange = (field: keyof Patient, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSelectChange = (field: keyof Patient) => (value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        // Reset selected visit when dialog closes
        setFormData({ ...patient });
      }
      onClose();
    }}>
      <DialogContent className="max-w-7xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Patient Information</DialogTitle>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>Patient UID: <span className="font-mono text-blue-600">{patient.patients_id || 'Not assigned'}</span></span>
            {patient.visitId && (visits as any[]).find((v: any) => v.id === patient.visitId) && (
              <span>Visit ID: <span className="font-mono text-green-600">{(visits as any[]).find((v: any) => v.id === patient.visitId)?.visit_id || 'Not assigned'}</span></span>
            )}
          </div>
        </DialogHeader>
        
        <div className="space-y-6 mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Basic Information</h3>
                <BasicInfoFields
                  formData={formData}
                  onFieldChange={handleChange}
                  onSelectChange={handleSelectChange}
                />
              </div>
              
              <div className="space-y-4">
                {/* Medical data fields removed - now managed via junction tables */}
              </div>
            </div>
                            </div>

        {/* Single unified save button */}
        <div className="flex justify-between items-center pt-6 border-t">
          <div className="text-sm text-muted-foreground">
            {patient.visitId && (
              <span className="text-orange-600">● Unsaved visit changes</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button 
              type="button" 
              variant="outline" 
              onClick={onClose}
              disabled={saveAllChangesMutation.isPending}
            >
              Cancel
            </Button>
            <Button 
              onClick={() => saveAllChangesMutation.mutate()}
              disabled={saveAllChangesMutation.isPending}
              className="min-w-[120px]"
            >
              {saveAllChangesMutation.isPending ? 'Saving...' : 'Save All Changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
