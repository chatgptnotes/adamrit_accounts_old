import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export const DAILY_ALLOCATION_SOURCE_PREFIX = 'DAILY_ALLOCATION_SENT:';
export const DAILY_ALLOCATION_EXECUTION_PREFIX = 'DAILY_ALLOCATION_EXECUTION:';
const LEGACY_DAILY_ALLOCATION_EXECUTION_PREFIX = 'Created from Daily Allocation';

export const isDailyAllocationExecution = (notes: string | null | undefined): boolean =>
  Boolean(
    notes?.startsWith(DAILY_ALLOCATION_EXECUTION_PREFIX)
    || notes?.startsWith(LEGACY_DAILY_ALLOCATION_EXECUTION_PREFIX),
  );

export const getDailyAllocationNarration = (notes: string | null | undefined): string => {
  if (!notes) return '';
  if (notes.startsWith(DAILY_ALLOCATION_SOURCE_PREFIX)) {
    return notes.slice(DAILY_ALLOCATION_SOURCE_PREFIX.length).trim();
  }
  return notes;
};

export interface ScheduleEntry {
  id: string;
  schedule_date: string;
  obligation_id: string;
  party_name: string;
  category: string;
  daily_amount: number;
  carryforward_amount: number;
  total_due: number;
  paid_amount: number;
  status: string;
  days_overdue: number;
  voucher_id: string | null;
  paid_at: string | null;
  paid_by: string | null;
  notes: string | null;
  hospital_name: string;
  company_id: string | null;
  tally_company_id: string | null;
  tally_ledger_id: string | null;
  tally_ledger_name: string | null;
  debit_account_name: string | null;
  credit_tally_ledger_id: string | null;
  accounting_company_id: string | null;
  debit_account_id: string | null;
  credit_account_id: string | null;
}

export interface BankAccount {
  id: string; // tally ledger id or manual id
  name: string;
  type: 'bank' | 'cash';
  hospital: string; // hope / ayushman
  ledger_balance: number; // from Tally
  actual_balance: number | null; // manually entered
  notes: string;
  last_synced: string | null;
}

export interface FundSummary {
  accounts: BankAccount[];
  totalLedger: number;
  totalActual: number;
  lastSyncAt: string | null;
}

// Generate today's schedule by calling the RPC
const generateSchedule = async (date: string, hospital: string) => {
  const { error } = await (supabase as any).rpc('generate_daily_payment_schedule', {
    p_date: date,
    p_hospital: hospital,
  });
  if (error) {
    console.error('Failed to generate schedule:', error);
  }
};

export const useDailyPaymentSchedule = (date: string, hospital: string = 'hope') => {
  const queryClient = useQueryClient();

  const schedule = useQuery({
    queryKey: ['daily-payment-schedule', date, hospital],
    queryFn: async () => {
      await generateSchedule(date, hospital);

      const { data, error } = await (supabase as any)
        .from('daily_payment_schedule')
        .select('*')
        .eq('schedule_date', date)
        .eq('hospital_name', hospital)
        .order('days_overdue', { ascending: false })
        .order('category', { ascending: true });

      if (error) throw error;

      const rows = (data || []) as ScheduleEntry[];
      const obligationIds = [...new Set(
        rows.map((row) => row.obligation_id).filter((id): id is string => Boolean(id)),
      )];
      const { data: obligations, error: obligationError } = obligationIds.length > 0
        ? await (supabase as any)
          .from('payment_obligations')
          .select('id, company_id, chart_of_accounts_id')
          .in('id', obligationIds)
        : { data: [], error: null };
      if (obligationError) throw obligationError;
      const obligationMap = new Map((obligations || []).map((obligation: {
        id: string;
        company_id: string | null;
        chart_of_accounts_id: string | null;
      }) => [obligation.id, obligation]));
      const rowsWithObligations = rows.map((row) => {
        const obligation = obligationMap.get(row.obligation_id);
        return {
          ...row,
          company_id: obligation?.company_id || null,
          accounting_company_id: obligation?.company_id || null,
          debit_account_id: obligation?.chart_of_accounts_id || null,
        };
      });
      const accountIds = [...new Set(
        rowsWithObligations.map((row) => row.debit_account_id).filter((id): id is string => Boolean(id)),
      )];
      if (accountIds.length === 0) {
        return rowsWithObligations.map((row) => ({ ...row, tally_ledger_name: null, debit_account_name: null }));
      }

      const { data: accounts, error: accountError } = await (supabase as any)
        .from('chart_of_accounts')
        .select('id, account_name')
        .in('id', accountIds);
      if (accountError) throw accountError;

      const accountNames = new Map((accounts || []).map((account: { id: string; account_name: string }) => [account.id, account.account_name]));
      return rowsWithObligations.map((row) => ({
        ...row,
        tally_ledger_name: null,
        debit_account_name: row.debit_account_id ? accountNames.get(row.debit_account_id) || null : null,
      }));
    },
  });

  const markPaid = useMutation({
    mutationFn: async ({ scheduleId, amount, userId }: { scheduleId: string; amount: number; userId: string }) => {
      const { data, error } = await (supabase as any).rpc('mark_obligation_paid', {
        p_schedule_id: scheduleId,
        p_amount: amount,
        p_user_id: userId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_voucherId: string, variables: any) => {
      queryClient.invalidateQueries({ queryKey: ['daily-payment-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['cash-book-entries'] });
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      toast.success(`Payment of Rs. ${variables.amount.toLocaleString('en-IN')} recorded successfully`);
    },
    onError: (err: any) => {
      toast.error('Payment failed: ' + err.message);
    },
  });

  const createPaymentVoucher = useMutation({
    mutationFn: async ({
      scheduleId, amount, userId, payeeName, hospitalType,
    }: {
      scheduleId: string;
      amount: number;
      userId: string;
      payeeName?: string | null;
      hospitalType: string;
    }) => {
      const { data, error } = await (supabase as any).rpc('create_daily_payment_voucher', {
        p_schedule_id: scheduleId,
        p_amount: amount,
        p_user_id: userId,
        p_payee_name: payeeName || null,
        p_hospital_type: hospitalType,
      });
      if (error) throw error;
      return data as {
        paymentVoucherId: string;
        paymentVoucherNumber: string;
      };
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['daily-payment-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['payment-history'] });
      toast.success(`Payment Voucher ${result.paymentVoucherNumber} created for Rs. ${variables.amount.toLocaleString('en-IN')}.`);
    },
    onError: (err: any) => toast.error('Payment failed: ' + err.message),
  });

  // Inline edit a schedule entry (daily_amount, notes, or skip)
  const updateScheduleEntry = useMutation({
    mutationFn: async ({ id, ...updates }: {
      id: string;
      party_name?: string;
      daily_amount?: number;
      notes?: string;
      status?: string;
      tally_company_id?: string | null;
      tally_ledger_id?: string | null;
      credit_tally_ledger_id?: string | null;
      accounting_company_id?: string | null;
      debit_account_id?: string | null;
      credit_account_id?: string | null;
    }) => {
      const { error } = await (supabase as any)
        .from('daily_payment_schedule')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-payment-schedule'] });
      toast.success('Schedule updated');
    },
    onError: (err: any) => {
      toast.error('Update failed: ' + err.message);
    },
  });

  const savePaymentLedgers = useMutation({
    mutationFn: async ({
      id,
      tallyCompanyId,
      debitLedgerId,
      creditLedgerId,
    }: {
      id: string;
      tallyCompanyId: string | null;
      debitLedgerId: string | null;
      creditLedgerId: string | null;
    }) => {
      const { error } = await (supabase as any)
        .from('daily_payment_schedule')
        .update({
          tally_company_id: tallyCompanyId,
          tally_ledger_id: debitLedgerId,
          credit_tally_ledger_id: creditLedgerId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-payment-schedule'] });
    },
    onError: (err: any) => {
      toast.error('Payment ledger selection could not be saved: ' + err.message);
    },
  });

  const saveAccountingLedgers = useMutation({
    mutationFn: async ({
      obligationId,
      accountingCompanyId,
      debitAccountId,
    }: {
      obligationId: string;
      accountingCompanyId: string | null;
      debitAccountId: string | null;
    }) => {
      const { error } = await (supabase as any)
        .from('payment_obligations')
        .update({
          company_id: accountingCompanyId,
          chart_of_accounts_id: debitAccountId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', obligationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-payment-schedule'] });
    },
    onError: (err: any) => {
      toast.error('Accounting company/ledger selection could not be saved: ' + err.message);
    },
  });

  const saveObligationDetails = useMutation({
    mutationFn: async ({
      obligationId,
      partyName,
      companyId,
      ledgerId,
    }: {
      obligationId: string;
      partyName: string;
      companyId: string | null;
      ledgerId: string | null;
    }) => {
      const { error } = await (supabase as any)
        .from('payment_obligations')
        .update({
          party_name: partyName,
          company_id: companyId,
          chart_of_accounts_id: ledgerId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', obligationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-payment-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['payment-obligations'] });
    },
    onError: (err: any) => toast.error('Obligation details could not be saved: ' + err.message),
  });

  // Skip/remove an entry from today's schedule
  const skipEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('daily_payment_schedule')
        .update({ status: 'skipped', daily_amount: 0, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-payment-schedule'] });
      toast.success('Obligation skipped for today');
    },
    onError: (err: any) => {
      toast.error('Skip failed: ' + err.message);
    },
  });

  // Batch update sort order after drag-and-drop
  const reorderSchedule = useMutation({
    mutationFn: async (entries: { id: string; priority: number }[]) => {
      // Update the priority on the underlying obligations so the order persists
      for (const entry of entries) {
        const scheduleRow = (schedule.data || []).find(s => s.id === entry.id);
        if (scheduleRow) {
          await (supabase as any)
            .from('payment_obligations')
            .update({ priority: entry.priority, updated_at: new Date().toISOString() })
            .eq('id', scheduleRow.obligation_id);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-payment-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['payment-obligations'] });
      toast.success('Priority order saved');
    },
    onError: (err: any) => {
      toast.error('Reorder failed: ' + err.message);
    },
  });

  return {
    schedule: schedule.data || [],
    isLoading: schedule.isLoading,
    error: schedule.error,
    refetch: schedule.refetch,
    markPaid,
    createPaymentVoucher,
    savePaymentLedgers,
    saveAccountingLedgers,
    saveObligationDetails,
    updateScheduleEntry,
    skipEntry,
    reorderSchedule,
  };
};

// Fetch individual bank/cash accounts from Tally + manual overrides
export const useFundAccounts = (date: string) => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['fund-accounts', date],
    queryFn: async (): Promise<FundSummary> => {
      const accounts: BankAccount[] = [];
      let lastSyncAt: string | null = null;

      // Get all tally configs
      const { data: configs } = await (supabase as any)
        .from('tally_config')
        .select('id, company_name');

      if (configs && configs.length > 0) {
        for (const config of configs) {
          const companyLower = (config.company_name || '').toLowerCase();
          let hospital = 'other';
          if (companyLower.includes('hope')) hospital = 'hope';
          else if (companyLower.includes('ayushman') || companyLower.includes('aishman')) hospital = 'ayushman';

          const { data: ledgers } = await (supabase as any)
            .from('tally_ledgers')
            .select('id, name, closing_balance, parent_group, updated_at, is_hidden')
            .eq('company_id', config.id)
            .or('parent_group.ilike.%cash%,parent_group.ilike.%bank%');

          if (ledgers) {
            for (const l of ledgers) {
              // Skip hidden/inactive ledgers
              if (l.is_hidden) continue;

              // Prevent duplicate accounts if multiple tally_config rows map to same company
              const alreadyExists = accounts.some(a => a.name.toLowerCase() === l.name.toLowerCase());
              if (alreadyExists) continue;

              const pg = (l.parent_group || '').toLowerCase();
              const type = pg.includes('cash') ? 'cash' as const : 'bank' as const;

              accounts.push({
                id: l.id,
                name: l.name,
                type,
                hospital,
                ledger_balance: Math.abs(l.closing_balance || 0),
                actual_balance: null,
                notes: '',
                last_synced: l.updated_at || null,
              });

              if (l.updated_at && (!lastSyncAt || l.updated_at > lastSyncAt)) {
                lastSyncAt = l.updated_at;
              }
            }
          }
        }
      }

      // Fetch manual overrides for this date
      const { data: overrides } = await (supabase as any)
        .from('daily_fund_balances')
        .select('*')
        .eq('balance_date', date);

      if (overrides) {
        for (const ov of overrides) {
          // PostgREST returns numeric columns as strings. Coerce to Number
          // so arithmetic (e.g. totalActual reduce) doesn't string-concat.
          const actual = ov.actual_balance !== null && ov.actual_balance !== undefined
            ? Number(ov.actual_balance)
            : null;
          // Try ID match first (direct Tally account), then name match (Tally re-synced with new ID)
          const existing =
            accounts.find(a => a.id === ov.account_ref_id) ||
            accounts.find(a => a.name.toLowerCase() === (ov.account_name || '').toLowerCase());
          if (existing) {
            existing.actual_balance = actual;
            existing.notes = ov.notes || '';
          } else {
            // Truly manual account (not from Tally)
            accounts.push({
              id: ov.id,
              name: ov.account_name,
              type: ov.account_type || 'bank',
              hospital: (ov.hospital_name || 'hope').toLowerCase(),
              ledger_balance: 0,
              actual_balance: actual,
              notes: ov.notes || '',
              last_synced: null,
            });
          }
        }
      }

      const totalLedger = accounts.reduce((s, a) => s + a.ledger_balance, 0);
      const totalActual = accounts.reduce((s, a) => s + (a.actual_balance !== null ? a.actual_balance : 0), 0);

      return { accounts, totalLedger, totalActual, lastSyncAt };
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // Save actual balance for an account
  const saveActualBalance = useMutation({
    mutationFn: async ({
      accountRefId, accountName, accountType, hospital, actualBalance, notes,
    }: {
      accountRefId: string; accountName: string; accountType: string;
      hospital: string; actualBalance: number; notes: string;
    }) => {
      // Upsert into daily_fund_balances
      const { error } = await (supabase as any)
        .from('daily_fund_balances')
        .upsert({
          balance_date: date,
          account_ref_id: accountRefId,
          account_name: accountName,
          account_type: accountType,
          hospital_name: hospital,
          actual_balance: actualBalance,
          notes: notes || '',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'balance_date,account_ref_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fund-accounts'] });
      toast.success('Actual balance saved');
    },
    onError: (err: any) => {
      toast.error('Failed to save: ' + err.message);
    },
  });

  // Add a manual account (not from Tally)
  const addManualAccount = useMutation({
    mutationFn: async ({
      accountName, accountType, hospital, actualBalance, notes,
    }: {
      accountName: string; accountType: string;
      hospital: string; actualBalance: number; notes: string;
    }) => {
      const manualId = crypto.randomUUID();
      const { error } = await (supabase as any)
        .from('daily_fund_balances')
        .insert({
          balance_date: date,
          account_ref_id: manualId,
          account_name: accountName,
          account_type: accountType,
          hospital_name: hospital,
          actual_balance: actualBalance,
          notes: notes || '',
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fund-accounts'] });
      toast.success('Account added');
    },
    onError: (err: any) => {
      toast.error('Failed to add account: ' + err.message);
    },
  });

  return {
    funds: query.data || { accounts: [], totalLedger: 0, totalActual: 0, lastSyncAt: null },
    isLoading: query.isLoading,
    refetch: query.refetch,
    saveActualBalance,
    addManualAccount,
  };
};

// Fetch today's cash collections from voucher entries
export const useTodayCashCollections = (date: string) => {
  return useQuery({
    queryKey: ['today-cash-collections', date],
    queryFn: async () => {
      const { data: cashAccount } = await supabase
        .from('chart_of_accounts')
        .select('id')
        .eq('account_name', 'Cash in Hand')
        .maybeSingle();

      if (!cashAccount) return 0;

      const { data: entries } = await supabase
        .from('voucher_entries')
        .select(`
          debit_amount,
          voucher:vouchers!inner (voucher_date, status)
        `)
        .eq('account_id', cashAccount.id) as any;

      if (!entries) return 0;

      const todayTotal = entries
        .filter((e: any) => e.voucher?.voucher_date === date && e.voucher?.status !== 'cancelled')
        .reduce((sum: number, e: any) => sum + (e.debit_amount || 0), 0);

      return todayTotal;
    },
  });
};

// Sub-allocations for a schedule entry (break one obligation into named payees)
export interface SubAllocation {
  id: string;
  schedule_id: string;
  payee_name: string;
  amount: number;
  is_paid: boolean;
  paid_at: string | null;
  paid_by: string | null;
  voucher_id: string | null;
  notes: string | null;
}

export const useSubAllocations = (scheduleId: string | null) => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['sub-allocations', scheduleId],
    queryFn: async (): Promise<SubAllocation[]> => {
      if (!scheduleId) return [];
      const { data, error } = await (supabase as any)
        .from('payment_sub_allocations')
        .select('*')
        .eq('schedule_id', scheduleId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as SubAllocation[];
    },
    enabled: !!scheduleId,
  });

  const invalidateSubAlloc = () => {
    queryClient.invalidateQueries({ queryKey: ['sub-allocations', scheduleId] });
    queryClient.invalidateQueries({ queryKey: ['sub-allocations-batch'] });
  };

  const addPayee = useMutation({
    mutationFn: async ({ payeeName, amount }: { payeeName: string; amount: number }) => {
      if (!scheduleId) throw new Error('No schedule ID');
      const { error } = await (supabase as any)
        .from('payment_sub_allocations')
        .insert({ schedule_id: scheduleId, payee_name: payeeName, amount });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateSubAlloc();
      toast.success('Payee added');
    },
    onError: (err: any) => {
      toast.error('Failed to add payee: ' + err.message);
    },
  });

  const removePayee = useMutation({
    mutationFn: async (subId: string) => {
      const { error } = await (supabase as any)
        .from('payment_sub_allocations')
        .delete()
        .eq('id', subId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateSubAlloc();
      toast.success('Payee removed');
    },
    onError: (err: any) => {
      toast.error('Failed to remove payee: ' + err.message);
    },
  });

  const updatePayee = useMutation({
    mutationFn: async ({ id, payeeName, amount, notes }: { id: string; payeeName?: string; amount?: number; notes?: string }) => {
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      if (payeeName !== undefined) updates.payee_name = payeeName;
      if (amount !== undefined) updates.amount = amount;
      if (notes !== undefined) updates.notes = notes;
      const { error } = await (supabase as any)
        .from('payment_sub_allocations')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateSubAlloc();
    },
    onError: (err: any) => {
      toast.error('Failed to update payee: ' + err.message);
    },
  });

  const markPayeePaid = useMutation({
    mutationFn: async ({ id, paidBy, paymentVoucherId }: { id: string; paidBy: string; paymentVoucherId?: string | null }) => {
      const { error } = await (supabase as any)
        .from('payment_sub_allocations')
        .update({
          is_paid: true,
          paid_at: new Date().toISOString(),
          paid_by: paidBy,
          payment_voucher_id: paymentVoucherId || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateSubAlloc();
      toast.success('Payee marked as paid');
    },
    onError: (err: any) => {
      toast.error('Failed to mark paid: ' + err.message);
    },
  });

  return {
    subAllocations: query.data || [],
    isLoading: query.isLoading,
    addPayee,
    removePayee,
    updatePayee,
    markPayeePaid,
  };
};

// Fetch sub-allocations for multiple schedule IDs in one query (for the table display)
export const useSubAllocationsForSchedule = (scheduleIds: string[]) => {
  return useQuery({
    queryKey: ['sub-allocations-batch', scheduleIds.join(',')],
    queryFn: async (): Promise<SubAllocation[]> => {
      if (!scheduleIds.length) return [];
      const { data, error } = await (supabase as any)
        .from('payment_sub_allocations')
        .select('*')
        .in('schedule_id', scheduleIds)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as SubAllocation[];
    },
    enabled: scheduleIds.length > 0,
  });
};

// Payment history query (date range)
export const usePaymentHistory = (fromDate: string, toDate: string, hospital: string = 'hope') => {
  return useQuery({
    queryKey: ['payment-history', fromDate, toDate, hospital],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('daily_payment_schedule')
        .select('*')
        .eq('hospital_name', hospital)
        .gte('schedule_date', fromDate)
        .lte('schedule_date', toDate)
        .order('schedule_date', { ascending: false })
        .order('days_overdue', { ascending: false });

      if (error) throw error;
      return (data || []) as ScheduleEntry[];
    },
    enabled: !!fromDate && !!toDate,
  });
};

// ── Saved Allocations (daily snapshots) ──

export interface SavedAllocation {
  id: string;
  save_date: string;
  hospital_name: string;
  total_due: number;
  total_paid: number;
  total_available: number;
  surplus: number;
  schedule_count: number;
  notes: string | null;
  saved_by: string | null;
  saved_at: string;
  status: 'saved' | 'finalized' | 'revised';
  created_at: string;
  updated_at: string;
}

// Check if a specific date is saved
export const useAllocationSaveStatus = (date: string, hospital: string) => {
  const query = useQuery({
    queryKey: ['allocation-save-status', date, hospital],
    queryFn: async (): Promise<SavedAllocation | null> => {
      const { data, error } = await (supabase as any)
        .from('daily_allocation_saves')
        .select('*')
        .eq('save_date', date)
        .eq('hospital_name', hospital)
        .maybeSingle();
      if (error) throw error;
      return data as SavedAllocation | null;
    },
    enabled: !!date && !!hospital,
  });

  return {
    isSaved: !!query.data,
    save: query.data,
    isLoading: query.isLoading,
  };
};

// Save/finalize a day's allocation (upsert)
export const useSaveAllocation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      save_date: string;
      hospital_name: string;
      total_due: number;
      total_paid: number;
      total_available: number;
      surplus: number;
      schedule_count: number;
      notes?: string;
      saved_by?: string;
      status: 'saved' | 'finalized' | 'revised';
    }) => {
      const { error } = await (supabase as any)
        .from('daily_allocation_saves')
        .upsert({
          save_date: params.save_date,
          hospital_name: params.hospital_name,
          total_due: params.total_due,
          total_paid: params.total_paid,
          total_available: params.total_available,
          surplus: params.surplus,
          schedule_count: params.schedule_count,
          notes: params.notes || null,
          saved_by: params.saved_by || null,
          status: params.status,
          saved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'save_date,hospital_name' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allocation-save-status'] });
      queryClient.invalidateQueries({ queryKey: ['saved-allocations'] });
      toast.success('Day\'s allocation saved successfully');
    },
    onError: (err: any) => {
      toast.error('Failed to save allocation: ' + err.message);
    },
  });
};

// List saved allocations for a date range
export const useSavedAllocations = (fromDate: string, toDate: string, hospital: string) => {
  return useQuery({
    queryKey: ['saved-allocations', fromDate, toDate, hospital],
    queryFn: async (): Promise<SavedAllocation[]> => {
      const { data, error } = await (supabase as any)
        .from('daily_allocation_saves')
        .select('*')
        .eq('hospital_name', hospital)
        .gte('save_date', fromDate)
        .lte('save_date', toDate)
        .order('save_date', { ascending: false });
      if (error) throw error;
      return (data || []) as SavedAllocation[];
    },
    enabled: !!fromDate && !!toDate && !!hospital,
  });
};
