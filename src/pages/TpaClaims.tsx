import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from 'use-debounce';
import { ShieldCheck, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// TPA / private-insurance claim tracker: pre-auth → submission → settlement,
// with the amounts at each stage. Complements the Yojana (govt panel)
// workflows — this is for the private insurers and TPAs.

const sb = supabase as unknown as { from: (table: string) => any };

const STATUSES = [
  'PREAUTH_PENDING',
  'PREAUTH_APPROVED',
  'CLAIM_SUBMITTED',
  'QUERY_RAISED',
  'APPROVED',
  'SETTLED',
  'DENIED',
] as const;
type ClaimStatus = (typeof STATUSES)[number];

const STATUS_LABEL: Record<ClaimStatus, string> = {
  PREAUTH_PENDING: 'Pre-auth pending',
  PREAUTH_APPROVED: 'Pre-auth approved',
  CLAIM_SUBMITTED: 'Claim submitted',
  QUERY_RAISED: 'Query raised',
  APPROVED: 'Approved',
  SETTLED: 'Settled',
  DENIED: 'Denied',
};

const STATUS_STYLE: Record<ClaimStatus, string> = {
  PREAUTH_PENDING: 'bg-amber-100 text-amber-800',
  PREAUTH_APPROVED: 'bg-sky-100 text-sky-800',
  CLAIM_SUBMITTED: 'bg-indigo-100 text-indigo-800',
  QUERY_RAISED: 'bg-orange-100 text-orange-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  SETTLED: 'bg-green-100 text-green-800',
  DENIED: 'bg-rose-100 text-rose-800',
};

// The natural "what happens next" per status — one-click advance.
const NEXT_STATUS: Partial<Record<ClaimStatus, ClaimStatus>> = {
  PREAUTH_PENDING: 'PREAUTH_APPROVED',
  PREAUTH_APPROVED: 'CLAIM_SUBMITTED',
  CLAIM_SUBMITTED: 'APPROVED',
  QUERY_RAISED: 'CLAIM_SUBMITTED',
  APPROVED: 'SETTLED',
};

interface Claim {
  id: string;
  visit_id: string | null;
  corporate_name: string | null;
  patient_name: string | null;
  visit_code: string | null;
  claim_no: string | null;
  policy_no: string | null;
  status: ClaimStatus;
  preauth_amount: number | null;
  claimed_amount: number | null;
  approved_amount: number | null;
  received_amount: number | null;
  preauth_date: string | null;
  submission_date: string | null;
  settlement_date: string | null;
  next_followup_date: string | null;
  remarks: string | null;
}

interface VisitOption {
  id: string;
  visit_id: string;
  patient_name: string;
  corporate: string;
}

const fmtMoney = (n: number | null | undefined): string =>
  n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`;

const todayISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const emptyForm = {
  claim_no: '',
  policy_no: '',
  preauth_amount: '',
  claimed_amount: '',
  approved_amount: '',
  received_amount: '',
  next_followup_date: '',
  remarks: '',
};

export default function TpaClaims() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'all' | ClaimStatus>('all');
  const [tpaFilter, setTpaFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Claim | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [visitSearch, setVisitSearch] = useState('');
  const [pickedVisit, setPickedVisit] = useState<VisitOption | null>(null);
  const [debouncedVisitSearch] = useDebounce(visitSearch, 300);

  const { data: claims = [], isLoading } = useQuery({
    queryKey: ['tpa-claims'],
    queryFn: async (): Promise<Claim[]> => {
      const { data, error } = await sb
        .from('tpa_claims')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Visit picker: TPA/insurance patients only — the govt panels have their own
  // Yojana workflows, this tracker is for the private payers.
  const { data: visitOptions = [] } = useQuery({
    queryKey: ['tpa-visit-search', debouncedVisitSearch],
    enabled: dialogOpen && !editing && debouncedVisitSearch.trim().length >= 2,
    queryFn: async (): Promise<VisitOption[]> => {
      const term = debouncedVisitSearch.replace(/[%,()]/g, ' ').trim();
      const { data, error } = await sb
        .from('visits')
        .select('id, visit_id, patients!inner(name, corporate)')
        .or(`visit_id.ilike.*${term}*,patients.name.ilike.*${term}*`)
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? [])
        .filter((v: any) => {
          const c = (v.patients?.corporate || '').toLowerCase();
          return c.includes('tpa') || c.includes('insurance') || c.includes('insur');
        })
        .slice(0, 15)
        .map((v: any) => ({
          id: v.id,
          visit_id: v.visit_id,
          patient_name: v.patients?.name ?? '',
          corporate: v.patients?.corporate ?? '',
        }));
    },
  });

  const tpas = useMemo(
    () => [...new Set(claims.map((c) => c.corporate_name).filter(Boolean))].sort() as string[],
    [claims],
  );

  const visible = useMemo(
    () =>
      claims
        .filter((c) => statusFilter === 'all' || c.status === statusFilter)
        .filter((c) => tpaFilter === 'all' || c.corporate_name === tpaFilter),
    [claims, statusFilter, tpaFilter],
  );

  const totals = useMemo(() => {
    const open = visible.filter((c) => c.status !== 'SETTLED' && c.status !== 'DENIED');
    return {
      openCount: open.length,
      claimed: visible.reduce((s, c) => s + (Number(c.claimed_amount) || 0), 0),
      approved: visible.reduce((s, c) => s + (Number(c.approved_amount) || 0), 0),
      received: visible.reduce((s, c) => s + (Number(c.received_amount) || 0), 0),
    };
  }, [visible]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tpa-claims'] });

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setPickedVisit(null);
    setVisitSearch('');
    setDialogOpen(true);
  };

  const openEdit = (c: Claim) => {
    setEditing(c);
    setForm({
      claim_no: c.claim_no ?? '',
      policy_no: c.policy_no ?? '',
      preauth_amount: c.preauth_amount == null ? '' : String(c.preauth_amount),
      claimed_amount: c.claimed_amount == null ? '' : String(c.claimed_amount),
      approved_amount: c.approved_amount == null ? '' : String(c.approved_amount),
      received_amount: c.received_amount == null ? '' : String(c.received_amount),
      next_followup_date: c.next_followup_date ?? '',
      remarks: c.remarks ?? '',
    });
    setDialogOpen(true);
  };

  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  const save = async () => {
    if (!editing && !pickedVisit) {
      toast.error('Pick the patient visit this claim belongs to.');
      return;
    }
    const payload: Record<string, unknown> = {
      claim_no: form.claim_no.trim() || null,
      policy_no: form.policy_no.trim() || null,
      preauth_amount: num(form.preauth_amount),
      claimed_amount: num(form.claimed_amount),
      approved_amount: num(form.approved_amount),
      received_amount: num(form.received_amount),
      next_followup_date: form.next_followup_date || null,
      remarks: form.remarks.trim() || null,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (editing) {
      ({ error } = await sb.from('tpa_claims').update(payload).eq('id', editing.id));
    } else {
      ({ error } = await sb.from('tpa_claims').insert({
        ...payload,
        visit_id: pickedVisit!.id,
        visit_code: pickedVisit!.visit_id,
        patient_name: pickedVisit!.patient_name,
        corporate_name: pickedVisit!.corporate,
        preauth_date: todayISO(),
      }));
    }
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(editing ? 'Claim updated.' : 'Claim opened — pre-auth pending.');
    setDialogOpen(false);
    refresh();
  };

  const advance = async (c: Claim) => {
    const next = NEXT_STATUS[c.status];
    if (!next) return;
    const stamp: Record<string, unknown> = { status: next, updated_at: new Date().toISOString() };
    if (next === 'CLAIM_SUBMITTED' && !c.submission_date) stamp.submission_date = todayISO();
    if (next === 'SETTLED') stamp.settlement_date = todayISO();
    const { error } = await sb.from('tpa_claims').update(stamp).eq('id', c.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${c.patient_name ?? 'Claim'} → ${STATUS_LABEL[next]}`);
    refresh();
  };

  const setStatus = async (c: Claim, status: ClaimStatus) => {
    const { error } = await sb
      .from('tpa_claims')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', c.id);
    if (error) { toast.error(error.message); return; }
    refresh();
  };

  const today = todayISO();

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-indigo-600" />
            <div>
              <CardTitle>TPA / Insurance Claims</CardTitle>
              <p className="mt-0.5 text-xs text-gray-500">
                Pre-auth to settlement for private insurers and TPAs. Govt panels (PMJAY/MJPJAY/CGHS/ESIC) stay in their Yojana workflows.
              </p>
            </div>
          </div>
          <Button onClick={openNew} className="gap-1.5">
            <Plus className="h-4 w-4" /> New Claim
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Summary strip */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border p-2.5">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Open claims</div>
              <div className="text-lg font-bold">{totals.openCount}</div>
            </div>
            <div className="rounded-lg border p-2.5">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Claimed</div>
              <div className="text-lg font-bold">{fmtMoney(totals.claimed)}</div>
            </div>
            <div className="rounded-lg border p-2.5">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Approved</div>
              <div className="text-lg font-bold">{fmtMoney(totals.approved)}</div>
            </div>
            <div className="rounded-lg border p-2.5">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Received</div>
              <div className="text-lg font-bold text-emerald-700">{fmtMoney(totals.received)}</div>
              <div className="text-[10px] text-gray-400">
                Shortfall {fmtMoney(Math.max(0, totals.claimed - totals.received))}
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${statusFilter === 'all' ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 text-gray-700'}`}
            >
              All
            </button>
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${statusFilter === s ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-300 text-gray-700'}`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
            {tpas.length > 1 && (
              <select
                value={tpaFilter}
                onChange={(e) => setTpaFilter(e.target.value)}
                className="ml-auto rounded border border-gray-300 px-2 py-1 text-xs"
                aria-label="Filter by TPA"
              >
                <option value="all">All TPAs</option>
                {tpas.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}
          </div>

          {/* Claims list */}
          {isLoading ? (
            <div className="py-12 text-center text-sm text-gray-400">Loading claims…</div>
          ) : visible.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">
              No claims here yet. New Claim starts one from a TPA patient's visit.
            </div>
          ) : (
            <div className="divide-y rounded-lg border">
              {visible.map((c) => {
                const followupDue = c.next_followup_date && c.next_followup_date <= today &&
                  c.status !== 'SETTLED' && c.status !== 'DENIED';
                const next = NEXT_STATUS[c.status];
                return (
                  <div key={c.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 ${followupDue ? 'bg-rose-50/60' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => openEdit(c)} className="text-left">
                        <span className="font-medium hover:underline">{c.patient_name ?? '(unknown)'}</span>
                      </button>
                      <div className="text-xs text-gray-500">
                        {c.corporate_name ?? '—'} · {c.visit_code ?? ''}{c.claim_no ? ` · Claim ${c.claim_no}` : ''}
                        {followupDue ? ' · follow-up due' : c.next_followup_date ? ` · follow up ${c.next_followup_date}` : ''}
                      </div>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[c.status]}`}>
                      {STATUS_LABEL[c.status]}
                    </span>
                    <div className="w-40 text-right text-xs">
                      <div>Claimed {fmtMoney(c.claimed_amount ?? c.preauth_amount)}</div>
                      <div className="text-emerald-700">Received {fmtMoney(c.received_amount)}</div>
                    </div>
                    <div className="flex gap-1">
                      {next && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => advance(c)}>
                          → {STATUS_LABEL[next]}
                        </Button>
                      )}
                      {c.status !== 'DENIED' && c.status !== 'SETTLED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-rose-600 hover:bg-rose-50"
                          onClick={() => setStatus(c, c.status === 'QUERY_RAISED' ? 'DENIED' : 'QUERY_RAISED')}
                        >
                          {c.status === 'QUERY_RAISED' ? 'Deny' : 'Query'}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* New / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Claim — ${editing.patient_name ?? ''}` : 'New TPA claim'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {!editing && (
              <div>
                <label className="text-xs font-medium text-gray-600">Patient visit (TPA/insurance patients)</label>
                {pickedVisit ? (
                  <div className="mt-1 flex items-center justify-between rounded border bg-emerald-50 px-2 py-1.5 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{pickedVisit.patient_name}</span>
                      <span className="ml-1 text-xs text-gray-500">{pickedVisit.visit_id} · {pickedVisit.corporate}</span>
                    </span>
                    <button type="button" className="text-xs text-gray-500 underline" onClick={() => setPickedVisit(null)}>
                      change
                    </button>
                  </div>
                ) : (
                  <div className="relative mt-1">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <Input
                      value={visitSearch}
                      onChange={(e) => setVisitSearch(e.target.value)}
                      placeholder="Search patient name or visit ID…"
                      className="pl-8"
                    />
                    {visitOptions.length > 0 && (
                      <div className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded border bg-white shadow">
                        {visitOptions.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => setPickedVisit(v)}
                            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50"
                          >
                            <span className="font-medium">{v.patient_name}</span>
                            <span className="ml-1 text-xs text-gray-500">{v.visit_id} · {v.corporate}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-gray-600">Claim no.</label>
                <Input value={form.claim_no} onChange={(e) => setForm({ ...form, claim_no: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Policy no.</label>
                <Input value={form.policy_no} onChange={(e) => setForm({ ...form, policy_no: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Pre-auth amount</label>
                <Input inputMode="decimal" value={form.preauth_amount} onChange={(e) => setForm({ ...form, preauth_amount: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Claimed amount</label>
                <Input inputMode="decimal" value={form.claimed_amount} onChange={(e) => setForm({ ...form, claimed_amount: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Approved amount</label>
                <Input inputMode="decimal" value={form.approved_amount} onChange={(e) => setForm({ ...form, approved_amount: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Received amount</label>
                <Input inputMode="decimal" value={form.received_amount} onChange={(e) => setForm({ ...form, received_amount: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Next follow-up</label>
                <Input type="date" value={form.next_followup_date} onChange={(e) => setForm({ ...form, next_followup_date: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Remarks</label>
                <Input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? 'Save' : 'Open claim'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
