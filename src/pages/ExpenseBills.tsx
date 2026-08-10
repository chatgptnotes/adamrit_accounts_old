import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { openStoredDocument } from '@/lib/openStoredDocument';
import {
  Banknote, CalendarClock, Camera, FileText, Filter, Loader2, Paperclip, Plus, QrCode, Receipt,
  Search, Sparkles, Undo2, Upload, Users, X,
} from 'lucide-react';
import { saveLedgerQr, savePaymentProof } from '@/lib/expense-bills/paymentEvidence';
import { extractInvoiceFromImage, fileToBase64 } from '@/lib/accounting-ai';
import { generateNarration } from '@/lib/expense-bill-narration';
import { LedgerAutocomplete, type LedgerAccountOption } from '@/components/accounting/LedgerAutocomplete';
import { RmoPaymentsTab } from '@/components/RmoPaymentsTab';
import { RupaliConsultantPayments } from '@/components/RupaliConsultantPayments';
import { useCashBankLedgers } from '@/hooks/useCashBankLedgers';
import {
  useExpenseBillCompanyId,
  useExpenseLedgerByName,
  useRecordExpenseBill,
} from '@/tablet/modules/expense-bills/useExpenseBills';

/**
 * Desktop Expense Bill page — the same register, tables and accounting the
 * tablet Expense Bills tile uses (expense_bills + v_expense_bills_outstanding
 * + record_expense_bill_payment), full screen, with search, filters, and the
 * two Daily Revenue Report referral sections (OPD / IPD).
 */

const rupees = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const todayIso = () => new Date().toISOString().slice(0, 10);

/** A proof can be a photo or a PDF statement; they preview differently. */
const isPdf = (url: string) => url.split('?')[0].toLowerCase().endsWith('.pdf');

/** The office pays two months after it receives the bill. */
const twoMonthsAfter = (iso: string) => {
  if (!iso) return '';
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getDate();
  date.setMonth(date.getMonth() + 2);
  // 31 Dec + 2 months must not roll into March.
  if (date.getDate() !== day) date.setDate(0);
  return date.toISOString().slice(0, 10);
};

/** PostgREST or() filters break on these characters. */
const sanitize = (s: string) => s.replace(/[%,()]/g, ' ').trim();

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  // Supabase/PostgREST errors are plain objects with a message field.
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : 'An unexpected error occurred';
};

interface BillRow {
  id: string;
  billNumber: string;
  billDate: string;
  dueDate: string | null;
  party: string;
  expenseHead: string;
  billed: number;
  paid: number;
  outstanding: number;
  documentUrl: string | null;
  signedVoucherUrl: string | null;
  companyId: string | null;
  narration: string | null;
  pointOfContact: string | null;
  relationshipManager: string | null;
  patientName: string | null;
  patientType: string | null;
  revenueEntryId: string | null;
  partyLedgerId: string | null;
  partyQrUrl: string | null;
  paymentProofUrl: string | null;
}

type PaymentStatus = 'unpaid' | 'partial' | 'paid';

const statusOf = (b: BillRow): PaymentStatus =>
  b.outstanding <= 0.005 ? 'paid' : b.paid > 0.005 ? 'partial' : 'unpaid';

const STATUS_STYLE: Record<PaymentStatus, string> = {
  unpaid: 'bg-red-100 text-red-700',
  partial: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
};

const mapRow = (r: any): BillRow => ({
  id: r.id,
  billNumber: r.bill_number,
  billDate: r.bill_date,
  dueDate: r.due_date,
  party: r.party,
  expenseHead: r.expense_head,
  billed: Number(r.billed) || 0,
  paid: Number(r.paid) || 0,
  outstanding: Number(r.outstanding) || 0,
  documentUrl: r.document_url,
  signedVoucherUrl: r.signed_voucher_url ?? null,
  companyId: r.company_id ?? null,
  narration: r.narration ?? null,
  pointOfContact: r.point_of_contact ?? null,
  relationshipManager: r.relationship_manager ?? null,
  patientName: r.patient_name ?? null,
  patientType: r.patient_type ?? null,
  revenueEntryId: r.revenue_entry_id ?? null,
  partyLedgerId: r.party_ledger_id ?? null,
  partyQrUrl: r.party_qr_url ?? null,
  paymentProofUrl: r.payment_proof_url ?? null,
});

interface RegisterFilters {
  search: string;
  minAmount: string;
  maxAmount: string;
  dateFrom: string;
  dateTo: string;
  poc: string;
  rm: string;
  status: 'all' | PaymentStatus;
}

const emptyFilters: RegisterFilters = {
  search: '', minAmount: '', maxAmount: '', dateFrom: '', dateTo: '', poc: '', rm: '', status: 'all',
};

/** The main register: the company's bills, filtered server-side where possible. */
function useExpenseBillRegister(companyId: string | null | undefined, applied: RegisterFilters) {
  return useQuery({
    queryKey: ['expense-bill-register', companyId, applied],
    enabled: Boolean(companyId),
    queryFn: async (): Promise<BillRow[]> => {
      let q = (supabase as any)
        .from('v_expense_bills_outstanding')
        .select('*')
        .eq('company_id', companyId)
        .order('bill_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(300);

      const term = sanitize(applied.search);
      if (term) {
        q = q.or(
          [
            `bill_number.ilike.%${term}%`,
            `party.ilike.%${term}%`,
            `expense_head.ilike.%${term}%`,
            `point_of_contact.ilike.%${term}%`,
            `relationship_manager.ilike.%${term}%`,
            `narration.ilike.%${term}%`,
            `patient_name.ilike.%${term}%`,
          ].join(','),
        );
      }
      if (applied.minAmount) q = q.gte('billed', Number(applied.minAmount) || 0);
      if (applied.maxAmount) q = q.lte('billed', Number(applied.maxAmount) || 0);
      if (applied.dateFrom) q = q.gte('bill_date', applied.dateFrom);
      if (applied.dateTo) q = q.lte('bill_date', applied.dateTo);
      if (sanitize(applied.poc)) q = q.ilike('point_of_contact', `%${sanitize(applied.poc)}%`);
      if (sanitize(applied.rm)) q = q.ilike('relationship_manager', `%${sanitize(applied.rm)}%`);

      const { data, error } = await q;
      if (error) throw error;
      const rows = ((data ?? []) as any[]).map(mapRow);
      return applied.status === 'all' ? rows : rows.filter((r) => statusOf(r) === applied.status);
    },
  });
}

/** The DRR referral invoices (both hospitals) for one section, OPD or IPD. */
function useReferralSection(patientType: 'OPD' | 'IPD', search: string, date: string) {
  return useQuery({
    queryKey: ['expense-bill-referral', patientType, search, date],
    queryFn: async (): Promise<BillRow[]> => {
      let q = (supabase as any)
        .from('v_expense_bills_outstanding')
        .select('*')
        .not('revenue_entry_id', 'is', null)
        .eq('patient_type', patientType)
        .order('bill_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(300);

      const term = sanitize(search);
      if (term) {
        q = q.or(
          [
            `patient_name.ilike.%${term}%`,
            `relationship_manager.ilike.%${term}%`,
            `bill_number.ilike.%${term}%`,
          ].join(','),
        );
      }
      if (date) q = q.eq('bill_date', date);

      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as any[]).map(mapRow);
    },
  });
}

const invalidateBills = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['expense-bill-register'] });
  qc.invalidateQueries({ queryKey: ['expense-bill-referral'] });
  qc.invalidateQueries({ queryKey: ['expense-bills-outstanding'] });
  qc.invalidateQueries({ queryKey: ['expense-bill-moved'] });
  qc.invalidateQueries({ queryKey: ['daily-payment-schedule'] });
};

interface MovedInfo {
  date: string;
  hospital: string | null;
}

const hospitalLabel = (hospital: string | null | undefined): string =>
  (hospital ?? '').toLowerCase().includes('ayush') ? 'Ayushman Hospital' : 'Hope Hospital';

/**
 * Which invoices are already sitting on a live (unpaid, unskipped) daily
 * allocation, so the page shows "In allocation" instead of a checkbox and a
 * second move is blocked before the database has to refuse it.
 */
function useMovedToAllocation() {
  return useQuery({
    queryKey: ['expense-bill-moved'],
    queryFn: async (): Promise<Record<string, MovedInfo>> => {
      const { data, error } = await (supabase as any)
        .from('daily_payment_schedule')
        .select('expense_bill_id, schedule_date, hospital_name, status')
        .not('expense_bill_id', 'is', null)
        .not('status', 'in', '(paid,skipped)');
      if (error) throw error;
      const map: Record<string, MovedInfo> = {};
      for (const r of (data ?? []) as any[]) {
        map[r.expense_bill_id] = { date: r.schedule_date, hospital: r.hospital_name };
      }
      return map;
    },
  });
}

// ── Pay dialog ──────────────────────────────────────────────────────────

function PayBillDialog({ bill, onClose }: { bill: BillRow | null; onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [bankId, setBankId] = useState('');
  const [payDate, setPayDate] = useState(todayIso());
  const [remarks, setRemarks] = useState('');
  // The printed payment voucher signed by the receiver of the cash.
  const [signedVoucher, setSignedVoucher] = useState<File | null>(null);
  const signedRef = useRef<HTMLInputElement>(null);
  const banksQuery = useCashBankLedgers(bill?.companyId ?? null);

  // Reset the form each time the dialog opens — including on the SAME bill,
  // or a part-payment would reopen with the previous amount, bank and signed
  // voucher still attached.
  const lastBillId = useRef<string | null>(null);
  if (!bill) lastBillId.current = null;
  if (bill && bill.id !== lastBillId.current) {
    lastBillId.current = bill.id;
    setAmount(bill.outstanding.toFixed(2));
    setBankId('');
    setPayDate(todayIso());
    setRemarks('');
    setSignedVoucher(null);
  }

  const value = Number(amount.replace(/,/g, '')) || 0;
  const overpaying = bill ? value > bill.outstanding + 0.005 : false;
  const selectedBank = (banksQuery.data ?? []).find((a) => a.id === bankId);
  const isCash = Boolean(
    selectedBank
    && ((selectedBank.account_group ?? '').toLowerCase().includes('cash')
      || selectedBank.account_name.toLowerCase().includes('cash')),
  );

  const payMutation = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!bill) throw new Error('No bill selected');

      // Upload the signed voucher first — evidence before entry, same as the
      // invoice itself; a failed payment removes the upload so a retry is clean.
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
        // Only sent when a voucher was attached, so payments keep working
        // even on an environment whose migration lags the deploy.
        ...(signedPath ? { p_signed_voucher_path: signedPath, p_signed_voucher_url: signedUrl } : {}),
      });
      if (error) {
        if (signedPath) await supabase.storage.from('uploads').remove([signedPath]);
        throw new Error(error.message);
      }
      return data as string;
    },
    onSuccess: (voucherNo) => {
      invalidateBills(queryClient);
      toast.success(`Paid ₹${rupees(value)} — voucher ${voucherNo}`);
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const canPay = Boolean(bill) && value > 0 && !overpaying && Boolean(bankId) && !payMutation.isPending;

  return (
    <Dialog open={!!bill} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pay invoice {bill?.billNumber}</DialogTitle>
        </DialogHeader>
        {bill && (
          <div className="space-y-4 text-sm">
            <div className="rounded-lg border bg-gray-50 p-3 space-y-1">
              <div className="font-semibold">{bill.party}</div>
              {bill.patientName && (
                <div className="text-xs text-gray-600">
                  Patient: {bill.patientName}
                  {bill.relationshipManager ? ` · RM ${bill.relationshipManager}` : ''}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                <div><span className="text-gray-500">Billed</span><div className="font-semibold tabular-nums">₹{rupees(bill.billed)}</div></div>
                <div><span className="text-gray-500">Paid</span><div className="font-semibold tabular-nums">₹{rupees(bill.paid)}</div></div>
                <div><span className="text-gray-500">Remaining</span><div className="font-semibold tabular-nums text-amber-700">₹{rupees(bill.outstanding)}</div></div>
              </div>
            </div>

            <div>
              <Label htmlFor="pay-amount">Payment amount</Label>
              <Input
                id="pay-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={overpaying ? 'border-destructive text-destructive' : ''}
              />
              {overpaying && (
                <p className="mt-1 text-xs text-destructive">
                  That is more than the ₹{rupees(bill.outstanding)} still outstanding.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pay-date">Payment date</Label>
                <Input id="pay-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
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
              <Label htmlFor="pay-remarks">Payment remarks (optional)</Label>
              <Input id="pay-remarks" value={remarks} maxLength={200} onChange={(e) => setRemarks(e.target.value)} />
            </div>

            {isCash && (
              <div>
                <Label>Signed payment voucher (cash payment)</Label>
                {signedVoucher ? (
                  <div className="mt-1 flex items-center gap-3 rounded-lg border p-2">
                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate text-xs">{signedVoucher.name}</span>
                    <button type="button" onClick={() => setSignedVoucher(null)} aria-label="Remove the signed voucher"
                      className="shrink-0 rounded-full p-1 hover:bg-muted">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <Button variant="outline" type="button" size="sm" className="mt-1"
                    onClick={() => signedRef.current?.click()}>
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
            {payMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Banknote className="mr-2 h-4 w-4" />}
            Pay ₹{rupees(value)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Record-invoice dialog (same flow as the tablet form) ────────────────

/**
 * Invoice categories are the groups the accounts team keeps under
 * Masters -> Group -> Sundry Creditors, read live: create one there and it
 * appears here, rename it and the name follows, remove it and it stops being
 * offered. Pharmacy vendors are left out — they have their own master, and
 * offering them twice is how two vendor lists start to disagree.
 */
function useInvoiceCategories() {
  return useQuery({
    queryKey: ['expense-bill-invoice-categories'],
    staleTime: 60_000,
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      const { data: parent, error: parentError } = await supabase
        .from('ledger_groups' as any)
        .select('id')
        .ilike('name', 'Sundry Creditors')
        .maybeSingle();
      if (parentError) throw parentError;
      if (!(parent as any)?.id) return [];

      const { data, error } = await supabase
        .from('ledger_groups' as any)
        .select('id, name')
        .eq('parent_group_id', (parent as any).id)
        .order('name');
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((g) => !/pharmac/i.test(g.name || ''))
        .map((g) => ({ id: g.id as string, name: g.name as string }));
    },
  });
}

function RecordBillDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const company = useExpenseBillCompanyId();
  const record = useRecordExpenseBill();
  const fileRef = useRef<HTMLInputElement>(null);

  const [category, setCategory] = useState<{ id: string; name: string } | null>(null);
  const [categorySearch, setCategorySearch] = useState('');
  const categoryOptions = useInvoiceCategories();
  const [party, setParty] = useState<LedgerAccountOption | null>(null);
  const [head, setHead] = useState<LedgerAccountOption | null>(null);
  const [billNumber, setBillNumber] = useState('');
  const [billDate, setBillDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState('');
  const [amount, setAmount] = useState('');
  const [poc, setPoc] = useState('');
  const [rm, setRm] = useState('');
  const [narration, setNarration] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isReadingInvoice, setIsReadingInvoice] = useState(false);
  // Which patient and procedure this bill is for, and the office's dates.
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(null);
  const [patientSearch, setPatientSearch] = useState('');
  const [surgeryName, setSurgeryName] = useState('');
  const [dateOfProcedure, setDateOfProcedure] = useState('');
  const [dateOfReceivingBill, setDateOfReceivingBill] = useState('');
  const [dateOfPayment, setDateOfPayment] = useState('');
  // Bills are settled two months after the office receives them, so the date
  // fills itself in — and stays editable for the ones that do not follow it.
  const paymentDateTouched = useRef(false);
  // Ask the existing director digest to chase this invoice when it falls due.
  const [notifyDirector, setNotifyDirector] = useState(false);
  const [writingNarration, setWritingNarration] = useState(false);

  const writeNarration = async () => {
    setWritingNarration(true);
    try {
      const { text, source } = await generateNarration({
        partyName: party?.account_name,
        expenseHead: head?.account_name,
        categoryName: category?.name,
        billNumber, billDate, amount: amountValue,
        patientName: patient?.name, patientId: patient?.id,
        surgeryName,
        dateOfProcedure, dateOfReceivingBill, dateOfPayment,
      });
      setNarration(text);
      if (source === 'template') {
        toast.message('Narration built from the form', {
          description: 'Written from a template — the AI was unavailable or its wording was rejected.',
        });
      }
    } finally {
      setWritingNarration(false);
    }
  };

  // Patients and procedures to pick from — both search in the database so the
  // list is the real master, not a snapshot in the page.
  const patientOptions = useQuery({
    queryKey: ['expense-bill-patient-search', patientSearch],
    enabled: patientSearch.trim().length >= 2,
    queryFn: async () => {
      const term = patientSearch.trim();
      const { data, error } = await supabase
        .from('patients')
        .select('patients_id, name')
        .or(`name.ilike.%${term}%,patients_id.ilike.%${term}%`)
        .limit(10);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ id: r.patients_id, name: r.name }));
    },
  });

  const surgeryOptions = useQuery({
    queryKey: ['expense-bill-surgery-search', surgeryName],
    enabled: surgeryName.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('surgery_fee_master' as any)
        .select('procedure_name')
        .eq('is_active', true)
        .ilike('procedure_name', `%${surgeryName.trim()}%`)
        .order('procedure_name')
        .limit(10);
      if (error) throw error;
      return (data ?? []).map((r: any) => r.procedure_name as string);
    },
  });

  // A group named like an expense ledger (Rent, Consultant…) still suggests it;
  // one that matches nothing simply leaves the head for the user to pick.
  const mappedName = category?.name ?? null;
  const mappedHead = useExpenseLedgerByName(!head ? mappedName : null);
  // Suggest the category's ledger ONCE per category pick — otherwise clearing
  // the suggestion re-applies it instantly from the query cache.
  const suggestedFor = useRef<string | null>(null);
  if (!head && mappedHead.data && category && suggestedFor.current !== category.id) {
    suggestedFor.current = category.id;
    setHead({
      id: mappedHead.data.id,
      account_code: mappedHead.data.code,
      account_name: mappedHead.data.name,
      account_group: mappedHead.data.group ?? null,
      company_id: null,
    });
  }

  const amountValue = Number(amount.replace(/,/g, '')) || 0;
  const canSave =
    !!company.data && !!category && !!party && !!head && party.id !== head.id
    && !!file && !isReadingInvoice
    && billNumber.trim().length > 0 && amountValue > 0 && !record.isPending;

  const reset = () => {
    setCategory(null); setCategorySearch(''); setParty(null); setHead(null); setBillNumber('');
    setBillDate(todayIso()); setDueDate(''); setAmount(''); setPoc(''); setRm('');
    setNarration(''); setFile(null); setIsReadingInvoice(false);
    setPatient(null); setPatientSearch(''); setSurgeryName('');
    setDateOfProcedure(''); setDateOfReceivingBill(''); setDateOfPayment('');
    setNotifyDirector(false); setWritingNarration(false);
    paymentDateTouched.current = false;
    suggestedFor.current = null;
  };

  /**
   * The invoice is attached BEFORE the accounting fields are typed, so the bill
   * itself can fill them in. Anything the user has already entered is left
   * alone — re-attaching a better scan must never overwrite a typed value.
   */
  const attachInvoice = async (nextFile: File | null) => {
    if (!nextFile) return;
    setFile(nextFile);
    setIsReadingInvoice(true);
    try {
      const { base64, mimeType } = await fileToBase64(nextFile);
      const extracted = await extractInvoiceFromImage(base64, mimeType);
      if (!extracted) {
        toast.error('Could not read the invoice. You can complete the fields manually.');
        return;
      }

      if (!billNumber.trim() && extracted.bill_number) setBillNumber(extracted.bill_number);
      if (!amount.trim() && extracted.amount != null) setAmount(String(extracted.amount));
      if (extracted.bill_date && /^\d{4}-\d{2}-\d{2}$/.test(extracted.bill_date)) {
        setBillDate(extracted.bill_date);
      }
      if (!narration.trim() && extracted.description) setNarration(extracted.description);

      // Match the seller printed on the invoice to an existing accounting ledger.
      // Never create a ledger from OCR text; the user picks it manually when the
      // vendor is not already configured.
      if (extracted.party_name && company.data && !party) {
        const { data: rows } = await (supabase as any)
          .from('chart_of_accounts')
          .select('id, account_code, account_name, account_group')
          .eq('is_active', true)
          .or(`company_id.eq.${company.data},company_id.is.null`)
          .ilike('account_name', `%${extracted.party_name.trim()}%`)
          .limit(10);
        const normalized = extracted.party_name.trim().toLowerCase();
        const row =
          (rows || []).find(
            (item: any) => String(item.account_name || '').trim().toLowerCase() === normalized,
          ) || rows?.[0];
        if (row) {
          setParty({
            id: row.id,
            account_code: row.account_code,
            account_name: row.account_name,
            account_group: row.account_group ?? null,
            company_id: null,
          });
        } else {
          toast.info(`Invoice seller “${extracted.party_name}” is not in the ledger. Select it manually.`);
        }
      }

      toast.success('Invoice read — review the populated fields before recording.');
    } catch (error) {
      console.error('Invoice OCR failed:', error);
      toast.error('Invoice reading failed. You can complete the fields manually.');
    } finally {
      setIsReadingInvoice(false);
    }
  };

  const onReceivingDateChange = (value: string) => {
    setDateOfReceivingBill(value);
    if (!paymentDateTouched.current) setDateOfPayment(twoMonthsAfter(value));
  };

  const save = () => {
    if (!canSave || !company.data || !party || !head || !file) return;
    record.mutate(
      {
        billNumber, billDate, dueDate: dueDate || null,
        partyLedgerId: party.id, expenseLedgerId: head.id,
        companyId: company.data, amount: amountValue, narration, file,
        pointOfContact: poc, relationshipManager: rm,
        categoryGroupId: category?.id ?? null, categoryGroupName: category?.name ?? null,
        patientId: patient?.id, patientName: patient?.name,
        surgeryName,
        dateOfProcedure: dateOfProcedure || null,
        dateOfReceivingBill: dateOfReceivingBill || null,
        dateOfPayment: dateOfPayment || null,
        notifyDirectorOnDue: notifyDirector && !!dateOfPayment,
        partyName: party.account_name,
      },
      {
        onSuccess: () => {
          invalidateBills(queryClient);
          toast.success(`Invoice ${billNumber.trim()} recorded and posted`);
          reset();
          onClose();
        },
        onError: (e: any) => toast.error(e?.message || 'Could not record the invoice'),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record an expense invoice</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {company.isError && (
            <p className="rounded border border-destructive/40 p-2 text-destructive">
              The accounting company could not be loaded. Close and try again.
            </p>
          )}
          {/* Evidence first: upload the invoice before entering any accounting
              fields so the bill itself can populate the rest of this form. */}
          <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div>
              <Label>Invoice bill (upload first)</Label>
              <p className="text-xs text-muted-foreground">
                Add the invoice photo or PDF. Adamrit will read the seller, invoice number,
                date, amount and description.
              </p>
            </div>
            {file ? (
              <div className="flex items-center gap-3 rounded-lg border bg-background p-3">
                <FileText className="h-5 w-5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                {isReadingInvoice && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                <button type="button" onClick={() => setFile(null)} aria-label="Remove the attached invoice"
                  className="shrink-0 rounded-full p-1 hover:bg-muted">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <Button variant="outline" type="button" onClick={() => fileRef.current?.click()}>
                <Paperclip className="mr-2 h-4 w-4" /> Attach photo or PDF
              </Button>
            )}
            {isReadingInvoice && <p className="text-xs text-primary">Reading invoice details…</p>}
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              hidden
              onChange={(e) => {
                void attachInvoice(e.target.files?.[0] ?? null);
                e.currentTarget.value = '';
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <Label htmlFor="eb-category">Invoice category</Label>
              <Input
                id="eb-category"
                value={category ? category.name : categorySearch}
                placeholder={
                  categoryOptions.isLoading
                    ? 'Loading categories…'
                    : 'Search groups under Sundry Creditors…'
                }
                autoComplete="off"
                onChange={(e) => { setCategory(null); setHead(null); setCategorySearch(e.target.value); }}
              />
              {!category && (() => {
                const term = categorySearch.trim().toLowerCase();
                const matches = (categoryOptions.data ?? []).filter(
                  (c) => !term || c.name.toLowerCase().includes(term),
                );
                if (matches.length === 0) {
                  return categoryOptions.data && categoryOptions.data.length > 0 ? null : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      No groups under Sundry Creditors yet — create them in Masters &rarr; Group.
                    </p>
                  );
                }
                return (
                  <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-background shadow">
                    {matches.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="block w-full px-3 py-2 text-left hover:bg-muted"
                        onClick={() => { setCategory(c); setCategorySearch(''); }}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
            <div>
              <Label htmlFor="eb-number">Invoice number</Label>
              <Input id="eb-number" value={billNumber} placeholder="As printed on the invoice"
                onChange={(e) => setBillNumber(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Who is the bill from (vendor / consultant / staff ledger)</Label>
            <LedgerAutocomplete
              value={party}
              companyId={company.data ?? null}
              placeholder="Search vendors, consultants and salary payees…"
              onChange={setParty}
            />
          </div>
          <div>
            <Label>What is it for (expense head)</Label>
            <LedgerAutocomplete
              value={head}
              companyId={company.data ?? null}
              placeholder="Search expense heads…"
              onChange={setHead}
            />
            {party && head && party.id === head.id && (
              <p className="mt-1 text-xs text-destructive">Bill From and What It Is For must use different ledgers.</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="eb-amount">Amount</Label>
              <Input id="eb-amount" inputMode="decimal" value={amount} placeholder="0.00"
                onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="eb-date">Invoice date</Label>
              <Input id="eb-date" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="eb-due">Due date</Label>
              <Input id="eb-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          {/* Which patient and which procedure this invoice is for */}
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <Label htmlFor="eb-patient">Patient ledger (optional)</Label>
              <Input
                id="eb-patient"
                value={patient ? `${patient.name} (${patient.id})` : patientSearch}
                placeholder="Search patient by name or ID…"
                onChange={(e) => { setPatient(null); setPatientSearch(e.target.value); }}
                autoComplete="off"
              />
              {!patient && patientSearch.trim().length >= 2 && (patientOptions.data?.length ?? 0) > 0 && (
                <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-background shadow">
                  {patientOptions.data!.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="block w-full px-3 py-2 text-left hover:bg-muted"
                      onClick={() => { setPatient(p); setPatientSearch(''); }}
                    >
                      {p.name} <span className="text-xs text-muted-foreground">({p.id})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <Label htmlFor="eb-surgery">Surgery name (optional)</Label>
              <Input
                id="eb-surgery"
                value={surgeryName}
                placeholder="Search the surgery master…"
                onChange={(e) => setSurgeryName(e.target.value)}
                autoComplete="off"
              />
              {surgeryName.trim().length >= 2 && (surgeryOptions.data?.length ?? 0) > 0
                && !surgeryOptions.data!.some((n) => n === surgeryName) && (
                <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-background shadow">
                  {surgeryOptions.data!.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="block w-full px-3 py-2 text-left hover:bg-muted"
                      onClick={() => setSurgeryName(name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="eb-procedure-date">Date of procedure</Label>
              <Input id="eb-procedure-date" type="date" value={dateOfProcedure}
                onChange={(e) => setDateOfProcedure(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="eb-received-date">Date of receiving bill</Label>
              <Input id="eb-received-date" type="date" value={dateOfReceivingBill}
                onChange={(e) => onReceivingDateChange(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="eb-payment-date">Date of payment</Label>
              <Input id="eb-payment-date" type="date" value={dateOfPayment}
                onChange={(e) => { paymentDateTouched.current = true; setDateOfPayment(e.target.value); }} />
              <p className="mt-1 text-xs text-muted-foreground">Two months after the bill was received.</p>
              <label className="mt-2 flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={notifyDirector}
                  disabled={!dateOfPayment}
                  onChange={(e) => setNotifyDirector(e.target.checked)}
                />
                <span className={dateOfPayment ? '' : 'text-muted-foreground'}>
                  Remind the director when this falls due
                </span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="eb-poc">Point of Contact (optional)</Label>
              <Input id="eb-poc" value={poc} maxLength={100} onChange={(e) => setPoc(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="eb-rm">Relationship Manager (optional)</Label>
              <Input id="eb-rm" value={rm} maxLength={100} onChange={(e) => setRm(e.target.value)} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="eb-narration">Narration</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={writingNarration}
                onClick={() => void writeNarration()}
              >
                {writingNarration
                  ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  : <Sparkles className="mr-1 h-3 w-3" />}
                Generate
              </Button>
            </div>
            <Input id="eb-narration" value={narration} maxLength={300}
              placeholder="Generate one from the fields above, or write your own"
              onChange={(e) => setNarration(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">
              Built from the vendor, patient, surgery and dates above. Always editable.
            </p>
          </div>

        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button disabled={!canSave} onClick={save}>
            {record.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Record invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Pay evidence: the payee's QR to scan, the confirmation to upload ────

/**
 * One cell per bill. The QR comes from the party's LEDGER, so whoever pays
 * scans the same code every time and never retypes a UPI id; the screenshot
 * goes back onto the bill as proof the transfer happened.
 */
function PayEvidenceCell({ bill }: { bill: BillRow }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [qrOpen, setQrOpen] = useState(false);
  const [proofOpen, setProofOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const proofInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const qrInput = useRef<HTMLInputElement>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['expense-bill-register'] });
    queryClient.invalidateQueries({ queryKey: ['expense-bill-referral'] });
  };

  const onProof = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      await savePaymentProof(bill.id, file);
      toast.success(`Payment proof saved against ${bill.billNumber}.`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the proof');
    } finally {
      setBusy(false);
      if (proofInput.current) proofInput.current.value = '';
    }
  };

  const onQr = async (file?: File) => {
    if (!file || !bill.partyLedgerId) return;
    setBusy(true);
    try {
      await saveLedgerQr(bill.partyLedgerId, file, user?.email || null);
      toast.success(`QR saved for ${bill.party}.`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the QR');
    } finally {
      setBusy(false);
      if (qrInput.current) qrInput.current.value = '';
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      {bill.partyQrUrl ? (
        <button
          type="button"
          onClick={() => setQrOpen(true)}
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          <QrCode className="h-3.5 w-3.5" /> Scan QR
        </button>
      ) : (
        <button
          type="button"
          disabled={!bill.partyLedgerId || busy}
          onClick={() => qrInput.current?.click()}
          className="inline-flex items-center gap-1 text-muted-foreground hover:underline disabled:opacity-50"
          title={`No QR held for ${bill.party} — upload the payee's code`}
        >
          <QrCode className="h-3.5 w-3.5" /> Add QR
        </button>
      )}

      {bill.paymentProofUrl ? (
        <button
          type="button"
          onClick={() => setProofOpen(true)}
          className="inline-flex items-center gap-1 text-emerald-700 hover:underline"
        >
          <FileText className="h-3.5 w-3.5" /> Proof
        </button>
      ) : (
        <span className="inline-flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => proofInput.current?.click()}
            className="inline-flex items-center gap-1 text-muted-foreground hover:underline disabled:opacity-50"
            title="Upload the PhonePe / UPI confirmation for this bill"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload proof
          </button>
          {/* Same destination, camera straight away — on a phone or tablet
              the confirmation is on the screen you are holding. */}
          <button
            type="button"
            disabled={busy}
            onClick={() => cameraInput.current?.click()}
            className="inline-flex items-center gap-1 text-muted-foreground hover:underline disabled:opacity-50"
            title="Photograph the payment confirmation"
            aria-label="Photograph the payment confirmation"
          >
            <Camera className="h-3.5 w-3.5" />
          </button>
        </span>
      )}

      <input
        ref={proofInput}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => void onProof(e.target.files?.[0])}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void onProof(e.target.files?.[0])}
      />
      <input
        ref={qrInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onQr(e.target.files?.[0])}
      />

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pay {bill.party}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {bill.partyQrUrl && (
              <img
                src={bill.partyQrUrl}
                alt={`Payment QR for ${bill.party}`}
                className="mx-auto w-full max-w-[260px] rounded-md border"
              />
            )}
            <p className="text-center text-sm text-muted-foreground">
              {bill.billNumber} · outstanding ₹{rupees(bill.outstanding)}
            </p>
            <div className="flex justify-between gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => qrInput.current?.click()}>
                Replace QR
              </Button>
              <Button size="sm" disabled={busy} onClick={() => proofInput.current?.click()}>
                <Upload className="mr-1 h-4 w-4" /> Upload proof
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* The confirmation opens over the register, so whoever is checking a
          row never loses their place in it. */}
      <Dialog open={proofOpen} onOpenChange={setProofOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Payment proof · {bill.billNumber}</DialogTitle>
          </DialogHeader>
          {bill.paymentProofUrl && (
            <div className="space-y-3">
              {isPdf(bill.paymentProofUrl) ? (
                <iframe
                  src={bill.paymentProofUrl}
                  title={`Payment proof for ${bill.billNumber}`}
                  className="h-[60vh] w-full rounded-md border"
                />
              ) : (
                <img
                  src={bill.paymentProofUrl}
                  alt={`Payment proof for ${bill.billNumber}`}
                  className="mx-auto max-h-[60vh] w-auto rounded-md border"
                />
              )}
              <p className="text-center text-sm text-muted-foreground">
                {bill.party} · ₹{rupees(bill.billed)}
              </p>
              {/* The wrong screenshot goes up often enough that replacing it
                  has to be possible from the same place it is checked. */}
              <div className="flex items-center justify-between gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a href={bill.paymentProofUrl} target="_blank" rel="noreferrer">
                    Open full size
                  </a>
                </Button>
                <span className="inline-flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => cameraInput.current?.click()}
                    aria-label="Photograph the payment confirmation again"
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => proofInput.current?.click()}>
                    {busy ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-1 h-4 w-4" />
                    )}
                    Replace proof
                  </Button>
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </span>
  );
}

// ── Shared bill table ───────────────────────────────────────────────────

function BillTable({
  rows, isLoading, error, onPay, emptyMessage, showPatient, billedToPatient,
  selectedIds, onToggleRow, onToggleAll, movedDates, onMove, moving, onRevert, reverting,
}: {
  rows: BillRow[];
  isLoading: boolean;
  error: unknown;
  onPay: (bill: BillRow) => void;
  emptyMessage: string;
  /** Adds the Patient column — a diagnostic or referral invoice is unreadable
   *  without knowing whose test it was. Blank for vendor and utility bills. */
  showPatient?: boolean;
  /** The referral cards bill the patient, so the vendor column is "Billed To". */
  billedToPatient?: boolean;
  /** Selection for the move-to-daily-allocation flow, shared across the page. */
  selectedIds: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: (rows: BillRow[], select: boolean) => void;
  /** billId → schedule_date for invoices already on a live allocation. */
  movedDates: Record<string, MovedInfo>;
  onMove: (ids: string[]) => void;
  moving: boolean;
  onRevert: (id: string) => void;
  reverting: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading bills…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded bg-red-50 p-4 text-sm text-red-700">
        Failed to load expense bills from the database.
        <div className="mt-1 text-xs opacity-70">{getErrorMessage(error)}</div>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="py-10 text-center text-gray-500">
        <Receipt className="mx-auto mb-2 h-10 w-10 opacity-30" />
        <p>{emptyMessage}</p>
      </div>
    );
  }
  // Only unpaid bills not already on a live allocation can be selected.
  const movable = rows.filter((b) => statusOf(b) !== 'paid' && !movedDates[b.id]);
  const allSelected = movable.length > 0 && movable.every((b) => selectedIds.has(b.id));

  return (
    <>
      <div className="space-y-3 sm:hidden">
        {rows.map((b) => {
          const status = statusOf(b);
          const movedInfo = movedDates[b.id];
          return (
            <article
              key={b.id}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest('button, a, input, select, [role="checkbox"]')) return;
                if (status !== 'paid' && !movedInfo) onToggleRow(b.id);
              }}
              className={`rounded-xl border p-4 shadow-sm ${status !== 'paid' && !movedInfo ? 'cursor-pointer' : ''} ${selectedIds.has(b.id) ? 'border-emerald-300 bg-emerald-50 text-slate-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-slate-100' : 'bg-white dark:bg-card'}`}
              aria-selected={selectedIds.has(b.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{b.party}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{b.billNumber} · {new Date(b.billDate).toLocaleDateString('en-IN')}</p>
                  {showPatient && <p className="mt-1 truncate text-sm text-gray-700">Patient: {b.patientName || '—'}</p>}
                </div>
                <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium uppercase ${STATUS_STYLE[status]}`}>{status}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-y py-3 text-sm">
                <div><p className="text-xs text-muted-foreground">Category</p><p className="truncate font-medium">{b.expenseHead}</p></div>
                <div><p className="text-xs text-muted-foreground">Bill amount</p><p className="font-medium tabular-nums">₹{rupees(b.billed)}</p></div>
                <div><p className="text-xs text-muted-foreground">Paid</p><p className="tabular-nums">₹{rupees(b.paid)}</p></div>
                <div><p className="text-xs text-muted-foreground">Remaining</p><p className="font-semibold tabular-nums">₹{rupees(b.outstanding)}</p></div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                {status === 'paid' ? <span className="text-muted-foreground">Settled</span> : movedInfo ? (
                  <span className="rounded bg-blue-100 px-2 py-1 font-medium text-blue-700">In allocation</span>
                ) : (
                  <label className="inline-flex items-center gap-2 font-medium">
                    <input type="checkbox" className="h-4 w-4" checked={selectedIds.has(b.id)} onChange={() => onToggleRow(b.id)} aria-label={`Select invoice ${b.billNumber} for Daily Allocation`} />
                    Allocate
                  </label>
                )}
                {b.documentUrl && <button type="button" onClick={() => { void openStoredDocument(b.documentUrl!).catch((e) => toast.error(e.message)); }} className="inline-flex items-center gap-1 text-primary"><Paperclip className="h-3.5 w-3.5" />Invoice</button>}
                {b.signedVoucherUrl && <a href={b.signedVoucherUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700"><FileText className="h-3.5 w-3.5" />Signed PV</a>}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <PayEvidenceCell bill={b} />
                {status !== 'paid' && <div className="flex gap-2"><Button size="sm" variant="outline" className="h-9 gap-1 bg-white text-slate-900 hover:bg-slate-100 hover:text-slate-900 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-100" onClick={() => onPay(b)}><Banknote className="h-3.5 w-3.5" />Pay</Button>{!movedInfo && <Button size="sm" variant="outline" className="h-9 gap-1 bg-white text-slate-900 hover:bg-slate-100 hover:text-slate-900 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-100" disabled={moving} onClick={() => onMove([b.id])}><CalendarClock className="h-3.5 w-3.5" />Move</Button>}{movedInfo && <Button size="sm" variant="outline" className="h-9 gap-1 bg-white text-amber-800 hover:bg-amber-50 hover:text-amber-900" disabled={reverting} onClick={() => onRevert(b.id)}><Undo2 className="h-3.5 w-3.5" />Revert Allocation</Button>}</div>}
              </div>
            </article>
          );
        })}
      </div>
      <div className="hidden overflow-x-auto sm:block">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            <TableHead className="w-24">
              <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer" title="Select every payable bill in this list for Daily Allocation">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={allSelected}
                  disabled={movable.length === 0}
                  onChange={(e) => onToggleAll(movable, e.target.checked)}
                />
                Allocate
              </label>
            </TableHead>
            <TableHead>Bill No</TableHead>
            <TableHead>Bill Date</TableHead>
            {showPatient && <TableHead>Patient</TableHead>}
            <TableHead>{billedToPatient ? 'Billed To' : 'Vendor / Consultant / Staff'}</TableHead>
            <TableHead>Expense Category</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead className="text-right">Remaining</TableHead>
            <TableHead>POC</TableHead>
            <TableHead>RM</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Invoice</TableHead>
            <TableHead>Pay evidence</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((b) => {
            const status = statusOf(b);
            const movedInfo = movedDates[b.id];
            return (
              <TableRow
                key={b.id}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('button, a, input, select, [role="checkbox"]')) return;
                  if (status !== 'paid' && !movedInfo) onToggleRow(b.id);
                }}
                className={selectedIds.has(b.id)
                  ? 'cursor-pointer bg-emerald-50 text-slate-900 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-slate-100 dark:hover:bg-emerald-900/50'
                  : status !== 'paid' && !movedInfo ? 'cursor-pointer hover:bg-muted/50' : 'hover:bg-muted/50'}
              >
                <TableCell>
                  {status === 'paid' ? (
                    <span className="text-xs text-gray-400">—</span>
                  ) : movedInfo ? (
                    <span
                      className="inline-block rounded bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700"
                      title={`On the ${new Date(movedInfo.date).toLocaleDateString('en-IN')} allocation — open Payment Allocation, pick ${hospitalLabel(movedInfo.hospital)}, and pay it there`}
                    >
                      In allocation
                    </span>
                  ) : (
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={selectedIds.has(b.id)}
                      onChange={() => onToggleRow(b.id)}
                      aria-label={`Select invoice ${b.billNumber} for Daily Allocation`}
                    />
                  )}
                </TableCell>
                <TableCell className="font-medium">{b.billNumber}</TableCell>
                <TableCell>{new Date(b.billDate).toLocaleDateString('en-IN')}</TableCell>
                {showPatient && <TableCell>{b.patientName || '—'}</TableCell>}
                <TableCell>{b.party}</TableCell>
                <TableCell>{b.expenseHead}</TableCell>
                <TableCell className="text-right tabular-nums">₹{rupees(b.billed)}</TableCell>
                <TableCell className="text-right tabular-nums">₹{rupees(b.paid)}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">₹{rupees(b.outstanding)}</TableCell>
                <TableCell>{b.pointOfContact || '—'}</TableCell>
                <TableCell>{b.relationshipManager || '—'}</TableCell>
                <TableCell>
                  <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium uppercase ${STATUS_STYLE[status]}`}>
                    {status}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="inline-flex flex-col gap-0.5">
                    {b.documentUrl ? (
                      <button type="button"
                        onClick={() => { void openStoredDocument(b.documentUrl!).catch((e) => toast.error(e.message)); }}
                        className="inline-flex items-center gap-1 text-primary hover:underline">
                        <Paperclip className="h-3.5 w-3.5" /> Invoice
                      </button>
                    ) : '—'}
                    {b.signedVoucherUrl && (
                      <a href={b.signedVoucherUrl} target="_blank" rel="noreferrer"
                        title="Payment voucher signed by the receiver of the cash"
                        className="inline-flex items-center gap-1 text-emerald-700 hover:underline">
                        <FileText className="h-3.5 w-3.5" /> Signed PV
                      </a>
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  <PayEvidenceCell bill={b} />
                </TableCell>
                <TableCell className="text-right">
                  {status !== 'paid' ? (
                    <span className="inline-flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 gap-1 bg-white px-2 text-xs text-slate-900 hover:bg-slate-100 hover:text-slate-900 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-100" onClick={() => onPay(b)}>
                        <Banknote className="h-3.5 w-3.5" /> Pay
                      </Button>
                      {!movedInfo && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 bg-white px-2 text-xs text-slate-900 hover:bg-slate-100 hover:text-slate-900 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                          disabled={moving}
                          title="Move this invoice to today's Daily Payment Allocation"
                          onClick={() => onMove([b.id])}
                        >
                          <CalendarClock className="h-3.5 w-3.5" /> Move
                        </Button>
                      )}
                      {movedInfo && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 bg-white px-2 text-xs text-amber-800 hover:bg-amber-50 hover:text-amber-900"
                          disabled={reverting}
                          title="Take this invoice back off the Daily Payment Allocation"
                          onClick={() => onRevert(b.id)}
                        >
                          <Undo2 className="h-3.5 w-3.5" /> Revert Allocation
                        </Button>
                      )}
                    </span>
                  ) : (
                    <span className="text-xs text-emerald-700">settled</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>
    </>
  );
}

// ── DRR referral section (OPD / IPD) ────────────────────────────────────

interface SelectionProps {
  selectedIds: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: (rows: BillRow[], select: boolean) => void;
  movedDates: Record<string, MovedInfo>;
  onMove: (ids: string[]) => void;
  moving: boolean;
  onRevert: (id: string) => void;
  reverting: boolean;
}

function ReferralSection({ patientType, onPay, selection }: {
  patientType: 'OPD' | 'IPD';
  onPay: (b: BillRow) => void;
  selection: SelectionProps;
}) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [date, setDate] = useState('');
  const isToday = date === todayIso();

  const query = useReferralSection(patientType, search, date);

  return (
    <Card className="border-l-4 border-l-purple-500">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-purple-600" />
          <CardTitle className="text-base">
            Daily Revenue Report Patient List RM Cut — {patientType}
          </CardTitle>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={isToday ? 'default' : 'outline'}
            onClick={() => setDate(isToday ? '' : todayIso())}
          >
            Today's {patientType}
          </Button>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 w-40"
            aria-label={`Filter ${patientType} referral bills by date`}
          />
          <div className="flex items-center gap-1">
            <Input
              value={searchInput}
              placeholder="Patient, RM or bill no…"
              className="h-9 w-56"
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setSearch(searchInput)}
            />
            <Button size="sm" variant="outline" onClick={() => setSearch(searchInput)}>
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-gray-500">
          M.L. Enterprises implant invoices raised by the per-patient Approve on the Director
          Dashboard's {patientType} Daily Revenue Report.
          {patientType === 'IPD' ? " Today's IPD shows patients whose report entry is dated today (discharge day)." : ''}
        </p>
        <BillTable
          rows={query.data ?? []}
          isLoading={query.isLoading}
          error={query.error}
          onPay={onPay}
          showPatient
          billedToPatient
          emptyMessage={`No ${patientType} referral invoices found${date ? ` for ${new Date(date).toLocaleDateString('en-IN')}` : ''}.`}
          {...selection}
        />
      </CardContent>
    </Card>
  );
}

// ── The page ────────────────────────────────────────────────────────────

export default function ExpenseBills() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const company = useExpenseBillCompanyId();
  const [draft, setDraft] = useState<RegisterFilters>(emptyFilters);
  const [applied, setApplied] = useState<RegisterFilters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [paying, setPaying] = useState<BillRow | null>(null);
  const [recording, setRecording] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('expense-bills-selected-ids') || '[]');
      return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    localStorage.setItem('expense-bills-selected-ids', JSON.stringify([...selected]));
  }, [selected]);

  const registerQuery = useExpenseBillRegister(company.data, applied);
  const movedQuery = useMovedToAllocation();

  const applyFilters = (filters: RegisterFilters) => {
    setApplied(filters);
  };

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = (rows: BillRow[], select: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (select) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });

  // One invoice at a time, so a failure names its bill instead of sinking the
  // whole batch; everything that succeeded stays moved.
  // Undo a move. The database refuses once anything has been paid, and says
  // so — the row does not vanish quietly.
  const revertMutation = useMutation({
    mutationFn: async (billId: string) => {
      const { data, error } = await (supabase as any).rpc('revert_expense_bill_allocation', {
        p_bill_id: billId,
        p_user: user?.email ?? user?.username ?? null,
      });
      if (error) throw new Error(error.message);
      return data as { reverted: boolean; reason?: string; bill_number?: string; paid?: boolean };
    },
    onSuccess: (result) => {
      invalidateBills(queryClient);
      if (result.reverted) {
        toast.success(`Invoice ${result.bill_number} taken off the allocation — it is back on the register.`);
      } else {
        toast.error(result.reason || 'Could not revert this allocation');
      }
    },
    onError: (e: any) => toast.error(e?.message || 'Could not revert this allocation'),
  });

  const moveMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const moved: Array<{ id: string; billNumber: string; amount: number; hospital: string | null }> = [];
      const failed: string[] = [];
      for (const id of ids) {
        const { data, error } = await (supabase as any).rpc('move_expense_bill_to_daily_allocation', {
          p_bill_id: id,
          p_date: todayIso(),
          p_created_by: user?.email ?? user?.username ?? null,
        });
        if (error) failed.push(error.message);
        else moved.push({
          id,
          billNumber: data.bill_number,
          amount: Number(data.amount) || 0,
          hospital: data.hospital ?? null,
        });
      }
      return { moved, failed };
    },
    onSuccess: ({ moved, failed }) => {
      invalidateBills(queryClient);
      setSelected((current) => {
        const next = new Set(current);
        moved.forEach((bill) => next.delete(bill.id));
        return next;
      });
      if (moved.length) {
        const total = moved.reduce((s, m) => s + m.amount, 0);
        const hospitals = [...new Set(moved.map((m) => hospitalLabel(m.hospital)))];
        toast.success(
          `Moved ${moved.length} invoice${moved.length === 1 ? '' : 's'} (₹${rupees(total)}) to today's Daily Payment Allocation — open Payment Allocation and pick ${hospitals.join(' / ')} to see and pay ${moved.length === 1 ? 'it' : 'them'}.`,
          {
            duration: 10000,
            action: { label: 'View', onClick: () => navigate('/daily-payment-allocation') },
          },
        );
      }
      for (const message of failed) toast.error(message);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const selection: SelectionProps = {
    selectedIds: selected,
    onToggleRow: toggleRow,
    onToggleAll: toggleAll,
    movedDates: movedQuery.data ?? {},
    onMove: (ids) => moveMutation.mutate(ids),
    moving: moveMutation.isPending,
    onRevert: (id) => revertMutation.mutate(id),
    reverting: revertMutation.isPending,
  };

  const activeFilterCount = useMemo(
    () =>
      (['minAmount', 'maxAmount', 'dateFrom', 'dateTo', 'poc', 'rm'] as const)
        .filter((k) => applied[k].trim() !== '').length + (applied.status !== 'all' ? 1 : 0),
    [applied],
  );

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Receipt className="h-6 w-6 text-emerald-600" />
          <h1 className="text-2xl font-bold">Expense Bill</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="gap-1"
            disabled={selected.size === 0 || moveMutation.isPending}
            title="Send the selected invoices to today's Daily Payment Allocation"
            onClick={() => moveMutation.mutate([...selected])}
          >
            {moveMutation.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <CalendarClock className="h-4 w-4" />}
            Move to Daily Allocation{selected.size > 0 ? ` (${selected.size})` : ''}
          </Button>
          <Button onClick={() => setRecording(true)} className="gap-1">
            <Plus className="h-4 w-4" /> Record an invoice
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="sticky bottom-20 z-20 flex items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50/95 p-3 shadow-lg backdrop-blur sm:static sm:rounded-lg sm:shadow-none">
          <span className="text-sm font-semibold text-emerald-950">{selected.size} bill{selected.size === 1 ? '' : 's'} selected</span>
          <Button
            size="sm"
            className="gap-1"
            disabled={moveMutation.isPending}
            onClick={() => moveMutation.mutate([...selected])}
          >
            {moveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            Move to Daily Allocation
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 w-full flex-1 sm:min-w-[280px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={draft.search}
                placeholder="Search by vendor, consultant, staff, bill no, POC, RM, category or description…"
                className="pl-9"
                onChange={(e) => setDraft({ ...draft, search: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && applyFilters(draft)}
              />
            </div>
            <Button onClick={() => applyFilters(draft)} className="gap-1">
              <Search className="h-4 w-4" /> Search
            </Button>
            <Button
              variant="outline"
              className="gap-1"
              onClick={() => { setDraft(emptyFilters); applyFilters(emptyFilters); }}
            >
              <X className="h-4 w-4" /> Clear Filters
            </Button>
            <Button variant="outline" className="gap-1" onClick={() => setShowFilters((s) => !s)}>
              <Filter className="h-4 w-4" />
              {showFilters ? 'Hide Filters' : 'More Filters'}
              {activeFilterCount > 0 && (
                <span className="ml-1 rounded-full bg-emerald-600 px-1.5 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>

          {showFilters && (
            <div className="grid grid-cols-2 gap-3 rounded-lg border bg-gray-50 p-3 md:grid-cols-4">
              <div>
                <Label htmlFor="f-min">Minimum amount</Label>
                <Input id="f-min" type="number" min="0" value={draft.minAmount}
                  onChange={(e) => setDraft({ ...draft, minAmount: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="f-max">Maximum amount</Label>
                <Input id="f-max" type="number" min="0" value={draft.maxAmount}
                  onChange={(e) => setDraft({ ...draft, maxAmount: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="f-from">Bill date from</Label>
                <Input id="f-from" type="date" value={draft.dateFrom}
                  onChange={(e) => setDraft({ ...draft, dateFrom: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="f-to">Bill date to</Label>
                <Input id="f-to" type="date" value={draft.dateTo}
                  onChange={(e) => setDraft({ ...draft, dateTo: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="f-poc">Point of Contact</Label>
                <Input id="f-poc" value={draft.poc}
                  onChange={(e) => setDraft({ ...draft, poc: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="f-rm">Relationship Manager</Label>
                <Input id="f-rm" value={draft.rm}
                  onChange={(e) => setDraft({ ...draft, rm: e.target.value })} />
              </div>
              <div>
                <Label>Payment status</Label>
                <Select
                  value={draft.status}
                  onValueChange={(v) => setDraft({ ...draft, status: v as RegisterFilters['status'] })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                    <SelectItem value="partial">Partially paid</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button className="w-full gap-1" onClick={() => applyFilters(draft)}>
                  <Search className="h-4 w-4" /> Apply
                </Button>
              </div>
            </div>
          )}

          <BillTable
            rows={registerQuery.data ?? []}
            isLoading={registerQuery.isLoading || company.isLoading}
            error={registerQuery.error ?? (company.isError ? company.error : null)}
            onPay={setPaying}
            showPatient
            emptyMessage="No expense bills match this search."
            {...selection}
          />
        </CardContent>
      </Card>

      <ReferralSection patientType="OPD" onPay={setPaying} selection={selection} />
      <ReferralSection patientType="IPD" onPay={setPaying} selection={selection} />

      {/* RMO duty JVs from the Gaurav and Javed tiles. They are approval-queue
          bills, not expense_bills rows, so they are paid by their own voucher
          rather than through record_expense_bill_payment. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Banknote className="h-4 w-4 text-emerald-600" />
            RMO duty — approved JVs awaiting payment
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Duties recorded on the RMO Duty (Gaurav) and Javed tiles. Once approved, the JV is
            posted and the RMO's ledger is owed — tick the duties and pay them here on one voucher.
          </p>
        </CardHeader>
        <CardContent>
          <RmoPaymentsTab companyId={company.data ?? null} />
        </CardContent>
      </Card>

      <RupaliConsultantPayments companyId={company.data ?? null} />

      <PayBillDialog bill={paying} onClose={() => setPaying(null)} />
      <RecordBillDialog open={recording} onClose={() => setRecording(false)} />
    </div>
  );
}
