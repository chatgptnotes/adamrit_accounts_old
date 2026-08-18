/**
 * How portal values are shown on screen. Shared by every government-portal
 * surface, so two screens cannot disagree about what the same cell says.
 *
 * These lived inside GovernmentPortalCsvSection until the Dialysis Bill Pending
 * page needed them too. A second copy is how the two screens would have drifted
 * — one deduping the repeated package text, the other not.
 */

/** The portal repeats a value once per admission day ("MG157AMH|MG157AMH|…") — show each one once. */
export const dedupePortalText = (value: string | null | undefined): string =>
  [...new Set((value || '').split('|').map((p) => p.trim().replace(/\s+/g, ' ')).filter(Boolean))].join(', ');

/** Rupees, Indian digit grouping. A value that is not a number is shown as it arrived, never as 0. */
export const formatPortalAmount = (value: string | null | undefined): string => {
  const raw = value || '';
  if (!raw.trim()) return '-';
  const numeric = Number(raw.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(numeric)) return raw;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(numeric);
};
