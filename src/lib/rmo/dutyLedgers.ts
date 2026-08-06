import { supabase } from '@/integrations/supabase/client';

// The company and expense head an RMO duty bill posts to.
//
// Both are derived from the RMO's OWN ledger rather than from the login or
// the master it was read from: the JV credits that ledger, so taking the
// company from it is the one choice that cannot disagree with itself. A duty
// recorded without these lands in Approvals as "needs details" and cannot be
// approved, which is what used to happen to every RMO duty.

/** The expense head every RMO duty is charged to, in each company's books. */
export const RMO_DUTY_EXPENSE_LEDGER = 'Rmo Salary Expenses';

export interface RmoDutyPosting {
  companyId: string;
  expenseAccountId: string;
}

export async function resolveRmoDutyPosting(
  partyAccountId: string | null | undefined,
): Promise<RmoDutyPosting | null> {
  if (!partyAccountId) return null;

  const { data: party, error: partyError } = await (supabase as any)
    .from('chart_of_accounts')
    .select('company_id, account_name')
    .eq('id', partyAccountId)
    .maybeSingle();
  if (partyError) throw new Error(partyError.message);
  if (!party?.company_id) return null;

  const { data: expense, error: expenseError } = await (supabase as any)
    .from('chart_of_accounts')
    .select('id')
    .eq('company_id', party.company_id)
    .eq('is_active', true)
    .ilike('account_name', RMO_DUTY_EXPENSE_LEDGER)
    .order('account_code')
    .limit(1)
    .maybeSingle();
  if (expenseError) throw new Error(expenseError.message);
  if (!expense?.id) return null;

  return { companyId: party.company_id, expenseAccountId: expense.id };
}
