import { Landmark } from 'lucide-react';
import { useBeneficiaryBank } from '@/hooks/useBeneficiaryBank';

// Shown beside a picked payee ledger on payment screens: which of our bank
// accounts has this party saved as a beneficiary (recorded on the Ledger
// Creation form). Silent while nothing is picked or the lookup is running.

export function BeneficiaryBankHint({
  accountId,
  ledgerName,
  onUseBank,
}: {
  accountId?: string | null;
  ledgerName?: string | null;
  /** Offered as a one-click "Pay from this bank" when the mapping exists. */
  onUseBank?: (bankAccountId: string) => void;
}) {
  const safeName = ledgerName == null ? null : String(ledgerName);
  const { data: bank, isLoading, isFetched } = useBeneficiaryBank({ accountId, ledgerName: safeName });

  if ((!accountId && !safeName?.trim()) || isLoading || !isFetched) return null;

  if (!bank) {
    return (
      <p className="mt-1 text-xs text-amber-700">
        Not saved as a beneficiary in any bank portal yet — record it on the Ledger Creation form.
      </p>
    );
  }

  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-emerald-700">
      <Landmark className="h-3.5 w-3.5 shrink-0" />
      <span>
        Beneficiary in <span className="font-semibold">{bank.bankName}</span>
      </span>
      {onUseBank && (
        <button
          type="button"
          onClick={() => onUseBank(bank.bankAccountId)}
          className="ml-1 rounded border border-emerald-300 px-1.5 py-0.5 font-medium hover:bg-emerald-50"
        >
          Pay from this bank
        </button>
      )}
    </p>
  );
}
