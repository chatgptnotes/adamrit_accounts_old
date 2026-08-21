import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

// The two audited companies, by their explicit imported Tally company IDs.
// Names are display only — every query below filters on these IDs, never on
// names or shared Tally GUIDs, so DRM and Ayushman can never mix.
const COMPANIES = [
  { id: '37548c73-14ac-4ba2-998e-d4ac14364151', label: 'DRM Hope Hospital Pvt Ltd' },
  { id: '3201eb57-5cd5-49b2-af62-e4af0147e63a', label: 'Ayushman Nagpur Hospital' },
];

const STATUSES = [
  { value: 'pending_review', label: 'Pending review', badge: 'bg-amber-100 text-amber-800' },
  { value: 'matched', label: 'Already entered — skipped', badge: 'bg-green-100 text-green-800' },
  { value: 'found_elsewhere', label: 'Found elsewhere — skipped', badge: 'bg-sky-100 text-sky-800' },
  { value: 'ambiguous', label: 'Parked', badge: 'bg-purple-100 text-purple-800' },
  { value: 'approved_missing', label: 'Approved — not yet posted', badge: 'bg-red-100 text-red-800' },
  { value: 'rejected', label: 'Rejected', badge: 'bg-gray-200 text-gray-700' },
  { value: 'posted', label: 'Posted to ledger', badge: 'bg-emerald-200 text-emerald-900' },
];

const DECISION_OPTIONS = [
  { value: 'matched', label: 'Already entered in software — skip' },
  { value: 'found_elsewhere', label: 'Found elsewhere — skip' },
  { value: 'ambiguous', label: 'Not sure — park for later' },
  { value: 'rejected', label: 'Reject (bank error / not ours)' },
  { value: 'approved_missing', label: 'Missing — post to ledger' },
];

const statusBadge = (status: string) => {
  const s = STATUSES.find(x => x.value === status);
  return <Badge className={`${s?.badge ?? ''} whitespace-nowrap`} variant="outline">{s?.label ?? status}</Badge>;
};

const PAGE_SIZE = 50;

interface AuditRow {
  id: string;
  statement_date: string;
  bank_ledger: string;
  signed_amount: number;
  reference: string | null;
  narration: string | null;
  source_file: string;
  source_page: number | null;
  audit_classification: string | null;
  candidate_details: string | null;
  status: string;
}

const inr = (n: number) =>
  Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Suggestion {
  ledgerName: string;
  voucherCategory: 'RECEIPT' | 'PAYMENT';
  source: string;
}

// Suggest the counterparty ledger and voucher type for a bank line, so the
// accountant only has to approve. Two signals, in order of trust:
//  1. The audit's own candidate list — near-match vouchers whose ledger
//     names are right there in candidate_details ("...; 20.00; Bank Charges;
//     Payment; ..."). The most frequent one wins.
//  2. A company ledger whose name literally appears in the bank narration
//     (e.g. "...ASHISH GA..." → ledger "Ashish Gawande"). Longest match wins.
// The voucher type is simply the direction: money in → Receipt, out → Payment.
const suggestFor = (row: AuditRow, ledgerNames: string[]): Suggestion | null => {
  const bankLower = row.bank_ledger.trim().toLowerCase();
  const category: Suggestion['voucherCategory'] = row.signed_amount > 0 ? 'RECEIPT' : 'PAYMENT';
  const known = new Map(ledgerNames.map(n => [n.trim().toLowerCase(), n]));

  // Signal 1: ledger names inside the audit's candidate lines.
  if (row.candidate_details) {
    const counts = new Map<string, number>();
    for (const line of row.candidate_details.split('\n')) {
      const parts = line.split(';');
      const name = (parts[3] || '').trim();
      const lower = name.toLowerCase();
      if (!name || lower === bankLower || !known.has(lower)) continue;
      counts.set(lower, (counts.get(lower) || 0) + 1);
    }
    let best: string | null = null; let bestCount = 0;
    for (const [lower, count] of counts) {
      if (count > bestCount) { best = lower; bestCount = count; }
    }
    if (best) return { ledgerName: known.get(best)!, voucherCategory: category, source: 'seen in similar entries' };
  }

  // Signal 2: a ledger name spelled out in the narration itself.
  if (row.narration) {
    const narration = row.narration.toLowerCase();
    let best: string | null = null;
    for (const [lower, name] of known) {
      if (lower.length >= 5 && lower !== bankLower && narration.includes(lower)) {
        if (!best || name.length > best.length) best = name;
      }
    }
    if (best) return { ledgerName: best, voucherCategory: category, source: 'name found in narration' };
  }

  return null;
};

const BankAudit: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [companyId, setCompanyId] = useState(COMPANIES[0].id);
  const [statusFilter, setStatusFilter] = useState('all');
  const [bankFilter, setBankFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Decision dialog state
  const [decidingRow, setDecidingRow] = useState<AuditRow | null>(null);
  const [decision, setDecision] = useState('');
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [ledgerId, setLedgerId] = useState('');
  const [voucherTypeId, setVoucherTypeId] = useState('');
  const [note, setNote] = useState('');

  // One light facet query per company: every row's status + bank, counted
  // client-side. 1,512 rows of two short strings — cheaper than 10 queries.
  const { data: facets } = useQuery({
    queryKey: ['bank-audit-facets', companyId],
    queryFn: async () => {
      // PostgREST caps every response at 1,000 rows regardless of range, so
      // page through — otherwise the counters stop at 1,000 of 1,512.
      const byStatus: Record<string, number> = {};
      const banks = new Set<string>();
      let from = 0;
      let total = 0;
      for (;;) {
        const { data, error } = await (supabase as any)
          .from('bank_reconciliation_rows')
          .select('status, bank_ledger')
          .eq('company_id', companyId)
          .range(from, from + 999);
        if (error) throw error;
        for (const r of data as { status: string; bank_ledger: string }[]) {
          byStatus[r.status] = (byStatus[r.status] || 0) + 1;
          banks.add(r.bank_ledger);
        }
        total += data.length;
        if (data.length < 1000) break;
        from += 1000;
      }
      return { byStatus, banks: [...banks].sort(), total };
    },
  });

  const { data: rowsPage, isLoading } = useQuery({
    queryKey: ['bank-audit-rows', companyId, statusFilter, bankFilter, search, page],
    queryFn: async () => {
      let q = (supabase as any)
        .from('bank_reconciliation_rows')
        .select('id, statement_date, bank_ledger, signed_amount, reference, narration, source_file, source_page, audit_classification, candidate_details, status', { count: 'exact' })
        .eq('company_id', companyId);
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      if (bankFilter !== 'all') q = q.eq('bank_ledger', bankFilter);
      if (search.trim()) {
        const term = search.trim().replace(/[%,()]/g, ' ');
        q = q.or(`narration.ilike.%${term}%,reference.ilike.%${term}%`);
      }
      const { data, count, error } = await q
        .order('statement_date', { ascending: true })
        .order('id', { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: data as AuditRow[], count: count ?? 0 };
    },
  });

  // Every ledger name of this company, for suggestions (paged past the
  // 1,000-row cap; ~4k short strings, cached per company).
  const { data: allLedgerNames = [] } = useQuery({
    queryKey: ['bank-audit-ledger-names', companyId],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const names: string[] = [];
      let from = 0;
      for (;;) {
        const { data, error } = await (supabase as any)
          .from('tally_ledgers')
          .select('name')
          .eq('company_id', companyId)
          .range(from, from + 999);
        if (error) throw error;
        names.push(...(data as { name: string }[]).map(l => l.name));
        if (data.length < 1000) break;
        from += 1000;
      }
      return names;
    },
  });

  // Counterparty ledger picker: same company only, searched server-side.
  const { data: ledgerOptions = [] } = useQuery({
    queryKey: ['bank-audit-ledgers', companyId, ledgerSearch],
    enabled: decision === 'approved_missing',
    queryFn: async () => {
      let q = (supabase as any)
        .from('tally_ledgers')
        .select('id, name, parent_group')
        .eq('company_id', companyId)
        .order('name')
        .limit(30);
      if (ledgerSearch.trim()) q = q.ilike('name', `%${ledgerSearch.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data as { id: string; name: string; parent_group: string | null }[];
    },
  });

  const { data: voucherTypes = [] } = useQuery({
    queryKey: ['bank-audit-voucher-types'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('voucher_types')
        .select('id, voucher_type_name, voucher_category')
        .eq('is_active', true)
        .order('voucher_type_name');
      if (error) throw error;
      return data as { id: string; voucher_type_name: string; voucher_category: string }[];
    },
  });

  const decide = useMutation({
    mutationFn: async () => {
      if (!decidingRow) throw new Error('no row selected');
      const { error } = await (supabase as any).rpc('decide_bank_recon_row', {
        p_row_id: decidingRow.id,
        p_decision: decision,
        p_ledger_id: ledgerId || null,
        p_voucher_type_id: voucherTypeId || null,
        p_matched_tally_voucher_id: null,
        p_note: note.trim() || null,
        p_decided_by: user?.email ?? '',
      });
      if (error) throw error;

      // "Missing — post to ledger": create the voucher right away, so the
      // entry appears in this company's ledger / bank book / day book. If
      // posting is refused (a duplicate check fired), the approval is kept
      // and the row shows "Approved — not yet posted" for a retry.
      if (decision === 'approved_missing') {
        const { data, error: postError } = await (supabase as any).rpc('post_bank_audit_row', {
          p_row_id: decidingRow.id,
          p_posted_by: user?.email ?? '',
        });
        if (postError) throw new Error(`Approved, but not posted: ${postError.message}`);
        return data as { voucher_number: string; voucher_type: string; ledger: string };
      }
      return null;
    },
    onSuccess: (posted) => {
      toast.success(posted
        ? `Posted ${posted.voucher_number} (${posted.voucher_type}) to ${posted.ledger}`
        : 'Decision saved');
      setDecidingRow(null);
      queryClient.invalidateQueries({ queryKey: ['bank-audit-rows'] });
      queryClient.invalidateQueries({ queryKey: ['bank-audit-facets'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setDecidingRow(null);
      queryClient.invalidateQueries({ queryKey: ['bank-audit-rows'] });
      queryClient.invalidateQueries({ queryKey: ['bank-audit-facets'] });
    },
  });

  // Retry posting a row that is approved but was refused earlier.
  const postOnly = useMutation({
    mutationFn: async (rowId: string) => {
      const { data, error } = await (supabase as any).rpc('post_bank_audit_row', {
        p_row_id: rowId,
        p_posted_by: user?.email ?? '',
      });
      if (error) throw error;
      return data as { voucher_number: string; voucher_type: string; ledger: string };
    },
    onSuccess: (posted) => {
      toast.success(`Posted ${posted.voucher_number} (${posted.voucher_type}) to ${posted.ledger}`);
      queryClient.invalidateQueries({ queryKey: ['bank-audit-rows'] });
      queryClient.invalidateQueries({ queryKey: ['bank-audit-facets'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openDecision = (row: AuditRow) => {
    setDecidingRow(row);
    setDecision(row.status === 'pending_review' ? '' : row.status);
    setSuggestion(suggestFor(row, allLedgerNames));
    setLedgerId('');
    setLedgerSearch('');
    setVoucherTypeId('');
    setNote('');
  };

  // Choosing "Missing — post to ledger" pre-fills what we can suggest: the
  // ledger search (from similar entries / narration) and the voucher type
  // (Receipt for money in, Payment for money out). The accountant confirms
  // or overrides — the pick is never silent.
  const onDecisionChange = (value: string) => {
    setDecision(value);
    if (value === 'approved_missing' && decidingRow) {
      if (suggestion && !ledgerId) setLedgerSearch(suggestion.ledgerName);
      if (!voucherTypeId) {
        const category = decidingRow.signed_amount > 0 ? 'RECEIPT' : 'PAYMENT';
        const vt = voucherTypes.find(t => t.voucher_category === category);
        if (vt) setVoucherTypeId(vt.id);
      }
    }
  };

  // When the suggested ledger comes back from the search, select it.
  React.useEffect(() => {
    if (decision !== 'approved_missing' || !suggestion || ledgerId) return;
    if (ledgerSearch !== suggestion.ledgerName) return;
    const exact = ledgerOptions.find(
      l => l.name.trim().toLowerCase() === suggestion.ledgerName.trim().toLowerCase()
    );
    if (exact) setLedgerId(exact.id);
  }, [decision, suggestion, ledgerId, ledgerSearch, ledgerOptions]);

  // Suggestions for the rows on screen, shown as their own column.
  const rowSuggestions = useMemo(() => {
    const map = new Map<string, Suggestion | null>();
    for (const row of rowsPage?.rows ?? []) map.set(row.id, suggestFor(row, allLedgerNames));
    return map;
  }, [rowsPage, allLedgerNames]);

  const canSubmit = decision !== ''
    && (decision !== 'approved_missing' || (ledgerId && voucherTypeId))
    && !decide.isPending;

  const totalPages = Math.max(1, Math.ceil((rowsPage?.count ?? 0) / PAGE_SIZE));
  const company = COMPANIES.find(c => c.id === companyId)!;
  const reviewed = useMemo(() => {
    const by = facets?.byStatus ?? {};
    const total = facets?.total ?? 0;
    return { total, pending: by['pending_review'] ?? 0, done: total - (by['pending_review'] ?? 0) };
  }, [facets]);

  return (
    <div className="p-4 max-w-[1400px] mx-auto space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h1 className="text-xl font-semibold">Bank Statement Audit — FY 2025-26</h1>
        <div className="ml-auto flex gap-2">
          {COMPANIES.map(c => (
            <Button
              key={c.id}
              size="sm"
              variant={companyId === c.id ? 'default' : 'outline'}
              onClick={() => { setCompanyId(c.id); setBankFilter('all'); setPage(0); }}
            >
              {c.label}
            </Button>
          ))}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Bank lines the audit could not tie to the books. Evidence is frozen. Decide each
        row: skip what is already entered — and for a genuinely missing entry, pick its
        ledger and Approve &amp; Post to create the voucher in this company&apos;s books.
      </p>

      {/* Progress + status chips */}
      <div className="flex gap-2 flex-wrap items-center">
        <Badge variant="secondary" className="text-sm">
          {company.label}: {reviewed.done} / {reviewed.total} reviewed
        </Badge>
        {STATUSES.map(s => {
          const n = facets?.byStatus?.[s.value] ?? 0;
          if (!n) return null;
          return (
            <button
              key={s.value}
              onClick={() => { setStatusFilter(statusFilter === s.value ? 'all' : s.value); setPage(0); }}
              className={`rounded-full px-3 py-1 text-xs border ${s.badge} ${statusFilter === s.value ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}
            >
              {s.label}: {n}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <Select value={bankFilter} onValueChange={v => { setBankFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[240px]"><SelectValue placeholder="Bank" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All banks</SelectItem>
            {(facets?.banks ?? []).map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
          <Input
            className="pl-8 w-[300px]"
            placeholder="Search narration / reference…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
        <span className="text-sm text-muted-foreground ml-auto">
          {rowsPage?.count ?? 0} rows · page {page + 1} of {totalPages}
        </span>
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
        <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
      </div>

      {/* Rows */}
      <div className="border rounded-md overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-2">Date</th>
              <th className="p-2">Bank</th>
              <th className="p-2 text-right">Amount (₹)</th>
              <th className="p-2">Reference</th>
              <th className="p-2">Narration</th>
              <th className="p-2">Audit hint</th>
              <th className="p-2">Suggested ledger</th>
              <th className="p-2">Status</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={9} className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin inline" /></td></tr>
            )}
            {!isLoading && (rowsPage?.rows ?? []).map(row => (
              <React.Fragment key={row.id}>
                <tr
                  className="border-t hover:bg-muted/30 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                >
                  <td className="p-2 whitespace-nowrap">{row.statement_date}</td>
                  <td className="p-2 whitespace-nowrap">{row.bank_ledger}</td>
                  <td className={`p-2 text-right whitespace-nowrap font-mono ${row.signed_amount < 0 ? 'text-red-600' : 'text-green-700'}`}>
                    {inr(row.signed_amount)}
                  </td>
                  <td className="p-2 max-w-[140px] truncate font-mono text-xs">{row.reference}</td>
                  <td className="p-2 max-w-[320px] truncate">{row.narration}</td>
                  <td className="p-2 max-w-[180px] truncate text-xs text-muted-foreground">{row.audit_classification}</td>
                  <td className="p-2 max-w-[170px] text-xs">
                    {(() => {
                      const s = rowSuggestions.get(row.id);
                      return s
                        ? <span className="text-blue-700 truncate block" title={`${s.ledgerName} (${s.source})`}>
                            {s.ledgerName}
                            <span className="text-muted-foreground"> · {s.voucherCategory === 'RECEIPT' ? 'Receipt' : 'Payment'}</span>
                          </span>
                        : <span className="text-muted-foreground">—</span>;
                    })()}
                  </td>
                  <td className="p-2">{statusBadge(row.status)}</td>
                  <td className="p-2 whitespace-nowrap">
                    {row.status !== 'posted' && (
                      <Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); openDecision(row); }}>
                        Decide
                      </Button>
                    )}
                    {row.status === 'approved_missing' && (
                      <Button
                        size="sm"
                        className="ml-1"
                        disabled={postOnly.isPending}
                        onClick={e => { e.stopPropagation(); postOnly.mutate(row.id); }}
                      >
                        Post
                      </Button>
                    )}
                  </td>
                </tr>
                {expandedId === row.id && (
                  <tr className="border-t bg-muted/20">
                    <td colSpan={9} className="p-3 text-xs space-y-2">
                      <div><span className="font-semibold">Full narration: </span>{row.narration || '—'}</div>
                      <div>
                        <span className="font-semibold">Source: </span>
                        {row.source_file}{row.source_page ? `, page ${row.source_page}` : ''}
                      </div>
                      {row.candidate_details && (
                        <div>
                          <span className="font-semibold">Automated candidates found by the audit:</span>
                          <pre className="whitespace-pre-wrap mt-1 bg-background border rounded p-2 max-h-56 overflow-y-auto">{row.candidate_details}</pre>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {!isLoading && (rowsPage?.rows ?? []).length === 0 && (
              <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No rows match the filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Decision dialog */}
      <Dialog open={!!decidingRow} onOpenChange={open => { if (!open) setDecidingRow(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Review bank line</DialogTitle>
          </DialogHeader>
          {decidingRow && (
            <div className="space-y-3 text-sm">
              <div className="bg-muted/40 rounded p-2 space-y-1">
                <div className="flex justify-between">
                  <span>{decidingRow.statement_date} · {decidingRow.bank_ledger}</span>
                  <span className={`font-mono ${decidingRow.signed_amount < 0 ? 'text-red-600' : 'text-green-700'}`}>
                    ₹{inr(decidingRow.signed_amount)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground line-clamp-3">{decidingRow.narration}</div>
              </div>

              {suggestion && (
                <div className="rounded border border-blue-200 bg-blue-50 p-2 text-xs">
                  <span className="font-semibold text-blue-800">Suggestion: </span>
                  {suggestion.ledgerName} · {suggestion.voucherCategory === 'RECEIPT' ? 'Receipt' : 'Payment'}
                  <span className="text-muted-foreground"> ({suggestion.source})</span>
                  <div className="text-muted-foreground mt-0.5">
                    Choose &quot;Missing — post to ledger&quot; and this fills in automatically — change it if wrong.
                  </div>
                </div>
              )}
              <Select value={decision} onValueChange={onDecisionChange}>
                <SelectTrigger><SelectValue placeholder="Decision…" /></SelectTrigger>
                <SelectContent>
                  {DECISION_OPTIONS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>

              {decision === 'approved_missing' && (
                <div className="space-y-2 border rounded p-2">
                  <p className="text-xs text-muted-foreground">
                    This entry is missing from the software. Choose which ledger it
                    belongs to — on approval a voucher is created and the entry
                    appears in that ledger, the bank book and the day book.
                  </p>
                  <Input
                    placeholder="Search counterparty ledger…"
                    value={ledgerSearch}
                    onChange={e => { setLedgerSearch(e.target.value); setLedgerId(''); }}
                  />
                  <div className="max-h-40 overflow-y-auto border rounded">
                    {ledgerOptions.map(l => (
                      <button
                        key={l.id}
                        className={`w-full text-left px-2 py-1 text-xs hover:bg-muted ${ledgerId === l.id ? 'bg-blue-100' : ''}`}
                        onClick={() => setLedgerId(l.id)}
                      >
                        {l.name}
                        <span className="text-muted-foreground"> — {l.parent_group ?? 'ungrouped'}</span>
                      </button>
                    ))}
                    {ledgerOptions.length === 0 && (
                      <div className="p-2 text-xs text-muted-foreground">No ledgers match.</div>
                    )}
                  </div>
                  <Select value={voucherTypeId} onValueChange={setVoucherTypeId}>
                    <SelectTrigger><SelectValue placeholder="Voucher type…" /></SelectTrigger>
                    <SelectContent>
                      {voucherTypes.map(vt => (
                        <SelectItem key={vt.id} value={vt.id}>
                          {vt.voucher_type_name} ({vt.voucher_category})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Textarea
                placeholder="Note (why this decision)…"
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecidingRow(null)}>Cancel</Button>
            <Button disabled={!canSubmit} onClick={() => decide.mutate()}>
              {decide.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : decision === 'approved_missing' ? 'Approve & Post' : 'Save decision'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BankAudit;
