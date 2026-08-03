import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Printer } from 'lucide-react';
import {
  listSurgeryInvoices,
  approveAndPostJV,
  needsDetails,
  type SurgeryInvoiceRow,
} from '@/lib/approval-queue-service';
import { printSpecialistInvoice } from '@/lib/printSpecialistInvoice';

/**
 * Date-wise report of every surgery invoice raised from the OT flow —
 * surgeon / anesthetist / OT & cath-lab assistant fees. One row per invoice,
 * with the accountant's Approve button that posts the JV in the backend.
 */

const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const todayStr = () => new Date().toISOString().slice(0, 10);

type StatusFilter = 'ALL' | 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';

const statusOf = (row: SurgeryInvoiceRow): Exclude<StatusFilter, 'ALL'> => {
  if (row.status === 'REJECTED') return 'REJECTED';
  if (row.is_paid) return 'PAID';
  if (row.status === 'APPROVED') return 'APPROVED';
  return 'PENDING';
};

const STATUS_BADGE: Record<Exclude<StatusFilter, 'ALL'>, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  PAID: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-700',
};

const SurgeryInvoiceReport: React.FC = () => {
  const [fromDate, setFromDate] = useState(firstOfMonth());
  const [toDate, setToDate] = useState(todayStr());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['surgery-invoices', fromDate, toDate],
    queryFn: () => listSurgeryInvoices(fromDate, toDate),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'ALL' && statusOf(row) !== statusFilter) return false;
      if (!term) return true;
      return [row.party_name, row.patient_name, row.surgery_name, row.invoice_no]
        .some((v) => (v || '').toLowerCase().includes(term));
    });
  }, [rows, statusFilter, search]);

  const totals = useMemo(() => {
    const sum = (pred: (r: SurgeryInvoiceRow) => boolean) =>
      filtered.filter(pred).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    return {
      all: sum(() => true),
      pending: sum((r) => statusOf(r) === 'PENDING'),
      unpaid: sum((r) => statusOf(r) === 'APPROVED'),
    };
  }, [filtered]);

  const approve = async (row: SurgeryInvoiceRow) => {
    setApprovingId(row.id);
    try {
      const { voucherNumber } = await approveAndPostJV(row.id);
      toast.success(`Approved — JV ${voucherNumber} posted`);
      queryClient.invalidateQueries({ queryKey: ['surgery-invoices'] });
    } catch (err: any) {
      toast.error(err?.message || 'Could not approve the invoice');
    } finally {
      setApprovingId(null);
    }
  };

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-lg font-semibold">Surgery Invoices</h2>
          <p className="text-xs text-muted-foreground">
            Every invoice raised from the OT — surgeon, anesthetist and assistant fees. Approving posts the JV.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">From (surgery date)</Label>
            <Input type="date" className="mt-1 h-8" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" className="mt-1 h-8" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <select
              className="mt-1 block h-8 rounded-md border bg-white px-2 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="ALL">All</option>
              <option value="PENDING">Pending approval</option>
              <option value="APPROVED">Approved, unpaid</option>
              <option value="PAID">Paid</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">Search</Label>
            <Input
              className="mt-1 h-8 w-48"
              placeholder="Doctor / patient / surgery / invoice"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>{filtered.length} invoice(s) — ₹{totals.all.toLocaleString('en-IN')}</span>
        <span className="text-amber-700">Pending: ₹{totals.pending.toLocaleString('en-IN')}</span>
        <span className="text-blue-700">Approved, unpaid: ₹{totals.unpaid.toLocaleString('en-IN')}</span>
      </div>

      <div className="overflow-x-auto rounded-md border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-left text-xs uppercase text-gray-600">
              <th className="px-3 py-2">Surgery Date &amp; Time</th>
              <th className="px-3 py-2">Invoice No</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Patient</th>
              <th className="px-3 py-2">Surgery / Package</th>
              <th className="px-3 py-2 text-right">Fees (₹)</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  No surgery invoices in this period.
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const status = statusOf(row);
                const incomplete = needsDetails(row);
                return (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-2">
                      {row.surgery_date || (row.created_at || '').slice(0, 10)}
                      {row.surgery_time ? ` ${String(row.surgery_time).slice(0, 5)}` : ''}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="font-mono text-blue-700 hover:underline"
                        title="Print this invoice"
                        onClick={() =>
                          void printSpecialistInvoice(row.id).catch((err: any) =>
                            toast.error(err?.message || 'Could not open the invoice'),
                          )
                        }
                      >
                        {row.invoice_no || '—'}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-medium">{row.party_name}</td>
                    <td className="px-3 py-2">{row.patient_name || '—'}</td>
                    <td className="max-w-[260px] truncate px-3 py-2" title={row.surgery_name || undefined}>
                      {row.surgery_name || row.narration || '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {Number(row.amount || 0).toLocaleString('en-IN')}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[status]}`}>
                        {status === 'APPROVED' ? 'APPROVED · UNPAID' : status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {status === 'PENDING' && (
                        incomplete ? (
                          <span
                            className="text-xs text-amber-700"
                            title="Amount, company or ledgers are missing — complete them in the Approvals screen first"
                          >
                            Complete details in Approvals
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            className="h-7"
                            disabled={approvingId === row.id}
                            onClick={() => approve(row)}
                          >
                            {approvingId === row.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Approve & Post JV'}
                          </Button>
                        )
                      )}
                      {status === 'APPROVED' && (
                        <span className="text-xs text-muted-foreground" title="Pay it from Daily Payment Allocation → Pay">
                          Awaiting payment
                        </span>
                      )}
                      {status === 'PAID' && row.paid_at && (
                        <span className="text-xs text-muted-foreground">Paid {row.paid_at.slice(0, 10)}</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        <Printer className="h-3 w-3" /> Click an invoice number to print it. Payment is made from Daily Payment
        Allocation → Pay, where only approved, unpaid invoices of the chosen doctor appear.
      </p>
    </div>
  );
};

export default SurgeryInvoiceReport;
