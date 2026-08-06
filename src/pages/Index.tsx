import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { usePatientsCount } from '@/hooks/useCounts';
import { SearchAndControls } from '@/components/SearchAndControls';
import { DiagnosisCard } from '@/components/DiagnosisCard';
import { StatisticsCards } from '@/components/StatisticsCards';
import { ClinicalKPIs } from '@/components/ClinicalKPIs';
import { OverviewReportsSection } from '@/components/OverviewReportsSection';
import { AddPatientDialog } from '@/components/AddPatientDialog';
import { AddDiagnosisDialog } from '@/components/AddDiagnosisDialog';
import { NoResultsCard } from '@/components/NoResultsCard';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';
import { usePatients } from '@/hooks/usePatients';
import { useToast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows, fetchAllByIn } from '@/utils/fetchAllRows';
import { useAuth } from '@/contexts/AuthContext';
import { useTileAccess } from '@/hooks/useTileAccess';
import { QuickCaptureCard } from '@/components/CameraUpload';

const Index = () => {
  const { hospitalConfig } = useAuth();
  const { canSeeTile } = useTileAccess();
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddPatientDialogOpen, setIsAddPatientDialogOpen] = useState(false);
  const [isAddDiagnosisDialogOpen, setIsAddDiagnosisDialogOpen] = useState(false);
  const [selectedSurgery, setSelectedSurgery] = useState<string>();
  const [expandedSurgeries, setExpandedSurgeries] = useState<Record<string, boolean>>({});

  // Default view = today's patients only; an explicit range (URL params, so
  // refresh/share keeps it) loads history on demand. Search still finds any
  // patient across all dates via the server-side search inside usePatients.
  const [searchParams, setSearchParams] = useSearchParams();
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const hasExplicitRange = searchParams.has('startDate');
  const startDate = searchParams.get('startDate') || todayStr;
  const endDate = hasExplicitRange ? (searchParams.get('endDate') || '') : todayStr;

  const pickerRange: DateRange | undefined = useMemo(() => ({
    from: new Date(`${startDate}T00:00:00`),
    to: endDate ? new Date(`${endDate}T00:00:00`) : undefined,
  }), [startDate, endDate]);

  const handleDateRangeChange = (range: DateRange | undefined) => {
    const next = new URLSearchParams(searchParams);
    if (range?.from) next.set('startDate', format(range.from, 'yyyy-MM-dd'));
    else next.delete('startDate');
    if (range?.to) next.set('endDate', format(range.to, 'yyyy-MM-dd'));
    else next.delete('endDate');
    setSearchParams(next, { replace: true });
  };

  const {
    diagnoses,
    patients,
    isLoading,
    addPatient,
    updatePatient,
    deletePatient,
    addDiagnosis,
    isUpdatingPatient,
    isDeletingPatient
  } = usePatients({
    dateRange: { from: startDate, to: endDate || undefined },
    searchTerm,
  });

  const { toast } = useToast();

  const currentHospital = hospitalConfig.name === 'ayushman' ? 'ayushman' : 'hope';

  // Fetch patient_data table data with hospital filtering.
  // Legacy records have free-text dates, so they can't be date-scoped; instead
  // this only loads when the user explicitly picks a range (0 requests on the
  // default today view, identical results once a range is chosen).
  const { data: patientDataRecords = [] } = useQuery({
    queryKey: ['patient-data-records', currentHospital],
    enabled: hasExplicitRange,
    queryFn: async () => {
      // Get patient IDs for this hospital. Abort after 8s so a slow/unreachable
      // DB fails fast instead of hanging ~20s+.
      let patientIds: string[] = [];
      try {
        const patientsData = await fetchAllRows<{ patients_id: string }>(() => supabase
          .from('patients')
          .select('patients_id')
          .eq('hospital_name', currentHospital)
          .abortSignal(AbortSignal.timeout(8000)));
        patientIds = patientsData?.map(p => p.patients_id) || [];
      } catch (patientsError) {
        console.error('Error fetching patients for hospital filtering:', patientsError);
        return [];
      }

      if (patientIds.length === 0) return [];

      const data = await fetchAllByIn<any>(patientIds, (chunk) => supabase
        .from('patient_data')
        .select('*')
        .in('patient_id', chunk)
        .order('sr_no', { ascending: false })
        .abortSignal(AbortSignal.timeout(8000)));

      return data || [];
    },
    retry: 0,
  });

  // Combine and deduplicate patients from both sources
  const combinedPatients = useMemo(() => {
    const combined = {};
    const seenPatientIds = new Set();

    // Add patients from main patients table
    if (patients && typeof patients === 'object') {
      Object.entries(patients).forEach(([surgery, patientList]) => {
        if (!combined[surgery]) combined[surgery] = [];

        if (Array.isArray(patientList)) {
          patientList.forEach(patient => {
            const uniqueId = patient.patients_id || patient.id || patient.name;
            if (!seenPatientIds.has(uniqueId)) {
              seenPatientIds.add(uniqueId);
              combined[surgery].push({
                ...patient,
                source: 'patients_table'
              });
            }
          });
        }
      });
    }

    // Add patients from patient_data table (if not already present)
    if (patientDataRecords && patientDataRecords.length > 0) {
      patientDataRecords.forEach(record => {
        const uniqueId = record.patient_id || record.mrn || record.patient_name;
        if (!seenPatientIds.has(uniqueId)) {
          seenPatientIds.add(uniqueId);

          // Determine surgery category and filter out unwanted categories
          const rawCategory = record.sst_or_secondary_treatment || 'Patient Data Records';

          // Skip unwanted categories
          const unwantedCategories = [
            'ESIC', 'Private', 'Patient Data Records', 'SST', '-',
            'Superspeciality Treatmention 2', 'Secondary (ST)', 'Secondary ( ST)',
            'Superspeciality Treatment 2', 'Superspeciality Treatmention', 'Superspeciality Treatment',
            'SST Treatment'
          ];

          if (unwantedCategories.includes(rawCategory)) {
            return; // Skip this record
          }

          const surgeryCategory = rawCategory;
          if (!combined[surgeryCategory]) combined[surgeryCategory] = [];

          // Transform patient_data format to match patients table format with ALL fields
          combined[surgeryCategory].push({
            id: record.patient_uuid || record.sr_no,
            patients_id: record.patient_id,
            name: record.patient_name,
            age: record.age,
            gender: record.sex,
            surgery: surgeryCategory,
            primaryDiagnosis: record.diagnosis_and_surgery_performed || record.sst_or_secondary_treatment || 'General',
            complications: 'None',
            labsRadiology: '',
            antibiotics: '',
            otherMedications: '',
            surgeon: record.surgery_performed_by || record.reff_dr_name || '',
            consultant: '',
            source: 'patient_data_table',

            // All patient_data table fields
            srNo: record.sr_no,
            patientUuid: record.patient_uuid,
            mrn: record.mrn,
            referralOriginalYesNo: record.referral_original_yes_no,
            ePahachanCardYesNo: record.e_pahachan_card_yes_no,
            hitlabhOrEntitelmentBenefitsYesNo: record.hitlabh_or_entitelment_benefits_yes_no,
            adharCardYesNo: record.adhar_card_yes_no,
            patientType: record.patient_type,
            reffDrName: record.reff_dr_name,
            dateOfAdmission: record.date_of_admission,
            dateOfDischarge: record.date_of_discharge,
            claimId: record.claim_id,
            intimationDoneNotDone: record.intimation_done_not_done,
            cghsSurgeryEsicReferral: record.cghs_surgery_esic_referral,
            diagnosisAndSurgeryPerformed: record.diagnosis_and_surgery_performed,
            totalPackageAmount: record.total_package_amount,
            billAmount: record.bill_amount,
            surgeryPerformedBy: record.surgery_performed_by,
            surgeryNameWithCghsAmountWithCghsCode: record.surgery_name_with_cghs_amount_with_cghs_code,
            surgery1InReferralLetter: record.surgery1_in_referral_letter,
            surgery2: record.surgery2,
            surgery3: record.surgery3,
            surgery4: record.surgery4,
            dateOfSurgery: record.date_of_surgery,
            cghsCodeUnlistedWithApprovalFromEsic: record.cghs_code_unlisted_with_approval_from_esic,
            cghsPackageAmountApprovedUnlistedAmount: record.cghs_package_amount_approved_unlisted_amount,
            paymentStatus: record.payment_status,
            onPortalSubmissionDate: record.on_portal_submission_date,
            billMadeByNameOfBillingExecutive: record.bill_made_by_name_of_billing_executive,
            extensionTakenNotTakenNotRequired: record.extension_taken_not_taken_not_required,
            delayWaiverForIntimationBillSubmissionTakenNotRequired: record.delay_waiver_for_intimation_bill_submission_taken_not_required,
            surgicalAdditionalApprovalTakenNotTakenNotRequiredBoth: record.surgical_additional_approval_taken_not_taken_not_required_both_,
            remark1: record.remark_1,
            remark2: record.remark_2
          });
        }
      });
    }

    return combined;
  }, [patients, patientDataRecords]);

  // Define static surgery categories that should always be displayed
  const staticCategories = [
    'No Surgery Assigned',  // Show patients without surgeries
    'HERNIA SURGERIES',
    'UROLOGICAL -Circumcision related',
    'UROLOGICAL - stones related',
    'UROLOGICAL - urethra related',
    'UROLOGICAL - Scrotum related',
    'VASCULAR PROCEDURES',
    'PLASTIC/RECONSTRUCTIVE SURGERY',
    'ORTHOPEDIC PROCEDURES',
    'GENERAL SURGERY',
    'WOUND CARE & DEBRIDEMENT',
    'COLORECTAL PROCEDURES'
  ];

  const unwantedCategories = [
    'ESIC', 'Private', 'Patient Data Records', 'SST', '-',
    'Superspeciality Treatmention 2', 'Secondary (ST)', 'Secondary ( ST)',
    'Superspeciality Treatment 2', 'Superspeciality Treatmention', 'Superspeciality Treatment',
    'SST Treatment'
  ];

  // Filter patients based on search term with improved search logic
  const filteredPatients = useMemo(() => {
    // Start with static categories
    const result: Record<string, any[]> = {};
    staticCategories.forEach(category => {
      result[category] = combinedPatients[category] || [];
    });

    // Add any existing categories that are not in static list and not in unwanted list
    Object.entries(combinedPatients).forEach(([surgery, patientList]) => {
      if (!staticCategories.includes(surgery) && !unwantedCategories.includes(surgery)) {
        result[surgery] = Array.isArray(patientList) ? patientList : [];
      }
    });

    if (!searchTerm || searchTerm.trim() === '') {
      return result;
    }

    const searchLower = searchTerm.toLowerCase().trim();
    const filtered: Record<string, any[]> = {};

    Object.entries(result).forEach(([surgery, patientList]) => {
      const patientArray = Array.isArray(patientList) ? patientList : [];

      const matchingPatients = patientArray.filter((patient: any) => {
        return [
          patient.name?.toLowerCase().includes(searchLower),
          patient.patients_id?.toLowerCase().includes(searchLower),
          patient.insurance_person_no?.toLowerCase().includes(searchLower),
          patient.visitId?.toLowerCase().includes(searchLower),
          patient.visitIdDisplay?.toLowerCase().includes(searchLower),
          patient.primaryDiagnosis?.toLowerCase().includes(searchLower),
          patient.surgeon?.toLowerCase().includes(searchLower),
          patient.consultant?.toLowerCase().includes(searchLower),
          patient.hopeSurgeon?.toLowerCase().includes(searchLower),
          patient.hopeConsultants?.toLowerCase().includes(searchLower),
          patient.surgery?.toLowerCase().includes(searchLower),
          patient.complications?.toLowerCase().includes(searchLower),
          surgery.toLowerCase().includes(searchLower)
        ].some(match => match === true);
      });

      if (!unwantedCategories.includes(surgery) &&
          (matchingPatients.length > 0 || staticCategories.includes(surgery) || surgery.toLowerCase().includes(searchLower))) {
        filtered[surgery] = matchingPatients;
      }
    });

    return filtered;
  }, [combinedPatients, searchTerm]);

  // Initialize expanded state for all surgeries
  useMemo(() => {
    const initialExpanded: Record<string, boolean> = {};
    Object.keys(filteredPatients).forEach(surgery => {
      if (!(surgery in expandedSurgeries)) {
        initialExpanded[surgery] = true;
      }
    });
    if (Object.keys(initialExpanded).length > 0) {
      setExpandedSurgeries(prev => ({ ...prev, ...initialExpanded }));
    }
  }, [filteredPatients, expandedSurgeries]);

  // All-time hospital total from the app-wide cached count query — independent
  // of the date-scoped list, so the number matches the pre-date-filter value.
  const { data: totalPatients = 0 } = usePatientsCount();
  
  const handleAddPatient = (surgery: string, patient: any) => {
    addPatient({ diagnosisName: surgery, patient });
  };

  const handleEditPatient = (patientId: string, updatedPatient: any) => {
    updatePatient({ patientId, updatedData: updatedPatient });
  };

  const handleDeletePatient = (patientId: string) => {
    if (window.confirm('Mark this patient as inactive? The record will be preserved for audit purposes.')) {
      deletePatient(patientId);
    }
  };

  const handleAddPatientClick = (surgery?: string) => {
    setSelectedSurgery(surgery);
    setIsAddPatientDialogOpen(true);
  };

  const handleToggleSurgery = (surgery: string) => {
    setExpandedSurgeries(prev => ({
      ...prev,
      [surgery]: !prev[surgery]
    }));
  };

  const handleCollapseAll = () => {
    const collapsed: Record<string, boolean> = {};
    Object.keys(filteredPatients).forEach(surgery => {
      collapsed[surgery] = false;
    });
    setExpandedSurgeries(collapsed);
  };

  const handleImportPatients = async (importData: any[]) => {
    try {
      // Process each patient import
      for (const item of importData) {
        await new Promise(resolve => {
          addPatient({ diagnosisName: item.diagnosis, patient: item.patient });
          // Add a small delay to prevent overwhelming the system
          setTimeout(resolve, 100);
        });
      }
      
      toast({
        title: "Import Complete",
        description: `Successfully imported ${importData.length} patients`,
      });
    } catch (error) {
      console.error('Import error:', error);
      toast({
        title: "Import Error",
        description: "Some patients could not be imported. Please check the data and try again.",
        variant: "destructive"
      });
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
  };

  const diagnosisNames = diagnoses.map(d => d.name);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-primary mb-4">
            Hospital Management Dashboard
          </h1>
          <p className="text-lg text-muted-foreground">
            All patients — IPD, OPD, ESIC, Corporate, Private and Panel
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="md:col-span-3">
            <ClinicalKPIs canSeeTile={canSeeTile} />
            <OverviewReportsSection />
          </div>
          <div>
            <QuickCaptureCard />
          </div>
        </div>
        <StatisticsCards
          totalPatients={totalPatients}
          canSeeTile={canSeeTile}
        />

        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <DateRangePicker date={pickerRange} onDateChange={handleDateRangeChange} />
          {hasExplicitRange && (
            <Button variant="ghost" size="sm" onClick={() => handleDateRangeChange(undefined)}>
              Today
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {hasExplicitRange
              ? 'Showing selected date range'
              : "Showing today's patients — pick a date range or search by name/ID/phone for older records"}
          </span>
        </div>

        <SearchAndControls
          searchTerm={searchTerm}
          onSearchChange={handleSearchChange}
          onAddPatientClick={() => handleAddPatientClick()}
          onAddDiagnosisClick={() => setIsAddDiagnosisDialogOpen(true)}
          patientData={filteredPatients}
          diagnoses={diagnosisNames}
          onImportPatients={handleImportPatients}
        />

        {Object.keys(filteredPatients).length > 0 && (
          <div className="mb-4 flex justify-end">
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleCollapseAll}
              className="flex items-center gap-2"
            >
              <ChevronDown className="h-4 w-4" />
              Collapse All
            </Button>
          </div>
        )}

         <div className="grid gap-6">
          {Object.keys(filteredPatients).length === 0 ? (
            <NoResultsCard searchTerm={searchTerm} />
          ) : (
            Object.entries(filteredPatients).map(([surgery, patientList]) => (
              <DiagnosisCard
                key={surgery}
                diagnosis={surgery}
                patients={Array.isArray(patientList) ? patientList : []}
                onAddPatient={() => handleAddPatientClick(surgery)}
                onEditPatient={handleEditPatient}
                onDeletePatient={handleDeletePatient}
                isUpdatingPatient={isUpdatingPatient}
                isDeletingPatient={isDeletingPatient}
                isExpanded={expandedSurgeries[surgery] !== false}
                onToggleExpanded={() => handleToggleSurgery(surgery)}
              />
            ))
          )}
        </div>

        {/* Mounted only when open so their reference-data queries don't fire on dashboard load */}
        {isAddPatientDialogOpen && (
          <AddPatientDialog
            isOpen={isAddPatientDialogOpen}
            onClose={() => {
              setIsAddPatientDialogOpen(false);
              setSelectedSurgery(undefined);
            }}
            onPatientAdded={(patient) => {
              if (selectedSurgery) {
                handleAddPatient(selectedSurgery, patient);
              }
            }}
          />
        )}

        {isAddDiagnosisDialogOpen && (
          <AddDiagnosisDialog
            isOpen={isAddDiagnosisDialogOpen}
            onClose={() => setIsAddDiagnosisDialogOpen(false)}
            onAddDiagnosis={(name: string, description?: string) =>
              addDiagnosis({ name, description })
            }
          />
        )}
      </div>
    </div>
  );
};

export default Index;
