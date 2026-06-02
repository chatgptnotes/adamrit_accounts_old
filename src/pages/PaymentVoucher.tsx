import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Receipt, Plus, Trash2, Printer, RotateCcw } from 'lucide-react';

interface PaymentVoucher {
  id: string;
  voucher_no: string;
  voucher_date: string;
  person_name: string;
  amount: number;
  purpose: string | null;
  paid_by: string | null;
  created_at: string;
}

const todayISO = (): string => new Date().toISOString().slice(0, 10);

const daysAgoISO = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

const fmtINR = (n: number | null | undefined): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
};

const formatDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const escapeHTML = (s: string): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Empty form state for the create-voucher panel.
const emptyForm = () => ({
  date: todayISO(),
  personName: '',
  amount: '',
  purpose: '',
  paidBy: '',
});

const PaymentVoucher = () => {
  const { hospitalConfig } = useAuth();
  const hospitalType = hospitalConfig.name;
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // History date filter (default: last 30 days)
  const [fromDate, setFromDate] = useState<string>(() => daysAgoISO(30));
  const [toDate, setToDate] = useState<string>(todayISO);
  const [vouchers, setVouchers] = useState<ReadonlyArray<PaymentVoucher>>([]);
  const [loading, setLoading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const loadVouchers = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('payment_vouchers')
        .select('*')
        .eq('hospital_type', hospitalType)
        .gte('voucher_date', fromDate)
        .lte('voucher_date', toDate)
        .order('voucher_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      setVouchers((data ?? []) as PaymentVoucher[]);
    } catch (err) {
      console.error('Failed to load payment vouchers:', err);
      toast.error('Could not load vouchers from the database');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, hospitalType]);

  useEffect(() => {
    loadVouchers();
  }, [loadVouchers]);

  const total = useMemo(
    () => vouchers.reduce((sum, v) => sum + (Number(v.amount) || 0), 0),
    [vouchers],
  );

  const updateForm = (field: keyof ReturnType<typeof emptyForm>, value: string): void => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // Voucher number is human-readable and unique-per-day: PV-YYYYMMDD-NNN
  const nextVoucherNo = async (date: string): Promise<string> => {
    const datePart = date.replace(/-/g, '');
    const { count, error } = await (supabase as any)
      .from('payment_vouchers')
      .select('*', { count: 'exact', head: true })
      .eq('voucher_date', date);
    if (error) throw error;
    const seq = String((count ?? 0) + 1).padStart(3, '0');
    return `PV-${datePart}-${seq}`;
  };

  const handleSave = async (): Promise<void> => {
    const personName = form.personName.trim();
    const amount = Number(form.amount);
    if (!personName) {
      toast.error('Enter the person name');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    setSaving(true);
    try {
      const voucher_no = await nextVoucherNo(form.date);
      const { error } = await (supabase as any).from('payment_vouchers').insert({
        voucher_no,
        voucher_date: form.date,
        person_name: personName,
        amount,
        purpose: form.purpose.trim() || null,
        paid_by: form.paidBy.trim() || null,
        hospital_type: hospitalType,
      });
      if (error) throw error;
      toast.success(`Voucher ${voucher_no} saved`);
      setForm((prev) => ({ ...emptyForm(), date: prev.date }));
      loadVouchers();
    } catch (err) {
      console.error('Failed to save payment voucher:', err);
      toast.error('Failed to save — please try again');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    try {
      const { error } = await (supabase as any).from('payment_vouchers').delete().eq('id', id);
      if (error) throw error;
      setDeleteConfirmId(null);
      toast.info('Voucher deleted');
      loadVouchers();
    } catch (err) {
      console.error('Failed to delete payment voucher:', err);
      toast.error('Failed to delete — please try again');
    }
  };

  const handlePrint = (): void => {
    const win = window.open('', '_blank', 'width=900,height=1100');
    if (!win) {
      toast.error('Popup blocked — please allow popups for this site to print');
      return;
    }
    const rows = vouchers
      .map(
        (v, i) => `
        <tr>
          <td class="b center">${i + 1}</td>
          <td class="b">${escapeHTML(v.voucher_no)}</td>
          <td class="b">${escapeHTML(formatDateLabel(v.voucher_date))}</td>
          <td class="b">${escapeHTML(v.person_name)}</td>
          <td class="b">${escapeHTML(v.purpose || '')}</td>
          <td class="b">${escapeHTML(v.paid_by || '')}</td>
          <td class="b num">${fmtINR(Number(v.amount))}</td>
        </tr>`,
      )
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8" />
<title>Payment Vouchers — ${escapeHTML(formatDateLabel(fromDate))} to ${escapeHTML(formatDateLabel(toDate))}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; margin: 14mm; color: #000; }
  h2 { margin: 0 0 4px; }
  .meta { color: #555; font-size: 12px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { border: 1px solid #555; background: #d9e1f2; padding: 6px 8px; text-align: left; }
  td.b { border: 1px solid #555; padding: 5px 8px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .center { text-align: center; }
  tr.total td { border: 1px solid #555; background: #d9e1f2; font-weight: 700; }
  @page { size: A4 portrait; margin: 12mm; }
</style></head><body>
  <h2>Payment Vouchers</h2>
  <div class="meta">${escapeHTML(formatDateLabel(fromDate))} to ${escapeHTML(formatDateLabel(toDate))} · ${vouchers.length} voucher(s)</div>
  <table>
    <thead><tr><th>#</th><th>Voucher No.</th><th>Date</th><th>Person</th><th>Purpose</th><th>Paid By</th><th class="num">Amount</th></tr></thead>
    <tbody>
      ${rows}
      <tr class="total"><td colspan="6" class="num">TOTAL</td><td class="num">${fmtINR(total)}</td></tr>
    </tbody>
  </table>
  <script>window.onload=function(){setTimeout(function(){window.print()},150)}</script>
</body></html>`;
    win.document.open();
    win.document.write(html);
    win.document.close();
  };

  return (
    <div className="space-y-6 p-4">
      {/* Create voucher */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <Receipt className="h-5 w-5 text-blue-600" />
          <CardTitle>Payment Voucher</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-gray-500">
            Create a voucher when cash is given to someone going outside. Enter the person and the amount; a voucher number is generated automatically.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="pv-date">Date</Label>
              <Input id="pv-date" type="date" value={form.date} onChange={(e) => updateForm('date', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pv-person">Person Name</Label>
              <Input id="pv-person" value={form.personName} onChange={(e) => updateForm('personName', e.target.value)} placeholder="Who is receiving the money" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pv-amount">Amount (₹)</Label>
              <Input
                id="pv-amount"
                type="number"
                inputMode="numeric"
                value={form.amount}
                onChange={(e) => updateForm('amount', e.target.value)}
                placeholder="0"
                className="text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pv-purpose">Purpose / Reason</Label>
              <Input id="pv-purpose" value={form.purpose} onChange={(e) => updateForm('purpose', e.target.value)} placeholder="e.g. market purchase, travel" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pv-paidby">Paid By</Label>
              <Input id="pv-paidby" value={form.paidBy} onChange={(e) => updateForm('paidBy', e.target.value)} placeholder="Who handed over the cash" />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
                <Plus className="mr-1 h-4 w-4" /> {saving ? 'Saving…' : 'Save Voucher'}
              </Button>
              <Button variant="outline" onClick={() => setForm(emptyForm())} disabled={saving}>
                <RotateCcw className="mr-1 h-4 w-4" /> Clear
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg">Previous Vouchers</CardTitle>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="pv-from" className="text-xs">From</Label>
              <Input id="pv-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-auto" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pv-to" className="text-xs">To</Label>
              <Input id="pv-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-auto" />
            </div>
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={vouchers.length === 0}>
              <Printer className="mr-1 h-4 w-4" /> Print
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table className="border">
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Voucher No.</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Paid By</TableHead>
                  <TableHead className="text-right">Amount (₹)</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-sm text-gray-400">Loading…</TableCell>
                  </TableRow>
                ) : vouchers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-sm text-gray-400">No vouchers in this date range.</TableCell>
                  </TableRow>
                ) : (
                  vouchers.map((v, idx) => (
                    <TableRow key={v.id}>
                      <TableCell className="text-center text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-mono text-xs">{v.voucher_no}</TableCell>
                      <TableCell>{formatDateLabel(v.voucher_date)}</TableCell>
                      <TableCell className="font-medium">{v.person_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{v.purpose || '-'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{v.paid_by || '-'}</TableCell>
                      <TableCell className="text-right font-mono">{fmtINR(Number(v.amount))}</TableCell>
                      <TableCell>
                        {deleteConfirmId === v.id ? (
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-600" onClick={() => handleDelete(v.id)}>Yes</Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setDeleteConfirmId(null)}>No</Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label="Delete voucher"
                            onClick={() => setDeleteConfirmId(v.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
                {vouchers.length > 0 && (
                  <TableRow className="bg-gray-100 font-bold">
                    <TableCell colSpan={6} className="text-right">TOTAL</TableCell>
                    <TableCell className="text-right font-mono">{fmtINR(total)}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PaymentVoucher;
