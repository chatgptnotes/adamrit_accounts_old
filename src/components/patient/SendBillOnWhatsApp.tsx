import { useState } from 'react';
import { MessageCircle, QrCode, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { composeBillMessage, openWhatsApp, toWhatsAppNumber } from '@/lib/patient-whatsapp';
import { buildUpiLink, buildUpiQrUrl, billPaymentNote } from '@/lib/patient-upi-payment';

/**
 * Send a patient their bill on WhatsApp, with a UPI link they can pay from.
 *
 * The message is shown before it goes — a bill is a statement about someone's
 * money, so nothing is sent to a patient without a human reading it first.
 */
export function SendBillOnWhatsApp({
  patientName,
  mobile,
  billNumber,
  amount,
  amountPaid = 0,
  hospital,
  variant = 'outline',
  size = 'sm',
  className,
}: {
  patientName: string;
  mobile: string | null | undefined;
  billNumber?: string | null;
  amount: number;
  amountPaid?: number;
  hospital?: string | null;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'default' | 'lg';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');

  const due = Math.max(0, (amount || 0) - (amountPaid || 0));
  const upi = { amount: due, note: billPaymentNote(billNumber, patientName) };
  const reachable = Boolean(toWhatsAppNumber(mobile));

  const openComposer = () => {
    setMessage(composeBillMessage({
      patientName, billNumber, amount, amountPaid, hospital,
      includePaymentLink: due > 0,
    }));
    setShowQr(false);
    setOpen(true);
  };

  const send = () => {
    if (!openWhatsApp(mobile, message)) {
      toast.error('This patient has no usable mobile number on record.');
      return;
    }
    setOpen(false);
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(buildUpiLink(upi));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('UPI payment link copied');
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={openComposer}
        title={reachable ? 'Send this bill to the patient on WhatsApp' : 'No mobile number on record'}
        disabled={!reachable}
      >
        <MessageCircle className="mr-1 h-4 w-4" />
        WhatsApp
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send to {patientName} on WhatsApp</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Check the message before sending — it goes to the patient as it reads here.
            </p>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={12}
              className="font-mono text-xs"
            />

            {due > 0 && (
              <div className="rounded-lg border bg-slate-50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    UPI payment link — ₹{due.toLocaleString('en-IN')}
                  </span>
                  <span className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={copyLink}>
                      {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowQr((v) => !v)}>
                      <QrCode className="h-4 w-4" />
                    </Button>
                  </span>
                </div>
                {showQr && (
                  <div className="mt-3 flex flex-col items-center gap-2">
                    <img
                      src={buildUpiQrUrl(upi)}
                      alt={`UPI QR for ₹${due}`}
                      className="rounded border bg-white p-2"
                      width={200}
                      height={200}
                    />
                    <p className="text-center text-[11px] text-muted-foreground">
                      Patient scans this to pay the exact balance. Raise the receipt as usual —
                      a UPI link cannot confirm payment on its own.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={send}>
              <MessageCircle className="mr-1 h-4 w-4" />
              Open WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default SendBillOnWhatsApp;
