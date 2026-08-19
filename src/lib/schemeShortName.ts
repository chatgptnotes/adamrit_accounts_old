/**
 * The short name of a panel or scheme — MJPJAY, PM-JAY, CGHS — from its full
 * name as the corporate master spells it.
 *
 * WHY THIS EXISTS. The same twelve-entry map was copy-pasted into ten files:
 * FinalBill, BillAgingStatementClassic, useBillSubmissions, CasualtyRegister,
 * ExpectedPaymentDateReport, ReferralRegister, the tablet referral register and
 * BillWorkflowCard. Every one keyed on the exact spelling stored in the
 * database, so correcting a typo in the corporate master silently broke all ten
 * at once — and in FinalBill the map is not a label. It builds the BILL NUMBER
 * PREFIX, falling back to
 *
 *     corporateName.toUpperCase().replace(/\s+/g, '-')
 *
 * so a missed key turns every new bill number into
 * MAHATMA-JYOTIRAO-PHULE-JAN-AROGYA-YOJANA-(MJPJAY)-… That is the fault this
 * file removes: matching is by CONTENT, so a rename of the master cannot reach
 * a bill number.
 *
 * Requested by Dr M on 19 Aug when he asked for "jan" and "Yojna" to be spelled
 * properly, and the rename could not be applied safely until this existed. It
 * is the same fault class as the ledger renamed on 2-Aug that stranded 8,441
 * entries, and Diksha's corrected email address that silently took her voucher
 * rights away on 16-Aug: a name used as a key.
 */

/**
 * Matched on a distinctive fragment of the full name, lower-cased. Order
 * matters only where one fragment could appear inside another; these do not
 * overlap. The fragments avoid the words that were misspelled — 'jan',
 * 'yojana'/'yojna' — on purpose.
 */
const BY_CONTENT: ReadonlyArray<readonly [fragment: string, short: string]> = [
  ['jyotirao', 'MJPJAY'],
  // "Jyotiba" is the other transliteration of the same name and is used in some
  // older records.
  ['jyotiba', 'MJPJAY'],
  ['mjpjay', 'MJPJAY'],
  ['pradhan mantri', 'PM-JAY'],
  ['pm-jay', 'PM-JAY'],
  ['pmjay', 'PM-JAY'],
  ['bal swasthya', 'RBSK'],
  ['rbsk', 'RBSK'],
  ['central government health', 'CGHS'],
  ['cghs', 'CGHS'],
  ['ex serviceman', 'ECHS'],
  ['echs', 'ECHS'],
  // MIKSSKAY before MPKAY: both are Maharashtra kutumb arogya schemes and the
  // police one must not swallow the prison one.
  ['karagruh', 'MIKSSKAY'],
  ['miksskay', 'MIKSSKAY'],
  ['police kutumb', 'MPKAY'],
  ['mpkay', 'MPKAY'],
  ['dharmadaya', 'MDKKSY'],
  ['mdkksy', 'MDKKSY'],
  ['coal india', 'CIL'],
  ['western coalfield', 'WCL'],
  ['south eastern central railway', 'SECR'],
  ['central railway', 'CR'],
];

/**
 * The short name, or NULL when this is not one of the twelve schemes.
 *
 * Null rather than a guess, so each caller keeps the fallback it already had:
 * the bill number hyphenates, the aging report prints the full name, the
 * submission report makes a six-character code. Those differ on purpose and
 * collapsing them into one would change five screens.
 */
export function knownSchemeShortName(
  corporateName: string | null | undefined,
): string | null {
  const value = (corporateName || '').trim().toLowerCase();
  if (!value) return null;
  for (const [fragment, short] of BY_CONTENT) {
    if (value.includes(fragment)) return short;
  }
  return null;
}

/**
 * The bill-number form. FinalBill's behaviour, unchanged: 'PRIVATE' for no
 * panel, the short name for a known scheme, and the panel's own name upper
 * cased and hyphenated for anything else. Bill numbers for panels outside the
 * twelve have always looked like that and must keep looking like it.
 *
 * @param corporateName the panel as stored on the patient, visit or bill
 */
export function schemeShortName(corporateName: string | null | undefined): string {
  const raw = (corporateName || '').trim();
  if (!raw || raw.toLowerCase() === 'private') return 'PRIVATE';
  return knownSchemeShortName(raw) ?? raw.toUpperCase().replace(/\s+/g, '-');
}
