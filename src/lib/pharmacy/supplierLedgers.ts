import { supabase } from '@/integrations/supabase/client';

// The creditor ledgers a pharmacy supplier may be mapped to.
//
// Receiving goods posts Dr Medicine Purchase / Cr the supplier's ledger, and
// paying reverses it, so the ledger has to be a creditor in the company the
// pharmacy posts under — Hope Pharmacy. Ledgers held centrally (no company)
// are offered too, because 2120 Other Creditors lives there and is the
// fallback the GRN accrual uses.

const PHARMACY_COMPANY_KEY = 'hope_pharmacy';
const CREDITOR_GROUPS = ['Sundry Creditors', 'CREDITORS'];

export interface SupplierLedgerOption {
  id: string;
  name: string;
  code: string | null;
  /** null for a centrally-held ledger such as Other Creditors. */
  companyName: string | null;
}

/** Creditor ledgers matching `search`, newest-configured first by name. */
export async function searchSupplierLedgers(search: string): Promise<SupplierLedgerOption[]> {
  const { data: company } = await (supabase as any)
    .from('companies')
    .select('id, company_name')
    .eq('company_key', PHARMACY_COMPANY_KEY)
    .maybeSingle();

  let query = (supabase as any)
    .from('chart_of_accounts')
    .select('id, account_name, account_code, company_id')
    .eq('is_active', true)
    .in('account_group', CREDITOR_GROUPS)
    .order('account_name')
    .limit(25);

  if (company?.id) query = query.or(`company_id.eq.${company.id},company_id.is.null`);
  else query = query.is('company_id', null);

  const term = search.trim();
  if (term) query = query.ilike('account_name', `%${term}%`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  // Hope Pharmacy's own creditors first: the centrally-held ones are mostly
  // legacy names carried over from Tally, and burying the real vendors under
  // them is how the wrong ledger gets picked.
  return ((data ?? []) as any[])
    .map((row) => ({
      id: row.id as string,
      name: row.account_name as string,
      code: row.account_code ?? null,
      companyName: row.company_id ? (company?.company_name ?? null) : null,
    }))
    .sort((a, b) => {
      if (Boolean(a.companyName) !== Boolean(b.companyName)) return a.companyName ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/** The ledger a supplier is already mapped to, for showing in the form. */
export async function fetchLedgerById(id: string | null | undefined): Promise<SupplierLedgerOption | null> {
  if (!id) return null;
  const { data } = await (supabase as any)
    .from('chart_of_accounts')
    .select('id, account_name, account_code, company_id')
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    name: data.account_name,
    code: data.account_code ?? null,
    companyName: null,
  };
}
