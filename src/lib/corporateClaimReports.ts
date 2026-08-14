// ============================================================================
// Corporate Claim Reports - CSV/Excel Export
// ============================================================================
// Provides export functionality for filtered claims data
// Supports CSV and Excel formats with comprehensive filtering
// ============================================================================

import * as XLSX from 'xlsx';

export interface ClaimExportFilters {
  scheme: 'ALL' | 'PMJAY' | 'MJPJAY' | 'UNRESOLVED';
  stage: 'all' | 'under_treatment' | 'claims_to_be_submitted' | 'pending_with_payer' | 'payment_accomplished' | 'rejected';
  dateFrom?: string;
  dateTo?: string;
  hospital?: string;
  paymentState?: 'all' | 'paid' | 'unpaid' | 'partial';
  verificationState?: 'all' | 'matched' | 'unmatched' | 'invalid';
  admissionStatus?: 'all' | 'active_ipd' | 'discharged' | 'not_ipd';
}

export interface ClaimRow {
  id: string;
  scheme_type: string;
  beneficiary_name: string;
  government_registration_id?: string;
  government_program_id?: string;
  current_stage: string;
  claimed_amount?: number | string;
  approved_amount?: number | string;
  paid_amount?: number | string;
  tds_amount?: number | string;
  rf_amount?: number | string;
  utr?: string;
  payment_date?: string | null;
  preauth_date?: string | null;
  verification_state: string;
  admission_status: string;
  matched_patient?: {
    name: string;
    patients_id?: string;
    registration_id?: string;
  };
  matched_visit?: {
    patient_type: string;
    admission_date?: string;
    discharge_date?: string;
  };
  raw_government_status?: string;
  source_file_name?: string;
  row_number?: number;
}

/**
 * Filter claims based on provided criteria
 */
export function filterClaims(claims: ClaimRow[], filters: ClaimExportFilters): ClaimRow[] {
  let filtered = [...claims];

  // Scheme filter
  if (filters.scheme !== 'ALL') {
    filtered = filtered.filter(row => row.scheme_type === filters.scheme);
  }

  // Stage filter
  if (filters.stage !== 'all') {
    filtered = filtered.filter(row => row.current_stage === filters.stage);
  }

  // Verification state filter
  if (filters.verificationState !== 'all') {
    filtered = filtered.filter(row => row.verification_state === filters.verificationState);
  }

  // Admission status filter
  if (filters.admissionStatus !== 'all') {
    filtered = filtered.filter(row => row.admission_status === filters.admissionStatus);
  }

  // Payment state filter
  if (filters.paymentState === 'paid') {
    filtered = filtered.filter(row => Number(row.paid_amount || 0) > 0);
  } else if (filters.paymentState === 'unpaid') {
    filtered = filtered.filter(row => Number(row.paid_amount || 0) === 0);
  } else if (filters.paymentState === 'partial') {
    filtered = filtered.filter(row => {
      const paid = Number(row.paid_amount || 0);
      const approved = Number(row.approved_amount || 0);
      return paid > 0 && paid < approved;
    });
  }

  // Date range filter (by payment date or preauth date)
  if (filters.dateFrom || filters.dateTo) {
    filtered = filtered.filter(row => {
      const dateToCheck = row.payment_date || row.preauth_date;
      if (!dateToCheck) return false;

      const rowDate = new Date(dateToCheck);

      if (filters.dateFrom && rowDate < new Date(filters.dateFrom)) return false;
      if (filters.dateTo && rowDate > new Date(filters.dateTo)) return false;

      return true;
    });
  }

  // Hospital filter
  if (filters.hospital && filters.hospital.trim()) {
    const hospitalLower = filters.hospital.toLowerCase().trim();
    filtered = filtered.filter(row => {
      // Check if patient was matched and has hospital info
      // This would require additional hospital field in ClaimRow
      return true; // Placeholder - implement when hospital field is available
    });
  }

  return filtered;
}

/**
 * Format claim data for export
 */
function formatClaimForExport(row: ClaimRow): Record<string, string | number> {
  const paidAmount = Number(row.paid_amount || 0);
  const approvedAmount = Number(row.approved_amount || 0);
  const claimedAmount = Number(row.claimed_amount || 0);

  // Calculate days pending if discharge date exists
  let daysPending = '—';
  if (row.matched_visit?.discharge_date) {
    const dischargeDate = new Date(row.matched_visit.discharge_date);
    const today = new Date();
    const daysDiff = Math.floor((today.getTime() - dischargeDate.getTime()) / (1000 * 60 * 60 * 24));
    daysPending = daysDiff > 0 ? daysDiff : 0;
  }

  return {
    'Scheme': row.scheme_type,
    'Patient Name': row.beneficiary_name || '—',
    'Registration ID': row.government_registration_id || '—',
    'Program ID': row.government_program_id || '—',
    'Stage': row.current_stage,
    'Claimed Amount': claimedAmount,
    'Approved Amount': approvedAmount,
    'Paid Amount': paidAmount,
    'TDS Amount': Number(row.tds_amount || 0),
    'RF Amount': Number(row.rf_amount || 0),
    'Outstanding': claimedAmount - paidAmount - Number(row.tds_amount || 0) - Number(row.rf_amount || 0),
    'UTR': row.utr || '—',
    'Payment Date': row.payment_date || '—',
    'Preauth Date': row.preauth_date || '—',
    'Verification State': row.verification_state,
    'Admission Status': row.admission_status,
    'Matched Patient': row.matched_patient?.name || 'Not matched',
    'Patient ID': row.matched_patient?.patients_id || '—',
    'Registration ID (Matched)': row.matched_patient?.registration_id || '—',
    'Visit Type': row.matched_visit?.patient_type || '—',
    'Admission Date': row.matched_visit?.admission_date || '—',
    'Discharge Date': row.matched_visit?.discharge_date || '—',
    'Days Pending': daysPending,
    'Government Status': row.raw_government_status || '—',
    'Source File': row.source_file_name || '—',
    'Row Number': row.row_number || '—'
  };
}

/**
 * Export filtered claims to CSV
 */
export function exportClaimsToCSV(
  claims: ClaimRow[],
  filters: ClaimExportFilters
): void {
  const filtered = filterClaims(claims, filters);

  if (filtered.length === 0) {
    throw new Error('No claims match the selected filters');
  }

  // Convert to export format
  const exportData = filtered.map(formatClaimForExport);

  if (exportData.length === 0) return;

  // Get headers from first row
  const headers = Object.keys(exportData[0]);

  // Create CSV content
  const csvRows: string[] = [];

  // Header row
  csvRows.push(headers.join(','));

  // Data rows
  for (const row of exportData) {
    const values = headers.map(header => {
      const value = row[header];

      // Handle different types
      if (typeof value === 'number') {
        return value.toString();
      }

      if (typeof value === 'string') {
        // Escape quotes and wrap in quotes
        return `"${value.replace(/"/g, '""')}"`;
      }

      return '""';
    });

    csvRows.push(values.join(','));
  }

  const csvContent = csvRows.join('\n');

  // Create blob and download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const schemeLabel = filters.scheme === 'ALL' ? 'All' : filters.scheme;
  link.setAttribute('download', `corporate_claims_${schemeLabel}_${timestamp}.csv`);

  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export filtered claims to Excel
 */
export function exportClaimsToExcel(
  claims: ClaimRow[],
  filters: ClaimExportFilters
): void {
  const filtered = filterClaims(claims, filters);

  if (filtered.length === 0) {
    throw new Error('No claims match the selected filters');
  }

  // Convert to export format
  const exportData = filtered.map(formatClaimForExport);

  if (exportData.length === 0) return;

  // Create worksheet
  const worksheet = XLSX.utils.json_to_sheet(exportData);

  // Create workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Claims');

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const schemeLabel = filters.scheme === 'ALL' ? 'All' : filters.scheme;

  // Write file
  XLSX.writeFile(workbook, `corporate_claims_${schemeLabel}_${timestamp}.xlsx`);
}

/**
 * Export reconciliation report to Excel
 */
export function exportReconciliationReport(
  claims: ClaimRow[],
  filters: ClaimExportFilters
): void {
  const filtered = filterClaims(claims, filters);

  if (filtered.length === 0) {
    throw new Error('No claims match the selected filters');
  }

  // Calculate reconciliation data
  const reconciliationData = filtered.map(row => {
    const claimed = Number(row.claimed_amount || 0);
    const approved = Number(row.approved_amount || 0);
    const paid = Number(row.paid_amount || 0);
    const tds = Number(row.tds_amount || 0);
    const rf = Number(row.rf_amount || 0);
    const outstanding = claimed - paid - tds - rf;

    // Check for discrepancies
    const discrepancies: string[] = [];
    if (approved > 0 && paid > approved) {
      discrepancies.push('Paid > Approved');
    }
    if (paid > 0 && !row.utr) {
      discrepancies.push('Missing UTR');
    }
    if (outstanding < 0) {
      discrepancies.push('Overpayment');
    }

    return {
      'Patient Name': row.beneficiary_name || '—',
      'Registration ID': row.government_registration_id || '—',
      'Program ID': row.government_program_id || '—',
      'Claimed Amount': claimed,
      'Approved Amount': approved,
      'Paid Amount': paid,
      'TDS Deducted': tds,
      'RF Amount': rf,
      'Outstanding Balance': outstanding,
      'Payment Status': paid > 0 ? 'Paid' : 'Unpaid',
      'UTR': row.utr || '—',
      'Payment Date': row.payment_date || '—',
      'Verification': row.verification_state,
      'Admission Status': row.admission_status,
      'Discrepancies': discrepancies.length > 0 ? discrepancies.join(', ') : 'None',
      'Scheme': row.scheme_type
    };
  });

  // Create worksheet
  const worksheet = XLSX.utils.json_to_sheet(reconciliationData);

  // Create workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Reconciliation');

  // Generate filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);

  // Write file
  XLSX.writeFile(workbook, `reconciliation_report_${timestamp}.xlsx`);
}
