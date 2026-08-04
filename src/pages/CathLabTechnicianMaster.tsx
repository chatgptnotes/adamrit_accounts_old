import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LedgerAutocomplete, type LedgerAccountOption } from '@/components/accounting/LedgerAutocomplete';
import { upsertDoctorLedgerMap } from '@/lib/approval-queue-service';

// Cath Lab Technician master — the outsourced technicians the OT scheduling
// screen offers for the Cath Lab slot, with the per-case fee decided
// beforehand. Every technician MUST map to their party ledger: the assistant
// bill posts Cr to that account, so the master refuses to save without one.
// Saving also updates doctor_ledger_map, which is what pre-fills the ledgers
// on the technician's auto-raised OT bills.

interface TechRow {
  id: string;
  name: string;
  default_fee: number | null;
  party_account_id: string | null;
  is_active: boolean;
  chart_of_accounts?: { account_name: string; account_code: string | null } | null;
}

interface Draft {
  id: string | null;
  name: string;
  default_fee: string;
  ledger: LedgerAccountOption | null;
}

const EMPTY: Draft = { id: null, name: '', default_fee: '1000', ledger: null };
const money = (v: number | null) => (v == null ? '—' : `₹ ${Number(v).toLocaleString('en-IN')}`);

const CathLabTechnicianMaster = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newLedgerName, setNewLedgerName] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['cathlab-technicians'],
    queryFn: async (): Promise<TechRow[]> => {
      const { data, error } = await (supabase as any)
        .from('cathlab_technicians')
        .select('*, chart_of_accounts(account_name, account_code)')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? rows.filter((r) => r.name.toLowerCase().includes(term)) : rows;
  }, [rows, search]);

  // A technician we owe per-case fees is a creditor — same reasoning (and
  // same inline-create pattern) as the Relationship Manager master, with a
  // CLT_ code series to keep these apart from the Tally import codes.
  const createLedgerMutation = useMutation({
    mutationFn: async (ledgerName: string): Promise<LedgerAccountOption> => {
      const name = ledgerName.trim();
      if (!name) throw new Error('Enter the ledger name');

      const { data: existing } = await (supabase as any)
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_group, company_id')
        .ilike('account_name', name)
        .eq('is_active', true)
        .limit(1);
      if (existing?.length) return existing[0] as LedgerAccountOption;

      const { data: company } = await (supabase as any)
        .from('companies')
        .select('id')
        .eq('company_key', 'drm_pvt_ltd')
        .maybeSingle();

      const { data: lastCode } = await (supabase as any)
        .from('chart_of_accounts')
        .select('account_code')
        .like('account_code', 'CLT\\_%')
        .order('account_code', { ascending: false })
        .limit(1);
      const nextNumber = lastCode?.length
        ? Number(String(lastCode[0].account_code).split('_')[1] || 0) + 1
        : 1;

      const { data, error } = await (supabase as any)
        .from('chart_of_accounts')
        .insert({
          account_code: `CLT_${String(nextNumber).padStart(6, '0')}`,
          account_name: name,
          account_type: 'CURRENT_LIABILITIES',
          account_group: 'Sundry Creditors',
          company_id: company?.id ?? null,
          opening_balance: 0,
          opening_balance_type: 'CR',
          is_active: true,
        })
        .select('id, account_code, account_name, account_group, company_id')
        .single();
      if (error) throw error;
      return data as LedgerAccountOption;
    },
    onSuccess: (ledger) => {
      setDraft((d) => (d ? { ...d, ledger, name: d.name.trim() || ledger.account_name } : d));
      setNewLedgerName('');
      toast.success(`Ledger ${ledger.account_name} (${ledger.account_code}) is now in Sundry Creditors`);
    },
    onError: (error: any) => toast.error(error?.message || 'Could not create the ledger'),
  });

  const save = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) { toast.error('Enter the technician name'); return; }
    const fee = Number(draft.default_fee);
    if (!fee || fee <= 0) { toast.error('Enter the per-case fee'); return; }
    if (!draft.ledger) { toast.error("Search and pick the technician's ledger — the mapping is mandatory"); return; }
    setSaving(true);
    try {
      const fields = { name, default_fee: fee, party_account_id: draft.ledger.id };
      const { error } = draft.id
        ? await (supabase as any).from('cathlab_technicians').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', draft.id)
        : await (supabase as any).from('cathlab_technicians').insert(fields);
      if (error) throw error;

      // The OT auto-feed reads doctor_ledger_map to pre-fill the bill's
      // company and party ledger — keep it in step with this master.
      let companyId = draft.ledger.company_id;
      if (!companyId) {
        const { data: company } = await (supabase as any)
          .from('companies').select('id').eq('company_key', 'drm_pvt_ltd').maybeSingle();
        companyId = company?.id ?? null;
      }
      if (companyId) {
        await upsertDoctorLedgerMap({ surgeonName: name, companyId, partyAccountId: draft.ledger.id });
      }

      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ['cathlab-technicians'] });
    } catch (error: any) {
      toast.error(error?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: TechRow) => {
    if (!window.confirm(`Remove ${row.name} from the cath lab technicians?`)) return;
    const { error } = await (supabase as any)
      .from('cathlab_technicians')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) toast.error(error.message);
    else queryClient.invalidateQueries({ queryKey: ['cathlab-technicians'] });
  };

  const openEdit = async (row: TechRow) => {
    let ledger: LedgerAccountOption | null = null;
    if (row.party_account_id) {
      const { data } = await (supabase as any)
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_group, company_id')
        .eq('id', row.party_account_id)
        .maybeSingle();
      ledger = data || null;
    }
    setNewLedgerName('');
    setDraft({
      id: row.id,
      name: row.name,
      default_fee: row.default_fee != null ? String(row.default_fee) : '',
      ledger,
    });
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Wrench className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Cath Lab Technicians</h1>
            <p className="text-sm text-muted-foreground">
              The outsourced technicians the OT schedule can pick, with the per-case fee decided beforehand.
              Each one maps to their ledger — that account is what their bills pay into.
            </p>
          </div>
        </div>
        <Button onClick={() => { setDraft({ ...EMPTY }); setNewLedgerName(''); }}>
          <Plus className="mr-2 h-4 w-4" /> Add technician
        </Button>
      </div>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name…"
        className="max-w-md"
      />

      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No technicians yet — add the people the cath lab calls in per case.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Ledger</TableHead>
                  <TableHead className="text-right">Per-case fee</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      {row.chart_of_accounts ? (
                        <span>
                          {row.chart_of_accounts.account_name}
                          {row.chart_of_accounts.account_code ? (
                            <span className="ml-1 text-xs text-muted-foreground">({row.chart_of_accounts.account_code})</span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                          no ledger — edit and map one
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">{money(row.default_fee)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => void openEdit(row)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void remove(row)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!draft} onOpenChange={(open) => { if (!open && !saving) setDraft(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit technician' : 'Add technician'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                className="mt-1"
                value={draft?.name || ''}
                onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                placeholder="Technician name"
              />
            </div>
            <div>
              <Label className="text-xs">
                Cath Lab Technician ledger <span className="text-red-500">*</span>
              </Label>
              <div className="mt-1 space-y-2">
                <LedgerAutocomplete
                  value={draft?.ledger || null}
                  onChange={(ledger) => setDraft((d) => (d ? { ...d, ledger } : d))}
                  placeholder="Search the chart of ledgers by name..."
                />
                {!draft?.ledger && (
                  <div className="rounded-md border border-dashed p-2">
                    <p className="mb-2 text-xs text-muted-foreground">
                      Not in the chart of ledgers yet? Create one under Sundry Creditors.
                    </p>
                    <div className="flex gap-2">
                      <Input
                        value={newLedgerName}
                        onChange={(e) => setNewLedgerName(e.target.value)}
                        placeholder="Technician's ledger name"
                        className="h-9"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!newLedgerName.trim() || createLedgerMutation.isPending}
                        onClick={() => createLedgerMutation.mutate(newLedgerName)}
                      >
                        {createLedgerMutation.isPending ? 'Creating…' : 'Create ledger'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div>
              <Label className="text-xs">Per-case fee (₹)</Label>
              <Input
                type="number"
                className="mt-1"
                value={draft?.default_fee || ''}
                onChange={(e) => setDraft((d) => (d ? { ...d, default_fee: e.target.value } : d))}
                placeholder="1000"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setDraft(null)}>Cancel</Button>
            <Button disabled={saving} onClick={() => void save()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CathLabTechnicianMaster;
