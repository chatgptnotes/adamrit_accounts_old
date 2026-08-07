import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { createAccountingVoucher } from '@/lib/accounting-voucher-service';
import type { PaymentObligation } from '@/hooks/usePaymentObligations';

// month is 'YYYY-MM'; rows in monthly_obligation_jvs always store the first day.
export const monthStartDate = (month: string) => `${month}-01`;
export const monthEndDate = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${month}-${String(last).padStart(2, '0')}`;
};

export interface MonthlyJvRow {
  id: string;
  obligation_id: string;
  month: string;
  voucher_id: string | null;
  amount: number;
  vouchers?: { voucher_number: string } | null;
}

// Sum of daily payments per obligation for the month — one query, reduced client-side.
export const useMonthlyPaidTotals = (hospital: string, month: string) =>
  useQuery({
    queryKey: ['monthly-obligation-paid', hospital, month],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('daily_payment_schedule')
        .select('obligation_id, paid_amount')
        // 'all' is the merged owner's view, same as the obligations behind it.
        .in('hospital_name', hospital === 'all' ? ['hope', 'ayushman'] : [hospital])
        .gte('schedule_date', monthStartDate(month))
        .lte('schedule_date', monthEndDate(month))
        .gt('paid_amount', 0);
      if (error) throw error;
      const totals = new Map<string, number>();
      for (const row of data || []) {
        totals.set(row.obligation_id, (totals.get(row.obligation_id) || 0) + Number(row.paid_amount));
      }
      return totals;
    },
  });

export const useMonthlyObligationJvs = (hospital: string, month: string) =>
  useQuery({
    queryKey: ['monthly-obligation-jvs', hospital, month],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('monthly_obligation_jvs')
        .select('id, obligation_id, month, voucher_id, amount, vouchers(voucher_number)')
        .in('hospital_name', hospital === 'all' ? ['hope', 'ayushman'] : [hospital])
        .eq('month', monthStartDate(month));
      if (error) throw error;
      const byObligation = new Map<string, MonthlyJvRow>();
      for (const row of (data || []) as MonthlyJvRow[]) byObligation.set(row.obligation_id, row);
      return byObligation;
    },
  });

export interface CreateJvsResult {
  created: { party: string; voucherNumber: string }[];
  skipped: { party: string; reason: string }[];
  failed: { party: string; error: string }[];
}

// One accrual JV per party for the month: Dr expense ledger / Cr party ledger.
// Claim-then-post (like approveAndPostJV): the UNIQUE(obligation_id, month) row
// is inserted first so a concurrent click can never double-post, and the claim
// is deleted if the voucher fails.
export async function createMonthlyJvs(
  parties: PaymentObligation[],
  month: string,
  hospital: string,
  createdBy: string,
): Promise<CreateJvsResult> {
  const result: CreateJvsResult = { created: [], skipped: [], failed: [] };
  const monthStart = monthStartDate(month);
  const monthLabel = new Date(`${monthStart}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  for (const ob of parties) {
    const amount = Number(ob.monthly_amount || 0);
    if (amount <= 0) { result.skipped.push({ party: ob.party_name, reason: 'No monthly amount set' }); continue; }
    if (!ob.company_id) { result.skipped.push({ party: ob.party_name, reason: 'No company selected' }); continue; }
    if (!ob.expense_account_id) { result.skipped.push({ party: ob.party_name, reason: 'No expense ledger selected' }); continue; }
    if (!ob.chart_of_accounts_id) { result.skipped.push({ party: ob.party_name, reason: 'No party ledger selected' }); continue; }

    const { data: claim, error: claimError } = await (supabase as any)
      .from('monthly_obligation_jvs')
      .insert({
        obligation_id: ob.id,
        month: monthStart,
        hospital_name: hospital,
        amount,
        created_by: createdBy,
      })
      .select('id')
      .single();
    if (claimError) {
      if (claimError.code === '23505') {
        result.skipped.push({ party: ob.party_name, reason: 'JV already created for this month' });
      } else {
        result.failed.push({ party: ob.party_name, error: claimError.message });
      }
      continue;
    }

    try {
      const voucher = await createAccountingVoucher({
        companyId: ob.company_id,
        category: 'JOURNAL',
        date: monthStart,
        narration: `Monthly obligation accrual ${monthLabel} - ${ob.party_name}`,
        entries: [
          { accountId: ob.expense_account_id, debitAmount: amount, creditAmount: 0 },
          { accountId: ob.chart_of_accounts_id, debitAmount: 0, creditAmount: amount },
        ],
      });
      const { error: linkError } = await (supabase as any)
        .from('monthly_obligation_jvs')
        .update({ voucher_id: voucher.id })
        .eq('id', claim.id);
      if (linkError) throw linkError;
      result.created.push({ party: ob.party_name, voucherNumber: voucher.voucher_number });
    } catch (error: any) {
      await (supabase as any).from('monthly_obligation_jvs').delete().eq('id', claim.id);
      result.failed.push({ party: ob.party_name, error: error?.message || 'Voucher posting failed' });
    }
  }
  return result;
}
