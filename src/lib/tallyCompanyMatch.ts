import { supabase } from '@/integrations/supabase/client';

// Native accounting uses `companies.id`; the Tally mirror tables
// (tally_ledgers / tally_vouchers) are scoped by `tally_config.id`. The two
// systems are only linked by company *name*, so everything here bridges them
// with a normalized fuzzy match. Extracted from TallyVouchers.tsx so the
// accounting reports can reuse the exact same pairing logic.

/** Normalize a company name for matching (drop punctuation + legal suffixes). */
export function companyKey(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/(privatelimited|pvtltd|limited|ltd)$/, '');
}

/** Normalize a ledger / voucher identifier for Tally-preferred dedup. */
export function normalizeName(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

/**
 * Given a Tally company name, find the single best-matching accounting company.
 * Returns null when there is no confident match (ties are treated as no match).
 */
export function findAccountingCompany<T extends { id: string; company_name: string }>(
  companies: T[],
  tallyCompanyName?: string,
): T | null {
  const target = companyKey(tallyCompanyName);
  if (!target) return null;

  const exact = companies.find((company) => companyKey(company.company_name) === target);
  if (exact) return exact;

  const targetTokens = target.match(/[a-z]+/g) || [];
  const candidates = companies
    .map((company) => {
      const key = companyKey(company.company_name);
      const candidateTokens = key.match(/[a-z]+/g) || [];
      const overlap = targetTokens.filter((token) => candidateTokens.includes(token)).length;
      const contains = key.includes(target) || target.includes(key);
      return { company, score: (contains ? 100 : 0) + overlap, overlap };
    })
    .filter((candidate) => candidate.overlap > 0)
    .sort((left, right) => right.score - left.score);

  if (!candidates.length || (candidates[1] && candidates[0].score === candidates[1].score)) return null;
  return candidates[0].company;
}

/**
 * Resolve the Tally `company_id`(s) that pair with a native accounting company.
 * - Empty / falsy accountingCompanyId → every active Tally company (the
 *   "All Companies" case, so reports aggregate across all mirrors).
 * - Otherwise → the Tally configs whose name matches that accounting company.
 * Returns [] when nothing pairs (report then shows Adamrit-only data).
 */
export async function resolveTallyCompanyIds(accountingCompanyId?: string): Promise<string[]> {
  const { data: configs, error } = await (supabase as any)
    .from('tally_config')
    .select('id, company_name, is_active');
  if (error || !configs) return [];
  const activeConfigs = (configs as { id: string; company_name: string; is_active?: boolean | null }[])
    .filter((config) => config.is_active !== false);

  if (!accountingCompanyId) return activeConfigs.map((config) => config.id);

  const { data: companies } = await (supabase as any)
    .from('companies')
    .select('id, company_name')
    .eq('id', accountingCompanyId);
  const company = (companies || [])[0] as { id: string; company_name: string } | undefined;
  if (!company) return [];

  const target = companyKey(company.company_name);
  return activeConfigs
    .filter((config) => companyKey(config.company_name) === target)
    .map((config) => config.id);
}
