import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, FileText, PenLine, X } from 'lucide-react';
import { usePaymentObligations, useAccountingLedgerSearch, type PaymentObligation } from '@/hooks/usePaymentObligations';
import { useCompanies } from '@/hooks/useCompanies';
import { isDailyAllocationExecution } from '@/hooks/useDailyPaymentAllocation';
import { useMonthlyPaidTotals, useMonthlyObligationJvs, createMonthlyJvs, type CreateJvsResult } from '@/hooks/useMonthlyObligation';
import { formatINR, OBLIGATION_SECTIONS, getSectionForObligation } from '@/pages/DailyPaymentAllocation';
import { useAuth } from '@/contexts/AuthContext';

const currentMonth = () => new Date().toISOString().slice(0, 7);

const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

export const MonthlyObligationTab: React.FC<{ hospital: string }> = ({ hospital }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const { obligations, updateObligation } = usePaymentObligations(hospital);
  const { data: companies = [] } = useCompanies();
  const { data: paidTotals } = useMonthlyPaidTotals(hospital, month);
  const { data: jvsByObligation } = useMonthlyObligationJvs(hospital, month);

  // Inline monthly-amount editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');

  // Expense-ledger picker (Pay-dialog search pattern)
  const [ledgerPickerId, setLedgerPickerId] = useState<string | null>(null);
  const [ledgerCompanyId, setLedgerCompanyId] = useState('');
  const [ledgerSearch, setLedgerSearch] = useState('');
  const { data: ledgerResults = [] } = useAccountingLedgerSearch(ledgerSearch, ledgerCompanyId);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const visible = useMemo(
    () => obligations.filter(o => o.is_active !== false && !isDailyAllocationExecution(o.notes)),
    [obligations],
  );

  // Names for the expense ledgers already saved on obligations
  const expenseAccountIds = useMemo(
    () => [...new Set(visible.map(o => o.expense_account_id).filter(Boolean))] as string[],
    [visible],
  );
  const { data: expenseAccountNames } = useQuery({
    queryKey: ['expense-account-names', expenseAccountIds.join(',')],
    queryFn: async () => {
      if (expenseAccountIds.length === 0) return new Map<string, string>();
      const { data, error } = await (supabase as any)
        .from('chart_of_accounts')
        .select('id, account_name')
        .in('id', expenseAccountIds);
      if (error) throw error;
      return new Map<string, string>((data || []).map((r: any) => [r.id, r.account_name]));
    },
    enabled: expenseAccountIds.length > 0,
  });

  const companyNameMap = useMemo(() => new Map(companies.map(c => [c.id, c.company_name])), [companies]);

  const sections = useMemo(
    () => OBLIGATION_SECTIONS
      .map(s => ({ ...s, items: visible.filter(o => getSectionForObligation(o) === s.key) }))
      .filter(s => s.items.length > 0),
    [visible],
  );

  const paidFor = (id: string) => paidTotals?.get(id) || 0;
  const jvFor = (id: string) => jvsByObligation?.get(id);

  const totals = useMemo(() => {
    let monthly = 0, paid = 0;
    for (const o of visible) {
      monthly += Number(o.monthly_amount || 0);
      paid += paidFor(o.id);
    }
    return { monthly, paid, remaining: monthly - paid };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, paidTotals]);

  // JV-creation preview for the confirm dialog
  const pendingParties = useMemo(
    () => visible.filter(o => Number(o.monthly_amount || 0) > 0 && !jvFor(o.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, jvsByObligation],
  );
  const eligible = pendingParties.filter(o => o.company_id && o.expense_account_id && o.chart_of_accounts_id);
  const notReady = pendingParties.filter(o => !o.company_id || !o.expense_account_id || !o.chart_of_accounts_id);
  const eligibleTotal = eligible.reduce((s, o) => s + Number(o.monthly_amount || 0), 0);

  const saveAmount = (ob: PaymentObligation) => {
    const amount = parseFloat(editAmount);
    if (isNaN(amount) || amount < 0) { toast.error('Enter a valid monthly amount'); setEditingId(null); return; }
    if (amount !== Number(ob.monthly_amount || 0)) {
      updateObligation.mutate({ id: ob.id, monthly_amount: amount });
    }
    setEditingId(null);
  };

  const openLedgerPicker = (ob: PaymentObligation) => {
    setLedgerPickerId(ob.id);
    setLedgerCompanyId(ob.company_id || '');
    setLedgerSearch('');
  };

  const pickExpenseLedger = (ob: PaymentObligation, ledger: { id: string; company_id: string | null }) => {
    updateObligation.mutate({
      id: ob.id,
      expense_account_id: ledger.id,
      company_id: ledger.company_id || ledgerCompanyId || ob.company_id,
    });
    setLedgerPickerId(null);
    setLedgerSearch('');
  };

  const runCreateJvs = async () => {
    setCreating(true);
    try {
      const result: CreateJvsResult = await createMonthlyJvs(eligible, month, hospital, user?.username || 'admin');
      if (result.created.length > 0) toast.success(`${result.created.length} JV(s) created for ${monthLabel(month)}`);
      for (const s of result.skipped) toast.info(`${s.party}: ${s.reason}`);
      for (const f of result.failed) toast.error(`${f.party}: ${f.error}`);
      if (result.created.length === 0 && result.failed.length === 0 && result.skipped.length === 0) {
        toast.info('Nothing to create');
      }
    } finally {
      setCreating(false);
      setConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['monthly-obligation-jvs', hospital, month] });
    }
  };

  return (
    <Card className="p-4">
      {/* Header: month selector + Create JVs */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonth(m => shiftMonth(m, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="h-8 w-44 text-sm"
          />
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setMonth(m => shiftMonth(m, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 font-semibold">{monthLabel(month)}</span>
        </div>
        <Button
          className="bg-purple-600 hover:bg-purple-700"
          disabled={pendingParties.length === 0}
          onClick={() => setConfirmOpen(true)}
        >
          <FileText className="h-4 w-4 mr-2" />
          Create JVs ({eligible.length})
        </Button>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Each JV books the month's obligation as Dr Expense / Cr Party. Daily payments made in
        Today's Allocation reduce the Remaining balance below.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Party</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Expense Ledger (Dr)</TableHead>
            <TableHead className="text-right">Monthly Amount</TableHead>
            <TableHead className="text-right">Paid This Month</TableHead>
            <TableHead className="text-right">Remaining</TableHead>
            <TableHead>JV</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sections.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                No active obligations for {hospital}.
              </TableCell>
            </TableRow>
          )}
          {sections.map(section => {
            const sectionMonthly = section.items.reduce((s, o) => s + Number(o.monthly_amount || 0), 0);
            const sectionPaid = section.items.reduce((s, o) => s + paidFor(o.id), 0);
            return (
              <React.Fragment key={section.key}>
                <TableRow className="bg-blue-50/60 hover:bg-blue-50/60">
                  <TableCell colSpan={3} className="font-semibold text-blue-900">{section.title}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatINR(sectionMonthly)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold text-green-700">{formatINR(sectionPaid)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatINR(sectionMonthly - sectionPaid)}</TableCell>
                  <TableCell />
                </TableRow>
                {section.items.map(ob => {
                  const monthly = Number(ob.monthly_amount || 0);
                  const paid = paidFor(ob.id);
                  const remaining = monthly - paid;
                  const jv = jvFor(ob.id);
                  return (
                    <TableRow key={ob.id}>
                      <TableCell className="font-medium">{ob.party_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {ob.company_id ? companyNameMap.get(ob.company_id) || '—' : '—'}
                      </TableCell>
                      <TableCell>
                        {ledgerPickerId === ob.id ? (
                          <div className="relative w-64 space-y-1">
                            <div className="flex items-center gap-1">
                              <Select
                                value={ledgerCompanyId}
                                onValueChange={(v) => { setLedgerCompanyId(v); setLedgerSearch(''); }}
                              >
                                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Company" /></SelectTrigger>
                                <SelectContent>
                                  {companies.map(c => (
                                    <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setLedgerPickerId(null)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                            <Input
                              value={ledgerSearch}
                              onChange={(e) => setLedgerSearch(e.target.value)}
                              placeholder="Search expense ledger"
                              className="h-7 text-xs"
                              disabled={!ledgerCompanyId}
                              autoFocus
                            />
                            {ledgerSearch.length >= 1 && ledgerResults.length > 0 && (
                              <div className="absolute left-0 right-0 z-50 max-h-44 overflow-y-auto rounded-md border bg-white shadow-lg">
                                {ledgerResults.map((ledger) => (
                                  <button
                                    key={ledger.id}
                                    type="button"
                                    className="block w-full px-3 py-2 text-left text-xs hover:bg-blue-50"
                                    onClick={() => pickExpenseLedger(ob, ledger)}
                                  >
                                    <span className="font-medium">{ledger.account_name}</span>
                                    <span className="ml-2 text-muted-foreground">{ledger.account_group || ledger.account_type || ''}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="text-sm text-left hover:underline"
                            onClick={() => openLedgerPicker(ob)}
                          >
                            {ob.expense_account_id
                              ? expenseAccountNames?.get(ob.expense_account_id) || 'Ledger selected'
                              : <span className="text-amber-600">Select expense ledger</span>}
                            <PenLine className="inline h-3 w-3 ml-1 text-muted-foreground" />
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {editingId === ob.id ? (
                          <Input
                            type="number"
                            value={editAmount}
                            onChange={(e) => setEditAmount(e.target.value)}
                            onBlur={() => saveAmount(ob)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveAmount(ob); if (e.key === 'Escape') setEditingId(null); }}
                            className="h-7 w-28 text-right font-mono text-sm ml-auto"
                            autoFocus
                          />
                        ) : (
                          <button
                            type="button"
                            className="font-mono hover:underline"
                            onClick={() => { setEditingId(ob.id); setEditAmount(String(monthly || '')); }}
                          >
                            {formatINR(monthly)}
                            <PenLine className="inline h-3 w-3 ml-1 text-muted-foreground" />
                          </button>
                        )}
                        {jv && Math.abs(jv.amount - monthly) > 0.005 && (
                          <div className="text-[10px] text-amber-600">JV posted for {formatINR(jv.amount)}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-green-700">{formatINR(paid)}</TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${remaining < 0 ? 'text-red-600' : ''}`}>
                        {formatINR(remaining)}
                      </TableCell>
                      <TableCell>
                        {jv ? (
                          <Badge className="bg-purple-100 text-purple-800">
                            {jv.vouchers?.voucher_number || 'JV posted'}
                          </Badge>
                        ) : monthly > 0 ? (
                          <Badge variant="outline" className="text-muted-foreground">Pending</Badge>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </React.Fragment>
            );
          })}
          {sections.length > 0 && (
            <TableRow className="bg-gray-100 hover:bg-gray-100">
              <TableCell colSpan={3} className="font-bold">Total</TableCell>
              <TableCell className="text-right font-mono font-bold">{formatINR(totals.monthly)}</TableCell>
              <TableCell className="text-right font-mono font-bold text-green-700">{formatINR(totals.paid)}</TableCell>
              <TableCell className={`text-right font-mono font-bold ${totals.remaining < 0 ? 'text-red-600' : ''}`}>
                {formatINR(totals.remaining)}
              </TableCell>
              <TableCell />
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Create JVs confirmation */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-purple-600" />
              Create JVs — {monthLabel(month)}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {eligible.length > 0 ? (
              <>
                <p>
                  One Journal Voucher per party (Dr Expense / Cr Party) will be posted for{' '}
                  <strong>{eligible.length}</strong> part{eligible.length === 1 ? 'y' : 'ies'} —{' '}
                  <strong>{formatINR(eligibleTotal)}</strong> total:
                </p>
                <div className="max-h-40 overflow-y-auto rounded border divide-y">
                  {eligible.map(o => (
                    <div key={o.id} className="flex justify-between px-3 py-1.5">
                      <span>{o.party_name}</span>
                      <span className="font-mono">{formatINR(Number(o.monthly_amount || 0))}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">No parties are ready for JV creation.</p>
            )}
            {notReady.length > 0 && (
              <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                <p className="font-semibold mb-1">Will be skipped (missing setup):</p>
                {notReady.map(o => (
                  <div key={o.id}>
                    {o.party_name} — {!o.company_id ? 'no company' : !o.expense_account_id ? 'no expense ledger' : 'no party ledger'}
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              className="bg-purple-600 hover:bg-purple-700"
              disabled={creating || eligible.length === 0}
              onClick={runCreateJvs}
            >
              {creating ? 'Posting…' : `Post ${eligible.length} JV(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
