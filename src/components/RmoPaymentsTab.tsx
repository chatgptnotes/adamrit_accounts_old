import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { payInvoicesTogether } from '@/lib/approval-queue-service';
import { printSpecialistInvoice } from '@/lib/printSpecialistInvoice';
import { useCompanies } from '@/hooks/useCompanies';
import { useAccountingCashBankLedgers } from '@/hooks/usePaymentObligations';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// RMO duty payments, inside Daily Payment Allocation so the accountant pays
// everything from one page. The duty bills come from the RMO Duty tile;
// pending ones still need approval (JV) in Accounting → Approvals; approved
// unpaid invoices are grouped per RMO, any number ticked, one voucher pays
// them. Paid invoices never appear.

interface DutyBill {
  id: string;
  party_name: string;
  amount: number;
  reference_no: string | null;
  invoice_no: string | null;
  duty_shift: string | null;
  status: string;
  company_id: string | null;
  jv_voucher_id: string | null;
}

export function RmoPaymentsTab() {
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState('');
  const [bankId, setBankId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [payingGroup, setPayingGroup] = useState<string | null>(null);

  const { data: companies = [] } = useCompanies();
  const { data: bankLedgers = [] } = useAccountingCashBankLedgers(companyId || null);

  const { data: bills = [], isLoading } = useQuery({
    queryKey: ['rmo-duty-payments'],
    queryFn: async (): Promise<DutyBill[]> => {
      const { data, error } = await (supabase as any)
        .from('approval_queue')
        .select('id, party_name, amount, reference_no, invoice_no, duty_shift, status, company_id, jv_voucher_id')
        .like('reference_no', 'RMO-DUTY-%')
        .neq('status', 'REJECTED')
        .eq('is_paid', false)
        .order('reference_no');
      if (error) throw error;
      return data || [];
    },
  });

  const groups = useMemo(() => {
    const byRmo = new Map<string, { name: string; pending: DutyBill[]; payable: DutyBill[] }>();
    for (const bill of bills) {
      const key = bill.party_name.trim().toLowerCase();
      const group = byRmo.get(key) || { name: bill.party_name, pending: [], payable: [] };
      if (bill.status === 'APPROVED' && bill.jv_voucher_id) group.payable.push(bill);
      else group.pending.push(bill);
      byRmo.set(key, group);
    }
    return [...byRmo.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [bills]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const dutyDate = (bill: DutyBill) => (bill.reference_no || '').replace('RMO-DUTY-', '');

  const payGroup = async (group: { name: string; payable: DutyBill[] }) => {
    const ids = group.payable.filter((b) => selected.has(b.id)).map((b) => b.id);
    if (!ids.length) {
      toast.error('Tick the invoices to pay first');
      return;
    }
    if (!bankId) {
      toast.error('Select the bank the payment goes out from');
      return;
    }
    setPayingGroup(group.name);
    try {
      const result = await payInvoicesTogether(ids, {
        cashBankAccountId: bankId,
        date: new Date().toISOString().slice(0, 10),
      });
      toast.success(
        `${group.name}: paid ${result.count} dut${result.count === 1 ? 'y' : 'ies'} — ₹${result.total.toLocaleString('en-IN')} on voucher ${result.voucherNumber}`,
      );
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['rmo-duty-payments'] });
    } catch (error: any) {
      toast.error(error?.message || 'Payment failed');
    } finally {
      setPayingGroup(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Company (must match the invoices' books)</Label>
            <Select value={companyId} onValueChange={(v) => { setCompanyId(v); setBankId(''); }}>
              <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
              <SelectContent>
                {companies.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.company_name || c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Pay from (cash / bank)</Label>
            <Select value={bankId} onValueChange={setBankId}>
              <SelectTrigger><SelectValue placeholder="Select bank" /></SelectTrigger>
              <SelectContent>
                {bankLedgers.map((l: any) => (
                  <SelectItem key={l.id} value={l.id}>{l.account_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading duty bills…</p>
      ) : groups.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nothing unpaid — duty entries from the RMO Duty tile appear here.
        </p>
      ) : (
        groups.map((group) => {
          const groupSelected = group.payable.filter((b) => selected.has(b.id));
          const total = groupSelected.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
          return (
            <Card key={group.name}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">{group.name}</CardTitle>
                {group.payable.length > 0 && (
                  <Button
                    size="sm"
                    disabled={payingGroup === group.name || groupSelected.length === 0}
                    onClick={() => void payGroup(group)}
                  >
                    {payingGroup === group.name ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Banknote className="mr-2 h-4 w-4" />
                    )}
                    Pay {groupSelected.length > 0 ? `${groupSelected.length} (₹${total.toLocaleString('en-IN')})` : ''}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-1">
                {group.payable.map((bill) => (
                  <label key={bill.id} className="flex items-center gap-2 rounded border px-2 py-1.5 text-sm">
                    <input type="checkbox" checked={selected.has(bill.id)} onChange={() => toggle(bill.id)} />
                    <button
                      type="button"
                      className="font-mono text-xs font-semibold text-blue-700 hover:underline"
                      title="Print invoice"
                      onClick={(e) => {
                        e.preventDefault();
                        void printSpecialistInvoice(bill.id).catch((err) => toast.error(err?.message || 'Could not open the invoice'));
                      }}
                    >
                      <FileText className="mr-1 inline h-3.5 w-3.5" />
                      {bill.invoice_no || '—'}
                    </button>
                    <span className="text-muted-foreground">{dutyDate(bill)}</span>
                    <span className="capitalize text-muted-foreground">{bill.duty_shift || ''}</span>
                    <span className="ml-auto font-mono">₹{Number(bill.amount).toLocaleString('en-IN')}</span>
                  </label>
                ))}
                {group.pending.length > 0 && (
                  <p className="pt-1 text-xs text-amber-700">
                    {group.pending.length} dut{group.pending.length === 1 ? 'y' : 'ies'} awaiting approval in
                    Accounting → Approvals before they can be paid.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
