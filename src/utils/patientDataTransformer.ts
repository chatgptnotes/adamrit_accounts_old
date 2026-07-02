
// @ts-nocheck

interface CghsSurgery {
  name?: string;
  code?: string;
  category?: string;
}

interface VisitSurgery {
  cghs_surgery?: CghsSurgery;
  sanction_status?: string;
}

interface Visit {
  id: string;
  visit_surgeries?: VisitSurgery[];
  visit_medical_data?: {
    primary_diagnosis?: string;
    complications?: string;
    labs?: string;
    radiology?: string;
    antibiotics?: string;
    other_medications?: string;
    surgeon?: string;
    consultant?: string;
    hope_surgeon?: string;
    hope_consultants?: string;
  }[];
  admission_date?: string;
  surgery_date?: string;
  discharge_date?: string;
  status?: string;
}

interface Patient {
  id: string;
  name: string;
  patients_id: string;
  insurance_person_no: string;
  visits?: Visit[];
}

interface TransformedPatient {
  id: string;
  patientUuid: string;
  name: string;
  primaryDiagnosis: string;
  complications: string;
  surgery: string;
  surgeryCode: string;
  sanctionStatus: string;
  labs: string;
  radiology: string;
  labsRadiology: string;
  antibiotics: string;
  otherMedications: string;
  surgeon: string;
  consultant: string;
  hopeSurgeon: string;
  hopeConsultants: string;
  admissionDate: string | null;
  surgeryDate: string | null;
  dischargeDate: string | null;
  patients_id: string;
  insurance_person_no: string;
  visitId: string | null;
  visitIdDisplay: string | null;
  visitDate: string | null;
  visitStatus: string | null;
}

export const transformPatientsData = (patients: Patient[]) => {
  const groupedPatients: { [surgery: string]: TransformedPatient[] } = {};

  patients.forEach((patient) => {
    // If the patient has no visits, create a card with patient data but no visit info
    if (!patient.visits || patient.visits.length === 0) {
      const surgeryLabel = 'No Surgery Assigned';
      
      if (!groupedPatients[surgeryLabel]) {
        groupedPatients[surgeryLabel] = [];
      }

      const transformedPatient = {
        id: `${patient.id}_no_visit`,
        patientUuid: patient.id, // Add the actual patient UUID for EditPatientDialog
        name: patient.name,
        primaryDiagnosis: 'No diagnosis', // No visits means no diagnosis
        complications: 'None', // Default since not in patients table
        surgery: 'No Surgery Assigned',
        surgeryCode: '',
        sanctionStatus: 'Not Sanctioned',
        labs: '',
        radiology: '',
        labsRadiology: '',
        antibiotics: '',
        otherMedications: '',
        surgeon: 'Not assigned', // Default since not in patients table
        consultant: 'Not assigned', // Default since not in patients table  
        hopeSurgeon: 'Not assigned', // Default since not in patients table
        hopeConsultants: 'Not assigned', // Default since not in patients table
        admissionDate: null, // Will come from visits
        surgeryDate: null, // Will come from visits
        dischargeDate: null, // Will come from visits
        patients_id: patient.patients_id,
        insurance_person_no: patient.insurance_person_no,
        visitId: null,
        visitIdDisplay: null,
        visitDate: null,
        visitStatus: null
      };

      groupedPatients[surgeryLabel].push(transformedPatient);
      return;
    }

    // Create a separate patient card for EACH visit
    patient.visits.forEach((visit: Visit) => {
      // Get CGHS surgery information from this specific visit's surgeries
      let surgeryName = 'No Surgery Assigned';
      let surgeryCode = '';
      let surgeryCategory = 'No Surgery Assigned';
      let sanctionStatus = 'Not Sanctioned';

      if (visit.visit_surgeries && visit.visit_surgeries.length > 0) {
        const primarySurgery = visit.visit_surgeries[0]; // Take the first surgery
        surgeryName = primarySurgery.cghs_surgery?.name || 'Unknown Surgery';
        surgeryCode = primarySurgery.cghs_surgery?.code || '';
        surgeryCategory = primarySurgery.cghs_surgery?.category || 'No Category Assigned';
        sanctionStatus = primarySurgery.sanction_status || 'Not Sanctioned';
      }
      
      // Also check for surgery status in visit remark2 field (if stored via EditPatientDialog)
      if (visit.remark2) {
        const statusMatch = visit.remark2.match(/Surgery Status: ([^;]+)/);
        if (statusMatch) {
          sanctionStatus = statusMatch[1].trim();
        }
      }
      
      // Debug: Log visits to track filtering issues (e.g., IH25G01006 not showing)
      console.log('🔍 Visit:', visit.visit_id,
        'Patient:', patient.name,
        'Surgery:', surgeryName,
        'SST:', visit.sst_treatment,
        'Category:', surgeryCategory);

      // REMOVED: Previously skipped SST treatment records without surgery
      // This was hiding visits like IH25G01006 that need to be visible for document upload
      // if (surgeryName === 'No Surgery Assigned' && visit.sst_treatment) {
      //   return; // Skip SST treatment records
      // }

      // Create a surgery label based on category instead of surgery name
      const surgeryLabel = surgeryCategory;
      
      if (!groupedPatients[surgeryLabel]) {
        groupedPatients[surgeryLabel] = [];
      }

      // Extract medical data from junction tables
      const complications = visit.visit_complications?.map(vc => vc.complications?.name).filter(Boolean) || [];
      const esicSurgeons = visit.visit_esic_surgeons?.map(vs => vs.esic_surgeons?.name).filter(Boolean) || [];
      const referees = visit.visit_referees?.map(vr => vr.referees?.name).filter(Boolean) || [];
      const hopeSurgeons = visit.visit_hope_surgeons?.map(vhs => vhs.hope_surgeons?.name).filter(Boolean) || [];
      const hopeConsultants = visit.visit_hope_consultants?.map(vhc => vhc.hope_consultants?.name).filter(Boolean) || [];

      // Get primary diagnosis from visit_diagnoses
      const primaryDiagnosis = visit.visit_diagnoses?.find(vd => vd.is_primary)?.diagnoses?.name || 'No diagnosis';

      // Transform the patient data for this specific visit
      const transformedPatient = {
        id: `${patient.id}_${visit.id}`, // Unique ID combining patient and visit
        patientUuid: patient.id, // Add the actual patient UUID for EditPatientDialog
        name: patient.name,
        primaryDiagnosis: primaryDiagnosis,
        complications: complications.length > 0 ? complications.join('; ') : 'None',
        surgery: surgeryName,
        surgeryCode: surgeryCode,
        sanctionStatus: sanctionStatus,
        // Full surgery list for this visit — same shape useVisitSurgeriesByCustomId
        // returned, so PatientCard renders it without its own per-card DB query.
        visitSurgeries: (visit.visit_surgeries || []).map(s => ({
          ...s,
          surgeryName: s.cghs_surgery?.name || 'Unknown Surgery'
        })),
        // Medical data now comes from junction tables only
        labs: '',
        radiology: '',
        labsRadiology: '',
        antibiotics: '',
        otherMedications: '',
        surgeon: esicSurgeons.length > 0 ? esicSurgeons.join(', ') : 'Not assigned',
        consultant: referees.length > 0 ? referees.join(', ') : 'Not assigned',
        hopeSurgeon: hopeSurgeons.length > 0 ? hopeSurgeons.join(', ') : 'Not assigned',
        hopeConsultants: hopeConsultants.length > 0 ? hopeConsultants.join(', ') : 'Not assigned',
        // Use visit-specific dates
        admissionDate: visit.admission_date,
        surgeryDate: visit.surgery_date,
        dischargeDate: visit.discharge_date,
        patients_id: patient.patients_id,
        insurance_person_no: patient.insurance_person_no,
        // Add visit information - use UUID for junction table queries
        visitId: visit.id, // Use UUID for junction table queries
        visitIdDisplay: visit.visit_id, // Human-readable visit ID for display
        visitDate: visit.visit_date,
        visitStatus: visit.status,
        // Add sr_no and bunch_no from visit
        srNo: visit.sr_no,
        bunchNo: visit.bunch_no,
        // Add billing fields from visit
        sstTreatment: visit.sst_treatment,
        intimationDone: visit.intimation_done,
        cghsCode: visit.cghs_code,
        packageAmount: visit.package_amount,
        billingExecutive: visit.billing_executive,
        extensionTaken: visit.extension_taken,
        delayWaiverIntimation: visit.delay_waiver_intimation,
        surgicalApproval: visit.surgical_approval,
        remark1: visit.remark1,
        remark2: visit.remark2
      };

      console.log('Junction table data for visit:', visit.visit_id, {
        complications: complications,
        esicSurgeons: esicSurgeons,
        referees: referees,
        hopeSurgeons: hopeSurgeons,
        hopeConsultants: hopeConsultants
      });

      groupedPatients[surgeryLabel].push(transformedPatient);
    });
  });

  return groupedPatients;
};
