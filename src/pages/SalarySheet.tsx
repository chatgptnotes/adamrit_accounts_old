import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, IndianRupee, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { fetchActiveAccounts } from '@/lib/fetchAccounts';
import { useAuth } from '@/contexts/AuthContext';
import { useCompanies } from '@/hooks/useCompanies';
import { useAccountingCashBankLedgers } from '@/hooks/usePaymentObligations';
import {
  approveAndPostJV,
  createApproval,
  postPaymentVoucher,
} from '@/lib/approval-queue-service';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// The salary sheet, run like the Daily Revenue Report's RM cuts: every staff
// member with a payroll slip for the month, the ledger and beneficiary bank
// they are paid through, one Approve that raises and posts the salary JVs,
// and a Pay button per person that posts the payment voucher.
//
// Salary math itself lives in the HR module (hr_payroll_slips); this page
// never recomputes it — it pays what HR verified.

interface PayrollRow {
  id: string;
  employee_name: string;
  payroll_month: string;
  gross_salary: number | null;
  deductions: number | null;
  net_salary: number | null;
}

interface LedgerLite {
  id: string;
  account_name: string;
  account_group: string | null;
  beneficiary_of_bank_account_id: string | null;
}

interface ApprovalLite {
  id: string;
  party_name: string;
  status: string;
  is_paid: boolean;
}

const normalize = (v: string | null | undefined) => (v || '').toLowerCase().replace(/[^a-z]/g, '');
const money = (v: number | null | undefined) =>
  v == null ? '—' : `₹ ${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

const EXPENSE_LEDGER_KEY = 'salary_sheet_expense_ledger';

const SalarySheet = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7)); // yyyy-mm
  const [companyId, setCompanyId] = useState('');
  const [defaultBankId, setDefaultBankId] = useState('');
  const [expenseLedgerId, setExpenseLedgerId] = useState(
    () => localStorage.getItem(EXPENSE_LEDGER_KEY) || '',
  );
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [approvingSheet, setApprovingSheet] = useState(false);

  const reference = `SALARY-${month}`;

  const { data: companies = [] } = useCompanies();
  const { data: bankLedgers = [] } = useAccountingCashBankLedgers(companyId || null);

  // Upper bound is the 1st of the NEXT month — "yyyy-mm-31" is an invalid
  // date literal in February and the query would error out.
  const nextMonthFirst = (() => {
    const [y, m] = month.split('-').map(Number);
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  })();

  const { data: slips = [], isLoading } = useQuery({
    queryKey: ['salary-sheet-slips', month],
    queryFn: async (): Promise<PayrollRow[]> => {
      const { data, error } = await (supabase as any)
        .from('hr_payroll_slips')
        .select('id, employee_name, payroll_month, gross_salary, deductions, net_salary')
        .gte('payroll_month', `${month}-01`)
        .lt('payroll_month', nextMonthFirst)
        .order('employee_name');
      if (error) throw error;
      return data || [];
    },
  });

  // Every active ledger once — employee rows match on the name, exactly the
  // way the Trial Balance merges ledgers. fetchActiveAccounts pages in a
  // stable order; a hand-rolled unordered .range() loop can skip or repeat
  // rows between pages.
  const { data: ledgers = [] } = useQuery({
    queryKey: ['salary-sheet-ledgers'],
    staleTime: 5 * 60_000,
    queryFn: () =>
      fetchActiveAccounts<LedgerLite>({
        columns: 'id, account_name, account_group, beneficiary_of_bank_account_id',
      }),
  });

  // Scoped to the selected company: the SALARY-<month> reference repeats
  // across companies, and reading it globally showed Company A's paid sheet
  // as Company B's. REJECTED rows are excluded so a rejected approval reads
  // as "not raised" and a fresh one can be created.
  const { data: approvals = [] } = useQuery({
    queryKey: ['salary-sheet-approvals', reference, companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<ApprovalLite[]> => {
      const { data, error } = await (supabase as any)
        .from('approval_queue')
        .select('id, party_name, status, is_paid')
        .eq('reference_no', reference)
        .eq('company_id', companyId)
        .eq('category', 'SALARY')
        .neq('status', 'REJECTED');
      if (error) throw error;
      return data || [];
    },
  });

  // Names are not identifiers: several employees (or a vendor ledger) can
  // normalize to the same string. A name that maps to more than one ledger,
  // or a slip name shared by more than one slip, is AMBIGUOUS and is never
  // auto-matched — paying the wrong ledger is worse than not paying.
  const ledgersByName = useMemo(() => {
    const map = new Map<string, LedgerLite[]>();
    for (const l of ledgers) {
      const key = normalize(l.account_name);
      if (!key) continue;
      map.set(key, [...(map.get(key) || []), l]);
    }
    return map;
  }, [ledgers]);

  const slipNameCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of slips) {
      const key = normalize(s.employee_name);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [slips]);

  const ledgerById = useMemo(() => new Map(ledgers.map((l) => [l.id, l])), [ledgers]);
  const approvalByName = useMemo(
    () => new Map(approvals.map((a) => [normalize(a.party_name), a])),
    [approvals],
  );

  const expenseOptions = useMemo(
    () =>
      ledgers
        .filter(
          (l) =>
            l.account_name.toLowerCase().includes('salary') ||
            (l.account_group || '').toLowerCase().includes('salary'),
        )
        .sort((a, b) => a.account_name.localeCompare(b.account_name)),
    [ledgers],
  );

  const rows = useMemo(
    () =>
      slips.map((slip) => {
        const key = normalize(slip.employee_name);
        const candidates = ledgersByName.get(key) || [];
        const duplicateName = (slipNameCounts.get(key) || 0) > 1;
        const ambiguous = duplicateName || candidates.length > 1;
        const ledger = !ambiguous && candidates.length === 1 ? candidates[0] : null;
        const beneficiaryBank = ledger?.beneficiary_of_bank_account_id
          ? ledgerById.get(ledger.beneficiary_of_bank_account_id) || null
          : null;
        const approval = ambiguous ? null : approvalByName.get(key) || null;
        return { slip, ledger, beneficiaryBank, approval, ambiguous, duplicateName };
      }),
    [slips, ledgersByName, slipNameCounts, ledgerById, approvalByName],
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['salary-sheet-approvals', reference] });

  const pickExpenseLedger = (id: string) => {
    setExpenseLedgerId(id);
    localStorage.setItem(EXPENSE_LEDGER_KEY, id);
  };

  const requireSetup = (): boolean => {
    if (!companyId) {
      toast.error('Select the company the salaries are paid from');
      return false;
    }
    if (!expenseLedgerId) {
      toast.error('Select the salary expense ledger');
      return false;
    }
    return true;
  };

  /**
   * Raise + post the JV for one slip, reusing an existing approval.
   *
   * The screen's cached approval list is never trusted for the "does one
   * already exist" decision — a stale cache here posts a second salary JV.
   * The database is re-read immediately before creating, and the partial
   * unique index on (reference_no, party_name) backstops the remaining
   * race window: a 23505 means someone else just created it, so re-read
   * and use theirs.
   */
  const ensureApproved = async (row: (typeof rows)[number]): Promise<string> => {
    if (row.ambiguous) {
      throw new Error(
        `${row.slip.employee_name}: more than one ledger or employee shares this name — settle it from the Approvals queue instead`,
      );
    }
    const findExisting = async (): Promise<ApprovalLite | null> => {
      const { data, error } = await (supabase as any)
        .from('approval_queue')
        .select('id, party_name, status, is_paid')
        .eq('reference_no', reference)
        .eq('company_id', companyId)
        .eq('category', 'SALARY')
        .ilike('party_name', row.slip.employee_name.trim())
        .neq('status', 'REJECTED')
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    };

    let approval = await findExisting();
    if (!approval) {
      if (!row.ledger) throw new Error(`${row.slip.employee_name} has no ledger in the chart of accounts`);
      const amount = Number(row.slip.net_salary) || 0;
      if (amount <= 0) throw new Error(`${row.slip.employee_name} has no net salary for ${month}`);
      try {
        approval = await createApproval({
          companyId,
          category: 'SALARY',
          partyName: row.slip.employee_name,
          amount,
          expenseAccountId: expenseLedgerId,
          partyAccountId: row.ledger.id,
          referenceNo: reference,
          narration: `Salary for ${month}`,
          createdBy: user?.email || undefined,
        });
      } catch (err: any) {
        // Unique-index refusal: created concurrently by another user/tab.
        if (String(err?.message || '').includes('duplicate') || err?.code === '23505') {
          approval = await findExisting();
        }
        if (!approval) throw err;
      }
    }
    if (approval.status === 'PENDING') {
      await approveAndPostJV(approval.id, user?.email || undefined);
    }
    return approval.id;
  };

  const approveSheet = async () => {
    if (!requireSetup()) return;
    setApprovingSheet(true);
    try {
      let posted = 0;
      const skipped: string[] = [];
      for (const row of rows) {
        if (row.approval && row.approval.status !== 'PENDING') continue;
        if (row.ambiguous || !row.ledger || !(Number(row.slip.net_salary) > 0)) {
          skipped.push(row.slip.employee_name);
          continue;
        }
        await ensureApproved(row);
        posted += 1;
      }
      toast.success(
        `Salary sheet approved — ${posted} JV(s) posted` +
          (skipped.length ? `; skipped: ${skipped.join(', ')}` : ''),
      );
      refresh();
    } catch (error: any) {
      toast.error(error?.message || 'Could not approve the sheet');
      refresh();
    } finally {
      setApprovingSheet(false);
    }
  };

  const payRow = async (row: (typeof rows)[number]) => {
    if (!requireSetup()) return;
    // Pay from the bank where the employee is a beneficiary — but only when
    // that bank ledger belongs to the selected company's cash/bank list, or
    // the voucher would credit another company's bank. Otherwise fall back
    // to the page-level default.
    const beneficiaryOk =
      row.beneficiaryBank && bankLedgers.some((l: any) => l.id === row.beneficiaryBank!.id);
    if (row.beneficiaryBank && !beneficiaryOk) {
      toast.warning(
        `${row.beneficiaryBank.account_name} is not a bank of the selected company — using the default bank`,
      );
    }
    const bankId = beneficiaryOk ? row.beneficiaryBank!.id : defaultBankId;
    if (!bankId) {
      toast.error('No beneficiary bank on the ledger and no default bank selected');
      return;
    }
    setBusyRow(row.slip.id);
    try {
      const approvalId = await ensureApproved(row);
      const payment = await postPaymentVoucher(approvalId, {
        cashBankAccountId: bankId,
        date: new Date().toISOString().slice(0, 10),
      });
      toast.success(`${row.slip.employee_name} paid — voucher ${payment.voucherNumber}`);
      refresh();
    } catch (error: any) {
      toast.error(error?.message || `Could not pay ${row.slip.employee_name}`);
      refresh();
    } finally {
      setBusyRow(null);
    }
  };

  const totals = rows.reduce(
    (acc, row) => ({
      gross: acc.gross + (Number(row.slip.gross_salary) || 0),
      net: acc.net + (Number(row.slip.net_salary) || 0),
      paid: acc.paid + (row.approval?.is_paid ? Number(row.slip.net_salary) || 0 : 0),
    }),
    { gross: 0, net: 0, paid: 0 },
  );

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Banknote className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Salary Sheet</h1>
            <p className="text-sm text-muted-foreground">
              Slips from the HR module — approve to post the JVs, then pay each person from the
              bank that holds them as a beneficiary.
            </p>
          </div>
        </div>
        <Button onClick={() => void approveSheet()} disabled={approvingSheet || isLoading}>
          {approvingSheet ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <IndianRupee className="mr-2 h-4 w-4" />}
          Approve sheet &amp; post JVs
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-4">
          <div className="space-y-2">
            <Label>Month</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Company</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
              <SelectContent>
                {companies.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.company_name || c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Salary expense ledger</Label>
            <Select value={expenseLedgerId} onValueChange={pickExpenseLedger}>
              <SelectTrigger><SelectValue placeholder="Select expense ledger" /></SelectTrigger>
              <SelectContent>
                {expenseOptions.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.account_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Default bank (when no beneficiary bank)</Label>
            <Select value={defaultBankId} onValueChange={setDefaultBankId}>
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            {rows.length} staff · Gross {money(totals.gross)} · Net {money(totals.net)} · Paid {money(totals.paid)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading payroll slips…</p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No payroll slips for {month}. Generate them in the HR module first.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Ledger</TableHead>
                    <TableHead>Beneficiary bank</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const paid = !!row.approval?.is_paid;
                    const approved = row.approval && row.approval.status !== 'PENDING';
                    return (
                      <TableRow key={row.slip.id}>
                        <TableCell className="font-medium">{row.slip.employee_name}</TableCell>
                        <TableCell className="text-right">{money(row.slip.gross_salary)}</TableCell>
                        <TableCell className="text-right">{money(row.slip.deductions)}</TableCell>
                        <TableCell className="text-right font-semibold">{money(row.slip.net_salary)}</TableCell>
                        <TableCell>
                          {row.ambiguous ? (
                            <span className="text-xs font-semibold text-amber-700">
                              {row.duplicateName
                                ? 'Name shared by more than one employee — settle from Approvals'
                                : 'More than one ledger matches this name — settle from Approvals'}
                            </span>
                          ) : row.ledger ? (
                            row.ledger.account_name
                          ) : (
                            <span className="text-xs font-semibold text-amber-700">
                              No ledger — create one with this name
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.beneficiaryBank ? (
                            <span className="text-emerald-700">{row.beneficiaryBank.account_name}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not mapped</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {paid ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Paid</span>
                          ) : approved ? (
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">JV posted</span>
                          ) : row.approval ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Awaiting approval</span>
                          ) : (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">Not raised</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            disabled={paid || busyRow === row.slip.id || row.ambiguous || !row.ledger || !(Number(row.slip.net_salary) > 0)}
                            onClick={() => void payRow(row)}
                          >
                            {busyRow === row.slip.id ? <Loader2 className="h-4 w-4 animate-spin" /> : paid ? 'Paid' : 'Pay'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SalarySheet;
