// ============================================================================
// Corporate Claim Management Summaries
// ============================================================================
// Ageing analysis, rejection trends, query ageing, and performance metrics
// For management decision-making and oversight
// ============================================================================

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
  preauth_date?: string | null;
  payment_date?: string | null;
  verification_state: string;
  admission_status: string;
  raw_government_status?: string;
  matched_visit?: {
    admission_date?: string;
    discharge_date?: string;
  };
  source_file_name?: string;
  created_at?: string;
}

export interface AgeingBucket {
  label: string;
  daysMin: number;
  daysMax: number;
  count: number;
  totalClaimed: number;
  totalApproved: number;
  totalPaid: number;
  averageClaimed: number;
}

export interface RejectionTrend {
  reason: string;
  count: number;
  percentage: number;
  totalAmount: number;
}

export interface QueryAgeing {
  ageRange: string;
  days: number;
  count: number;
  percentage: number;
}

export interface ManagementSummary {
  ageingByStage: Record<string, AgeingBucket[]>;
  pendingWithPayerAgeing: AgeingBucket[];
  rejectionTrends: RejectionTrend[];
  queryAgeing: QueryAgeing[];
  approvalToPaymentTime: {
    averageDays: number;
    medianDays: number;
    minDays: number;
    maxDays: number;
  };
  stageTransitionMetrics: Record<string, {
    averageDays: number;
    count: number;
  }>;
  summaryMetrics: {
    totalClaims: number;
    totalClaimed: number;
    totalApproved: number;
    totalPaid: number;
    approvalRate: number;
    paymentRate: number;
    rejectionRate: number;
    averageProcessingTime: number;
  };
}

/**
 * Calculate days between two dates
 */
function daysBetween(date1: Date, date2: Date): number {
  return Math.floor((date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Create ageing buckets for analysis
 */
function createAgeingBuckets(items: any[], dateField: string, amountField: string): AgeingBucket[] {
  const buckets: AgeingBucket[] = [
    { label: '0-30 days', daysMin: 0, daysMax: 30, count: 0, totalClaimed: 0, totalApproved: 0, totalPaid: 0, averageClaimed: 0 },
    { label: '31-60 days', daysMin: 31, daysMax: 60, count: 0, totalClaimed: 0, totalApproved: 0, totalPaid: 0, averageClaimed: 0 },
    { label: '61-90 days', daysMin: 61, daysMax: 90, count: 0, totalClaimed: 0, totalApproved: 0, totalPaid: 0, averageClaimed: 0 },
    { label: '91-120 days', daysMin: 91, daysMax: 120, count: 0, totalClaimed: 0, totalApproved: 0, totalPaid: 0, averageClaimed: 0 },
    { label: '121-180 days', daysMin: 121, daysMax: 180, count: 0, totalClaimed: 0, totalApproved: 0, totalPaid: 0, averageClaimed: 0 },
    { label: '181+ days', daysMin: 181, daysMax: Infinity, count: 0, totalClaimed: 0, totalApproved: 0, totalPaid: 0, averageClaimed: 0 }
  ];

  const today = new Date();

  for (const item of items) {
    const dateStr = item[dateField];
    if (!dateStr) continue;

    const itemDate = new Date(dateStr);
    const daysPending = daysBetween(itemDate, today);

    const bucket = buckets.find(b => daysPending >= b.daysMin && daysPending <= b.daysMax);
    if (bucket) {
      bucket.count++;
      bucket.totalClaimed += Number(item.claimed_amount || 0);
      bucket.totalApproved += Number(item.approved_amount || 0);
      bucket.totalPaid += Number(item.paid_amount || 0);
    }
  }

  // Calculate averages
  for (const bucket of buckets) {
    bucket.averageClaimed = bucket.count > 0 ? bucket.totalClaimed / bucket.count : 0;
  }

  return buckets.filter(b => b.count > 0);
}

/**
 * Calculate ageing analysis by stage
 */
export function calculateAgingAnalysis(claims: ClaimRow[]): Record<string, AgeingBucket[]> {
  const stages = ['under_treatment', 'claims_to_be_submitted', 'pending_with_payer', 'payment_accomplished', 'rejected'];
  const result: Record<string, AgeingBucket[]> = {};

  for (const stage of stages) {
    const stageClaims = claims.filter(c => c.current_stage === stage);

    // Use preauth_date as the reference date
    const withDates = stageClaims.filter(c => c.preauth_date);

    if (withDates.length > 0) {
      result[stage] = createAgeingBuckets(withDates, 'preauth_date', 'claimed_amount');
    }
  }

  return result;
}

/**
 * Calculate pending-with-payer ageing (claims stuck at pending_with_payer)
 */
export function calculatePendingWithPayerAgeing(claims: ClaimRow[]): AgeingBucket[] {
  const pendingClaims = claims.filter(c =>
    c.current_stage === 'pending_with_payer' &&
    c.preauth_date
  );

  return createAgeingBuckets(pendingClaims, 'preauth_date', 'claimed_amount');
}

/**
 * Calculate rejection trends
 */
export function calculateRejectionTrends(claims: ClaimRow[]): RejectionTrend[] {
  const rejectedClaims = claims.filter(c => c.current_stage === 'rejected');

  // Group by rejection reason (from raw_government_status)
  const reasonMap = new Map<string, { count: number; totalAmount: number }>();

  for (const claim of rejectedClaims) {
    const reason = claim.raw_government_status || 'Unknown reason';
    const amount = Number(claim.claimed_amount || 0);

    if (!reasonMap.has(reason)) {
      reasonMap.set(reason, { count: 0, totalAmount: 0 });
    }

    const data = reasonMap.get(reason)!;
    data.count++;
    data.totalAmount += amount;
  }

  const total = rejectedClaims.length;

  // Convert to trends array
  const trends: RejectionTrend[] = [];
  for (const [reason, data] of reasonMap.entries()) {
    trends.push({
      reason,
      count: data.count,
      percentage: total > 0 ? (data.count / total) * 100 : 0,
      totalAmount: data.totalAmount
    });
  }

  // Sort by count descending
  return trends.sort((a, b) => b.count - a.count);
}

/**
 * Calculate unresolved query ageing
 */
export function calculateQueryAgeing(claims: ClaimRow[]): QueryAgeing[] {
  // Claims with verification issues that need resolution
  const queryClaims = claims.filter(c =>
    c.verification_state === 'unmatched' ||
    c.verification_state === 'invalid' ||
    c.verification_state === 'ambiguous'
  );

  const buckets: QueryAgeing[] = [
    { ageRange: '0-7 days', days: 7, count: 0, percentage: 0 },
    { ageRange: '8-14 days', days: 14, count: 0, percentage: 0 },
    { ageRange: '15-30 days', days: 30, count: 0, percentage: 0 },
    { ageRange: '31-60 days', days: 60, count: 0, percentage: 0 },
    { ageRange: '61+ days', days: Infinity, count: 0, percentage: 0 }
  ];

  const today = new Date();

  for (const claim of queryClaims) {
    // Use created_at or preauth_date as reference
    const dateStr = claim.created_at || claim.preauth_date;
    if (!dateStr) continue;

    const claimDate = new Date(dateStr);
    const daysOld = daysBetween(claimDate, today);

    const bucket = buckets.find(b => daysOld <= b.days);
    if (bucket) {
      bucket.count++;
    }
  }

  // Calculate percentages
  const total = queryClaims.length;
  for (const bucket of buckets) {
    bucket.percentage = total > 0 ? (bucket.count / total) * 100 : 0;
  }

  return buckets.filter(b => b.count > 0);
}

/**
 * Calculate approval to payment time
 */
export function calculateApprovalToPaymentTime(claims: ClaimRow[]): {
  averageDays: number;
  medianDays: number;
  minDays: number;
  maxDays: number;
} {
  const paidClaims = claims.filter(c =>
    c.preauth_date &&
    c.payment_date &&
    Number(c.paid_amount || 0) > 0
  );

  const daysList: number[] = [];

  for (const claim of paidClaims) {
    const preauthDate = new Date(claim.preauth_date!);
    const paymentDate = new Date(claim.payment_date!);
    const days = daysBetween(preauthDate, paymentDate);

    if (days >= 0 && days <= 365) { // Reasonable range
      daysList.push(days);
    }
  }

  if (daysList.length === 0) {
    return { averageDays: 0, medianDays: 0, minDays: 0, maxDays: 0 };
  }

  daysList.sort((a, b) => a - b);

  return {
    averageDays: daysList.reduce((sum, d) => sum + d, 0) / daysList.length,
    medianDays: daysList[Math.floor(daysList.length / 2)],
    minDays: daysList[0],
    maxDays: daysList[daysList.length - 1]
  };
}

/**
 * Generate complete management summary
 */
export function generateManagementSummary(claims: ClaimRow[]): ManagementSummary {
  const totalClaims = claims.length;
  const totalClaimed = claims.reduce((sum, c) => sum + Number(c.claimed_amount || 0), 0);
  const totalApproved = claims.reduce((sum, c) => sum + Number(c.approved_amount || 0), 0);
  const totalPaid = claims.reduce((sum, c) => sum + Number(c.paid_amount || 0), 0);
  const rejectedCount = claims.filter(c => c.current_stage === 'rejected').length;

  return {
    ageingByStage: calculateAgingAnalysis(claims),
    pendingWithPayerAgeing: calculatePendingWithPayerAgeing(claims),
    rejectionTrends: calculateRejectionTrends(claims),
    queryAgeing: calculateQueryAgeing(claims),
    approvalToPaymentTime: calculateApprovalToPaymentTime(claims),
    stageTransitionMetrics: {}, // Would need timestamp history for each stage
    summaryMetrics: {
      totalClaims,
      totalClaimed,
      totalApproved,
      totalPaid,
      approvalRate: totalClaims > 0 ? (totalApproved / totalClaimed) * 100 : 0,
      paymentRate: totalClaims > 0 ? (totalPaid / totalApproved) * 100 : 0,
      rejectionRate: totalClaims > 0 ? (rejectedCount / totalClaims) * 100 : 0,
      averageProcessingTime: calculateApprovalToPaymentTime(claims).averageDays
    }
  };
}

/**
 * Export management summary to data structure for UI rendering
 */
export function formatSummaryForUI(summary: ManagementSummary): {
  kpiCards: Array<{ label: string; value: string | number; trend?: string }>;
  ageingCharts: Array<{ stage: string; data: AgeingBucket[] }>;
  rejectionTable: RejectionTrend[];
  queryTable: QueryAgeing[];
} {
  return {
    kpiCards: [
      { label: 'Total Claims', value: summary.summaryMetrics.totalClaims },
      { label: 'Total Claimed', value: `₹${summary.summaryMetrics.totalClaimed.toFixed(0)}` },
      { label: 'Approval Rate', value: `${summary.summaryMetrics.approvalRate.toFixed(1)}%` },
      { label: 'Payment Rate', value: `${summary.summaryMetrics.paymentRate.toFixed(1)}%` },
      { label: 'Rejection Rate', value: `${summary.summaryMetrics.rejectionRate.toFixed(1)}%` },
      { label: 'Avg Processing', value: `${summary.summaryMetrics.averageProcessingTime.toFixed(0)} days` }
    ],
    ageingCharts: Object.entries(summary.ageingByStage).map(([stage, data]) => ({
      stage,
      data
    })),
    rejectionTable: summary.rejectionTrends,
    queryTable: summary.queryAgeing
  };
}
