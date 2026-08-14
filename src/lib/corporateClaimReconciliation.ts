// ============================================================================
// Corporate Claim Reconciliation Report
// ============================================================================
// Compares claimed vs approved vs paid amounts to identify discrepancies
// Calculates outstanding balances and flags payment issues
// ============================================================================

import * as XLSX from 'xlsx';

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
  verification_state: string;
  admission_status: string;
}

export interface ReconciliationReport {
  patientName: string;
  registrationId: string;
  programId: string;
  claimedAmount: number;
  approvedAmount: number;
  paidAmount: number;
  tdsDeducted: number;
  rfAmount: number;
  outstandingBalance: number;
  paymentStatus: 'Paid' | 'Unpaid' | 'Partial';
  utr: string;
  paymentDate: string;
  verificationState: string;
  discrepancies: string[];
  scheme: string;
}

export interface ReconciliationSummary {
  totalClaims: number;
  totalClaimed: number;
  totalApproved: number;
  totalPaid: number;
  totalTDS: number;
  totalRF: number;
  totalOutstanding: number;
  paidCount: number;
  unpaidCount: number;
  partialCount: number;
  discrepancyCount: number;
}

/**
 * Calculate days between two dates
 */
function daysBetween(date1: Date, date2: Date): number {
  return Math.floor((date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Generate reconciliation report for a single claim
 */
function reconcileClaim(row: ClaimRow): ReconciliationReport {
  const claimed = Number(row.claimed_amount || 0);
  const approved = Number(row.approved_amount || 0);
  const paid = Number(row.paid_amount || 0);
  const tds = Number(row.tds_amount || 0);
  const rf = Number(row.rf_amount || 0);
  const outstanding = claimed - paid - tds - rf;

  // Determine payment status
  let paymentStatus: 'Paid' | 'Unpaid' | 'Partial' = 'Unpaid';
  if (paid > 0 && paid >= approved - tds - rf) {
    paymentStatus = 'Paid';
  } else if (paid > 0) {
    paymentStatus = 'Partial';
  }

  // Identify discrepancies
  const discrepancies: string[] = [];

  if (approved > 0 && paid > approved) {
    discrepancies.push('Paid exceeds approved amount');
  }

  if (paid > 0 && !row.utr) {
    discrepancies.push('Payment without UTR');
  }

  if (row.utr && paid === 0) {
    discrepancies.push('UTR without payment');
  }

  if (outstanding < -10) { // Allow small rounding differences
    discrepancies.push(`Overpayment of ₹${Math.abs(outstanding).toFixed(2)}`);
  }

  if (approved > 0 && (approved - paid - tds - rf) > 100) {
    discrepancies.push('Large outstanding balance');
  }

  if (claimed > 0 && approved === 0 && row.current_stage === 'rejected') {
    discrepancies.push('Claim rejected');
  }

  return {
    patientName: row.beneficiary_name || '—',
    registrationId: row.government_registration_id || '—',
    programId: row.government_program_id || '—',
    claimedAmount: claimed,
    approvedAmount: approved,
    paidAmount: paid,
    tdsDeducted: tds,
    rfAmount: rf,
    outstandingBalance: Math.max(0, outstanding),
    paymentStatus,
    utr: row.utr || '—',
    paymentDate: row.payment_date || '—',
    verificationState: row.verification_state,
    discrepancies,
    scheme: row.scheme_type
  };
}

/**
 * Generate full reconciliation report
 */
export function generateReconciliationReport(claims: ClaimRow[]): {
  report: ReconciliationReport[];
  summary: ReconciliationSummary;
} {
  const report = claims.map(reconcileClaim);

  // Calculate summary
  const summary: ReconciliationSummary = {
    totalClaims: claims.length,
    totalClaimed: report.reduce((sum, r) => sum + r.claimedAmount, 0),
    totalApproved: report.reduce((sum, r) => sum + r.approvedAmount, 0),
    totalPaid: report.reduce((sum, r) => sum + r.paidAmount, 0),
    totalTDS: report.reduce((sum, r) => sum + r.tdsDeducted, 0),
    totalRF: report.reduce((sum, r) => sum + r.rfAmount, 0),
    totalOutstanding: report.reduce((sum, r) => sum + r.outstandingBalance, 0),
    paidCount: report.filter(r => r.paymentStatus === 'Paid').length,
    unpaidCount: report.filter(r => r.paymentStatus === 'Unpaid').length,
    partialCount: report.filter(r => r.paymentStatus === 'Partial').length,
    discrepancyCount: report.filter(r => r.discrepancies.length > 0).length
  };

  return { report, summary };
}

/**
 * Export reconciliation report to Excel
 */
export function exportReconciliationReportToExcel(
  claims: ClaimRow[],
  filename?: string
): void {
  const { report, summary } = generateReconciliationReport(claims);

  // Create workbook
  const workbook = XLSX.utils.book_new();

  // Summary sheet
  const summaryData = [
    ['Reconciliation Summary'],
    [''],
    ['Metric', 'Value'],
    ['Total Claims', summary.totalClaims],
    ['Total Claimed Amount', `₹${summary.totalClaimed.toFixed(2)}`],
    ['Total Approved Amount', `₹${summary.totalApproved.toFixed(2)}`],
    ['Total Paid Amount', `₹${summary.totalPaid.toFixed(2)}`],
    ['Total TDS Deducted', `₹${summary.totalTDS.toFixed(2)}`],
    ['Total RF Amount', `₹${summary.totalRF.toFixed(2)}`],
    ['Total Outstanding Balance', `₹${summary.totalOutstanding.toFixed(2)}`],
    [''],
    ['Payment Status Breakdown'],
    ['Paid', summary.paidCount],
    ['Partial', summary.partialCount],
    ['Unpaid', summary.unpaidCount],
    [''],
    ['Claims with Discrepancies', summary.discrepancyCount]
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  // Detailed report sheet
  const reportData = report.map(r => ({
    'Patient Name': r.patientName,
    'Registration ID': r.registrationId,
    'Program ID': r.programId,
    'Scheme': r.scheme,
    'Claimed': r.claimedAmount,
    'Approved': r.approvedAmount,
    'Paid': r.paidAmount,
    'TDS': r.tdsDeducted,
    'RF': r.rfAmount,
    'Outstanding': r.outstandingBalance,
    'Status': r.paymentStatus,
    'UTR': r.utr,
    'Payment Date': r.paymentDate,
    'Verification': r.verificationState,
    'Discrepancies': r.discrepancies.length > 0 ? r.discrepancies.join('; ') : 'None'
  }));

  const reportSheet = XLSX.utils.json_to_sheet(reportData);
  XLSX.utils.book_append_sheet(workbook, reportSheet, 'Details');

  // Discrepancies only sheet
  const discrepanciesOnly = report.filter(r => r.discrepancies.length > 0);
  if (discrepanciesOnly.length > 0) {
    const discrepancyData = discrepanciesOnly.map(r => ({
      'Patient Name': r.patientName,
      'Registration ID': r.registrationId,
      'Issue': r.discrepancies.join('; '),
      'Claimed': r.claimedAmount,
      'Approved': r.approvedAmount,
      'Paid': r.paidAmount,
      'Outstanding': r.outstandingBalance,
      'UTR': r.utr
    }));

    const discrepancySheet = XLSX.utils.json_to_sheet(discrepancyData);
    XLSX.utils.book_append_sheet(workbook, discrepancySheet, 'Discrepancies');
  }

  // Generate filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const defaultFilename = `reconciliation_report_${timestamp}.xlsx`;

  // Write file
  XLSX.writeFile(workbook, filename || defaultFilename);
}

/**
 * Get claims needing attention (discrepancies or long outstanding)
 */
export function getClaimsNeedingAttention(
  claims: ClaimRow[],
  options: {
    outstandingDays?: number; // Days since discharge to flag as stale
    minOutstandingAmount?: number; // Minimum outstanding amount to flag
  } = {}
): ReconciliationReport[] {
  const { report } = generateReconciliationReport(claims);

  return report.filter(r => {
    // Has discrepancies
    if (r.discrepancies.length > 0) return true;

    // Large outstanding balance
    if (options.minOutstandingAmount && r.outstandingBalance >= options.minOutstandingAmount) {
      return true;
    }

    return false;
  });
}
