/** Aadhaar number helpers — a single source of truth for the 12-digit rule. */

/** Strip everything but digits (handles spaces/hyphens users may type). */
export function normalizeAadhaar(value: string): string {
  return (value || '').replace(/\D/g, '');
}

/** Indian Aadhaar is exactly 12 digits. */
export function isValidAadhaar(value: string): boolean {
  return /^\d{12}$/.test(normalizeAadhaar(value));
}

/**
 * Grouped 4-4-4, the way it is printed on the card — so a number on screen or
 * on a document can be read against the card without counting digits.
 */
export function formatAadhaar(value: string): string {
  return normalizeAadhaar(value).replace(/(\d{4})(?=\d)/g, '$1 ');
}

/**
 * Last four digits only — "XXXX XXXX 9012" — for anything that leaves the
 * hospital on paper. A discharge or death summary is handed to the patient
 * and sent to panels; the last block is enough to tell one patient from
 * another, and the full number on a travelling document is not ours to
 * spread. Screens inside the hospital still show it in full.
 *
 * A number that is not a full twelve digits is returned as-is: masking a
 * fragment would hide the fact that it is wrong.
 */
export function maskAadhaar(value: string): string {
  const digits = normalizeAadhaar(value);
  if (!isValidAadhaar(digits)) return digits;
  return `XXXX XXXX ${digits.slice(-4)}`;
}

/**
 * A mobile number with everything but its last four digits hidden, for the
 * same reason as [maskAadhaar] — printed copies travel. Enough survives for
 * the patient to recognise their own number and for a panel to match a
 * query; not enough to call the person from a document lying on a desk.
 *
 * Anything shorter than five digits is returned as-is: there is nothing left
 * to mask, and blanking it would only hide bad data.
 */
export function maskMobile(value: string): string {
  const digits = (value || '').replace(/\D/g, '');
  if (digits.length < 5) return value || '';
  return `${'X'.repeat(digits.length - 4)} ${digits.slice(-4)}`;
}
