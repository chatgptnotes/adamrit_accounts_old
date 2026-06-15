// Pure, dependency-free logic for the tablet->pharmacy ward bridge, split out so
// it can be unit-tested without pulling in the supabase client or React.

/** Doses-per-day for the common frequency codes; anything else falls back to 1. */
export const FREQ_PER_DAY: Record<string, number> = {
  OD: 1, HS: 1, SOS: 1, STAT: 1,
  BD: 2, BID: 2, Q12H: 2,
  TDS: 3, TID: 3, Q8H: 3,
  QID: 4, QDS: 4, Q6H: 4,
};

/** Total units to prescribe ≈ doses/day × days. Always ≥ 1 (column is NOT NULL). */
export function deriveQuantity(
  frequency?: string | null,
  duration?: string | null,
): number {
  const key = (frequency || "").trim().toUpperCase().split(/[\s/]/)[0];
  const perDay = FREQ_PER_DAY[key] || 1;
  const days = parseInt(String(duration ?? ""), 10);
  const d = Number.isFinite(days) && days > 0 ? days : 1;
  return Math.max(1, perDay * d);
}

/**
 * PostgREST `.or()` filter for the pharmacy "pending prescriptions" bell.
 * Shows: any PENDING prescription (camera/manual, all hospitals) PLUS APPROVED
 * ward orders for THIS hospital, PLUS APPROVED ward orders whose hospital_name
 * is NULL (legacy/bulk-imported patients) so an approved tablet order is never
 * silently dropped just because its patient lacks a hospital.
 */
export function buildPendingFilter(hospitalType: string | null | undefined): string {
  return (
    `status.eq.PENDING,` +
    `and(status.eq.APPROVED,source.eq.ward,hospital_name.eq.${hospitalType}),` +
    `and(status.eq.APPROVED,source.eq.ward,hospital_name.is.null)`
  );
}
