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

/** No CT over 2,500 and no MRI over 3,000 — enforced again by a DB trigger. */
export function testCeiling(testName: string): number | null {
  const name = testName.toUpperCase();
  if (/\bMRI\b/.test(name)) return 3000;
  if (/\bCT\b/.test(name)) return 2500;
  return null;
}

/** The ceiling breach for an amount, as a sentence, or null when it is fine. */
export function ceilingError(testName: string, amount: number): string | null {
  const ceiling = testCeiling(testName);
  if (ceiling === null || amount <= ceiling) return null;
  const kind = /\bMRI\b/.test(testName.toUpperCase()) ? 'MRI' : 'CT scan';
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
