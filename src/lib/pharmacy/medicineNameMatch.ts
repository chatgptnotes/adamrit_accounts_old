/**
 * Matching a prescribed medicine name to the pharmacy master.
 *
 * THE PROBLEM THIS SOLVES. A prescription carries free text — "INJ TAZAR",
 * "TAB CARBOPHAGE", "INJ OPTINEURON" — while medicine_master carries the
 * purchased product, "TAZAR 4.5 GM INJ" or "CARBOPHAGE 500 TAB (METFORMIN
 * 500MG)". PrescriptionQueue resolved the two with
 *
 *     .ilike('medicine_name', name)
 *
 * which is an EXACT comparison: ilike without wildcards matches the whole
 * string. So only a prescription whose text was character-for-character the
 * purchased product resolved. That is why "NS 500 ML I.V.- SODIUM CHLORIDE 500
 * ML INJ" showed "In stock: 23" and everything typed short showed "Stock:
 * unknown" — and why the Unit Price, Amount and Batch/Expiry columns beside them
 * were empty, because all three come from the batch that was never found. The
 * New Sale screen searches with wildcards across the name AND the generic name
 * and finds the same medicines perfectly, which is what Dr M meant by "new sale
 * shows all stock" (19 Aug).
 *
 * WHY NOT JUST ADD WILDCARDS. Because dispensing decrements stock and hands a
 * drug to a patient. "%NS%" matches half the master. A loose match that is right
 * most of the time is the wrong tool for that, so this returns how confident the
 * match is and lets the caller decide: a badge may show a best guess, a
 * dispense may not act on one.
 *
 * MOLECULE, NOT BRAND (Dr M, 19 Aug: "use the content of the medicines, do not
 * go by the brand — any brand is ok"). The master embeds the molecule in the
 * product name — "ATOVASTRIN 40 MG- ATORVASTATIN 40 MG TAB" — and carries
 * generic_name where it is filled in, so both are searched.
 */

/** Words that describe the FORM, not the drug. They carry no identity. */
const FORM_WORDS = new Set([
  'inj', 'injection', 'tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps',
  'capsule', 'capsules', 'syp', 'syrup', 'susp', 'suspension', 'drops', 'drop',
  'oint', 'ointment', 'cream', 'gel', 'lotion', 'sol', 'solution', 'iv', 'i.v.',
  'im', 'po', 'vial', 'amp', 'ampoule', 'bottle', 'sachet', 'powder', 'spray',
  'mg', 'mcg', 'gm', 'g', 'ml', 'iu', 'unit', 'units', 'ds', 'sr', 'xr', 'cr',
  'er', 'mr', 'dsr', 'plus', 'forte',
]);

/**
 * The identifying words of a medicine name, longest first.
 *
 * "INJ TAZAR" -> ["tazar"];  "100ML NS" -> ["ns"];
 * "TAB CARBOPHAGE" -> ["carbophage"].
 *
 * Note 'mr' and 'dsr' are treated as form/strength words, so "Mr" and "Sp" on
 * their own reduce to nothing — deliberately. A two-letter abbreviation is not
 * enough to identify a drug and must not be guessed at.
 */
export function medicineKeywords(name: string): string[] {
  return (name || '')
    .toLowerCase()
    // Bracketed content is usually the molecule — keep it, drop the brackets.
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .split(/[\s-]+/)
    .map((word) => word.replace(/^\.+|\.+$/g, ''))
    // A pure number, or a number glued to a unit (500mg), identifies nothing.
    .filter((word) => word.length >= 3 && !/^\d/.test(word) && !FORM_WORDS.has(word))
    .sort((a, b) => b.length - a.length);
}

export type MatchConfidence =
  /** The names are the same once case and spacing are ignored. */
  | 'exact'
  /** One master medicine contains the prescription's identifying word. */
  | 'single'
  /** Several master medicines contain it — the caller must choose. */
  | 'ambiguous'
  /** Nothing contains it. */
  | 'none';

export interface MasterMedicine {
  id: string;
  medicine_name: string;
  generic_name?: string | null;
}

export interface NameMatch {
  confidence: MatchConfidence;
  /** The single medicine, when there is exactly one. */
  medicine: MasterMedicine | null;
  /** Every candidate, for a picker. */
  candidates: MasterMedicine[];
}

const norm = (value: string): string =>
  (value || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Choose the master medicine a prescribed name refers to.
 *
 * @param prescribed the free text on the prescription
 * @param master     candidate rows already fetched from medicine_master
 */
export function matchMedicineName(
  prescribed: string,
  master: MasterMedicine[],
): NameMatch {
  const wanted = norm(prescribed);
  if (!wanted || master.length === 0) {
    return { confidence: 'none', medicine: null, candidates: [] };
  }

  // 1. The same name. Nothing beats it, and it is how the working rows matched.
  const exact = master.find((m) => norm(m.medicine_name) === wanted);
  if (exact) return { confidence: 'exact', medicine: exact, candidates: [exact] };

  // 2. The identifying words, longest first: a longer word is a stronger claim,
  //    so "carbophage" is tried before "500".
  for (const keyword of medicineKeywords(prescribed)) {
    const hits = master.filter(
      (m) =>
        norm(m.medicine_name).includes(keyword) ||
        norm(m.generic_name || '').includes(keyword),
    );
    if (hits.length === 1) {
      return { confidence: 'single', medicine: hits[0], candidates: hits };
    }
    if (hits.length > 1) {
      // Several products of the same molecule. Any brand is acceptable
      // clinically, but which one leaves the shelf is a pharmacist's call, so
      // the caller is told rather than picked for.
      return { confidence: 'ambiguous', medicine: null, candidates: hits };
    }
  }

  return { confidence: 'none', medicine: null, candidates: [] };
}

/**
 * A PostgREST `or=` filter that finds every plausible candidate for a name, so
 * one round trip fetches what matchMedicineName then decides between.
 * Returns null when the name carries no identifying word at all.
 */
export function medicineSearchFilter(prescribed: string): string | null {
  const keywords = medicineKeywords(prescribed).slice(0, 3);
  if (keywords.length === 0) return null;
  // Commas and dots separate PostgREST arguments; the keyword filter above
  // already drops everything but letters, digits and dots.
  return keywords
    .flatMap((k) => [`medicine_name.ilike.%${k}%`, `generic_name.ilike.%${k}%`])
    .join(',');
}
