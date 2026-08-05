import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { Banknote, Download, IndianRupee, Loader2, Pencil, Plus, Upload } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { BeneficiaryBankHint } from '@/components/BeneficiaryBankHint';

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
  designation: string | null;
  days_present: number | null;
  duty_count: number | null;
  base_monthly_salary: number | null;
  entry_source: string | null;
}

/** The add/edit dialog's field set — everything the desk types by hand.
 *  The name is never free-typed: it is picked from the ledger search, and
 *  ledgerId records the pick so the beneficiary bank can be shown. */
interface SlipDraft {
  id: string | null;
  employee_name: string;
  /** The picked chart_of_accounts ledger; null until a pick is made. */
  ledgerId: string | null;
  /** What the row was called before editing — amounts-only edits keep it. */
  originalName: string;
  designation: string;
  base_monthly_salary: string;
  days_present: string;
  duty_count: string;
  gross_salary: string;
  deductions: string;
  net_salary: string;
}

const EMPTY_DRAFT: SlipDraft = {
  id: null,
  employee_name: '',
  ledgerId: null,
  originalName: '',
  designation: '',
  base_monthly_salary: '',
  days_present: '',
  duty_count: '',
  gross_salary: '',
  deductions: '',
  net_salary: '',
};

interface LedgerLite {
  id: string;
  account_code: string | null;
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
const COMPANY_KEY = 'salary_sheet_company_id';

/** The upload format, exactly as the downloadable template writes it. */
const TEMPLATE_HEADERS = [
  'Employee Name',
  'Employee ID',
  'Designation',
  'Monthly Salary',
  'Days Present',
  'Duties',
  'Gross Salary',
  'Deductions',
  'Net Salary',
] as const;

/** "Days  Present" / "days_present" / "DAYS PRESENT" all read the same. */
const normalizeHeader = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

const SalarySheet = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7)); // yyyy-mm
  const [companyId, setCompanyId] = useState(() => localStorage.getItem(COMPANY_KEY) || '');
  const [defaultBankId, setDefaultBankId] = useState('');
  const [expenseLedgerId, setExpenseLedgerId] = useState(
    () => localStorage.getItem(EXPENSE_LEDGER_KEY) || '',
  );
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [approvingSheet, setApprovingSheet] = useState(false);
  // Background JV posting progress — the sheet stays usable while it runs.
  const [postProgress, setPostProgress] = useState<{ done: number; total: number } | null>(null);
  // Manual row entry/edit — HRPulse import fills most rows, but staff off the
  // portal (and corrections) are typed one row at a time.
  const [draft, setDraft] = useState<SlipDraft | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [ledgerSearch, setLedgerSearch] = useState('');

  const reference = `SALARY-${month}`;

  const { data: companies = [] } = useCompanies();
  const { data: bankLedgers = [] } = useAccountingCashBankLedgers(companyId || null);

  // Keep the salary sheet scoped to a real company by default. The ledger
  // search, bank list, and approval queries are company-bound, so starting
  // with an empty company makes the page look broken even though the slip
  // data itself is available.
  useEffect(() => {
    if (!companies.length) return;

    const savedCompany = companies.find((company) => company.id === companyId) || null;
    if (savedCompany) return;

    const nextCompany = companies[0];
    setCompanyId(nextCompany.id);
    localStorage.setItem(COMPANY_KEY, nextCompany.id);
  }, [companies, companyId]);

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
        .select(
          'id, employee_name, payroll_month, gross_salary, deductions, net_salary, designation, days_present, duty_count, base_monthly_salary, entry_source',
        )
        .gte('payroll_month', `${month}-01`)
        .lt('payroll_month', nextMonthFirst)
        .order('employee_name');
      if (error) throw error;
      return data || [];
    },
  });

  // The SELECTED COMPANY's ledgers (plus the shared ones) — the JV posts into
  // this company's books, so only its chart is offered. Fetching every
  // company's chart showed each ledger once per company in the pickers, and
  // the duplicate-name guard then flagged every staffer as ambiguous.
  // fetchActiveAccounts pages in a stable order past the 1000-row cap.
  const { data: ledgers = [] } = useQuery({
    queryKey: ['salary-sheet-ledgers', companyId],
    enabled: !!companyId,
    staleTime: 5 * 60_000,
    queryFn: () =>
      fetchActiveAccounts<LedgerLite>({
        columns: 'id, account_code, account_name, account_group, beneficiary_of_bank_account_id',
        companyId,
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

  const pickCompany = (id: string) => {
    setCompanyId(id);
    localStorage.setItem(COMPANY_KEY, id);
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

  /**
   * Approve whatever is new and post its JVs, in the background.
   *
   * Meant to be clicked repeatedly through the day — rows added since the
   * last click are the only ones touched, because rows that already carry a
   * JV are skipped (and ensureApproved re-checks the database besides). The
   * sheet stays fully usable while posting runs; the button shows progress.
   */
  const approveSheet = async () => {
    if (!requireSetup()) return;
    const eligible = rows.filter(
      (row) =>
        !(row.approval && row.approval.status !== 'PENDING') &&
        !row.ambiguous &&
        row.ledger &&
        Number(row.slip.net_salary) > 0,
    );
    const skipped = rows
      .filter(
        (row) =>
          !(row.approval && row.approval.status !== 'PENDING') &&
          (row.ambiguous || !row.ledger || !(Number(row.slip.net_salary) > 0)),
      )
      .map((row) => row.slip.employee_name);

    if (!eligible.length) {
      toast.info(
        'Nothing new to approve — every eligible row already has its JV' +
          (skipped.length ? `; needs attention: ${skipped.join(', ')}` : ''),
      );
      return;
    }

    setApprovingSheet(true);
    setPostProgress({ done: 0, total: eligible.length });
    toast.info(`Posting ${eligible.length} JV(s) in the background — you can keep working.`);
    try {
      let posted = 0;
      const failed: string[] = [];
      for (const row of eligible) {
        try {
          await ensureApproved(row);
          posted += 1;
        } catch (error: any) {
          failed.push(`${row.slip.employee_name} (${error?.message || 'failed'})`);
        }
        setPostProgress({ done: posted + failed.length, total: eligible.length });
      }
      if (failed.length) {
        toast.error(`${posted} JV(s) posted; failed: ${failed.join('; ')}`);
      } else {
        toast.success(
          `${posted} JV(s) posted` +
            (skipped.length ? `; needs attention: ${skipped.join(', ')}` : ''),
        );
      }
      refresh();
    } finally {
      setApprovingSheet(false);
      setPostProgress(null);
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

  const openDraft = (slip?: PayrollRow) => {
    if (!slip) {
      setDraft({ ...EMPTY_DRAFT });
      setLedgerSearch('');
      return;
    }
    // Re-resolve the pick from the name so the edit dialog shows the same
    // ledger (and its beneficiary bank) the row is matched to.
    const candidates = ledgersByName.get(normalize(slip.employee_name)) || [];
    setDraft({
      id: slip.id,
      employee_name: slip.employee_name,
      ledgerId: candidates.length === 1 ? candidates[0].id : null,
      originalName: slip.employee_name,
      designation: slip.designation ?? '',
      base_monthly_salary: slip.base_monthly_salary != null ? String(slip.base_monthly_salary) : '',
      days_present: slip.days_present != null ? String(slip.days_present) : '',
      duty_count: slip.duty_count != null ? String(slip.duty_count) : '',
      gross_salary: slip.gross_salary != null ? String(slip.gross_salary) : '',
      deductions: slip.deductions != null ? String(slip.deductions) : '',
      net_salary: slip.net_salary != null ? String(slip.net_salary) : '',
    });
    setLedgerSearch('');
  };

  const saveDraft = async () => {
    if (!draft) return;
    const name = draft.employee_name.trim();
    if (!name) {
      toast.error('Search and pick the staff ledger first');
      return;
    }
    // The name comes from the ledger master, not the keyboard. The one
    // exception: editing only the amounts of an existing row whose name has
    // no ledger yet (e.g. an imported slip awaiting its ledger).
    if (!draft.ledgerId && name !== draft.originalName) {
      toast.error('Pick the ledger from the search list — names are not typed in by hand');
      return;
    }
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    if (!(Number(draft.net_salary) > 0)) {
      toast.error("Enter this month's salary (net payable)");
      return;
    }
    setSavingDraft(true);
    try {
      const fields = {
        employee_name: name,
        designation: draft.designation.trim() || null,
        base_monthly_salary: num(draft.base_monthly_salary),
        days_present: num(draft.days_present),
        duty_count: num(draft.duty_count),
        gross_salary: num(draft.gross_salary) ?? Number(draft.net_salary),
        deductions: num(draft.deductions) ?? 0,
        net_salary: Number(draft.net_salary),
      };
      if (draft.id) {
        const { error } = await (supabase as any)
          .from('hr_payroll_slips')
          .update(fields)
          .eq('id', draft.id);
        if (error) throw error;
        toast.success(`${name} updated`);
      } else {
        const { error } = await (supabase as any).from('hr_payroll_slips').insert({
          ...fields,
          payroll_month: `${month}-01`,
          entry_source: 'manual',
        });
        if (error) throw error;
        toast.success(`${name} added to the ${month} sheet`);
      }
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ['salary-sheet-slips', month] });
    } catch (error: any) {
      toast.error(error?.message || 'Could not save the row');
    } finally {
      setSavingDraft(false);
    }
  };

  // ---- Excel template + import ------------------------------------------
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [gsheetUrl, setGsheetUrl] = useState('');

  const downloadTemplate = () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      [...TEMPLATE_HEADERS],
      ['RAVI KUMAR', 'EMP-001', 'Staff Nurse', 25000, 26, 4, 26500, 500, 26000],
    ]);
    sheet['!cols'] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Salary Sheet');
    XLSX.writeFile(book, `salary-sheet-template-${month}.xlsx`);
  };

  /** Shared ingestion for the Excel upload and the Google Sheet link. */
  const ingestParsedRows = async (parsed: Record<string, unknown>[]) => {
      const existing = new Set(slips.map((s) => normalize(s.employee_name)));
      const records: any[] = [];
      let skippedExisting = 0;
      for (const raw of parsed) {
        const byKey = new Map<string, unknown>();
        Object.entries(raw).forEach(([k, v]) => byKey.set(normalizeHeader(k), v));
        const text = (k: string) => String(byKey.get(k) ?? '').trim();
        const amount = (k: string) => {
          const v = Number(String(byKey.get(k) ?? '').replace(/[₹, ]/g, ''));
          return Number.isFinite(v) ? v : null;
        };
        const name = text('employeename');
        if (!name) continue;
        if (existing.has(normalize(name))) {
          skippedExisting += 1;
          continue;
        }
        existing.add(normalize(name));
        records.push({
          employee_name: name,
          employee_id: text('employeeid') || null,
          designation: text('designation') || null,
          payroll_month: `${month}-01`,
          base_monthly_salary: amount('monthlysalary'),
          days_present: amount('dayspresent'),
          duty_count: amount('duties'),
          gross_salary: amount('grosssalary') ?? amount('netsalary') ?? 0,
          deductions: amount('deductions') ?? 0,
          net_salary: amount('netsalary') ?? 0,
          entry_source: 'import',
        });
      }
      if (!records.length) {
        toast.error(
          skippedExisting
            ? `Nothing new to import — ${skippedExisting} row(s) already on this month's sheet`
            : 'No rows with an Employee Name found. Download the template to see the format.',
        );
        return;
      }
      const { error } = await (supabase as any).from('hr_payroll_slips').insert(records);
      if (error) throw error;
      toast.success(
        `${records.length} row(s) imported to ${month}` +
          (skippedExisting ? ` — ${skippedExisting} already present, left untouched` : ''),
      );
      queryClient.invalidateQueries({ queryKey: ['salary-sheet-slips', month] });
  };

  const importExcel = async (file: File) => {
    setImporting(true);
    try {
      const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
      await ingestParsedRows(
        XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]]),
      );
    } catch (error: any) {
      toast.error(`Import failed: ${error?.message || 'unknown error'}`);
    } finally {
      setImporting(false);
    }
  };

  /**
   * Import straight from a pasted Google Sheet link. Works when the sheet is
   * shared "Anyone with the link" — Google then serves a CSV export the
   * browser is allowed to fetch. Same columns as the template.
   */
  const importGoogleSheet = async () => {
    const match = gsheetUrl.match(/\/d\/([A-Za-z0-9_-]{20,})/);
    if (!match) {
      toast.error('Paste the full Google Sheet link (…docs.google.com/spreadsheets/d/…)');
      return;
    }
    setImporting(true);
    try {
      const candidates = [
        `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`,
        `https://docs.google.com/spreadsheets/d/${match[1]}/gviz/tq?tqx=out:csv`,
      ];
      let csv: string | null = null;
      for (const url of candidates) {
        try {
          const response = await fetch(url);
          if (response.ok) {
            const text = await response.text();
            // A private sheet answers with an HTML sign-in page, not CSV.
            if (!text.trimStart().startsWith('<')) {
              csv = text;
              break;
            }
          }
        } catch {
          // Try the next URL shape.
        }
      }
      if (!csv) {
        throw new Error(
          'Could not read the sheet. In Google Sheets use Share → General access → "Anyone with the link", then paste the link again.',
        );
      }
      const workbook = XLSX.read(csv, { type: 'string' });
      await ingestParsedRows(
        XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]]),
      );
      setGsheetUrl('');
    } catch (error: any) {
      toast.error(`Google Sheet import failed: ${error?.message || 'unknown error'}`);
    } finally {
      setImporting(false);
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
              Rows come from the HRPulse sync, the Excel import, or Add staff row — approve to
              post the JVs, then pay each person from the bank that holds them as a beneficiary.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importExcel(f);
              e.target.value = '';
            }}
          />
          <Button variant="outline" onClick={downloadTemplate} title="Download the upload format with column headers">
            <Download className="mr-2 h-4 w-4" />
            Template
          </Button>
          <Button variant="outline" disabled={importing} onClick={() => importInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            {importing ? 'Importing…' : 'Import Excel'}
          </Button>
          <Button variant="outline" onClick={() => openDraft()}>
            <Plus className="mr-2 h-4 w-4" />
            Add staff row
          </Button>
          <Button onClick={() => void approveSheet()} disabled={approvingSheet || isLoading}>
            {approvingSheet ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <IndianRupee className="mr-2 h-4 w-4" />}
            {postProgress
              ? `Posting JVs… ${postProgress.done}/${postProgress.total}`
              : 'Approve new rows & post JVs'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
        <Label className="shrink-0 text-sm">Google Sheet:</Label>
        <Input
          value={gsheetUrl}
          onChange={(e) => setGsheetUrl(e.target.value)}
          placeholder="Paste the sheet link (shared as “Anyone with the link”) — same columns as the Template"
          className="h-8 min-w-[260px] flex-1 text-sm"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={importing || !gsheetUrl.trim()}
          onClick={() => void importGoogleSheet()}
        >
          {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          Import from link
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
            <Select value={companyId} onValueChange={pickCompany}>
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
              No rows for {month} yet — sync from HRPulse, import the Excel (download the
              Template for the format), or use Add staff row.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Designation</TableHead>
                    <TableHead className="text-right">Monthly salary</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead className="text-right">Duties</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">This month</TableHead>
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
                        <TableCell className="font-medium">
                          {row.slip.employee_name}
                          {row.slip.entry_source === 'manual' && (
                            <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">manual</span>
                          )}
                        </TableCell>
                        <TableCell>{row.slip.designation || '—'}</TableCell>
                        <TableCell className="text-right">{money(row.slip.base_monthly_salary)}</TableCell>
                        <TableCell className="text-right">{row.slip.days_present ?? '—'}</TableCell>
                        <TableCell className="text-right">{row.slip.duty_count ?? '—'}</TableCell>
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
                          ) : !companyId ? (
                            <span className="text-xs text-muted-foreground">Select company to match ledgers</span>
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
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              title={row.approval ? 'Figures are frozen once the JV is raised' : 'Edit this row'}
                              disabled={!!row.approval}
                              onClick={() => openDraft(row.slip)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              disabled={paid || busyRow === row.slip.id || row.ambiguous || !row.ledger || !(Number(row.slip.net_salary) > 0)}
                              onClick={() => void payRow(row)}
                            >
                              {busyRow === row.slip.id ? <Loader2 className="h-4 w-4 animate-spin" /> : paid ? 'Paid' : 'Pay'}
                            </Button>
                          </div>
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
      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? `Edit ${draft.employee_name}` : `Add staff to ${month}`}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label>Staff ledger (search the chart of accounts)</Label>
                <div className="relative">
                  <Input
                    value={ledgerSearch || draft.employee_name}
                    onChange={(e) => {
                      // Typing is searching — the name itself only ever comes
                      // from picking a ledger below.
                      setLedgerSearch(e.target.value);
                      if (draft.ledgerId || draft.employee_name) {
                        setDraft({ ...draft, employee_name: draft.originalName && draft.id ? draft.employee_name : '', ledgerId: null });
                      }
                    }}
                    placeholder="Search by ledger name or code…"
                  />
                  {ledgerSearch.trim().length >= 1 && (
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border bg-background shadow-lg">
                      {(() => {
                        const term = ledgerSearch.trim().toLowerCase();
                        const hits = ledgers
                          .filter(
                            (l) =>
                              l.account_name.toLowerCase().includes(term) ||
                              (l.account_code || '').toLowerCase().includes(term),
                          )
                          .slice(0, 8);
                        return hits.length === 0 ? (
                          <p className="px-3 py-2 text-sm text-muted-foreground">
                            {companyId
                              ? 'No ledger matches — create it on Ledger Creation first.'
                              : 'Select the company first — the ledger list is per company.'}
                          </p>
                        ) : (
                          hits.map((l) => (
                            <button
                              key={l.id}
                              type="button"
                              className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/60"
                              onPointerDown={(e) => {
                                e.preventDefault();
                                setDraft({ ...draft, employee_name: l.account_name, ledgerId: l.id });
                                setLedgerSearch('');
                              }}
                            >
                              <span className="font-medium">{l.account_name}</span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {[l.account_code, l.account_group].filter(Boolean).join(' · ')}
                              </span>
                            </button>
                          ))
                        );
                      })()}
                    </div>
                  )}
                </div>
                {draft.ledgerId ? (
                  <>
                    <p className="text-xs text-emerald-700">
                      Ledger picked
                      {(() => {
                        const l = ledgerById.get(draft.ledgerId);
                        return l?.account_code ? ` · code ${l.account_code}` : '';
                      })()}
                    </p>
                    <BeneficiaryBankHint accountId={draft.ledgerId} />
                  </>
                ) : draft.employee_name ? (
                  <p className="text-xs text-amber-700">
                    No ledger picked for “{draft.employee_name}” — search and pick one above.
                  </p>
                ) : null}
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Designation</Label>
                <Input
                  value={draft.designation}
                  onChange={(e) => setDraft({ ...draft, designation: e.target.value })}
                  placeholder="e.g. Staff Nurse, RMO, Ward Boy"
                />
              </div>
              {(
                [
                  ['Monthly salary (₹)', 'base_monthly_salary'],
                  ['Days attended', 'days_present'],
                  ['Duties done', 'duty_count'],
                  ['Gross salary (₹)', 'gross_salary'],
                  ['Deductions (₹)', 'deductions'],
                  ["This month's salary (₹)", 'net_salary'],
                ] as const
              ).map(([label, field]) => (
                <div key={field} className="space-y-1">
                  <Label>{label}</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={draft[field]}
                    onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                    placeholder="0"
                  />
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={savingDraft}>
              Cancel
            </Button>
            <Button onClick={() => void saveDraft()} disabled={savingDraft}>
              {savingDraft ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {draft?.id ? 'Save changes' : 'Add to sheet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SalarySheet;
