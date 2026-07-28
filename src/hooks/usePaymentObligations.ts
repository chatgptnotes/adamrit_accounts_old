import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface PaymentObligation {
  id: string;
  party_name: string;
  category: 'fixed' | 'variable';
  sub_category: string | null;
  default_daily_amount: number;
  priority: number;
  chart_of_accounts_id: string | null;
  is_active: boolean;
  notes: string | null;
  hospital_name: string;
  payee_name: string | null; // specific payee e.g. "Dr Pramod Gandhi" for rent
  payee_search_table: string | null; // e.g. hope_consultants, staff_members
  attachment_url: string | null; // uploaded Excel/Doc file URL
  google_sheet_link: string | null; // Google Sheets link for outstanding payments
  company_id: string | null;
  tally_ledger_id: string | null; // legacy single FK; kept for back-compat
  approximate_balance: number | null; // director's manual estimate when ledger is stale
  section: string | null; // explicit Obligations Master section; null → derive from sub_category
  tally_ledgers?: { id: string; name: string; closing_balance: number } | null; // legacy embed
  payment_obligation_ledgers?: ObligationLedgerLink[]; // per-company ledger links (current)
  created_at: string;
  updated_at: string;
}

export interface ObligationLedgerLink {
  obligation_id: string;
  company_id: string;
  ledger_id: string;
  tally_ledgers: { id: string; name: string; closing_balance: number };
  tally_config?: { id: string; company_name: string } | null;
}

export interface TallyCompany {
  id: string;
  company_name: string;
  company_ids?: string[];
}

const canonicalTallyCompany = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/pvtltd|privatelimited|limited|ltd/g, '');

const SUPPORTED_TALLY_COMPANIES = new Map<string, string>([
  ['ayushmannagpurhospital', 'Ayushman Nagpur Hospital'],
  ['drmhopehospital', 'DRM Hope Hospital Pvt Ltd'],
  ['drmhopehospitalayushmanhospital', 'DRM Hope Hospital Pvt Ltd & Ayushman Hospital'],
  ['hopepharmacy', 'Hope Pharmacy'],
]);

export type NewObligation = Omit<PaymentObligation, 'id' | 'created_at' | 'updated_at'>;

export const usePaymentObligations = (hospital: string = 'hope') => {
  const queryClient = useQueryClient();

  const obligations = useQuery({
    queryKey: ['payment-obligations', hospital],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('payment_obligations')
        .select(`
          *,
          tally_ledgers(id, name, closing_balance),
          payment_obligation_ledgers(
            obligation_id, company_id, ledger_id,
            tally_ledgers(id, name, closing_balance),
            tally_config(id, company_name)
          )
        `)
        .eq('hospital_name', hospital)
        .order('priority', { ascending: true });
      if (error) throw error;
      return (data || []) as PaymentObligation[];
    },
  });

  const createObligation = useMutation({
    mutationFn: async (obligation: Partial<NewObligation>) => {
      const { data, error } = await (supabase as any)
        .from('payment_obligations')
        .insert({
          party_name: obligation.party_name,
          category: obligation.category || 'variable',
          sub_category: obligation.sub_category || 'other',
          default_daily_amount: obligation.default_daily_amount || 0,
          priority: obligation.priority || 10,
          chart_of_accounts_id: obligation.chart_of_accounts_id || null,
          is_active: true,
          notes: obligation.notes || null,
          hospital_name: obligation.hospital_name || hospital,
          payee_name: obligation.payee_name || null,
          payee_search_table: obligation.payee_search_table || null,
          attachment_url: obligation.attachment_url || null,
          google_sheet_link: obligation.google_sheet_link || null,
          tally_ledger_id: obligation.tally_ledger_id || null,
          approximate_balance: obligation.approximate_balance ?? null,
          section: obligation.section || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-obligations'] });
      toast.success('Obligation added successfully');
    },
    onError: (err: any) => {
      toast.error('Failed to add obligation: ' + err.message);
    },
  });

  const updateObligation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PaymentObligation> & { id: string }) => {
      const { data, error } = await (supabase as any)
        .from('payment_obligations')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-obligations'] });
      queryClient.invalidateQueries({ queryKey: ['daily-payment-schedule'] });
      toast.success('Obligation updated');
    },
    onError: (err: any) => {
      toast.error('Failed to update: ' + err.message);
    },
  });

  const deleteObligation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('payment_obligations')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-obligations'] });
      toast.success('Obligation deleted');
    },
    onError: (err: any) => {
      toast.error('Failed to delete: ' + err.message);
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await (supabase as any)
        .from('payment_obligations')
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-obligations'] });
      toast.success('Status updated');
    },
    onError: (err: any) => {
      toast.error('Failed to toggle: ' + err.message);
    },
  });

  return {
    obligations: obligations.data || [],
    isLoading: obligations.isLoading,
    error: obligations.error,
    createObligation,
    updateObligation,
    deleteObligation,
    toggleActive,
  };
};

// Search consultants/surgeons/anaesthetists/staff for sub-payment payee
export const usePayeeSearch = (searchTable: string, searchTerm: string) => {
  return useQuery({
    queryKey: ['payee-search', searchTable, searchTerm],
    queryFn: async () => {
      if (!searchTable || !searchTerm || searchTerm.length < 2) return [];

      const { data, error } = await (supabase as any)
        .from(searchTable)
        .select('id, name, specialty, department')
        .ilike('name', `%${searchTerm}%`)
        .limit(20);

      if (error) {
        console.error('Payee search error:', error);
        return [];
      }
      return (data || []) as { id: string; name: string; specialty?: string; department?: string }[];
    },
    enabled: !!searchTable && searchTerm.length >= 2,
  });
};

// Search Tally ledgers by name, optionally scoped to a single Tally company
export const useTallyLedgerSearch = (searchTerm: string | null | undefined, companyId?: string | string[] | null) => {
  const normalizedSearchTerm = searchTerm || '';
  const companyIds = Array.isArray(companyId) ? companyId : companyId ? [companyId] : [];

  return useQuery({
    queryKey: ['tally-ledger-search', normalizedSearchTerm, companyIds.join(',') || 'any'],
    queryFn: async () => {
      if (normalizedSearchTerm.length < 1) return [];
      let query = (supabase as any)
        .from('tally_ledgers')
        .select('id, name, parent_group, closing_balance, company_id, tally_config(company_name)')
        .ilike('name', `%${normalizedSearchTerm}%`)
        .order('name')
        .limit(20);
      if (companyIds.length === 1) query = query.eq('company_id', companyIds[0]);
      if (companyIds.length > 1) query = query.in('company_id', companyIds);
      const { data, error } = await query;
      if (error) {
        console.error('Ledger search error:', error);
        return [];
      }
      return (data || []) as {
        id: string;
        name: string;
        parent_group: string | null;
        closing_balance: number;
        company_id: string | null;
        tally_config?: { company_name: string } | null;
      }[];
    },
    enabled: normalizedSearchTerm.length >= 1,
  });
};

// Cash and bank ledgers available for the credit side of a payment voucher.
export const useTallyCashBankLedgers = (companyId?: string | string[] | null) => {
  const companyIds = Array.isArray(companyId) ? companyId : companyId ? [companyId] : [];

  return useQuery({
    queryKey: ['tally-cash-bank-ledgers', companyIds.join(',') || 'none'],
    queryFn: async () => {
      if (companyIds.length === 0) return [];
      let query = (supabase as any)
        .from('tally_ledgers')
        .select('id, name, parent_group, closing_balance, company_id, accounting_account_id, is_hidden, tally_config(company_name)')
        .or('parent_group.ilike.%cash%,parent_group.ilike.%bank%')
        .order('name');
      if (companyIds.length === 1) query = query.eq('company_id', companyIds[0]);
      else query = query.in('company_id', companyIds);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).filter((ledger: any) => !ledger.is_hidden && ledger.accounting_account_id) as Array<{
        id: string;
        name: string;
        parent_group: string | null;
        closing_balance: number;
        company_id: string | null;
        accounting_account_id: string;
        tally_config?: { company_name: string } | null;
      }>;
    },
    enabled: companyIds.length > 0,
  });
};

export const useTallyLedgerDetails = (ledgerId?: string | null) => {
  return useQuery({
    queryKey: ['tally-ledger-details', ledgerId || 'none'],
    queryFn: async () => {
      if (!ledgerId) return null;
      const { data, error } = await (supabase as any)
        .from('tally_ledgers')
        .select('id, name, parent_group, company_id, tally_config(company_name)')
        .eq('id', ledgerId)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; name: string; parent_group: string | null; company_id: string | null; tally_config?: { company_name: string } | null } | null;
    },
    enabled: Boolean(ledgerId),
  });
};

export interface AccountingLedgerOption {
  id: string;
  account_name: string;
  account_group: string | null;
  account_type: string | null;
  company_id: string | null;
}

// Accounting-ledger equivalents used by the Payment Allocation UI. These are
// deliberately read-only: confirming an operational payment still follows the
// existing create_daily_payment_voucher flow and does not post ledger entries.
export const useAccountingLedgerSearch = (
  searchTerm: string | null | undefined,
  companyId?: string | null,
) => {
  const normalizedSearchTerm = (searchTerm || '').trim();
  return useQuery({
    queryKey: ['accounting-ledger-search', normalizedSearchTerm, companyId || 'none'],
    queryFn: async (): Promise<AccountingLedgerOption[]> => {
      if (!companyId || normalizedSearchTerm.length < 1) return [];
      const { data, error } = await (supabase as any)
        .from('chart_of_accounts')
        .select('id, account_name, account_group, account_type, company_id')
        .eq('is_active', true)
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .ilike('account_name', `%${normalizedSearchTerm}%`)
        .order('account_name')
        .limit(20);
      if (error) throw error;
      return (data || []) as AccountingLedgerOption[];
    },
    enabled: Boolean(companyId) && normalizedSearchTerm.length >= 1,
  });
};

export const useAccountingCashBankLedgers = (companyId?: string | null) => {
  return useQuery({
    queryKey: ['accounting-cash-bank-ledgers', companyId || 'none'],
    queryFn: async (): Promise<AccountingLedgerOption[]> => {
      if (!companyId) return [];
      const { data, error } = await (supabase as any)
        .from('chart_of_accounts')
        .select('id, account_name, account_group, account_type, company_id')
        .eq('is_active', true)
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .or('account_group.ilike.%cash%,account_group.ilike.%bank%')
        .order('account_name');
      if (error) throw error;
      return (data || []) as AccountingLedgerOption[];
    },
    enabled: Boolean(companyId),
  });
};

// Sub-categories master (editable). Each row declares which Obligations
// Master section it rolls up into.
export interface SubCategoryRow {
  id: string;
  value: string;
  label: string;
  section: 'pharmacy_implant' | 'consultants' | 'overheads' | 'other_vendors';
  sort_order: number;
  is_active: boolean;
}

export const useObligationSubCategories = () => {
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['obligation-sub-categories'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('payment_obligation_sub_categories')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data || []) as SubCategoryRow[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (row: Partial<SubCategoryRow> & { value: string; label: string; section: SubCategoryRow['section'] }) => {
      const payload: any = {
        value: row.value.trim().toLowerCase(),
        label: row.label.trim(),
        section: row.section,
        sort_order: row.sort_order ?? 100,
        is_active: row.is_active ?? true,
        updated_at: new Date().toISOString(),
      };
      if (row.id) {
        const { error } = await (supabase as any)
          .from('payment_obligation_sub_categories')
          .update(payload)
          .eq('id', row.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from('payment_obligation_sub_categories')
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['obligation-sub-categories'] });
      toast.success('Sub-category saved');
    },
    onError: (err: any) => toast.error('Failed to save: ' + err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('payment_obligation_sub_categories')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['obligation-sub-categories'] });
      toast.success('Sub-category deleted');
    },
    onError: (err: any) => toast.error('Failed to delete: ' + err.message),
  });

  return {
    subCategories: list.data || [],
    isLoading: list.isLoading,
    upsert,
    remove,
  };
};

// List active Tally companies (Hope, Ayushman, etc.) — used to render one
// ledger picker per company on the obligation edit dialog.
export const useTallyCompanies = () => {
  return useQuery({
    queryKey: ['tally-companies'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('tally_config')
        .select('id, company_name, is_active, updated_at, created_at')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      const grouped = new Map<string, TallyCompany>();
      for (const row of data || []) {
        const key = canonicalTallyCompany(row.company_name || '');
        const canonicalName = SUPPORTED_TALLY_COMPANIES.get(key);
        if (!canonicalName) continue;
        const existing = grouped.get(key);
        if (existing) {
          existing.company_ids = [...(existing.company_ids || [existing.id]), row.id];
        } else {
          grouped.set(key, { id: row.id, company_name: canonicalName, company_ids: [row.id] });
        }
      }
      return Array.from(grouped.values()).sort((a, b) => a.company_name.localeCompare(b.company_name));
    },
  });
};

// Replace all ledger links for one obligation atomically (delete-all + insert-many).
export const useSaveObligationLedgerLinks = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      obligationId,
      links,
    }: {
      obligationId: string;
      links: { company_id: string; ledger_id: string }[];
    }) => {
      // Remove all existing links for this obligation, then insert the new set.
      const { error: delErr } = await (supabase as any)
        .from('payment_obligation_ledgers')
        .delete()
        .eq('obligation_id', obligationId);
      if (delErr) throw delErr;

      if (links.length === 0) return;

      const rows = links.map(l => ({
        obligation_id: obligationId,
        company_id: l.company_id,
        ledger_id: l.ledger_id,
      }));
      const { error: insErr } = await (supabase as any)
        .from('payment_obligation_ledgers')
        .insert(rows);
      if (insErr) throw insErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-obligations'] });
    },
    onError: (err: any) => {
      toast.error('Failed to save ledger links: ' + err.message);
    },
  });
};

// Multi-table payee search — searches across consultants, surgeons, and Tally ledgers
export const useMultiPayeeSearch = (searchTerm: string, hospital: string = 'hope') => {
  return useQuery({
    queryKey: ['multi-payee-search', searchTerm, hospital],
    queryFn: async () => {
      if (!searchTerm || searchTerm.length < 2) return [];

      const results: { id: string; name: string; specialty?: string; source: string; amount?: number }[] = [];

      // Search consultants
      const consultTable = hospital === 'hope' ? 'hope_consultants' : 'ayushman_consultants';
      const { data: consultants } = await (supabase as any)
        .from(consultTable)
        .select('id, name, specialty')
        .ilike('name', `%${searchTerm}%`)
        .limit(10);
      if (consultants) {
        for (const c of consultants) {
          results.push({ id: c.id, name: c.name, specialty: c.specialty, source: 'Consultant' });
        }
      }

      // Search surgeons
      const surgeonTable = hospital === 'hope' ? 'hope_surgeons' : 'ayushman_surgeons';
      const { data: surgeons } = await (supabase as any)
        .from(surgeonTable)
        .select('id, name, specialty')
        .ilike('name', `%${searchTerm}%`)
        .limit(10);
      if (surgeons) {
        for (const s of surgeons) {
          // Avoid duplicates (same name from consultants)
          if (!results.find(r => r.name === s.name)) {
            results.push({ id: s.id, name: s.name, specialty: s.specialty, source: 'Surgeon' });
          }
        }
      }

      // Search RMOs (include daily_remuneration for auto-fill)
      const rmoTable = hospital === 'hope' ? 'hope_rmos' : 'ayushman_rmos';
      const { data: rmos } = await (supabase as any)
        .from(rmoTable)
        .select('id, name, specialty, daily_remuneration')
        .ilike('name', `%${searchTerm}%`)
        .limit(10);
      if (rmos) {
        for (const r of rmos) {
          if (!results.find(x => x.name === r.name)) {
            results.push({ id: r.id, name: r.name, specialty: r.specialty, source: 'RMO', amount: r.daily_remuneration || 0 });
          }
        }
      }

      // Search Tally ledgers (vendors, expenses)
      const { data: ledgers } = await (supabase as any)
        .from('tally_ledgers')
        .select('id, name, parent_group')
        .ilike('name', `%${searchTerm}%`)
        .limit(10);
      if (ledgers) {
        for (const l of ledgers) {
          if (!results.find(r => r.name === l.name)) {
            results.push({ id: l.id, name: l.name, specialty: l.parent_group, source: 'Ledger' });
          }
        }
      }

      return results;
    },
    enabled: searchTerm.length >= 2,
  });
};

// ── Default payees for an obligation (template) ──
export interface DefaultPayee {
  id: string;
  obligation_id: string;
  payee_name: string;
  amount: number;
  created_at: string;
}

export const useObligationDefaultPayees = (obligationId: string | null) => {
  const queryClient = useQueryClient();

  const payees = useQuery({
    queryKey: ['obligation-default-payees', obligationId],
    queryFn: async () => {
      if (!obligationId) return [];
      const { data, error } = await (supabase as any)
        .from('obligation_default_payees')
        .select('*')
        .eq('obligation_id', obligationId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as DefaultPayee[];
    },
    enabled: !!obligationId,
  });

  const addPayee = useMutation({
    mutationFn: async ({ payee_name, amount }: { payee_name: string; amount: number }) => {
      const { data, error } = await (supabase as any)
        .from('obligation_default_payees')
        .insert({ obligation_id: obligationId, payee_name, amount })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['obligation-default-payees', obligationId] });
    },
    onError: (err: any) => {
      toast.error('Failed to add payee: ' + err.message);
    },
  });

  const removePayee = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('obligation_default_payees')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['obligation-default-payees', obligationId] });
    },
    onError: (err: any) => {
      toast.error('Failed to remove payee: ' + err.message);
    },
  });

  const updatePayee = useMutation({
    mutationFn: async ({ id, payee_name, amount }: { id: string; payee_name: string; amount: number }) => {
      const { error } = await (supabase as any)
        .from('obligation_default_payees')
        .update({ payee_name, amount })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['obligation-default-payees', obligationId] });
    },
    onError: (err: any) => {
      toast.error('Failed to update payee: ' + err.message);
    },
  });

  return {
    defaultPayees: payees.data || [],
    isLoading: payees.isLoading,
    addPayee,
    removePayee,
    updatePayee,
  };
};
