import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CheckCircle2, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { approveAndPostJV, payInvoicesTogether, updateApprovalDetails } from '@/lib/approval-queue-service';
import { RMO_DUTY_EXPENSE_LEDGER, resolveRmoDutyPosting } from '@/lib/rmo/dutyLedgers';
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
//
// The Expense Bill page mounts the same component with its own company fixed,
// so the duty JVs are payable from there too. Both surfaces call the same
// payInvoicesTogether, which claims every invoice before it posts — so a bill
// paid on one screen cannot be paid again on the other.
//
// A pending duty is approved here as well, so the whole life of a duty bill —
// approve, then pay — happens on one screen. Approving posts the same JV the
// tile posts, through the same approveAndPostJV.

interface DutyBill {
  id: string;
  party_name: string;
  amount: number;
  reference_no: string | null;
  invoice_no: string | null;
  duty_shift: string | null;
  status: string;
  company_id: string | null;
  expense_account_id: string | null;
  party_account_id: string | null;
  jv_voucher_id: string | null;
}

export function RmoPaymentsTab({ companyId: fixedCompanyId }: { companyId?: string | null } = {}) {
  const queryClient = useQueryClient();
  const [pickedCompanyId, setPickedCompanyId] = useState('');
  const [bankId, setBankId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [payingGroup, setPayingGroup] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  // A caller that knows its own company (Expense Bill) fixes it; Daily Payment
  // Allocation pays for any company, so it picks one.
  const fixedCompany = fixedCompanyId !== undefined;
  const companyId = fixedCompany ? fixedCompanyId || '' : pickedCompanyId;

  const { data: companies = [] } = useCompanies();
  const { data: bankLedgers = [] } = useAccountingCashBankLedgers(companyId || null);

  const { data: bills = [], isLoading } = useQuery({
    queryKey: ['rmo-duty-payments', fixedCompany ? companyId : 'all'],
    enabled: !fixedCompany || Boolean(companyId),
    queryFn: async (): Promise<DutyBill[]> => {
      let query = (supabase as any)
        .from('approval_queue')
        .select('id, party_name, amount, reference_no, invoice_no, duty_shift, status, company_id, expense_account_id, party_account_id, jv_voucher_id')
        .like('reference_no', 'RMO-DUTY-%')
        .neq('status', 'REJECTED')
        .eq('is_paid', false);
      // A duty whose company was never resolved belongs to no page at all, so
      // it is shown alongside this company's — approving it is what finally
      // stamps the company, taken from the RMO's own ledger.
      if (fixedCompany) query = query.or(`company_id.eq.${companyId},company_id.is.null`);
      const { data, error } = await query.order('reference_no');
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

  // RMO-DUTY-2026-08-09 and the Javed roster's RMO-DUTY-JAVED-2026-08-09 both
  // reduce to the duty date.
  const dutyDate = (bill: DutyBill) => (bill.reference_no || '').replace(/^RMO-DUTY-(JAVED-)?/, '');

  // Approve a pending duty: post the JV so it becomes payable. The company and
  // expense head are resolved from the RMO's own ledger, exactly as the tile
  // resolves them when the duty is recorded, so a bill that arrived without
  // them is repaired rather than sent back to Accounting → Approvals.
  const approveDuty = async (bill: DutyBill) => {
    if (!bill.party_account_id) {
      toast.error(`${bill.party_name} has no ledger — map it on the RMO master before approving.`);
      return;
    }
    setApprovingId(bill.id);
    try {
      if (!bill.company_id || !bill.expense_account_id) {
        const posting = await resolveRmoDutyPosting(bill.party_account_id);
        if (!posting) {
          toast.error(
            `${bill.party_name}'s ledger has no company, or that company has no "${RMO_DUTY_EXPENSE_LEDGER}" head. Fix it in the chart of accounts, then approve.`,
          );
          return;
        }
        await updateApprovalDetails(bill.id, {
          amount: Number(bill.amount),
          companyId: posting.companyId,
          expenseAccountId: posting.expenseAccountId,
          partyAccountId: bill.party_account_id,
        });
      }
      const { voucherNumber } = await approveAndPostJV(bill.id);
      toast.success(`${bill.party_name}: JV ${voucherNumber} posted — the duty can now be paid.`);
      queryClient.invalidateQueries({ queryKey: ['rmo-duty-payments'] });
    } catch (error: any) {
      toast.error(error?.message || 'Could not approve this duty');
    } finally {
      setApprovingId(null);
    }
  };

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
        <CardContent className={`grid gap-4 pt-6 ${fixedCompany ? '' : 'md:grid-cols-2'}`}>
          {!fixedCompany && (
            <div className="space-y-2">
              <Label>Company (must match the invoices' books)</Label>
              <Select value={companyId} onValueChange={(v) => { setPickedCompanyId(v); setBankId(''); }}>
                <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>
                  {companies.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.company_name || c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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
                  <div className="space-y-1 pt-1">
                    <p className="text-xs font-semibold text-amber-700">
                      {group.pending.length} dut{group.pending.length === 1 ? 'y' : 'ies'} not approved yet —
                      approve to post the JV, then it can be paid above.
                    </p>
                    {group.pending.map((bill) => (
                      <div
                        key={bill.id}
                        className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50/60 px-2 py-1.5 text-sm"
                      >
                        <span className="text-muted-foreground">{dutyDate(bill)}</span>
                        <span className="capitalize text-muted-foreground">{bill.duty_shift || ''}</span>
                        <span className="ml-auto font-mono">₹{Number(bill.amount).toLocaleString('en-IN')}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={approvingId === bill.id}
                          onClick={() => void approveDuty(bill)}
                        >
                          {approvingId === bill.id ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                          )}
                          Approve
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
