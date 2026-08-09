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
