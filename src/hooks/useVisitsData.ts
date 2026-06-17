import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/utils/fetchAllRows';

// Hook to fetch all visits with comprehensive data
export const useVisitsData = () => {
  return useQuery({
    queryKey: ['visits-data'],
    queryFn: async () => {
      console.log('🔍 Fetching all visits data...');
      
      const data = await fetchAllRows(() => supabase
        .from('visits')
        .select(`
          id,
          visit_id,
          patient_id,
          visit_date,
          visit_type,
          appointment_with,
          reason_for_visit,
          relation_with_employee,
          status,
          diagnosis_id,
          referring_doctor_id,
          claim_id,
          created_at,
          updated_at,
          surgery_date,
          admission_date,
          discharge_date,
          sst_treatment,
          intimation_done,
          cghs_code,
          package_amount,
          billing_executive,
          extension_taken,
          delay_waiver_intimation,
          surgical_approval,
          remark1,
          remark2,
          sr_no,
          billing_status,
          bunch_no,
          file_status,
          condonation_delay_claim,
          condonation_delay_intimation,
          extension_of_stay,
          extension_days_count,
          additional_approvals,
          discharge_summary_signed,
          nurse_clearance,
          pharmacy_clearance,
          final_bill_printed,
          gate_pass_generated,
          discharge_mode,
          bill_paid,
          discharge_notes,
          authorized_by,
          gate_pass_id,
          billing_sub_status,
          patients(
            id,
            name,
            age,
            gender,
            patients_id,
            insurance_person_no
          ),
          visit_diagnoses(
            diagnoses(
              id,
              name,
              description
            )
          ),
          visit_surgeries(
            id,
            status,
            sanction_status,
            cghs_surgery(
              id,
              name,
              code,
              description,
              category
            )
          ),
          visit_complications(
            complications!complication_id(
              id,
              name,
              description
            )
          ),
          visit_esic_surgeons(
            esic_surgeons!surgeon_id(
              id,
              name,
              specialty,
              department
            )
          ),
          visit_hope_surgeons(
            hope_surgeons!surgeon_id(
              id,
              name,
              specialty
            )
          ),
          referees(
            id,
            name,
            specialty,
            institution
          )
        `)
        .order('created_at', { ascending: false }));

      return data || [];
    },
  });
};

// Hook to fetch a specific visit by visit_id
export const useVisitData = (visitId: string | undefined) => {
  return useQuery({
    queryKey: ['visit-data', visitId],
    enabled: !!visitId,
    queryFn: async () => {
      if (!visitId) return null;
      
      console.log('🔍 Fetching visit data for visitId:', visitId);
      
      const { data, error } = await supabase
        .from('visits')
        .select(`
          *,
          patients(*),
          visit_diagnoses(
            diagnoses(
              id,
              name,
              description
            )
          ),
          visit_surgeries(
            id,
            status,
            sanction_status,
            cghs_surgery(
              id,
              name,
              code,
              description,
              category
            )
          ),
          visit_complications(
            complications!complication_id(
              id,
              name,
              description
            )
          ),
          visit_esic_surgeons(
            esic_surgeons!surgeon_id(
              id,
              name,
              specialty,
              department
            )
          ),
          visit_hope_surgeons(
            hope_surgeons!surgeon_id(
              id,
              name,
              specialty
            )
          ),
          referees(
            id,
            name,
            specialty,
            institution
          )
        `)
        .eq('visit_id', visitId)
        .single();
      
      if (error) {
        console.error('❌ Error fetching visit data:', error);
        console.error('Error details:', error.message, error.details, error.hint);
        throw error;
      }
      
      return data;
    },
  });
};

// Hook to fetch visits by patient_id
export const usePatientVisits = (patientId: string | undefined) => {
  return useQuery({
    queryKey: ['patient-visits', patientId],
    enabled: !!patientId,
    queryFn: async () => {
      if (!patientId) return [];
      
      console.log('🔍 Fetching visits for patient:', patientId);
      
      const { data, error } = await supabase
        .from('visits')
        .select(`
          *,
          patients(*),
          visit_diagnoses(
            diagnoses(name)
          ),
          referees(name)
        `)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error fetching patient visits:', error);
        throw error;
      }
      
      return data || [];
    },
  });
};
