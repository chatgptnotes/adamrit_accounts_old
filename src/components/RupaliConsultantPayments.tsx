import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Check, Loader2, QrCode, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useAccountingCashBankLedgers } from '@/hooks/usePaymentObligations';
import { fileToBase64, verifyPaymentProof } from '@/lib/accounting-ai';
import {
  VOUCHER_PAYMENT_PROOF_CATEGORY,
  linkVoucherAttachments,
  uploadVoucherAttachments,
} from '@/lib/voucher-attachments';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// DATA SOURCE: rupali_visit_logs (the services Rupali recorded, each with the
//   JV it already raised) -> pay_doctor_services (one payment voucher per
//   company, against those JVs).
//
// The Rupali tile posts its JV straight into vouchers — Dr the consultant
// expense head / Cr the doctor's ledger — and never writes an expense_bills
// row, so these payables cannot appear in the Expense Bill register itself.
// They are listed here instead, and paid through the same RPC the Akshay
// Payouts tile uses. That RPC locks the rows and refuses anything already
// carrying a paid_voucher_id, so a service paid on one screen cannot be paid
// again on the other.

interface VisitLog {
  id: string;
  doctor_name: string;
  patient_name: string;
  category: string;
  purpose_reason: string | null;
  amount: number;
  created_at: string;
  voucher_id: string;
  /** Stamped from the JV below — the log itself carries no company. */
  voucher_number: string | null;
}

interface PaymentResult {
  companyName: string;
  voucherId: string;
  voucherNumber: string;
  amount: number;
}

/** What was just paid, kept on screen so the proof can be attached to it. */
interface LastPayment {
  doctor: string;
  mode: 'QR' | 'CASH';
  payments: PaymentResult[];
  total: number;
}

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

/** The day the hospital lived it, not the UTC slice of created_at. */
const istDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });

export function RupaliConsultantPayments({ companyId }: { companyId: string | null }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const proofRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [payingDoctor, setPayingDoctor] = useState<string | null>(null);
  const [payFromId, setPayFromId] = useState('');
  const [lastPayment, setLastPayment] = useState<LastPayment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);

  const { data: payFromLedgers = [] } = useAccountingCashBankLedgers(companyId);

  const { data: logs = [], isLoading, error } = useQuery({
    queryKey: ['rupali-consultant-payments', companyId],
    enabled: Boolean(companyId),
    queryFn: async (): Promise<VisitLog[]> => {
      const { data, error: queryError } = await (supabase as any)
        .from('rupali_visit_logs')
        .select('id, doctor_name, patient_name, category, purpose_reason, amount, created_at, voucher_id')
        .not('voucher_id', 'is', null)
        .is('paid_voucher_id', null)
        .order('created_at', { ascending: false })
        .limit(500);
      if (queryError) throw queryError;
      const rows = (data || []) as VisitLog[];
      if (!rows.length) return [];

      // The company lives on the JV, not on the log, so the books this page is
      // showing are matched through the voucher. A manual two-step join:
      // rupali_visit_logs points at vouchers twice (voucher_id and
      // paid_voucher_id), so PostgREST cannot embed either one unasked.
      const { data: vouchers, error: voucherError } = await (supabase as any)
        .from('vouchers')
        .select('id, company_id, voucher_number')
        .in('id', [...new Set(rows.map((r) => r.voucher_id))]);
      if (voucherError) throw voucherError;
      const byId = new Map((vouchers || []).map((v: any) => [v.id, v]));
      return rows
        .filter((row) => byId.get(row.voucher_id)?.company_id === companyId)
        .map((row) => ({ ...row, voucher_number: byId.get(row.voucher_id)?.voucher_number ?? null }));
    },
  });

  const groups = useMemo(() => {
    const byDoctor = new Map<string, { name: string; services: VisitLog[] }>();
    for (const log of logs) {
      const key = log.doctor_name.trim().toLowerCase();
      const group = byDoctor.get(key) || { name: log.doctor_name, services: [] };
      group.services.push(log);
      byDoctor.set(key, group);
    }
    return [...byDoctor.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [logs]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // One doctor per voucher — the RPC refuses a mixed set, and that is also how
  // a doctor is actually paid.
  const payDoctor = async (group: { name: string; services: VisitLog[] }, mode: 'QR' | 'CASH') => {
    const ids = group.services.filter((s) => selected.has(s.id)).map((s) => s.id);
    if (!ids.length) {
      toast.error('Tick the services to pay first');
      return;
    }
    setPayingDoctor(group.name);
    try {
      const { data, error: rpcError } = await (supabase as any).rpc('pay_doctor_services', {
        p_log_ids: ids,
        p_payment_mode: mode,
        p_paid_by: user?.email || user?.id || null,
        // Empty means the RPC picks the company's cash or bank ledger itself,
        // which is what the Akshay tile has always done.
        p_credit_account_id: payFromId || null,
      });
      if (rpcError) throw new Error(rpcError.message);
      const payments = ((data as any)?.payments || []) as PaymentResult[];
      const total = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      toast.success(
        `${group.name}: paid ${rupees(total)} for ${ids.length} service${ids.length === 1 ? '' : 's'} — ${payments
          .map((p) => p.voucherNumber)
          .join(', ')}.`,
      );
      setLastPayment({ doctor: group.name, mode, payments, total });
      setUploadedCount(0);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['rupali-consultant-payments'] });
      queryClient.invalidateQueries({ queryKey: ['akshay-services'] });
    } catch (err: any) {
      toast.error(err?.message || 'Payment failed');
    } finally {
      setPayingDoctor(null);
    }
  };

  /** The screenshot or signed voucher goes onto every voucher the payment
   *  produced — usually one, two only when the services spanned two companies. */
  const uploadProof = async (files: FileList | null) => {
    if (!files?.length || !lastPayment) return;
    setUploading(true);
    try {
      const uploaded = await uploadVoucherAttachments(Array.from(files), VOUCHER_PAYMENT_PROOF_CATEGORY);
      for (const payment of lastPayment.payments) {
        await linkVoucherAttachments(
          payment.voucherId,
          uploaded.map((item) => ({ ...item, id: undefined })),
          user?.id || null,
        );
      }
      setUploadedCount((n) => n + files.length);
      toast.success(
        lastPayment.mode === 'CASH' ? 'Signed voucher attached.' : 'Payment screenshot attached.',
      );

      // AI check: does the screenshot actually show this payment? Only for a QR
      // image — a signed cash voucher carries no amount to read. The upload has
      // already succeeded by this point, so a failed check warns and never
      // undoes the attachment.
      if (lastPayment.mode === 'QR' && files[0].type.startsWith('image/')) {
        const { base64, mimeType } = await fileToBase64(files[0]);
        const verdict = await verifyPaymentProof(base64, mimeType, lastPayment.total, lastPayment.doctor);
        if (verdict && !verdict.matches) {
          toast.warning(
            `AI check: screenshot shows ${
              verdict.amount_seen != null ? rupees(verdict.amount_seen) : 'no clear amount'
            }, voucher is ${rupees(lastPayment.total)}. ${verdict.note}`,
            { duration: 12000 },
          );
        } else if (verdict?.matches) {
          toast.success('AI check: screenshot matches the voucher amount.');
        }
      }
    } catch (err: any) {
      toast.error(err?.message || 'Could not upload the proof');
    } finally {
      setUploading(false);
      if (proofRef.current) proofRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Banknote className="h-4 w-4 text-emerald-600" />
          Consultant visits (Rupali) — JVs awaiting payment
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Services recorded on the Rupali tile. The JV crediting the doctor is already posted — tick
          the services and pay by QR or cash, one voucher per doctor, then attach the screenshot or
          the signed cash voucher. The same services can still be paid from the Akshay Payouts tile.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-w-md space-y-2">
          <Label>Pay from (cash / bank)</Label>
          <Select value={payFromId || 'auto'} onValueChange={(v) => setPayFromId(v === 'auto' ? '' : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic — the company's cash or bank</SelectItem>
              {payFromLedgers.map((ledger: any) => (
                <SelectItem key={ledger.id} value={ledger.id}>{ledger.account_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {lastPayment && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm">
            <span className="text-emerald-950">
              Paid {rupees(lastPayment.total)} to {lastPayment.doctor} —{' '}
              {lastPayment.payments.map((p) => p.voucherNumber).join(', ')}.
            </span>
            <input
              ref={proofRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => void uploadProof(e.target.files)}
            />
            <Button
              size="sm"
              variant="outline"
              className="ml-auto gap-1"
              disabled={uploading}
              onClick={() => proofRef.current?.click()}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Attach payment proof
            </Button>
            {uploadedCount > 0 && (
              <span className="flex items-center gap-1 font-semibold text-emerald-700">
                <Check className="h-4 w-4" />
                {uploadedCount} attached
              </span>
            )}
          </div>
        )}

        {error ? (
          <p className="py-6 text-center text-sm text-destructive">
            {(error as any)?.message || 'Could not load the consultant visits.'}
          </p>
        ) : isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading consultant visits…</p>
        ) : groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing unpaid — consultant visits recorded on the Rupali tile appear here.
          </p>
        ) : (
          groups.map((group) => {
            const ticked = group.services.filter((s) => selected.has(s.id));
            const total = ticked.reduce((sum, s) => sum + Number(s.amount || 0), 0);
            const busy = payingDoctor === group.name;
            return (
              <div key={group.name} className="rounded-xl border">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/50 px-3 py-2">
                  <div>
                    <p className="font-semibold">{group.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {group.services.length} service{group.services.length === 1 ? '' : 's'} unpaid
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {ticked.length > 0 && (
                      <span className="text-sm font-semibold">
                        {ticked.length} · {rupees(total)}
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      disabled={busy || ticked.length === 0}
                      onClick={() => void payDoctor(group, 'QR')}
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                      Pay by QR
                    </Button>
                    <Button
                      size="sm"
                      className="gap-1"
                      disabled={busy || ticked.length === 0}
                      onClick={() => void payDoctor(group, 'CASH')}
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
                      Pay cash
                    </Button>
                  </div>
                </div>
                <div className="divide-y">
                  {group.services.map((service) => (
                    <label
                      key={service.id}
                      className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(service.id)}
                        onChange={() => toggle(service.id)}
                      />
                      <span className="w-16 text-xs text-muted-foreground">{istDate(service.created_at)}</span>
                      <span className="w-20 text-xs text-muted-foreground">{service.category}</span>
                      <span className="min-w-0 flex-1 truncate">{service.patient_name}</span>
                      <span className="hidden truncate text-xs text-muted-foreground sm:block sm:w-40">
                        {service.purpose_reason || ''}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {service.voucher_number || ''}
                      </span>
                      <span className="ml-auto font-mono">{rupees(Number(service.amount))}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

export default RupaliConsultantPayments;
