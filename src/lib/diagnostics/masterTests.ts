import { supabase } from '@/integrations/supabase/client';

// DATA SOURCE: radiology (551 rows) + lab (182 rows) — the same masters the
// Radiology Master and Lab Master screens edit. Outsourced diagnostics pick
// their test name from here so a centre's rate card lines up with the
// hospital's own catalogue instead of whatever someone typed.

export interface MasterTest {
  key: string;
  name: string;
  category: string | null;
  source: 'radiology' | 'lab';
}

/**
 * No CT over 2,500 and no MRI over 3,500 — enforced again by a DB trigger.
 *
 * CT Urography is the one exception: a multi-phase contrast study the centres
 * quote 3,500 for, so the general CT level turned its real rate away. Keep this
 * in step with enforce_diagnostic_test_ceiling() (20260814160000) — if the two
 * disagree, the screen refuses a rate the database would take, or worse, waves
 * through one it will reject on save.
 *
 * UROGRAPH matches "CT Urography" only. A test named "CT Urogram" would still
 * cap at 2,500; the radiology master holds only the longer spelling, so nothing
 * is missed today, but adding the shorter one would need this widened here AND
 * in the trigger.
 */
export function testCeiling(testName: string): number | null {
  const name = testName.toUpperCase();
  if (/\bMRI\b/.test(name)) return 3500;
  if (/\bCT\b/.test(name)) return /UROGRAPH/.test(name) ? 3500 : 2500;
  return null;
}

/** The ceiling breach for an amount, as a sentence, or null when it is fine. */
export function ceilingError(testName: string, amount: number): string | null {
  const ceiling = testCeiling(testName);
  if (ceiling === null || amount <= ceiling) return null;
  const name = testName.toUpperCase();
  // Name the study when it has a ceiling of its own, so "No CT scan can be
  // more than Rs. 3,500" cannot be read as the rule for every CT.
  const kind = /\bMRI\b/.test(name)
    ? 'MRI'
    : /UROGRAPH/.test(name)
      ? 'CT Urography'
      : 'CT scan';
  return `No ${kind} can be more than Rs. ${ceiling.toLocaleString('en-IN')}.`;
}

export async function searchMasterTests(term: string, limit = 15): Promise<MasterTest[]> {
  const search = term.trim();
  if (!search) return [];
  const pattern = `%${search.replace(/[,()]/g, ' ')}%`;

  const [radiology, lab] = await Promise.all([
    (supabase as any)
      .from('radiology')
      .select('id, name, category')
      .ilike('name', pattern)
      .order('name')
      .limit(limit),
    (supabase as any)
      .from('lab')
      .select('id, name, category')
      .ilike('name', pattern)
      .order('name')
      .limit(limit),
  ]);
  if (radiology.error) throw new Error(radiology.error.message);
  if (lab.error) throw new Error(lab.error.message);

  const rows: MasterTest[] = [
    ...(radiology.data || []).map((r: any) => ({
      key: `radiology:${r.id}`,
      name: String(r.name),
      category: r.category ?? null,
      source: 'radiology' as const,
    })),
    ...(lab.data || []).map((r: any) => ({
      key: `lab:${r.id}`,
      name: String(r.name),
      category: r.category ?? null,
      source: 'lab' as const,
    })),
  ];

  // Radiology first — the outsourced work is mostly CT / MRI / ultrasound.
  return rows
    .sort((a, b) => (a.source === b.source ? a.name.localeCompare(b.name) : a.source === 'radiology' ? -1 : 1))
    .slice(0, limit * 2);
}
