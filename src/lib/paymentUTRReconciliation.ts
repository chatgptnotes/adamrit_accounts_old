// ============================================================================
// Payment/UTR Reconciliation
// ============================================================================
// Identifies payment issues: missing UTRs, duplicate UTRs, partial payments
// Flags amount differences and orphan payments
// ============================================================================

import * as XLSX from 'xlsx';

export interface PaymentIssue {
  type: 'missing_utr' | 'duplicate_utr' | 'partial_payment' | 'amount_mismatch' | 'orphan_payment' | 'overpayment';
  severity: 'critical' | 'warning' | 'info';
  claimId: string;
  patientName: string;
  registrationId?: string;
  programId?: string;
  description: string;
  details: Record<string, string | number>;
}

export interface UTRCheckResult {
  totalClaimsChecked: number;
  totalPaidClaims: number;
  issues: PaymentIssue[];
  summary: {
    missingUTR: number;
    duplicateUTR: number;
    partialPayments: number;
    amountMismatches: number;
    orphanPayments: number;
    overpayments: number;
  };
}

/**
 * Check for missing UTRs (paid claims without UTR)
 */
function findMissingUTRs(claims: any[]): PaymentIssue[] {
  const issues: PaymentIssue[] = [];

  for (const claim of claims) {
    const paidAmount = Number(claim.paid_amount || 0);
    const hasUTR = claim.utr && claim.utr.trim() !== '';

    if (paidAmount > 0 && !hasUTR) {
      issues.push({
        type: 'missing_utr',
        severity: 'critical',
        claimId: claim.id,
        patientName: claim.beneficiary_name || '—',
        registrationId: claim.government_registration_id,
        programId: claim.government_program_id,
        description: `Payment of ₹${paidAmount} recorded without UTR`,
        details: {
          paidAmount,
          paymentDate: claim.payment_date || 'Not recorded',
          approvedAmount: Number(claim.approved_amount || 0)
        }
      });
    }
  }

  return issues;
}

/**
 * Check for duplicate UTRs (same UTR on multiple claims)
 */
function findDuplicateUTRs(claims: any[]): PaymentIssue[] {
  const issues: PaymentIssue[] = [];
  const utrMap = new Map<string, any[]>();

  // Group claims by UTR
  for (const claim of claims) {
    const utr = claim.utr?.trim();
    if (utr && utr !== '—' && utr !== '') {
      if (!utrMap.has(utr)) {
        utrMap.set(utr, []);
      }
      utrMap.get(utr)!.push(claim);
    }
  }

  // Find UTRs with multiple claims
  for (const [utr, claimList] of utrMap.entries()) {
    if (claimList.length > 1) {
      const totalPaid = claimList.reduce((sum, c) => sum + Number(c.paid_amount || 0), 0);

      issues.push({
        type: 'duplicate_utr',
        severity: 'critical',
        claimId: claimList[0].id,
        patientName: `Multiple claims (${claimList.length})`,
        description: `UTR ${utr} is used on ${claimList.length} claims. Total: ₹${totalPaid}`,
        details: {
          utr,
          claimCount: claimList.length,
          totalPaid,
          claims: claimList.map(c => `${c.beneficiary_name} - ₹${c.paid_amount}`).join('; ')
        }
      });
    }
  }

  return issues;
}

/**
 * Check for partial payments (paid < approved)
 */
function findPartialPayments(claims: any[]): PaymentIssue[] {
  const issues: PaymentIssue[] = [];

  for (const claim of claims) {
    const paid = Number(claim.paid_amount || 0);
    const approved = Number(claim.approved_amount || 0);
    const tds = Number(claim.tds_amount || 0);
    const rf = Number(claim.rf_amount || 0);
    const expectedTotal = approved - tds - rf;

    if (paid > 0 && approved > 0 && paid < expectedTotal - 10) { // Allow small rounding diff
      const outstanding = expectedTotal - paid;
      const percentagePaid = (paid / expectedTotal) * 100;

      issues.push({
        type: 'partial_payment',
        severity: paid > 0 ? 'warning' : 'info',
        claimId: claim.id,
        patientName: claim.beneficiary_name || '—',
        registrationId: claim.government_registration_id,
        programId: claim.government_program_id,
        description: `Only ₹${paid} paid of ₹${expectedTotal} (${percentagePaid.toFixed(1)}%)`,
        details: {
          approvedAmount: approved,
          paidAmount: paid,
          tds,
          rf,
          outstandingBalance: outstanding,
          percentagePaid: percentagePaid.toFixed(1) + '%'
        }
      });
    }
  }

  return issues;
}

/**
 * Check for amount mismatches (payment doesn't match approved)
 */
function findAmountMismatches(claims: any[]): PaymentIssue[] {
  const issues: PaymentIssue[] = [];

  for (const claim of claims) {
    const paid = Number(claim.paid_amount || 0);
    const approved = Number(claim.approved_amount || 0);
    const tds = Number(claim.tds_amount || 0);
    const rf = Number(claim.rf_amount || 0);

    // If paid amount differs from approved - TDS - RF by more than 10%
    if (paid > 0 && approved > 0) {
      const expected = approved - tds - rf;
      const difference = Math.abs(paid - expected);

      if (difference > 10 && difference / expected > 0.1) {
        issues.push({
          type: 'amount_mismatch',
          severity: 'warning',
          claimId: claim.id,
          patientName: claim.beneficiary_name || '—',
          registrationId: claim.government_registration_id,
          description: `Paid ₹${paid} but expected ₹${expected.toFixed(2)} (difference: ₹${difference.toFixed(2)})`,
          details: {
            approvedAmount: approved,
            tds,
            rf,
            expectedPayment: expected,
            actualPayment: paid,
            difference
          }
        });
      }
    }
  }

  return issues;
}

/**
 * Check for overpayments
 */
function findOverpayments(claims: any[]): PaymentIssue[] {
  const issues: PaymentIssue[] = [];

  for (const claim of claims) {
    const paid = Number(claim.paid_amount || 0);
    const approved = Number(claim.approved_amount || 0);
    const tds = Number(claim.tds_amount || 0);
    const rf = Number(claim.rf_amount || 0);
    const expected = approved - tds - rf;

    if (paid > expected + 10) { // Allow small rounding difference
      issues.push({
        type: 'overpayment',
        severity: 'critical',
        claimId: claim.id,
        patientName: claim.beneficiary_name || '—',
        registrationId: claim.government_registration_id,
        description: `Overpayment of ₹${(paid - expected).toFixed(2)}`,
        details: {
          approvedAmount: approved,
          tds,
          rf,
          expectedPayment: expected,
          actualPayment: paid,
          overpayment: paid - expected
        }
      });
    }
  }

  return issues;
}

/**
 * Check for orphan payments (payment records without matching claim data)
 * This would require checking payment/bill tables separately
 */
function findOrphanPayments(claims: any[]): PaymentIssue[] {
  const issues: PaymentIssue[] = [];

  for (const claim of claims) {
    // Check if payment exists but claim data is missing
    const hasPayment = Number(claim.paid_amount || 0) > 0 || (claim.utr && claim.utr.trim() !== '');
    const hasClaimData = claim.beneficiary_name || claim.government_registration_id || claim.government_program_id;

    if (hasPayment && !hasClaimData) {
      issues.push({
        type: 'orphan_payment',
        severity: 'warning',
        claimId: claim.id,
        patientName: 'Unknown',
        description: 'Payment recorded without complete claim data',
        details: {
          paidAmount: Number(claim.paid_amount || 0),
          utr: claim.utr || '—',
          paymentDate: claim.payment_date || '—'
        }
      });
    }
  }

  return issues;
}

/**
 * Run all UTR and payment reconciliation checks
 */
export function reconcilePaymentsAndUTRs(claims: any[]): UTRCheckResult {
  const issues: PaymentIssue[] = [];

  // Run all checks
  issues.push(...findMissingUTRs(claims));
  issues.push(...findDuplicateUTRs(claims));
  issues.push(...findPartialPayments(claims));
  issues.push(...findAmountMismatches(claims));
  issues.push(...findOverpayments(claims));
  issues.push(...findOrphanPayments(claims));

  // Calculate summary
  const summary = {
    missingUTR: issues.filter(i => i.type === 'missing_utr').length,
    duplicateUTR: issues.filter(i => i.type === 'duplicate_utr').length,
    partialPayments: issues.filter(i => i.type === 'partial_payment').length,
    amountMismatches: issues.filter(i => i.type === 'amount_mismatch').length,
    orphanPayments: issues.filter(i => i.type === 'orphan_payment').length,
    overpayments: issues.filter(i => i.type === 'overpayment').length
  };

  return {
    totalClaimsChecked: claims.length,
    totalPaidClaims: claims.filter(c => Number(c.paid_amount || 0) > 0).length,
    issues: issues.sort((a, b) => {
      // Sort by severity: critical > warning > info
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    }),
    summary
  };
}

/**
 * Export payment/UTR reconciliation results to Excel
 */
export function exportPaymentUTRReconciliation(
  claims: any[],
  filename?: string
): void {
  const result = reconcilePaymentsAndUTRs(claims);

  // Create workbook
  const workbook = XLSX.utils.book_new();

  // Summary sheet
  const summaryData = [
    ['Payment/UTR Reconciliation Report'],
    [''],
    ['Checks Performed'],
    ['Total Claims Checked', result.totalClaimsChecked],
    ['Total Paid Claims', result.totalPaidClaims],
    [''],
    ['Issues Found'],
    ['Missing UTR', result.summary.missingUTR],
    ['Duplicate UTR', result.summary.duplicateUTR],
    ['Partial Payments', result.summary.partialPayments],
    ['Amount Mismatches', result.summary.amountMismatches],
    ['Orphan Payments', result.summary.orphanPayments],
    ['Overpayments', result.summary.overpayments],
    [''],
    ['Total Issues', result.issues.length]
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  // Issues sheet
  if (result.issues.length > 0) {
    const issuesData = result.issues.map(issue => ({
      'Severity': issue.severity.toUpperCase(),
      'Issue Type': issue.type.replace(/_/g, ' ').toUpperCase(),
      'Patient Name': issue.patientName,
      'Registration ID': issue.registrationId || '—',
      'Program ID': issue.programId || '—',
      'Description': issue.description,
      'Paid Amount': issue.details.paidAmount || '—',
      'Approved Amount': issue.details.approvedAmount || '—',
      'UTR': issue.details.utr || '—',
      'Payment Date': issue.details.paymentDate || '—'
    }));

    const issuesSheet = XLSX.utils.json_to_sheet(issuesData);
    XLSX.utils.book_append_sheet(workbook, issuesSheet, 'Issues');
  }

  // Critical issues sheet
  const criticalIssues = result.issues.filter(i => i.severity === 'critical');
  if (criticalIssues.length > 0) {
    const criticalData = criticalIssues.map(issue => ({
      'Patient Name': issue.patientName,
      'Registration ID': issue.registrationId || '—',
      'Issue': issue.description,
      'Details': JSON.stringify(issue.details)
    }));

    const criticalSheet = XLSX.utils.json_to_sheet(criticalData);
    XLSX.utils.book_append_sheet(workbook, criticalSheet, 'Critical Issues');
  }

  // Generate filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const defaultFilename = `payment_utr_reconciliation_${timestamp}.xlsx`;

  // Write file
  XLSX.writeFile(workbook, filename || defaultFilename);
}

/**
 * Get issues by severity
 */
export function getIssuesBySeverity(result: UTRCheckResult, severity: 'critical' | 'warning' | 'info'): PaymentIssue[] {
  return result.issues.filter(i => i.severity === severity);
}

/**
 * Get issues by type
 */
export function getIssuesByType(result: UTRCheckResult, type: PaymentIssue['type']): PaymentIssue[] {
  return result.issues.filter(i => i.type === type);
}
