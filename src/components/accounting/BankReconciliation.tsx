import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchActiveAccounts } from '@/lib/fetchAccounts';
import { useAccountingCompany } from './AccountingCompanyContext';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { geminiFetch, geminiGenerateContentUrl, GEMINI_MODEL_LITE } from '@/lib/gemini';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import {
  Printer,
  Download,
  Loader2,
  AlertCircle,
  Check,
  X,
  Building2,
  Calendar,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { format } from 'date-fns';

// Type definitions
interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: 'Asset' | 'Liability' | 'Income' | 'Expense' | 'Equity';
  parent_account_id: string | null;
  account_group: string;
  is_active: boolean;
  opening_balance: number;
  opening_balance_type: 'Dr' | 'Cr';
  created_at: string;
  updated_at: string;
}

interface VoucherEntry {
  id: string;
  voucher_id: string;
  account_id: string;
  debit_amount: number;
  credit_amount: number;
  narration: string;
  entry_order: number;
  created_at: string;
}

interface Voucher {
  id: string;
  voucher_number: string;
  voucher_date: string;
  status: 'PENDING' | 'AUTHORISED' | 'CANCELLED';
}

/** Combined entry with voucher details for display. */
interface TransactionRow {
  entryId: string;
  voucherDate: string;
  voucherNumber: string;
  narration: string;
  debit: number;
  credit: number;
}

/**
 * Formats a numeric amount in Indian Rupee locale format with 2 decimal places.
 */
const formatCurrency = (val: number): string => {
  return `\u20B9${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
};

/**
 * BankReconciliation - A bank account reconciliation tool.
 * Allows selecting a bank account, viewing its transactions, and marking
 * entries as reconciled. Reconciliation status is persisted in localStorage.
 */
const BankReconciliation: React.FC = () => {
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');

  const { selectedCompanyId } = useAccountingCompany();
  const report = useTallyReport({
    supportsColumns: false,
    filterFields: ['Particulars', 'Vch No.'],
    views: [
      { label: 'Cash/Bank Book', target: 'cash-bank-book' },
      { label: 'Cash/Bank Summary', target: 'cash-bank-summary' },
      { label: 'Banking', target: 'banking' },
      { label: 'Ledger Vouchers', target: 'ledger-view' },
    ],
    screenKeys: [
      {
        hotkey: 'F4',
        label: 'Import Stmt',
        onClick: () => {
          if (!selectedAccountId) {
            toast.error('Select a bank account first');
            return;
          }
          fileRef.current?.click();
        },
      },
    ],
  });
  const { from: fromDate, to: toDate, setPeriod } = report;
  const setFromDate = (v: string) => setPeriod(v, toDate);
  const setToDate = (v: string) => setPeriod(fromDate, v);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reconciled IDs are persisted per bank account in localStorage
  // Bank ledgers are shared (company_id IS NULL), so without the company in
  // the key one company's tick marks would show up in another's.
  const storageKey = `bank_recon_${selectedCompanyId}_${selectedAccountId}`;
  const [reconciledIds, setReconciledIds] = useState<Set<string>>(new Set());

  // Load reconciled IDs from localStorage when account changes
  useEffect(() => {
    if (selectedAccountId) {
      let restored: Set<string>;
      try {
        const saved = localStorage.getItem(storageKey);
        restored = saved ? new Set(JSON.parse(saved)) : new Set();
      } catch {
        restored = new Set();
      }
      setReconciledIds(restored);
      setSelectedIds(new Set());
    } else {
      setReconciledIds(new Set());
      setSelectedIds(new Set());
    }
  }, [selectedAccountId, storageKey]);

  // ---- Bank statement import (CSV) with auto-match ----
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const [unmatchedStmt, setUnmatchedStmt] = React.useState<{ date: string; desc: string; amount: number }[]>([]);
  const [aiMatching, setAiMatching] = React.useState(false);

  const parseCsv = (text: string): { date: string; desc: string; debit: number; credit: number }[] => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    // Empty cells MUST survive as empty strings. A regex match() that skips
    // them shifts every later column left — and on a bank statement exactly
    // one of Debit/Credit is blank per row, so skipping flips deposits into
    // withdrawals and reconciles the wrong side of the book.
    const split = (l: string): string[] => {
      const cells: string[] = [];
      let current = '';
      let inQuotes = false;
      for (const ch of l) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === ',' && !inQuotes) {
          cells.push(current.trim());
          current = '';
        } else current += ch;
      }
      cells.push(current.trim());
      // Banks wrap values as ="10.00" so Excel keeps them as text. The quotes
      // are gone by here; drop the leading = or the amount reads as NaN.
      return cells.map((c) => c.replace(/^=/, '').trim());
    };
    // The header is not necessarily line 1 — Canara and others put 20-odd
    // preamble lines (account holder, IFSC, opening balance) above it. The
    // header is the first line that names a date column and a money column.
    const isHeader = (cells: string[]) => {
      const lower = cells.map((c) => c.toLowerCase());
      return (
        lower.some((c) => c.includes('date')) &&
        lower.some(
          (c) =>
            c.includes('debit') || c.includes('withdraw') || c.includes('credit') ||
            c.includes('deposit') || c.includes('amount'),
        )
      );
    };
    const headerLine = lines.findIndex((l) => isHeader(split(l)));
    if (headerLine === -1) return [];
    lines.splice(0, headerLine);
    const header = split(lines[0]).map((h) => h.toLowerCase());
    const idx = (names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
    const di = idx(['date']);
    const wi = idx(['debit', 'withdraw']);
    const ci = idx(['credit', 'deposit']);
    const ai = idx(['amount']);
    const descIdx = idx(['desc', 'narrat', 'particular', 'remark']);
    const out: { date: string; desc: string; debit: number; credit: number }[] = [];
    for (const line of lines.slice(1)) {
      const c = split(line);
      const num = (v?: string) => Math.abs(Number(String(v ?? '').replace(/[₹, ]/g, ''))) || 0;
      let debit = wi >= 0 ? num(c[wi]) : 0;
      let credit = ci >= 0 ? num(c[ci]) : 0;
      if (!debit && !credit && ai >= 0) {
        const raw = Number(String(c[ai] ?? '').replace(/[₹, ]/g, ''));
        if (raw < 0) debit = -raw;
        else credit = raw;
      }
      if (!debit && !credit) continue;
      out.push({ date: c[di] ?? '', desc: c[descIdx] ?? '', debit, credit });
    }
    return out;
  };

  /** Excel statements (what the bank portals export) read via the same CSV path. */
  const fileToRows = async (file: File) => {
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
      return parseCsv(XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]]));
    }
    return parseCsv(await file.text());
  };

  /**
   * Second pass, after exact-amount matching: the statement lines and book
   * entries that remain are given to the AI to pair on amount + date
   * proximity + narration similarity. Only pairs whose amounts actually agree
   * (checked here, not trusted from the model) are ticked.
   */
  const aiReconcile = async (
    unmatched: { date: string; desc: string; amount: number }[],
    candidates: TransactionRow[],
  ): Promise<{ pairs: Map<number, string>; failed: boolean }> => {
    const pairs = new Map<number, string>();
    if (!unmatched.length || !candidates.length) return { pairs, failed: false };
    try {
      const prompt = `You are reconciling a bank statement against a hospital's accounting book.
Statement lines (index | date | description | amount, positive = money IN to the bank, negative = money OUT):
${unmatched.map((u, i) => `${i} | ${u.date} | ${u.desc || '-'} | ${u.amount.toFixed(2)}`).join('\n')}

Unreconciled book entries (id | voucher date | narration | debit = money in, credit = money out):
${candidates
  .map((t) => `${t.entryId} | ${t.voucherDate} | ${t.narration || '-'} | Dr ${t.debit.toFixed(2)} / Cr ${t.credit.toFixed(2)}`)
  .join('\n')}

Pair each statement line with at most one book entry, and each book entry with at most one line. A pair must have the same amount on the correct side (statement IN pairs a book debit, statement OUT pairs a book credit); prefer close dates and similar party names in the text. Only output pairs you are confident about — leaving a line unpaired is correct when nothing fits.
Output JSON only, no prose: [{"s": <statement index>, "e": "<book entry id>"}]`;

      const response = await geminiFetch(geminiGenerateContentUrl('', GEMINI_MODEL_LITE), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 2000 },
        }),
      });
      const data = await response.json();
      const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed = JSON.parse(text.replace(/^```(?:json)?|```$/gm, '').trim());
      if (!Array.isArray(parsed)) return { pairs, failed: false };

      const byId = new Map(candidates.map((t) => [t.entryId, t]));
      const usedEntries = new Set<string>();
      for (const p of parsed) {
        const stmt = unmatched[Number(p?.s)];
        const entry = byId.get(String(p?.e));
        if (!stmt || !entry || pairs.has(Number(p.s)) || usedEntries.has(entry.entryId)) continue;
        // The model proposes; the amounts decide.
        const bookAmount = stmt.amount >= 0 ? entry.debit : entry.credit;
        if (Math.abs(bookAmount - Math.abs(stmt.amount)) < 0.01) {
          pairs.set(Number(p.s), entry.entryId);
          usedEntries.add(entry.entryId);
        }
      }
      return { pairs, failed: false };
    } catch (err) {
      console.warn('AI reconciliation pass failed:', err);
      return { pairs, failed: true };
    }
  };

  const importStatement = async (file: File): Promise<void> => {
    try {
      const rows = await fileToRows(file);
      if (rows.length === 0) {
        toast.error('No rows found — expected columns like Date, Description, Debit, Credit');
        return;
      }
      // Statement debit (money out) matches a book credit entry; statement
      // credit (money in) matches a book debit. Amount match, each book
      // entry used once, already-ticked entries skipped.
      const used = new Set<string>(reconciledIds);
      const matchedNow = new Set<string>();
      const unmatched: { date: string; desc: string; amount: number }[] = [];
      for (const r of rows) {
        const amt = r.debit || r.credit;
        const wantDebitSide = r.credit > 0;
        const hit = transactions.find(
          (t) => !used.has(t.entryId) && Math.abs((wantDebitSide ? t.debit : t.credit) - amt) < 0.01,
        );
        if (hit) {
          used.add(hit.entryId);
          matchedNow.add(hit.entryId);
        } else {
          unmatched.push({ date: r.date, desc: r.desc, amount: wantDebitSide ? amt : -amt });
        }
      }

      // AI pass on whatever the exact pass could not place.
      let aiMatched = 0;
      let aiFailed = false;
      if (unmatched.length > 0) {
        setAiMatching(true);
        try {
          const candidates = transactions.filter((t) => !used.has(t.entryId));
          const { pairs, failed } = await aiReconcile(unmatched, candidates);
          aiFailed = failed;
          const stillUnmatched: typeof unmatched = [];
          unmatched.forEach((u, i) => {
            const entryId = pairs.get(i);
            if (entryId) {
              matchedNow.add(entryId);
              aiMatched += 1;
            } else {
              stillUnmatched.push(u);
            }
          });
          unmatched.length = 0;
          unmatched.push(...stillUnmatched);
        } finally {
          setAiMatching(false);
        }
      }

      if (matchedNow.size > 0) setReconciledIds((prev) => new Set([...prev, ...matchedNow]));
      setUnmatchedStmt(unmatched);
      toast.success(
        `${matchedNow.size} of ${rows.length} statement line(s) ticked` +
          (aiMatched > 0 ? ` (${aiMatched} matched by AI)` : '') +
          (aiFailed ? ' — AI pass unavailable, exact matches only' : ''),
      );
    } catch (err) {
      console.error('Statement import failed:', err);
      toast.error('Could not read this file');
    }
  };

  // Persist reconciled IDs to localStorage on change
  useEffect(() => {
    if (selectedAccountId) {
      localStorage.setItem(storageKey, JSON.stringify([...reconciledIds]));
    }
  }, [reconciledIds, selectedAccountId, storageKey]);

  // Fetch bank accounts from chart_of_accounts
  const {
    data: bankAccounts = [],
    isLoading: bankLoading,
  } = useQuery({
    queryKey: ['bank_recon_accounts', selectedCompanyId],
    // Bank ledgers live under account codes 112x in this chart
    queryFn: () => fetchActiveAccounts<Account>({ columns: '*', codePrefixes: ['112'], companyId: selectedCompanyId }),
  });

  // Fetch voucher entries for the selected bank account within the date range
  const {
    data: transactions = [],
    isLoading: txnLoading,
    isError: txnError,
    error: txnErr,
    refetch: refetchTxn,
  } = useQuery({
    queryKey: ['bank_recon_entries', selectedCompanyId, selectedAccountId, fromDate, toDate],
    queryFn: async () => {
      if (!selectedAccountId) return [];

      // Single join-filtered query, paginated — the previous two-step fetch
      // truncated at 1000 vouchers and dropped bank transactions.
      const entryData = await fetchAllRows((from, to) =>
        supabase
          .from('voucher_entries')
          .select('*, voucher:vouchers!inner(id, voucher_number, voucher_date, status)')
          .eq('account_id', selectedAccountId)
          .eq('voucher.status', 'AUTHORISED')
          .eq('voucher.company_id', selectedCompanyId)
          .gte('voucher.voucher_date', fromDate)
          .lte('voucher.voucher_date', toDate)
          .order('created_at', { ascending: true })
          .order('id')
          .range(from, to),
      );

      // Combine entry with voucher info
      return (entryData as any[]).map((entry): TransactionRow => {
        return {
          entryId: entry.id,
          voucherDate: entry.voucher?.voucher_date || '',
          voucherNumber: entry.voucher?.voucher_number || '',
          narration: entry.narration || '',
          debit: Number(entry.debit_amount || 0),
          credit: Number(entry.credit_amount || 0),
        };
      });
    },
    enabled: !!selectedAccountId,
  });

  // Get the selected account object for balance computation
  const selectedAccount = bankAccounts.find((a) => a.id === selectedAccountId);

  // Movement before the From date. The stored opening balance is the cutover
  // figure, not a balance as of any chosen date — without this, narrowing the
  // period silently drops all earlier movement from the Book Balance.
  const { data: preWindowNet = 0 } = useQuery({
    queryKey: ['bank_recon_prewindow', selectedCompanyId, selectedAccountId, fromDate],
    enabled: !!selectedAccountId,
    queryFn: async () => {
      const rows = await fetchAllRows<any>((from, to) =>
        supabase
          .from('voucher_entries')
          .select('id, debit_amount, credit_amount, voucher:vouchers!inner(voucher_date, status)')
          .eq('account_id', selectedAccountId)
          .eq('voucher.status', 'AUTHORISED')
          .eq('voucher.company_id', selectedCompanyId)
          .lt('voucher.voucher_date', fromDate)
          .order('id')
          .range(from, to),
      );
      return rows.reduce(
        (sum, e: any) => sum + (Number(e.debit_amount) || 0) - (Number(e.credit_amount) || 0),
        0,
      );
    },
  });

  // Compute summary values
  const { bookBalance, totalDebits, totalCredits, reconciledAmount, unreconciledAmount, reconciledCount } =
    useMemo(() => {
      // Opening balance (debit = positive for Asset accounts), rolled forward
      // to the From date by the pre-window movement.
      let openingBal = preWindowNet;
      if (selectedAccount) {
        const bal = Number(selectedAccount.opening_balance || 0);
        openingBal += selectedAccount.opening_balance_type?.toUpperCase() === 'DR' ? bal : -bal;
      }

      let totalDebits = 0;
      let totalCredits = 0;
      let reconciledAmount = 0;
      let reconciledCount = 0;

      transactions.forEach((txn) => {
        totalDebits += txn.debit;
        totalCredits += txn.credit;
        if (reconciledIds.has(txn.entryId)) {
          reconciledAmount += txn.debit - txn.credit;
          reconciledCount++;
        }
      });

      const bookBalance = openingBal + totalDebits - totalCredits;
      const unreconciledAmount = bookBalance - reconciledAmount;

      return { bookBalance, totalDebits, totalCredits, reconciledAmount, unreconciledAmount, reconciledCount };
    }, [transactions, reconciledIds, selectedAccount, preWindowNet]);

  // Toggle selection for a single row
  const toggleSelected = (entryId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  // Select/deselect all
  const toggleSelectAll = () => {
    if (selectedIds.size === transactions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(transactions.map((t) => t.entryId)));
    }
  };

  // Mark selected entries as reconciled
  const markReconciled = () => {
    if (selectedIds.size === 0) {
      toast.error('No entries selected');
      return;
    }
    setReconciledIds((prev) => {
      const next = new Set(prev);
      selectedIds.forEach((id) => next.add(id));
      return next;
    });
    toast.success(`${selectedIds.size} entries marked as reconciled`);
    setSelectedIds(new Set());
  };

  // Unmark selected entries
  const unmarkReconciled = () => {
    if (selectedIds.size === 0) {
      toast.error('No entries selected');
      return;
    }
    setReconciledIds((prev) => {
      const next = new Set(prev);
      selectedIds.forEach((id) => next.delete(id));
      return next;
    });
    toast.success(`${selectedIds.size} entries unmarked`);
    setSelectedIds(new Set());
  };

  // Print handler
  const handlePrint = () => {
    window.print();
  };

  // No bank account selected state
  if (!selectedAccountId && !bankLoading) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Bank Reconciliation</h2>
          <p className="text-sm text-gray-500 mt-1">
            Reconcile bank statements with your books
          </p>
        </div>

        {/* Bank Account Selector */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <Label htmlFor="bankAccount" className="text-sm whitespace-nowrap font-medium">
                Bank Account
              </Label>
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger className="w-80">
                  <SelectValue placeholder="Select a bank account..." />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.account_code} - {acc.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Prompt */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Building2 className="h-12 w-12 text-gray-300 mb-4" />
              <p className="text-gray-500 text-sm">
                Select a bank account to begin reconciliation
              </p>
              {bankAccounts.length === 0 && !bankLoading && (
                <p className="text-gray-400 text-xs mt-2">
                  No bank accounts found. Add a bank account in Chart of Accounts first.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
    <TallyScreen
      title="Bank Reconciliation"
      rail={report.rail}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importStatement(f);
          e.target.value = '';
        }}
      />
      {aiMatching && (
        <div className="mx-3 mt-1 border border-blue-300 bg-blue-50 p-2 text-[12px] font-semibold text-blue-800">
          Exact matches ticked — AI is reconciling the remaining statement lines…
        </div>
      )}
      {unmatchedStmt.length > 0 && (
        <div className="mx-3 mt-1 border border-orange-300 bg-orange-50 p-2 text-[12px]">
          <div className="font-semibold text-orange-800">
            {unmatchedStmt.length} statement line(s) had no matching book entry:
          </div>
          {unmatchedStmt.slice(0, 8).map((u, i) => (
            <div key={i} className="flex gap-3">
              <span className="w-24">{u.date}</span>
              <span className="min-w-0 flex-1 truncate">{u.desc}</span>
              <span className="font-mono">
                {Math.abs(u.amount).toFixed(2)} {u.amount >= 0 ? 'In' : 'Out'}
              </span>
            </div>
          ))}
          {unmatchedStmt.length > 8 && <div className="italic">…and {unmatchedStmt.length - 8} more</div>}
        </div>
      )}
    
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Bank Reconciliation</h2>
          <p className="text-sm text-gray-500 mt-1">
            Reconcile bank statements with your books
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1" />
            Print
          </Button>
        </div>
      </div>

      {/* Controls: Bank account selector + date range */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor="bankAccount" className="text-sm font-medium mb-1.5 block">
                Bank Account
              </Label>
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a bank account..." />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.account_code} - {acc.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="brFromDate" className="text-sm font-medium mb-1.5 block">
                From
              </Label>
              <Input
                id="brFromDate"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-40"
              />
            </div>
            <div>
              <Label htmlFor="brToDate" className="text-sm font-medium mb-1.5 block">
                To
              </Label>
              <Input
                id="brToDate"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-40"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Session-only notice */}
      <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg">
        <AlertCircle className="h-4 w-4 text-yellow-600 flex-shrink-0" />
        <p className="text-xs text-yellow-700">
          Reconciliation status is stored in your browser's local storage. Clearing browser data will reset it.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500 font-medium">Book Balance</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">
              {formatCurrency(bookBalance)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500 font-medium">Reconciled Amount</p>
            <p className="text-2xl font-bold text-green-700 mt-1">
              {formatCurrency(reconciledAmount)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500 font-medium">Unreconciled Amount</p>
            <p className="text-2xl font-bold text-red-700 mt-1">
              {formatCurrency(unreconciledAmount)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          className="bg-green-600 hover:bg-green-700"
          onClick={markReconciled}
          disabled={selectedIds.size === 0}
        >
          <Check className="h-4 w-4 mr-1" />
          Mark Reconciled ({selectedIds.size})
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={unmarkReconciled}
          disabled={selectedIds.size === 0}
        >
          <X className="h-4 w-4 mr-1" />
          Unmark ({selectedIds.size})
        </Button>
        <div className="ml-auto text-sm text-gray-500">
          {selectedIds.size} selected of {transactions.length} entries
        </div>
      </div>

      {/* Transactions Table */}
      <Card>
        <CardContent className="pt-0 px-0">
          {txnLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="h-4 w-6 bg-gray-200 rounded animate-pulse" />
                  <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
                  <div className="h-4 flex-1 bg-gray-200 rounded animate-pulse" />
                  <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
                  <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : txnError ? (
            <div className="flex items-center gap-3 p-6 bg-red-50 border border-red-200 rounded-lg m-4">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-red-700 font-medium">Failed to load transactions</p>
                <p className="text-xs text-red-600 mt-1">
                  {(txnErr as Error)?.message || 'An unexpected error occurred.'}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchTxn()}>
                Retry
              </Button>
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Calendar className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-gray-500 text-sm">
                No transactions found for the selected period
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selectedIds.size === transactions.length && transactions.length > 0}
                        onCheckedChange={toggleSelectAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Voucher #</TableHead>
                    <TableHead>Narration</TableHead>
                    <TableHead className="text-right">Debit (Deposit)</TableHead>
                    <TableHead className="text-right">Credit (Withdrawal)</TableHead>
                    <TableHead className="text-center">Reconciled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((txn) => {
                    const isReconciled = reconciledIds.has(txn.entryId);
                    const isSelected = selectedIds.has(txn.entryId);
                    return (
                      <TableRow
                        key={txn.entryId}
                        className={isReconciled ? 'bg-green-50' : ''}
                      >
                        <TableCell>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelected(txn.entryId)}
                            aria-label={`Select entry ${txn.voucherNumber}`}
                          />
                        </TableCell>
                        <TableCell className="text-sm text-gray-700 whitespace-nowrap">
                          {txn.voucherDate
                            ? format(new Date(txn.voucherDate), 'dd-MMM-yyyy')
                            : '-'}
                        </TableCell>
                        <TableCell className="text-sm font-mono text-gray-600">
                          {txn.voucherNumber || '-'}
                        </TableCell>
                        <TableCell className="text-sm text-gray-700 max-w-xs truncate">
                          {txn.narration || '-'}
                        </TableCell>
                        <TableCell className="text-right text-sm text-gray-700">
                          {txn.debit > 0 ? formatCurrency(txn.debit) : '-'}
                        </TableCell>
                        <TableCell className="text-right text-sm text-gray-700">
                          {txn.credit > 0 ? formatCurrency(txn.credit) : '-'}
                        </TableCell>
                        <TableCell className="text-center">
                          {isReconciled ? (
                            <Badge className="bg-green-100 text-green-800 border-green-200">
                              <Check className="h-3 w-3 mr-0.5" />
                              Yes
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-gray-400">
                              No
                            </Badge>
                          )}
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

      {/* Reconciliation Summary */}
      {transactions.length > 0 && (
        <Card>
          <CardHeader className="py-3 bg-gray-50 rounded-t-lg">
            <CardTitle className="text-base font-bold text-gray-800">
              Reconciliation Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Total Debits (Deposits)</span>
                  <span className="font-medium text-gray-800">{formatCurrency(totalDebits)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Total Credits (Withdrawals)</span>
                  <span className="font-medium text-gray-800">{formatCurrency(totalCredits)}</span>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Reconciled Items</span>
                  <span className="font-medium text-green-700">
                    {reconciledCount} / {transactions.length}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Unreconciled Balance</span>
                  <span className="font-medium text-red-700">
                    {formatCurrency(unreconciledAmount)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
    </TallyScreen>

    {report.popups}
    </>
  );
};

export default BankReconciliation;
