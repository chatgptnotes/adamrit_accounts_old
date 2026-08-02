import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Which of OUR bank accounts has this payee saved as a beneficiary?
// Read from chart_of_accounts.beneficiary_of_bank_account_id (set on the
// Ledger Creation form). Payment screens show it beside the picked ledger so
// the voucher is drawn from the bank that can actually transfer to the party.

export interface BeneficiaryBank {
  bankAccountId: string;
  bankName: string;
}

/**
 * Resolve by chart_of_accounts id when the caller has one, else by ledger
 * name — Tally-synced screens hold names, not chart ids.
 */
export function useBeneficiaryBank(opts: {
  accountId?: string | null;
  ledgerName?: string | null;
}) {
  // Callers pass whatever the row holds — coerce, never trust it's a string.
  const accountId = opts.accountId ? String(opts.accountId) : null;
  const ledgerName = opts.ledgerName ? String(opts.ledgerName) : null;
  return useQuery<BeneficiaryBank | null>({
    queryKey: ['beneficiary-bank', accountId ?? null, ledgerName ?? null],
    enabled: !!(accountId || (ledgerName && ledgerName.trim())),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      let query = (supabase as any)
        .from('chart_of_accounts')
        .select('id, beneficiary_of_bank_account_id')
        .limit(1);
      // % and _ are wildcards to ilike — a ledger literally named with them
      // would match other parties. Escape so the name matches itself only.
      query = accountId
        ? query.eq('id', accountId)
        : query.ilike('account_name', (ledgerName ?? '').trim().replace(/[%_\\]/g, '\\$&'));
      const { data, error } = await query.maybeSingle();
      if (error) {
        // The column ships ahead of the migration on some environments; a
        // missing column must read as "no mapping", not a broken screen.
        console.warn('Beneficiary bank lookup failed:', error.message);
        return null;
      }
      const bankId = data?.beneficiary_of_bank_account_id;
      if (!bankId) return null;
      const { data: bank, error: bankError } = await (supabase as any)
        .from('chart_of_accounts')
        .select('id, account_name')
        .eq('id', bankId)
        .maybeSingle();
      if (bankError || !bank) return null;
      return { bankAccountId: bank.id, bankName: bank.account_name };
    },
  });
}
