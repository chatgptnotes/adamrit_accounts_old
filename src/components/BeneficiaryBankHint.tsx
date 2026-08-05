import { Landmark } from 'lucide-react';
import { useBeneficiaryBank } from '@/hooks/useBeneficiaryBank';

// Shown beside a picked payee ledger on payment screens: which of our bank
// accounts has this party saved as a beneficiary (recorded on the Ledger
// Creation form). Silent while nothing is picked or the lookup is running.

export function BeneficiaryBankHint({
  accountId,
  ledgerName,
  onUseBank,
  showPaymentQr = false,
}: {
  accountId?: string | null;
  ledgerName?: string | null;
  /** Offered as a one-click "Pay from this bank" when the mapping exists. */
  onUseBank?: (bankAccountId: string) => void;
  /** Show the QR image recorded on this ledger in a payment confirmation flow. */
  showPaymentQr?: boolean;
}) {
  const safeName = ledgerName == null ? null : String(ledgerName);
  const { data: bank, isLoading, isFetched } = useBeneficiaryBank({ accountId, ledgerName: safeName });

  if ((!accountId && !safeName?.trim()) || isLoading || !isFetched) return null;

  return (
    <div className="mt-1 space-y-2">
      {bank?.bankAccountId ? (
        <p className="flex items-center gap-1 text-xs text-emerald-700">
          <Landmark className="h-3.5 w-3.5 shrink-0" />
          <span>
            Beneficiary in <span className="font-semibold">{bank.bankName}</span>
          </span>
          {onUseBank && (
            <button
              type="button"
              onClick={() => onUseBank(bank.bankAccountId!)}
              className="ml-1 rounded border border-emerald-300 px-1.5 py-0.5 font-medium hover:bg-emerald-50"
            >
              Pay from this bank
            </button>
          )}
        </p>
      ) : (
        <p className="text-xs text-amber-700">
          Not saved as a beneficiary in any bank portal yet — record it on the Ledger Creation form.
        </p>
      )}
      {showPaymentQr && bank?.qrCodeUrl && (
        <a
          href={bank.qrCodeUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800 hover:bg-blue-100"
          title="Open the payment QR image"
        >
          <img
            src={bank.qrCodeUrl}
            alt="Payment QR code for this ledger"
            className="h-28 w-28 rounded bg-white object-contain p-1"
          />
          <span className="pt-1 font-medium">Scan payment QR<br /><span className="font-normal">Click to enlarge</span></span>
        </a>
      )}
    </div>
  );
}
