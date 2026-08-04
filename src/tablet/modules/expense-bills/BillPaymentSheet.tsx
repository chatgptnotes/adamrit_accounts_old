import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, FileText, Loader2, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import {
  useCashBankLedgers,
  useRecordBillPayment,
  type OutstandingBill,
} from "./useExpenseBills";

const rupees = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Settle one invoice. Defaults to the full outstanding, since paying in full
 * is the common case, but the amount stays editable for a part payment.
 */
export function BillPaymentSheet({
  bill,
  onClose,
}: {
  bill: OutstandingBill;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(bill.outstanding.toFixed(2));
  const [bankId, setBankId] = useState<string | null>(null);
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  // The printed payment voucher signed by the receiver of the cash.
  const [signedVoucher, setSignedVoucher] = useState<File | null>(null);
  const signedRef = useRef<HTMLInputElement>(null);

  const { data: accounts = [], isLoading: loadingAccounts } = useCashBankLedgers();
  const pay = useRecordBillPayment();

  const value = useMemo(() => Number(amount.replace(/,/g, "")) || 0, [amount]);
  const overpaying = value > bill.outstanding + 0.005;
  const canPay = value > 0 && !overpaying && !!bankId && !pay.isPending;
  const isCash = (accounts.find((a) => a.id === bankId)?.name ?? "")
    .toLowerCase()
    .includes("cash");

  const submit = () => {
    if (!canPay || !bankId) return;
    pay.mutate(
      {
        billId: bill.id,
        amount: value,
        bankAccountId: bankId,
        paymentDate: payDate,
        signedVoucherFile: isCash ? signedVoucher : null,
      },
      {
        onSuccess: (voucherNo) => {
          toast.success(`Paid ${rupees(value)} · voucher ${voucherNo}`);
          onClose();
        },
        onError: (e: any) => toast.error(e?.message || "Could not record the payment"),
      },
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="tablet-no-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
        <TabletCard variant="flat" className="space-y-1">
          <h2 className="text-lg font-semibold">{bill.party}</h2>
          <p className="text-sm text-muted-foreground">
            Invoice {bill.billNumber} · {bill.expenseHead}
          </p>
          <div className="flex items-baseline justify-between pt-2">
            <span className="text-sm text-muted-foreground">Outstanding</span>
            <span className="text-xl font-bold tabular-nums text-amber-700">
              {rupees(bill.outstanding)}
            </span>
          </div>
          {bill.paid > 0 && (
            <p className="text-xs text-muted-foreground">
              Already paid {rupees(bill.paid)} of {rupees(bill.billed)}
            </p>
          )}
        </TabletCard>

        <div>
          <TabletLabel htmlFor="pay-amount">Amount to pay</TabletLabel>
          <TabletInput
            id="pay-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={cn(
              "text-2xl font-semibold tabular-nums",
              overpaying && "border-destructive text-destructive",
            )}
          />
          {overpaying && (
            <p className="mt-1.5 text-sm text-destructive">
              That is more than the {rupees(bill.outstanding)} still outstanding.
            </p>
          )}
        </div>

        <div>
          <TabletLabel>Paid from</TabletLabel>
          {loadingAccounts ? (
            <div className="flex items-center gap-2 py-3 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading accounts
            </div>
          ) : accounts.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">
              No cash or bank accounts are configured.
            </p>
          ) : (
            <div className="space-y-2">
              {accounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setBankId(a.id)}
                  className={cn(
                    "flex min-h-[56px] w-full items-center gap-3 rounded-xl border px-4 text-left active:bg-muted",
                    bankId === a.id && "border-primary bg-primary/5",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-base">{a.name}</span>
                  {bankId === a.id && <Check className="h-5 w-5 shrink-0 text-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <TabletLabel htmlFor="pay-date">Payment date</TabletLabel>
          <TabletInput
            id="pay-date"
            type="date"
            value={payDate}
            onChange={(e) => setPayDate(e.target.value)}
          />
        </div>

        {isCash && (
          <div>
            <TabletLabel>Signed payment voucher (cash)</TabletLabel>
            {signedVoucher ? (
              <TabletCard variant="flat" className="flex items-center gap-3">
                <FileText className="h-6 w-6 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-sm">{signedVoucher.name}</span>
                <button
                  type="button"
                  onClick={() => setSignedVoucher(null)}
                  className="shrink-0 rounded-full p-2 active:bg-muted"
                  aria-label="Remove the signed voucher"
                >
                  <X className="h-5 w-5" />
                </button>
              </TabletCard>
            ) : (
              <TabletButton variant="outline" className="w-full" onClick={() => signedRef.current?.click()}>
                <Paperclip className="mr-2 h-5 w-5" />
                Upload signed voucher
              </TabletButton>
            )}
            <input
              ref={signedRef}
              type="file"
              accept="image/*,application/pdf"
              hidden
              onChange={(e) => setSignedVoucher(e.target.files?.[0] ?? null)}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Print the payment voucher, take the receiver's signature, and attach the signed copy.
            </p>
          </div>
        )}
      </div>

      <div className="tablet-safe-bottom flex flex-shrink-0 gap-3 border-t bg-background/95 p-4 backdrop-blur">
        <TabletButton variant="outline" className="flex-1" onClick={onClose}>
          Cancel
        </TabletButton>
        <TabletButton className="flex-[2]" disabled={!canPay} onClick={submit}>
          {pay.isPending ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Recording
            </>
          ) : (
            `Pay ${rupees(value)}`
          )}
        </TabletButton>
      </div>
    </div>
  );
}
