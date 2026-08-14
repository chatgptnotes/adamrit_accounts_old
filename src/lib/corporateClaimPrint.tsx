// ============================================================================
// Corporate Claim Print-Friendly Reports
// ============================================================================
// Clean, printable components for claim details, audit trails, and reports
// Designed for PDF output without navigation/sidebar
// ============================================================================

import React from 'react';

interface PrintHeaderProps {
  title: string;
  subtitle?: string;
  printedBy: string;
  hospitalName?: string;
}

/**
 * Print header component - appears on all printed pages
 */
export function PrintHeader({ title, subtitle, printedBy, hospitalName }: PrintHeaderProps) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="print-header mb-6 pb-4 border-b-2 border-gray-300">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          {subtitle && <p className="text-sm text-gray-600 mt-1">{subtitle}</p>}
          {hospitalName && (
            <p className="text-sm text-gray-500 mt-1">Hospital: {hospitalName}</p>
          )}
        </div>
        <div className="text-right text-sm text-gray-500">
          <p>Printed: {dateStr} at {timeStr}</p>
          <p>By: {printedBy}</p>
        </div>
      </div>
    </div>
  );
}

interface ClaimDetailPrintProps {
  claim: Record<string, any>;
  patientName: string;
  hospitalName?: string;
}

/**
 * Claim detail print view - single claim for printing
 */
export function ClaimDetailPrintReport({ claim, patientName, hospitalName }: ClaimDetailPrintProps) {
  const formatDate = (date: string | null | undefined) => {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const formatMoney = (amount: number | string | undefined) => {
    if (!amount) return '₹0';
    return '₹' + Number(amount).toLocaleString('en-IN');
  };

  return (
    <div className="p-8 bg-white text-black">
      <PrintHeader
        title="Claim Details Report"
        subtitle={`Patient: ${patientName}`}
        printedBy={claim.printed_by || 'System'}
        hospitalName={hospitalName}
      />

      <div className="grid grid-cols-2 gap-6">
        {/* Patient Information */}
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3 border-b pb-1">Patient Information</h2>
          <div className="space-y-2 text-sm">
            <div className="flex">
              <span className="font-medium w-40">Patient Name:</span>
              <span>{claim.beneficiary_name || '—'}</span>
            </div>
            <div className="flex">
              <span className="font-medium w-40">Registration ID:</span>
              <span>{claim.government_registration_id || '—'}</span>
            </div>
            <div className="flex">
              <span className="font-medium w-40">Program ID:</span>
              <span>{claim.government_program_id || '—'}</span>
            </div>
            <div className="flex">
              <span className="font-medium w-40">Scheme:</span>
              <span>{claim.scheme_type || '—'}</span>
            </div>
          </div>
        </section>

        {/* Claim Status */}
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3 border-b pb-1">Claim Status</h2>
          <div className="space-y-2 text-sm">
            <div className="flex">
              <span className="font-medium w-40">Current Stage:</span>
              <span className="capitalize">{claim.current_stage?.replace(/_/g, ' ') || '—'}</span>
            </div>
            <div className="flex">
              <span className="font-medium w-40">Verification:</span>
              <span className="capitalize">{claim.verification_state || '—'}</span>
            </div>
            <div className="flex">
              <span className="font-medium w-40">Admission Status:</span>
              <span className="capitalize">{claim.admission_status?.replace(/_/g, ' ') || '—'}</span>
            </div>
          </div>
        </section>

        {/* Financial Details */}
        <section className="mb-6 col-span-2">
          <h2 className="text-lg font-semibold mb-3 border-b pb-1">Financial Details</h2>
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b">
                <td className="py-2 font-medium">Claimed Amount</td>
                <td className="py-2 text-right">{formatMoney(claim.claimed_amount)}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 font-medium">Approved Amount</td>
                <td className="py-2 text-right">{formatMoney(claim.approved_amount)}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 font-medium">TDS Deducted</td>
                <td className="py-2 text-right">{formatMoney(claim.tds_amount)}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 font-medium">RF Amount</td>
                <td className="py-2 text-right">{formatMoney(claim.rf_amount)}</td>
              </tr>
              <tr className="border-b bg-gray-50">
                <td className="py-2 font-semibold">Paid Amount</td>
                <td className="py-2 text-right font-semibold">{formatMoney(claim.paid_amount)}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 font-medium">Outstanding Balance</td>
                <td className="py-2 text-right">
                  {formatMoney(
                    Number(claim.claimed_amount || 0) -
                    Number(claim.paid_amount || 0) -
                    Number(claim.tds_amount || 0) -
                    Number(claim.rf_amount || 0)
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Payment Details */}
        {(claim.utr || claim.payment_date) && (
          <section className="mb-6">
            <h2 className="text-lg font-semibold mb-3 border-b pb-1">Payment Details</h2>
            <div className="space-y-2 text-sm">
              {claim.utr && (
                <div className="flex">
                  <span className="font-medium w-40">UTR:</span>
                  <span>{claim.utr}</span>
                </div>
              )}
              {claim.payment_date && (
                <div className="flex">
                  <span className="font-medium w-40">Payment Date:</span>
                  <span>{formatDate(claim.payment_date)}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Visit Information */}
        {claim.matched_visit && (
          <section className="mb-6">
            <h2 className="text-lg font-semibold mb-3 border-b pb-1">Visit Information</h2>
            <div className="space-y-2 text-sm">
              <div className="flex">
                <span className="font-medium w-40">Patient Type:</span>
                <span>{claim.matched_visit.patient_type || '—'}</span>
              </div>
              {claim.matched_visit.admission_date && (
                <div className="flex">
                  <span className="font-medium w-40">Admission Date:</span>
                  <span>{formatDate(claim.matched_visit.admission_date)}</span>
                </div>
              )}
              {claim.matched_visit.discharge_date && (
                <div className="flex">
                  <span className="font-medium w-40">Discharge Date:</span>
                  <span>{formatDate(claim.matched_visit.discharge_date)}</span>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* Footer */}
      <div className="mt-8 pt-4 border-t text-center text-xs text-gray-500">
        <p>This is a computer-generated report. For queries, contact the billing department.</p>
        <p className="mt-1">Generated by Adamrit Hospital Management System</p>
      </div>
    </div>
  );
}

interface ReviewAuditReportProps {
  audits: Array<{
    id: string;
    action: string;
    performedBy: string;
    performedAt: string;
    details?: Record<string, any>;
  }>;
  claimId: string;
  patientName: string;
}

/**
 * Review/Audit trail print report
 */
export function ReviewAuditReport({ audits, claimId, patientName }: ReviewAuditReportProps) {
  return (
    <div className="p-8 bg-white text-black">
      <PrintHeader
        title="Claim Review Audit Trail"
        subtitle={`Patient: ${patientName} | Claim ID: ${claimId}`}
        printedBy="System"
      />

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-gray-400 bg-gray-100">
            <th className="text-left py-2 px-3">Date/Time</th>
            <th className="text-left py-2 px-3">Action</th>
            <th className="text-left py-2 px-3">Performed By</th>
            <th className="text-left py-2 px-3">Details</th>
          </tr>
        </thead>
        <tbody>
          {audits.map((audit, index) => (
            <tr key={audit.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="py-2 px-3 border-b">
                {new Date(audit.performedAt).toLocaleString('en-IN')}
              </td>
              <td className="py-2 px-3 border-b capitalize">{audit.action.replace(/_/g, ' ')}</td>
              <td className="py-2 px-3 border-b">{audit.performedBy}</td>
              <td className="py-2 px-3 border-b text-gray-600">
                {audit.details ? JSON.stringify(audit.details) : '—'}
              </td>
            </tr>
          ))}
          {audits.length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-center text-gray-500">
                No audit records found for this claim.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mt-8 text-center text-xs text-gray-500">
        <p>Audit trail report generated on {new Date().toLocaleDateString('en-IN')}</p>
      </div>
    </div>
  );
}

interface ReconciliationPrintProps {
  data: Array<{
    patientName: string;
    registrationId: string;
    claimedAmount: number;
    approvedAmount: number;
    paidAmount: number;
    outstandingBalance: number;
    discrepancies: string[];
  }>;
  summary: {
    totalClaims: number;
    totalClaimed: number;
    totalPaid: number;
    totalOutstanding: number;
  };
  dateRange: string;
}

/**
 * Reconciliation report print view
 */
export function ReconciliationPrintReport({ data, summary, dateRange }: ReconciliationPrintProps) {
  const formatMoney = (amount: number) => '₹' + amount.toLocaleString('en-IN');

  return (
    <div className="p-8 bg-white text-black">
      <PrintHeader
        title="Claims Reconciliation Report"
        subtitle={`Period: ${dateRange}`}
        printedBy="System"
      />

      {/* Summary Section */}
      <section className="mb-8 p-4 bg-gray-50 border">
        <h2 className="text-lg font-semibold mb-3">Summary</h2>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Total Claims</p>
            <p className="text-xl font-bold">{summary.totalClaims}</p>
          </div>
          <div>
            <p className="text-gray-500">Total Claimed</p>
            <p className="text-xl font-bold">{formatMoney(summary.totalClaimed)}</p>
          </div>
          <div>
            <p className="text-gray-500">Total Paid</p>
            <p className="text-xl font-bold">{formatMoney(summary.totalPaid)}</p>
          </div>
          <div>
            <p className="text-gray-500">Outstanding</p>
            <p className="text-xl font-bold">{formatMoney(summary.totalOutstanding)}</p>
          </div>
        </div>
      </section>

      {/* Detailed Table */}
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b-2 border-gray-400 bg-gray-100">
            <th className="text-left py-2 px-2">Patient</th>
            <th className="text-left py-2 px-2">Reg ID</th>
            <th className="text-right py-2 px-2">Claimed</th>
            <th className="text-right py-2 px-2">Approved</th>
            <th className="text-right py-2 px-2">Paid</th>
            <th className="text-right py-2 px-2">Outstanding</th>
            <th className="text-left py-2 px-2">Discrepancies</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="py-2 px-2 border-b">{row.patientName}</td>
              <td className="py-2 px-2 border-b">{row.registrationId}</td>
              <td className="py-2 px-2 border-b text-right">{formatMoney(row.claimedAmount)}</td>
              <td className="py-2 px-2 border-b text-right">{formatMoney(row.approvedAmount)}</td>
              <td className="py-2 px-2 border-b text-right">{formatMoney(row.paidAmount)}</td>
              <td className="py-2 px-2 border-b text-right font-semibold">{formatMoney(row.outstandingBalance)}</td>
              <td className="py-2 px-2 border-b text-xs text-gray-600">
                {row.discrepancies.length > 0 ? row.discrepancies.join('; ') : 'None'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-8 text-center text-xs text-gray-500">
        <p>Reconciliation report generated on {new Date().toLocaleDateString('en-IN')}</p>
      </div>
    </div>
  );
}

/**
 * Print stylesheet - add this to your global CSS or print-specific stylesheet
 */
export const printStyles = `
  @media print {
    /* Hide navigation, sidebar, and other non-print elements */
    .no-print {
      display: none !important;
    }

    /* Remove backgrounds and shadows for cleaner print */
    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    /* Page layout */
    @page {
      size: A4;
      margin: 15mm;
    }

    /* Ensure text is black on white */
    body {
      background: white !important;
      color: black !important;
    }

    /* Table borders */
    table {
      border-collapse: collapse;
    }

    td, th {
      border: 1px solid #ddd;
    }

    /* Page breaks */
    .page-break {
      page-break-after: always;
    }

    .avoid-page-break {
      page-break-inside: avoid;
    }
  }
`;
