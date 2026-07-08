import { ReportColumn, PrintPreset } from '@/types/print';
import { format } from 'date-fns';
import { formatDateOnlyForDisplay } from '@/utils/dateOnly';

/**
 * Column definitions for IPD Dashboard print functionality
 */
export const IPD_PRINT_COLUMNS: ReportColumn[] = [
  {
    id: 'sr_no',
    label: 'Sr No',
    accessorKey: 'sr_no',
    printable: true,
    widthPx: 60,
    align: 'center'
  },
  {
    id: 'bunch_no',
    label: 'Bunch No.',
    accessorKey: 'bunch_no',
    printable: true,
    widthPx: 80,
    align: 'center'
  },
  {
    id: 'visit_id',
    label: 'Visit ID',
    accessorKey: 'visit_id',
    printable: true,
    widthPx: 120,
    align: 'left'
  },
  {
    id: 'patient_name',
    label: 'Patient Name',
    accessorKey: 'patients.name',
    printable: true,
    widthPx: 180,
    align: 'left'
  },
  {
    id: 'mobile_no',
    label: 'Mob No',
    accessorKey: 'patients.phone',
    printable: true,
    widthPx: 120,
    align: 'left'
  },
  {
    id: 'claim_id',
    label: 'Claim ID',
    accessorKey: 'claim_id',
    printable: true,
    widthPx: 120,
    align: 'left'
  },
  {
    id: 'registration_id',
    label: 'Registration ID',
    accessorKey: 'patients.registration_id',
    printable: true,
    widthPx: 120,
    align: 'left'
  },
  {
    id: 'treatment_type',
    label: 'Treatment Type',
    accessorKey: 'treatment_type',
    printable: true,
    widthPx: 110,
    align: 'center'
  },
  {
    id: 'intimation_date',
    label: 'Intimation Date',
    accessorKey: 'intimation_date',
    printable: true,
    widthPx: 120,
    align: 'center',
    format: (value) => formatDateOnlyForDisplay(value, 'MMM dd, yyyy')
  },
  {
    id: 'esic_uhid',
    label: 'ESIC UHID',
    accessorKey: 'esic_uh_id',
    printable: true,
    widthPx: 140,
    align: 'left'
  },
  {
    id: 'billing_executive',
    label: 'Billing Executive',
    accessorKey: 'billing_executive',
    printable: true,
    widthPx: 120,
    align: 'left'
  },
  {
    id: 'corporate',
    label: 'Corporate',
    accessorKey: 'patients.corporate',
    printable: true,
    widthPx: 150,
    align: 'left'
  },
  {
    id: 'billing_status',
    label: 'Billing Status',
    accessorKey: 'billing_status',
    printable: true,
    widthPx: 140,
    align: 'left'
  },
  {
    id: 'billing_sub_status',
    label: 'Billing Sub Status',
    accessorKey: 'billing_sub_status',
    printable: true,
    widthPx: 140,
    align: 'left'
  },
  {
    id: 'file_status',
    label: 'File Status',
    accessorKey: 'file_status',
    printable: true,
    widthPx: 100,
    align: 'center',
    format: (value) => value === 'available' ? 'Available' : value === 'missing' ? 'Missing' : value || '—'
  },
  {
    id: 'condonation_delay_claim',
    label: 'Condonation Delay - Submission',
    accessorKey: 'condonation_delay_claim',
    printable: true,
    widthPx: 120,
    align: 'center',
    format: (value) => value === 'present' ? 'Present' : value === 'not_present' ? 'Not Present' : value || '—'
  },
  {
    id: 'condonation_delay_intimation',
    label: 'Condonation Delay - Intimation',
    accessorKey: 'condonation_delay_intimation',
    printable: true,
    widthPx: 120,
    align: 'center',
    format: (value) => value === 'present' ? 'Present' : value === 'not_present' ? 'Not Present' : value || '—'
  },
  {
    id: 'extension_of_stay',
    label: 'Extension of Stay',
    accessorKey: 'extension_of_stay',
    printable: true,
    widthPx: 120,
    align: 'center',
    format: (value) => {
      switch (value) {
        case 'taken': return 'Taken';
        case 'not_taken': return 'Not Taken';
        case 'not_required': return 'Not Required';
        default: return value || '—';
      }
    }
  },
  {
    id: 'additional_approvals',
    label: 'Additional Approvals',
    accessorKey: 'additional_approvals',
    printable: true,
    widthPx: 120,
    align: 'center',
    format: (value) => {
      switch (value) {
        case 'taken': return 'Taken';
        case 'not_taken': return 'Not Taken';
        case 'not_required': return 'Not Required';
        default: return value || '—';
      }
    }
  },
  {
    id: 'visit_type',
    label: 'Visit Type',
    accessorKey: 'visit_type',
    printable: true,
    widthPx: 100,
    align: 'center'
  },
  {
    id: 'doctor',
    label: 'Doctor',
    accessorKey: 'appointment_with',
    printable: true,
    widthPx: 140,
    align: 'left'
  },
  {
    id: 'diagnosis',
    label: 'Diagnosis',
    accessorKey: 'reason_for_visit',
    printable: true,
    widthPx: 150,
    align: 'left',
    format: (value) => value || 'General'
  },
  {
    id: 'admission_date',
    label: 'Admission Date',
    accessorKey: 'admission_date',
    printable: true,
    widthPx: 120,
    align: 'center',
    format: (value) => formatDateOnlyForDisplay(value, 'MMM dd, yyyy')
  },
  {
    id: 'admission_time',
    label: 'Admission Time',
    accessorKey: 'admission_date',
    printable: true,
    widthPx: 100,
    align: 'center',
    format: (value) => value ? format(new Date(value), 'HH:mm') : '—'
  },
  {
    id: 'days_admitted',
    label: 'Days Admitted',
    accessorKey: 'admission_date',
    printable: true,
    widthPx: 100,
    align: 'right',
    format: (value, row) => {
      if (!value) return '—';
      const admission = new Date(value);
      const discharge = row?.discharge_date ? new Date(row.discharge_date) : new Date();
      const days = Math.ceil((discharge.getTime() - admission.getTime()) / (1000 * 60 * 60 * 24));
      return `${days} day${days !== 1 ? 's' : ''}`;
    }
  },
  {
    id: 'referral_doctor_rm',
    label: 'Referral Doctor/Relationship Manager',
    accessorKey: 'referees.name',
    printable: true,
    widthPx: 180,
    align: 'left',
    format: (value, row) => {
      const referee = row?.referees?.name || '-';
      const rm = row?.relationship_managers?.code || '';
      return rm ? `${referee} / ${rm}` : referee;
    }
  },
  {
    id: 'discharge_date',
    label: 'Discharge Date',
    accessorKey: 'discharge_date',
    printable: true,
    widthPx: 120,
    align: 'center',
    format: (value) => formatDateOnlyForDisplay(value, 'MMM dd, yyyy')
  },
  {
    id: 'discharge_time',
    label: 'Discharge Time',
    accessorKey: 'discharge_date',
    printable: true,
    widthPx: 100,
    align: 'center',
    format: (value) => value ? format(new Date(value), 'HH:mm') : '—'
  },
  {
    id: 'discharge_intimation',
    label: 'Discharge Intimation',
    accessorKey: 'discharge_intimation_at',
    printable: true,
    widthPx: 130,
    align: 'center',
    format: (value) => value ? format(new Date(value), 'MMM dd, yyyy HH:mm') : '—'
  },
  // Additional fields that might be useful for detailed reports
  {
    id: 'patient_age',
    label: 'Age',
    accessorKey: 'age',
    printable: true,
    widthPx: 60,
    align: 'right'
  },
  {
    id: 'patient_gender',
    label: 'Gender',
    accessorKey: 'gender',
    printable: true,
    widthPx: 80,
    align: 'center'
  },
  {
    id: 'cghs_code',
    label: 'CGHS Code',
    accessorKey: 'cghs_code',
    printable: true,
    widthPx: 100,
    align: 'left'
  },
  {
    id: 'package_amount',
    label: 'Package Amount',
    accessorKey: 'package_amount',
    printable: true,
    widthPx: 120,
    align: 'right',
    format: (value) => value ? `₹${Number(value).toLocaleString()}` : '—'
  },
  {
    id: 'visit_date',
    label: 'Visit Date',
    accessorKey: 'visit_date',
    printable: true,
    widthPx: 120,
    align: 'center',
    format: (value) => formatDateOnlyForDisplay(value, 'MMM dd, yyyy')
  }
];

/**
 * Predefined print presets for common use cases
 */
export const IPD_PRINT_PRESETS: PrintPreset[] = [
  {
    id: 'summary',
    label: 'Summary',
    columnIds: [
      'sr_no',
      'visit_id',
      'patient_name',
      'billing_status',
      'admission_date',
      'days_admitted',
      'doctor'
    ]
  },
  {
    id: 'detailed',
    label: 'Detailed',
    columnIds: [
      'sr_no',
      'bunch_no',
      'visit_id',
      'patient_name',
      'claim_id',
      'registration_id',
      'treatment_type',
      'intimation_date',
      'esic_uhid',
      'billing_executive',
      'corporate',
      'billing_status',
      'file_status',
      'visit_type',
      'doctor',
      'admission_date',
      'days_admitted',
      'discharge_date'
    ]
  },
  {
    id: 'billing',
    label: 'Billing Focus',
    columnIds: [
      'sr_no',
      'visit_id',
      'patient_name',
      'claim_id',
      'billing_executive',
      'corporate',
      'billing_status',
      'billing_sub_status',
      'package_amount',
      'cghs_code'
    ]
  },
  {
    id: 'compliance',
    label: 'Compliance Check',
    columnIds: [
      'sr_no',
      'visit_id',
      'patient_name',
      'file_status',
      'condonation_delay_claim',
      'condonation_delay_intimation',
      'extension_of_stay',
      'additional_approvals'
    ]
  },
  {
    id: 'admission_discharge',
    label: 'Admission & Discharge',
    columnIds: [
      'sr_no',
      'visit_id',
      'patient_name',
      'doctor',
      'admission_date',
      'admission_time',
      'days_admitted',
      'discharge_date',
      'discharge_time'
    ]
  }
];

/**
 * Generate filter summary for IPD dashboard print
 */
export const generateIPDFilterSummary = (filters: Record<string, any>): Record<string, any> => {
  const summary: Record<string, any> = {};

  if (filters.searchTerm) {
    summary['Search'] = filters.searchTerm;
  }

  if (filters.billingExecutiveFilter) {
    summary['Billing Executive'] = filters.billingExecutiveFilter;
  }

  if (filters.billingStatusFilter) {
    summary['Billing Status'] = filters.billingStatusFilter;
  }

  if (filters.bunchFilter) {
    summary['Bunch'] = filters.bunchFilter;
  }

  if (filters.corporateFilter) {
    summary['Corporate'] = filters.corporateFilter;
  }

  if (filters.daysAdmittedFilter) {
    summary['Days Admitted'] = filters.daysAdmittedFilter;
  }

  if (filters.fileStatusFilter && filters.fileStatusFilter.length > 0) {
    summary['File Status'] = filters.fileStatusFilter.join(', ');
  }

  if (filters.condonationSubmissionFilter && filters.condonationSubmissionFilter.length > 0) {
    summary['Condonation Submission'] = filters.condonationSubmissionFilter.join(', ');
  }

  if (filters.condonationIntimationFilter && filters.condonationIntimationFilter.length > 0) {
    summary['Condonation Intimation'] = filters.condonationIntimationFilter.join(', ');
  }

  if (filters.extensionOfStayFilter && filters.extensionOfStayFilter.length > 0) {
    summary['Extension of Stay'] = filters.extensionOfStayFilter.join(', ');
  }

  if (filters.additionalApprovalsFilter && filters.additionalApprovalsFilter.length > 0) {
    summary['Additional Approvals'] = filters.additionalApprovalsFilter.join(', ');
  }

  return summary;
};
