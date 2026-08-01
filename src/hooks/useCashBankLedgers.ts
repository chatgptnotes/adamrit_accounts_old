import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';

export interface CashBankLedger {
  id: string;
  account_code: string | null;
  account_name: string;
  account_group: string | null;
}

/**
 * The cash and bank ledgers of one company, for picking what a payment is made
 * from. Same test the Tally approvals screen uses — group or name mentioning
 * cash or bank — because the chart of accounts has no flag that says so.
 */
export function useCashBankLedgers(companyId: string | null | undefined) {
  return useQuery({
    queryKey: ['cash-bank-ledgers', companyId],
    enabled: Boolean(companyId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CashBankLedger[]> => {
      // Paged — .limit(2000) is still capped at 1000 by the server, and a
      // ledger past that silently vanished from the picker.
      const data = await fetchAllRows<CashBankLedger>((from, to) =>
        (supabase as any)
          .from('chart_of_accounts')
          .select('id, account_code, account_name, account_group')
          .eq('company_id', companyId)
          .eq('is_active', true)
          .order('account_name')
          .order('id')
          .range(from, to),
      );
      return ((data || []) as CashBankLedger[]).filter((ledger) => {
        const group = (ledger.account_group || '').toLowerCase();
        const name = ledger.account_name.toLowerCase();
        return group.includes('bank') || group.includes('cash')
          || name.includes('bank') || name.includes('cash');
      });
    },
  });
}
