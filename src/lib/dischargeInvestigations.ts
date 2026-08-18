/**
 * The Investigations section of a discharge summary.
 *
 * Everything printed here must be traceable to a lab_results row recorded
 * against THIS patient's visit. Three faults were found in the previous
 * behaviour (18-Aug), each of which put wrong results on a medical record:
 *
 * 1. WRONG PATIENT. When the visit UUID could not be resolved, the summary fell
 *    back to `patient_name ILIKE '%name%'` with LIMIT 10. On live data
 *    "SUNITA" matches SEVEN different patients across eight visits, and "RAM"
 *    matches 50,161 rows across three. That fallback could print another
 *    patient's blood results on this patient's discharge summary. It is gone:
 *    no visit, no investigations. An empty section is recoverable; a wrong
 *    result on a signed discharge summary is not.
 *
 * 2. REPEATED RESULTS. Results are stored once per sub-test row, so a single
 *    visit held 368 rows containing the same value many times over -- Globulin
 *    3.52 appeared SEVENTEEN times on one date. Identical readings on the same
 *    date are collapsed to one line.
 *
 * 3. NO REFERENCE RANGE. lab_results.reference_range is populated on every row
 *    checked (368 of 368) and was being dropped, so a reader could not tell a
 *    normal result from an abnormal one.
 *
 * The same test legitimately repeated on ANOTHER date is kept, separately,
 * under that date -- that is a genuine second reading, not a duplicate.
 */

export interface LabResultRow {
  test_name?: string | null;
  main_test_name?: string | null;
  test_category?: string | null;
  result_value?: string | null;
  result_unit?: string | null;
  reference_range?: string | null;
  created_at?: string | null;
}

export interface InvestigationLine {
  testName: string;
  value: string;
  unit: string;
  referenceRange: string;
}

export interface InvestigationGroup {
  /** dd/MM/yyyy, as printed. */
  date: string;
  /** Sort key — the ISO date, so ordering does not depend on the printed form. */
  isoDate: string;
  category: string;
  lines: InvestigationLine[];
}

const clean = (v: unknown): string => String(v ?? '').trim();

/** dd/MM/yyyy from an ISO timestamp, without pulling in a date library. */
function printedDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown Date';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Group a visit's lab rows into what the summary prints.
 *
 * Chronological, oldest first, so the section reads as the stay progressed.
 * A row with no test name or no result is dropped rather than printed as
 * "N/A" — a blank line on a medical record invites someone to fill it in.
 */
export function buildInvestigationGroups(rows: readonly LabResultRow[]): InvestigationGroup[] {
  const byKey = new Map<string, InvestigationGroup>();
  const seen = new Set<string>();

  for (const row of rows) {
    const testName = clean(row.test_name);
    const value = clean(row.result_value);
    if (!testName || !value) continue;

    const iso = clean(row.created_at);
    if (!iso) continue;
    const date = printedDate(iso);
    const day = iso.slice(0, 10);
    const category = clean(row.main_test_name) || clean(row.test_category) || 'General Tests';
    const unit = clean(row.result_unit);
    const referenceRange = clean(row.reference_range);

    // Identical reading, same test, same day — one line, however many rows the
    // lab wrote. A different value on the same day is NOT a duplicate and is
    // kept, because that is a genuine repeat reading.
    const dedupeKey = `${day}|${category}|${testName}|${value}|${unit}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const groupKey = `${day}|${category}`;
    let group = byKey.get(groupKey);
    if (!group) {
      group = { date, isoDate: day, category, lines: [] };
      byKey.set(groupKey, group);
    }
    group.lines.push({ testName, value, unit, referenceRange });
  }

  return [...byKey.values()].sort(
    (a, b) => a.isoDate.localeCompare(b.isoDate) || a.category.localeCompare(b.category),
  );
}

/** One printed line: "Blood Urea: 39.3 mg/dl (ref 15 - 45 mg/dl)". */
export function formatLine(line: InvestigationLine): string {
  const unit = line.unit ? ` ${line.unit}` : '';
  const ref = line.referenceRange ? ` (ref ${line.referenceRange})` : '';
  return `${line.testName}: ${line.value}${unit}${ref}`;
}

/**
 * The Investigations text for the summary.
 *
 * Returns an EMPTY STRING when there is nothing on file. The caller decides
 * what to say; this must never invent a placeholder that reads like a result.
 */
export function formatInvestigations(rows: readonly LabResultRow[]): string {
  return buildInvestigationGroups(rows)
    .map((g) => `${g.date} — ${g.category}\n  ${g.lines.map(formatLine).join('\n  ')}`)
    .join('\n\n');
}
