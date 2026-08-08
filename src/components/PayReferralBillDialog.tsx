import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Banknote, FileText, Loader2, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useCashBankLedgers } from '@/hooks/useCashBankLedgers';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// DATA SOURCE: v_expense_bills_outstanding -> record_expense_bill_payment.
// The same view and the same RPC the Expense Bill page pays through — this is
// only a second doorway to it, so a cut can be settled on the report that
// raised it instead of on another screen.

const rupees = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const todayIso = () => new Date().toISOString().slice(0, 10);

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'An unexpected error occurred';

interface OutstandingBill {
  id: string;
  bill_number: string;
  party: string;
  billed: number;
  paid: number;
  outstanding: number;
  company_id: string | null;
}

/**
 * Pay a referral invoice that has already been raised, without leaving the
 * revenue report. Amount defaults to what is still outstanding; a cash payment
 * carries the signed voucher, exactly as the Expense Bill page requires.
 */
export function PayReferralBillDialog({
  expenseBillId,
  patientName,
  onClose,
  onPaid,
}: {
  expenseBillId: string;
  patientName: string;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { user } = useAuth();
  const [amount, setAmount] = useState('');
  const [bankId, setBankId] = useState('');
  const [payDate, setPayDate] = useState(todayIso());
  const [remarks, setRemarks] = useState('');
  const [signedVoucher, setSignedVoucher] = useState<File | null>(null);
  const signedRef = useRef<HTMLInputElement>(null);

  const billQuery = useQuery({
    queryKey: ['referral-bill-outstanding', expenseBillId],
    queryFn: async (): Promise<OutstandingBill | null> => {
      const { data, error } = await (supabase as any)
        .from('v_expense_bills_outstanding')
        .select('id, bill_number, party, billed, paid, outstanding, company_id')
        .eq('id', expenseBillId)
        .maybeSingle();
      if (error) throw error;
      return (data as OutstandingBill) ?? null;
    },
  });

  const bill = billQuery.data ?? null;
  const banksQuery = useCashBankLedgers(bill?.company_id ?? null);

  // Seed the amount from the bill the first time it arrives, and never again —
  // otherwise a part-payment being typed would be overwritten on every refetch.
  const seededFor = useRef<string | null>(null);
  if (bill && seededFor.current !== bill.id) {
    seededFor.current = bill.id;
    setAmount(Number(bill.outstanding).toFixed(2));
  }

  const value = Number(amount.replace(/,/g, '')) || 0;
  const outstanding = Number(bill?.outstanding ?? 0);
  const overpaying = bill ? value > outstanding + 0.005 : false;
  const selectedBank = (banksQuery.data ?? []).find((a) => a.id === bankId);
  const isCash = Boolean(
    selectedBank
    && ((selectedBank.account_group ?? '').toLowerCase().includes('cash')
      || selectedBank.account_name.toLowerCase().includes('cash')),
  );

  const payMutation = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!bill) throw new Error('No invoice selected');

      // Evidence before entry: a failed payment removes the upload so a retry
      // does not leave an orphan file in the bucket.
      let signedPath: string | null = null;
      let signedUrl: string | null = null;
      if (isCash && signedVoucher) {
        const ext = signedVoucher.name.split('.').pop() || 'bin';
        signedPath = `expense-bills/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('uploads').upload(signedPath, signedVoucher);
        if (upErr) throw new Error(`Could not upload the signed voucher: ${upErr.message}`);
        signedUrl = supabase.storage.from('uploads').getPublicUrl(signedPath).data?.publicUrl ?? null;
      }

      const { data, error } = await (supabase as any).rpc('record_expense_bill_payment', {
        p_bill_id: bill.id,
        p_amount: value,
        p_bank_account_id: bankId,
        p_payment_date: payDate,
        p_created_by: user?.email ?? user?.username ?? null,
        p_remarks: remarks.trim() || null,
        ...(signedPath ? { p_signed_voucher_path: signedPath, p_signed_voucher_url: signedUrl } : {}),
      });
      if (error) {
        if (signedPath) await supabase.storage.from('uploads').remove([signedPath]);
        throw new Error(error.message);
      }
      return data as string;
    },
    onSuccess: (voucherNo) => {
      toast.success(`Paid ₹${rupees(value)} to ${bill?.party} — voucher ${voucherNo}`);
      onPaid();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const canPay = Boolean(bill) && value > 0 && !overpaying && Boolean(bankId) && !payMutation.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pay {patientName}'s referral cut</DialogTitle>
        </DialogHeader>

        {billQuery.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading the invoice…
          </p>
        ) : !bill ? (
          <p className="py-6 text-center text-sm text-amber-700">
            This invoice is no longer outstanding — it may have been paid or cancelled already.
          </p>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="space-y-1 rounded-lg border bg-gray-50 p-3">
              <div className="font-semibold">{bill.party}</div>
              <div className="text-xs text-gray-600">Invoice {bill.bill_number}</div>
              <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                <div>
                  <span className="text-gray-500">Billed</span>
                  <div className="font-semibold tabular-nums">₹{rupees(Number(bill.billed))}</div>
                </div>
                <div>
                  <span className="text-gray-500">Paid</span>
                  <div className="font-semibold tabular-nums">₹{rupees(Number(bill.paid))}</div>
                </div>
                <div>
                  <span className="text-gray-500">Remaining</span>
                  <div className="font-semibold tabular-nums text-amber-700">₹{rupees(outstanding)}</div>
                </div>
              </div>
            </div>

            <div>
              <Label htmlFor="referral-pay-amount">Payment amount</Label>
              <Input
                id="referral-pay-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={overpaying ? 'border-destructive text-destructive' : ''}
              />
              {overpaying && (
                <p className="mt-1 text-xs text-destructive">
                  That is more than the ₹{rupees(outstanding)} still outstanding.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="referral-pay-date">Payment date</Label>
                <Input
                  id="referral-pay-date"
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                />
              </div>
              <div>
                <Label>Paid from</Label>
                <Select value={bankId} onValueChange={setBankId}>
                  <SelectTrigger>
                    <SelectValue placeholder={banksQuery.isLoading ? 'Loading…' : 'Cash / Bank account'} />
                  </SelectTrigger>
                  <SelectContent>
                    {(banksQuery.data ?? []).map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.account_name}{a.account_code ? ` · ${a.account_code}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!banksQuery.isLoading && (banksQuery.data ?? []).length === 0 && (
                  <p className="mt-1 text-xs text-amber-700">This company has no cash or bank ledger.</p>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="referral-pay-remarks">Payment remarks (optional)</Label>
              <Input
                id="referral-pay-remarks"
                value={remarks}
                maxLength={200}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>

            {isCash && (
              <div>
                <Label>Signed payment voucher (cash payment)</Label>
                {signedVoucher ? (
                  <div className="mt-1 flex items-center gap-3 rounded-lg border p-2">
                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate text-xs">{signedVoucher.name}</span>
                    <button
                      type="button"
                      onClick={() => setSignedVoucher(null)}
                      aria-label="Remove the signed voucher"
                      className="shrink-0 rounded-full p-1 hover:bg-muted"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    type="button"
                    size="sm"
                    className="mt-1"
                    onClick={() => signedRef.current?.click()}
                  >
                    <Paperclip className="mr-2 h-4 w-4" /> Upload signed voucher
                  </Button>
                )}
                <input
                  ref={signedRef}
                  type="file"
                  accept="image/*,application/pdf"
                  hidden
                  onChange={(e) => setSignedVoucher(e.target.files?.[0] ?? null)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Print the payment voucher, take the receiver's signature on it, and upload the
                  signed copy here. It is kept beside the invoice on this bill.
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!canPay} onClick={() => payMutation.mutate()}>
            {payMutation.isPending
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <Banknote className="mr-2 h-4 w-4" />}
            Pay ₹{rupees(value)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
