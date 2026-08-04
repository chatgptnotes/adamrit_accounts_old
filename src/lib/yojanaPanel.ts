/**
 * Is this billing category a government Yojana panel?
 *
 * The registration ID printed on the Yojana card is the ONLY reliable key for
 * matching a patient to their government-portal row — names drift between the
 * portal and our records (a discharged patient once kept an "Extension Needed"
 * alert for weeks because his visit had no ID and the portal spelled his name
 * differently). So registration forms make the ID required for these panels.
 *
 * The same test lives in several older files by copy-paste; new code should
 * use this one.
 */
export const isYojanaPanel = (category: string | null | undefined): boolean =>
  /yojna|yojana|pm-?jay|mjpjay|ayushman|rbsk/i.test(String(category || ''));

/**
 * A registration ID that is actually usable as a matching key. Blanks, '0'
 * placeholders, and the visit code auto-filled by the tablet all look
 * populated but match nothing.
 */
export const isUsableRegistrationId = (
  value: string | null | undefined,
  visitCode?: string | null,
): boolean => {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === '0') return false;
  if (visitCode && trimmed === String(visitCode).trim()) return false;
  return trimmed.length >= 6;
};
