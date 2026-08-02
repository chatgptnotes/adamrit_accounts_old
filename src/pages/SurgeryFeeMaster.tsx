import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Scissors, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Surgery Fees Payable — what the hospital pays the surgeon per procedure,
// decided beforehand: one PANEL rate (Yojana/corporate) and one PRIVATE
// rate. The procedure comes from the surgery master; the tag list carries
// related surgery names and corporate package names that map to the same
// row. The surgeon's system-generated invoice takes its amount from here.

interface FeeRow {
  id: string;
  procedure_name: string;
  surgery_id: string | null;
  tags: string[];
  panel_rate: number | null;
  private_rate: number | null;
  is_active: boolean;
}

interface Draft {
  id: string | null;
  procedure_name: string;
  surgery_id: string | null;
  tags: string[];
  panel_rate: string;
  private_rate: string;
}

const EMPTY: Draft = { id: null, procedure_name: '', surgery_id: null, tags: [], panel_rate: '', private_rate: '' };
const money = (v: number | null) => (v == null ? '—' : `₹ ${Number(v).toLocaleString('en-IN')}`);

const SurgeryFeeMaster = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [procSearch, setProcSearch] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['surgery-fee-master'],
    queryFn: async (): Promise<FeeRow[]> => {
      const { data, error } = await (supabase as any)
        .from('surgery_fee_master')
        .select('*')
        .eq('is_active', true)
        .order('procedure_name');
      if (error) throw error;
      return data || [];
    },
  });

  // The surgery master feeds the procedure picker — never free-typed.
  const { data: surgeries = [] } = useQuery({
    queryKey: ['surgery-fee-procedures', procSearch],
    enabled: !!draft && procSearch.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cghs_surgery')
        .select('id, name, code')
        .ilike('name', `%${procSearch.trim()}%`)
        .limit(10);
      if (error) throw error;
      return data || [];
    },
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.procedure_name.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag || !draft) return;
    if (!draft.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      setDraft({ ...draft, tags: [...draft.tags, tag] });
    }
    setTagInput('');
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.procedure_name.trim()) {
      toast.error('Pick the procedure from the surgery master');
      return;
    }
    if (!(Number(draft.panel_rate) > 0) && !(Number(draft.private_rate) > 0)) {
      toast.error('Enter at least one rate');
      return;
    }
    setSaving(true);
    try {
      const fields = {
        procedure_name: draft.procedure_name.trim(),
        surgery_id: draft.surgery_id,
        tags: draft.tags,
        panel_rate: Number(draft.panel_rate) > 0 ? Number(draft.panel_rate) : null,
        private_rate: Number(draft.private_rate) > 0 ? Number(draft.private_rate) : null,
      };
      const { error } = draft.id
        ? await (supabase as any).from('surgery_fee_master').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', draft.id)
        : await (supabase as any).from('surgery_fee_master').insert(fields);
      if (error) throw error;
      toast.success(`${fields.procedure_name} saved`);
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ['surgery-fee-master'] });
    } catch (error: any) {
      toast.error(error?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: FeeRow) => {
    if (!window.confirm(`Remove the fee row for ${row.procedure_name}?`)) return;
    const { error } = await (supabase as any)
      .from('surgery_fee_master')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    if (error) toast.error(error.message);
    else queryClient.invalidateQueries({ queryKey: ['surgery-fee-master'] });
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Scissors className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Surgery Fees Payable</h1>
            <p className="text-sm text-muted-foreground">
              What the surgeon is paid per procedure — panel and private rates, decided beforehand.
              The surgeon's invoice takes its amount from here.
            </p>
          </div>
        </div>
        <Button onClick={() => { setDraft({ ...EMPTY }); setProcSearch(''); setTagInput(''); }}>
          <Plus className="mr-2 h-4 w-4" /> Add procedure fee
        </Button>
      </div>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by procedure or tag…"
        className="max-w-md"
      />

      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No fee rows yet — add the procedures the surgeons are paid for.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Procedure name</TableHead>
                  <TableHead>Tags (related surgeries & corporate packages)</TableHead>
                  <TableHead className="text-right">Panel rate</TableHead>
                  <TableHead className="text-right">Private rate</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.procedure_name}</TableCell>
                    <TableCell>
                      <div className="flex max-w-md flex-wrap gap-1">
                        {row.tags.length ? row.tags.map((t) => (
                          <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-xs">{t}</span>
                        )) : <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{money(row.panel_rate)}</TableCell>
                    <TableCell className="text-right font-mono">{money(row.private_rate)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => {
                        setDraft({
                          id: row.id,
                          procedure_name: row.procedure_name,
                          surgery_id: row.surgery_id,
                          tags: row.tags,
                          panel_rate: row.panel_rate != null ? String(row.panel_rate) : '',
                          private_rate: row.private_rate != null ? String(row.private_rate) : '',
                        });
                        setProcSearch('');
                        setTagInput('');
                      }}>
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

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? `Edit ${draft.procedure_name}` : 'Add procedure fee'}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Procedure (search the surgery master)</Label>
                <div className="relative">
                  <Input
                    value={procSearch || draft.procedure_name}
                    onChange={(e) => {
                      setProcSearch(e.target.value);
                      setDraft({ ...draft, procedure_name: '', surgery_id: null });
                    }}
                    placeholder="Type to search the 2,000+ surgery master…"
                  />
                  {procSearch.trim().length >= 2 && surgeries.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-md border bg-background shadow-lg">
                      {surgeries.map((sg: any) => (
                        <button
                          key={sg.id}
                          type="button"
                          className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/60"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            setDraft({ ...draft, procedure_name: sg.name, surgery_id: sg.id });
                            setProcSearch('');
                          }}
                        >
                          {sg.name}
                          {sg.code ? <span className="ml-2 text-xs text-muted-foreground">{sg.code}</span> : null}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <Label>Tags — related surgery names & corporate package names</Label>
                <div className="flex gap-2">
                  <Input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                    placeholder="Type a name and press Enter"
                  />
                  <Button type="button" variant="outline" onClick={addTag}>Add</Button>
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {draft.tags.map((t) => (
                    <span key={t} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                      {t}
                      <button type="button" onClick={() => setDraft({ ...draft, tags: draft.tags.filter((x) => x !== t) })}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Panel rate (₹) — Yojana / corporate</Label>
                  <Input type="number" inputMode="decimal" value={draft.panel_rate} onChange={(e) => setDraft({ ...draft, panel_rate: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Private rate (₹)</Label>
                  <Input type="number" inputMode="decimal" value={draft.private_rate} onChange={(e) => setDraft({ ...draft, private_rate: e.target.value })} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
            <Button onClick={() => void save()} disabled={saving}>{draft?.id ? 'Save changes' : 'Add to master'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SurgeryFeeMaster;
