import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Banknote, CalendarClock, ChevronDown, ChevronRight, FileText, Loader2, Printer } from 'lucide-react';
import {
  listSurgeryInvoices,
  listSurgeryInvoiceAllocations,
  moveSurgeryInvoiceToDailyAllocation,
  approveAndPostJV,
  payInvoicesTogether,
  needsDetails,
  type SurgeryInvoiceRow,
} from '@/lib/approval-queue-service';
import { printSpecialistInvoice } from '@/lib/printSpecialistInvoice';
import { printSpecialistStatement } from '@/lib/printSpecialistStatement';
import { useAccountingCashBankLedgers } from '@/hooks/usePaymentObligations';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Person-wise payout screen for everyone paid per OT case — surgeons,
 * anesthetists, OT & cath-lab assistants. One row per person for the period:
 * approve all their pending invoices (posts one JV each), then pay every
 * approved invoice with ONE payment voucher via payInvoicesTogether.
 */

const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const todayStr = () => new Date().toISOString().slice(0, 10);
const inr = (n: number) => Number(n || 0).toLocaleString('en-IN');

type RowStatus = 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';
const statusOf = (row: SurgeryInvoiceRow): RowStatus => {
  if (row.status === 'REJECTED') return 'REJECTED';
  if (row.is_paid) return 'PAID';
  if (row.status === 'APPROVED') return 'APPROVED';
  return 'PENDING';
};

const STATUS_BADGE: Record<RowStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  PAID: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-700',
};

interface PersonGroup {
  key: string;
  name: string;
  rows: SurgeryInvoiceRow[];
  pendingTotal: number;
  approvedTotal: number;
  paidTotal: number;
  /** Pending rows whose amount/company/ledgers are filled — approvable now. */
  approvable: SurgeryInvoiceRow[];
  /** Approved, unpaid, JV posted, not on a daily allocation — payable together. */
  payable: SurgeryInvoiceRow[];
  payableTotal: number;
  /** Some pending bills are missing amount/ledgers (unmapped doctor). */
  needsMapping: boolean;
}

const SpecialistPayouts: React.FC = () => {
  const [fromDate, setFromDate] = useState(firstOfMonth());
  const [toDate, setToDate] = useState(todayStr());
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [approvingKey, setApprovingKey] = useState<string | null>(null);
  const [payingGroup, setPayingGroup] = useState<PersonGroup | null>(null);
  const [payForm, setPayForm] = useState({ cashBankAccountId: '', date: todayStr() });
  const [posting, setPosting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['surgery-invoices', fromDate, toDate],
    queryFn: () => listSurgeryInvoices(fromDate, toDate),
  });

  /** invoice id → schedule_date for invoices already on a live daily allocation. */
  const { data: allocatedDates = {} } = useQuery({
    queryKey: ['surgery-invoice-allocations'],
    queryFn: listSurgeryInvoiceAllocations,
  });

  // The Surgery Fees master carries the MJPJAY package keywords (tags), so a
  // search by any package keyword finds the surgeries filed under it.
  const { data: feeMaster = [] } = useQuery({
    queryKey: ['surgery-fee-master-tags'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('surgery_fee_master')
        .select('procedure_name, tags')
        .eq('is_active', true);
      if (error) throw error;
      return (data || []) as Array<{ procedure_name: string; tags: string[] | null }>;
    },
  });

  const groups = useMemo<PersonGroup[]>(() => {
    const byPerson = new Map<string, SurgeryInvoiceRow[]>();
    for (const row of rows) {
      if (row.status === 'REJECTED') continue;
      const key = row.party_name.trim().toLowerCase();
      if (!byPerson.has(key)) byPerson.set(key, []);
      byPerson.get(key)!.push(row);
    }
    const term = search.trim().toLowerCase();
    // Package keywords: master rows whose name or any tag mentions the term
    // make every surgery filed under that procedure name a match.
    const matchingProcedures = new Set<string>();
    if (term) {
      for (const fee of feeMaster) {
        const hit = fee.procedure_name.toLowerCase().includes(term)
          || (fee.tags || []).some((tag) => String(tag).toLowerCase().includes(term));
        if (hit) matchingProcedures.add(fee.procedure_name.trim().toLowerCase());
      }
    }
    const rowMatches = (r: SurgeryInvoiceRow): boolean => {
      const surgery = (r.surgery_name || '').trim().toLowerCase();
      return [r.surgery_name, r.narration, r.patient_name]
        .some((field) => (field || '').toLowerCase().includes(term))
        || (surgery !== '' && matchingProcedures.has(surgery));
    };
    const list: PersonGroup[] = [];
    for (const [key, personRows] of byPerson) {
      if (term && !key.includes(term) && !personRows.some(rowMatches)) continue;
      const sum = (pred: (r: SurgeryInvoiceRow) => boolean) =>
        personRows.filter(pred).reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const payable = personRows.filter(
        (r) => statusOf(r) === 'APPROVED' && r.jv_voucher_id && !allocatedDates[r.id],
      );
      list.push({
        key,
        name: personRows[0].party_name,
        rows: personRows,
        pendingTotal: sum((r) => statusOf(r) === 'PENDING'),
        approvedTotal: sum((r) => statusOf(r) === 'APPROVED'),
        paidTotal: sum((r) => statusOf(r) === 'PAID'),
        approvable: personRows.filter((r) => statusOf(r) === 'PENDING' && !needsDetails(r)),
        payable,
        payableTotal: payable.reduce((s, r) => s + (Number(r.amount) || 0), 0),
        needsMapping: personRows.some((r) => statusOf(r) === 'PENDING' && needsDetails(r)),
      });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, search, allocatedDates, feeMaster]);

  const totals = useMemo(() => {
    const sum = (pick: (g: PersonGroup) => number) => groups.reduce((s, g) => s + pick(g), 0);
    return { pending: sum((g) => g.pendingTotal), approved: sum((g) => g.approvedTotal), paid: sum((g) => g.paidTotal) };
  }, [groups]);

  // Bank list needs the paying company; every payable invoice of one person
  // shares it (doctor_ledger_map holds one company per doctor).
  const payingCompanyId = useMemo(() => {
    const ids = new Set((payingGroup?.payable || []).map((r) => r.company_id).filter(Boolean));
    return ids.size === 1 ? [...ids][0] : null;
  }, [payingGroup]);
  const { data: cashBankLedgers = [], isLoading: loadingBanks } = useAccountingCashBankLedgers(payingCompanyId);

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['surgery-invoices'] });
    queryClient.invalidateQueries({ queryKey: ['surgery-invoice-allocations'] });
  };

  /** Approved, unpaid, JV posted, not already on a live allocation. */
  const canAllocate = (row: SurgeryInvoiceRow) =>
    statusOf(row) === 'APPROVED' && !!row.jv_voucher_id && !allocatedDates[row.id];

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // One invoice at a time, so a failure names its invoice instead of sinking
  // the whole batch; everything that succeeded stays moved.
  const moveToAllocation = async (ids: string[]) => {
    setMoving(true);
    const moved: number[] = [];
    try {
      for (const id of ids) {
        try {
          const result = await moveSurgeryInvoiceToDailyAllocation(
            id,
            todayStr(),
            (user as any)?.email ?? (user as any)?.username ?? null,
          );
          moved.push(Number(result.amount) || 0);
        } catch (err: any) {
          toast.error(err?.message || 'Could not move an invoice to the daily allocation');
        }
      }
      if (moved.length) {
        const total = moved.reduce((s, n) => s + n, 0);
        toast.success(
          `Moved ${moved.length} invoice(s) (₹${inr(total)}) to today's Daily Payment Allocation`,
        );
      }
    } finally {
      setMoving(false);
      setSelected(new Set());
      refresh();
    }
  };

  const approveAll = async (group: PersonGroup) => {
    setApprovingKey(group.key);
    let posted = 0;
    try {
      for (const row of group.approvable) {
        await approveAndPostJV(row.id);
        posted += 1;
      }
      toast.success(`${group.name}: ${posted} invoice(s) approved, JVs posted`);
    } catch (err: any) {
      toast.error(
        posted
          ? `${posted} approved, then failed: ${err?.message || 'unknown error'}`
          : err?.message || 'Could not approve the invoices',
      );
    } finally {
      setApprovingKey(null);
      refresh();
    }
  };

  const openPayModal = (group: PersonGroup) => {
    const companies = new Set(group.payable.map((r) => r.company_id).filter(Boolean));
    if (companies.size > 1) {
      toast.error(`${group.name}'s approved invoices sit in different companies — pay them from the Approvals screen`);
      return;
    }
    setPayingGroup(group);
    setPayForm({ cashBankAccountId: '', date: todayStr() });
  };

  const payAll = async () => {
    if (!payingGroup) return;
    if (!payForm.cashBankAccountId) {
      toast.error('Select the cash or bank ledger the payment goes out from');
      return;
    }
    setPosting(true);
    try {
      const { voucherNumber, total, count } = await payInvoicesTogether(
        payingGroup.payable.map((r) => r.id),
        { cashBankAccountId: payForm.cashBankAccountId, date: payForm.date },
      );
      toast.success(`Paid ${payingGroup.name} ₹${inr(total)} against ${count} invoice(s) — voucher ${voucherNumber}`);
      setPayingGroup(null);
    } catch (err: any) {
      toast.error(err?.message || 'Could not post the payment');
    } finally {
      setPosting(false);
      refresh();
    }
  };

  const payTotal = (payingGroup?.payable || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const bankName = cashBankLedgers.find((l: any) => l.id === payForm.cashBankAccountId)?.account_name;

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-lg font-semibold">Specialist Payouts</h2>
          <p className="text-xs text-muted-foreground">
            Surgeon, anesthetist and OT/cath-lab assistant fees, person-wise. Approve posts one JV per invoice;
            Pay settles every approved invoice with one payment voucher.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <Button
            variant="outline"
            className="h-8 gap-1"
            disabled={selected.size === 0 || moving}
            title="Send the ticked invoices to today's Daily Payment Allocation — payment happens there, against the day's budget"
            onClick={() => void moveToAllocation([...selected])}
          >
            {moving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            Move to Daily Allocation{selected.size > 0 ? ` (${selected.size})` : ''}
          </Button>
          <div>
            <Label className="text-xs">From (surgery date)</Label>
            <Input type="date" className="mt-1 h-8" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" className="mt-1 h-8" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Search person</Label>
            <Input
              className="mt-1 h-8 w-44"
              placeholder="Doctor, surgery, package keyword or patient…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>{groups.length} person(s)</span>
        <span className="text-amber-700">Pending approval: ₹{inr(totals.pending)}</span>
        <span className="text-blue-700">Approved, unpaid: ₹{inr(totals.approved)}</span>
        <span className="text-emerald-700">Paid: ₹{inr(totals.paid)}</span>
      </div>

      <div className="overflow-x-auto rounded-md border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-left text-xs uppercase text-gray-600">
              <th className="w-8 px-3 py-2" />
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 text-right">Cases</th>
              <th className="px-3 py-2 text-right">Pending (₹)</th>
              <th className="px-3 py-2 text-right">Approved, Unpaid (₹)</th>
              <th className="px-3 py-2 text-right">Paid (₹)</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : groups.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  No surgery invoices in this period.
                </td>
              </tr>
            ) : (
              groups.map((group) => {
                const open = expanded.has(group.key);
                return (
                  <React.Fragment key={group.key}>
                    <tr className="border-b hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => toggleExpanded(group.key)} title="Show invoices">
                          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-medium">
                        {group.name}
                        {group.needsMapping && (
                          <span
                            className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
                            title="Some pending bills are missing amount, company or ledgers — complete them in the Approvals screen (or map the doctor's ledgers there) first"
                          >
                            needs ledger/amount
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{group.rows.length}</td>
                      <td className="px-3 py-2 text-right font-mono text-amber-700">{inr(group.pendingTotal)}</td>
                      <td className="px-3 py-2 text-right font-mono text-blue-700">{inr(group.approvedTotal)}</td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-700">{inr(group.paidTotal)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          title={`Print ${group.name}'s full statement for this period — every case across both hospitals`}
                          onClick={() =>
                            void printSpecialistStatement({
                              name: group.name,
                              fromDate,
                              toDate,
                              rows: group.rows,
                            }).catch((err: any) => toast.error(err?.message || 'Could not open the statement'))
                          }
                        >
                          <Printer className="mr-1 h-3.5 w-3.5" />
                          Statement
                        </Button>
                        {group.approvable.length > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            disabled={approvingKey === group.key}
                            onClick={() => approveAll(group)}
                          >
                            {approvingKey === group.key ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <>Approve &amp; Post JV ({group.approvable.length})</>
                            )}
                          </Button>
                        )}
                        {group.payable.length > 0 && (
                          <Button size="sm" className="ml-2 h-7" onClick={() => openPayModal(group)}>
                            <Banknote className="mr-1 h-3.5 w-3.5" />
                            Pay ₹{inr(group.payableTotal)}
                          </Button>
                        )}
                        {group.approvable.length === 0 && group.payable.length === 0 && (
                          <span className="text-xs text-muted-foreground">
                            {group.needsMapping
                              ? 'Complete details in Approvals'
                              : group.rows.some((r) => statusOf(r) === 'APPROVED' && allocatedDates[r.id])
                                ? 'On daily allocation'
                                : 'Settled'}
                          </span>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b bg-slate-100 text-[11px] uppercase text-gray-500">
                        <td className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5"
                            title="Select every approved invoice of this person for Daily Allocation"
                            checked={group.payable.length > 0 && group.payable.every((r) => selected.has(r.id))}
                            disabled={group.payable.length === 0}
                            onChange={(e) =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                for (const r of group.payable) {
                                  e.target.checked ? next.add(r.id) : next.delete(r.id);
                                }
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className="py-1.5 pl-8 pr-3">Invoice</td>
                        <td className="px-3 py-1.5">Patient Name</td>
                        <td className="px-3 py-1.5">Package</td>
                        <td className="px-3 py-1.5">Procedure Date</td>
                        <td className="px-3 py-1.5 text-right">Amount (₹)</td>
                        <td className="px-3 py-1.5 text-right">Status</td>
                      </tr>
                    )}
                    {open &&
                      group.rows.map((row) => {
                        const status = statusOf(row);
                        const allocatedOn = allocatedDates[row.id];
                        return (
                          <tr key={row.id} className="border-b bg-slate-50/60 text-xs last:border-0">
                            <td className="px-3 py-1.5">
                              {canAllocate(row) && (
                                <input
                                  type="checkbox"
                                  className="h-3.5 w-3.5"
                                  checked={selected.has(row.id)}
                                  onChange={() => toggleSelected(row.id)}
                                  aria-label={`Select invoice ${row.invoice_no || row.reference_no || ''} for Daily Allocation`}
                                />
                              )}
                            </td>
                            <td className="py-1.5 pl-8 pr-3">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 font-mono text-blue-700 hover:underline"
                                title="View this invoice — generated by the system from the surgery bill"
                                onClick={() =>
                                  void printSpecialistInvoice(row.id).catch((err: any) =>
                                    toast.error(err?.message || 'Could not open the invoice'),
                                  )
                                }
                              >
                                <FileText className="h-3.5 w-3.5 shrink-0" />
                                {row.invoice_no || row.reference_no || 'View invoice'}
                              </button>
                            </td>
                            <td className="px-3 py-1.5 font-medium">{row.patient_name || '—'}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">
                              {row.surgery_name || row.narration || '—'}
                            </td>
                            <td className="px-3 py-1.5">
                              {row.surgery_date || (row.created_at || '').slice(0, 10)}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono">{inr(Number(row.amount))}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-right">
                              <span className={`rounded px-2 py-0.5 font-medium ${STATUS_BADGE[status]}`}>
                                {status === 'APPROVED' ? 'APPROVED · UNPAID' : status}
                                {status === 'PAID' && row.paid_at ? ` ${row.paid_at.slice(0, 10)}` : ''}
                              </span>
                              {allocatedOn && status !== 'PAID' && (
                                <span
                                  className="ml-1 rounded bg-blue-100 px-2 py-0.5 font-medium text-blue-700"
                                  title={`On the ${new Date(allocatedOn).toLocaleDateString('en-IN')} allocation — pay it from the Payment Allocation page`}
                                >
                                  In allocation
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!payingGroup} onOpenChange={(open) => { if (!open && !posting) setPayingGroup(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Pay {payingGroup?.name} — ₹{inr(payTotal)} ({payingGroup?.payable.length} invoice(s))
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">
                Cash / Bank Ledger (Credit) <span className="text-red-500">*</span>
              </Label>
              <select
                className="mt-1 block h-9 w-full rounded-md border bg-white px-2 text-sm"
                value={payForm.cashBankAccountId}
                onChange={(e) => setPayForm((f) => ({ ...f, cashBankAccountId: e.target.value }))}
                disabled={loadingBanks}
              >
                <option value="">
                  {loadingBanks ? 'Loading ledgers…' : cashBankLedgers.length ? 'Select cash or bank ledger' : 'No cash/bank ledger found'}
                </option>
                {cashBankLedgers.map((ledger: any) => (
                  <option key={ledger.id} value={ledger.id}>
                    {ledger.account_name} ({ledger.account_group || 'Cash/Bank'})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">
                Payment Date <span className="text-red-500">*</span>
              </Label>
              <Input
                type="date"
                className="mt-1 h-9"
                value={payForm.date}
                onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>
            {payingGroup && payForm.cashBankAccountId && (
              <div className="rounded-lg border bg-gray-50 px-3 py-2 text-xs">
                <p className="mb-1 font-semibold text-gray-700">Payment voucher that will post:</p>
                <p>
                  <span className="font-medium text-emerald-700">Dr</span> {payingGroup.name} — ₹{inr(payTotal)}
                </p>
                <p>
                  <span className="font-medium text-red-700">Cr</span> {bankName} — ₹{inr(payTotal)}
                </p>
                <p className="mt-1 text-gray-500">
                  Knocked off against {payingGroup.payable.map((r) => r.invoice_no || r.reference_no).filter(Boolean).join(', ') || 'the approved invoices'}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={posting} onClick={() => setPayingGroup(null)}>
              Cancel
            </Button>
            <Button disabled={posting} onClick={payAll}>
              {posting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Banknote className="mr-1 h-4 w-4" />}
              Post Payment Voucher
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SpecialistPayouts;
