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

// Package Fees Payable — what the hospital pays the surgeon per package,
// decided beforehand: one YOJANA rate and one PRIVATE rate. The existing
// procedure_name column is retained as the stored package name for backwards
// compatibility. The surgeon's system-generated invoice takes its amount
// from here.

interface FeeRow {
  id: string;
  procedure_name: string;
  surgery_id: string | null;
  yojana_surgery_name: string | null;
  tags: string[];
  panel_rate: number | null;
  private_rate: number | null;
  is_active: boolean;
  // Who normally does this, and under what. Filled from the PMJAY/MJPJAY
  // package master where the names matched exactly; blank where they did not,
  // rather than guessed. Gaurav's OT tile pre-fills the schedule from these.
  default_surgeon_name: string | null;
  default_anaesthetist_name: string | null;
  anaesthesia_type: string | null;
}

interface Draft {
  id: string | null;
  procedure_name: string;
  surgery_id: string | null;
  yojana_surgery_name: string;
  tags: string[];
  panel_rate: string;
  private_rate: string;
  default_surgeon_name: string;
  default_anaesthetist_name: string;
  anaesthesia_type: string;
}

const EMPTY: Draft = {
  id: null, procedure_name: '', surgery_id: null, yojana_surgery_name: '', tags: [],
  panel_rate: '', private_rate: '',
  default_surgeon_name: '', default_anaesthetist_name: '', anaesthesia_type: '',
};
// A fee nobody has decided must not look like a decision — the OT bill
// auto-fill reads these, and a seeded placeholder would be paid as if real.
const money = (v: number | null) =>
  v == null ? 'Not set' : `₹ ${Number(v).toLocaleString('en-IN')}`;

const SurgeryFeeMaster = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showProcedureSuggestions, setShowProcedureSuggestions] = useState(false);
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

  // Existing surgery-master suggestions remain available, but package names
  // may also be entered manually when they are not in that master.
  const { data: surgeries = [] } = useQuery({
    queryKey: ['surgery-fee-procedures', draft?.procedure_name || ''],
    enabled: !!draft && draft.procedure_name.trim().length >= 2,
    queryFn: async () => {
      const packageSearch = draft?.procedure_name.trim() || '';
      const { data, error } = await supabase
        .from('cghs_surgery')
        .select('id, name, code')
        .ilike('name', `%${packageSearch}%`)
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
        (r.yojana_surgery_name || '').toLowerCase().includes(q) ||
        (r.default_surgeon_name || '').toLowerCase().includes(q) ||
        (r.default_anaesthetist_name || '').toLowerCase().includes(q) ||
        (r.anaesthesia_type || '').toLowerCase().includes(q) ||
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
      toast.error('Enter a package name');
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
        yojana_surgery_name: draft.yojana_surgery_name.trim() || null,
        tags: draft.tags,
        panel_rate: Number(draft.panel_rate) > 0 ? Number(draft.panel_rate) : null,
        private_rate: Number(draft.private_rate) > 0 ? Number(draft.private_rate) : null,
        default_surgeon_name: draft.default_surgeon_name.trim() || null,
        default_anaesthetist_name: draft.default_anaesthetist_name.trim() || null,
        anaesthesia_type: draft.anaesthesia_type.trim() || null,
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
    <div className="space-y-3 p-3 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Scissors className="h-5 w-5 shrink-0 text-primary" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Package Fees Payable</h1>
            <p className="text-xs text-muted-foreground">
              What the surgeon is paid per package — Yojana and private amounts, decided beforehand.
              The surgeon's invoice takes its amount from here.
            </p>
          </div>
        </div>
        <Button onClick={() => { setDraft({ ...EMPTY }); setShowProcedureSuggestions(false); setTagInput(''); }}>
          <Plus className="mr-1.5 h-4 w-4" /> Add package fee
        </Button>
      </div>

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by package, Yojana surgery name or keyword…"
        className="h-9 max-w-lg"
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
            <Table className="min-w-[980px] table-fixed">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="h-9 w-[17%] px-3 text-xs font-semibold">Package name</TableHead>
                  <TableHead className="h-9 w-[20%] px-3 text-xs font-semibold">Surgery name as per Yojana</TableHead>
                  <TableHead className="h-9 w-[17%] px-3 text-xs font-semibold">Keywords</TableHead>
                  <TableHead className="h-9 w-[19%] px-3 text-xs font-semibold">Surgeon / Anaesthetist</TableHead>
                  <TableHead className="h-9 w-[8%] px-3 text-xs font-semibold">Anaesthesia</TableHead>
                  <TableHead className="h-9 w-[8%] px-3 text-right text-xs font-semibold">Yojana amount</TableHead>
                  <TableHead className="h-9 w-[8%] px-3 text-right text-xs font-semibold">Private amount</TableHead>
                  <TableHead className="h-9 w-[3%] px-3 text-right text-xs font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      No packages yet — click “Add package fee” to create the first row.
                    </TableCell>
                  </TableRow>
                ) : visible.map((row) => (
                  <TableRow key={row.id} className="h-14 hover:bg-muted/20">
                    <TableCell className="px-3 py-2 align-middle text-sm font-medium">
                      <div className="line-clamp-2 leading-tight" title={row.procedure_name}>{row.procedure_name}</div>
                    </TableCell>
                    <TableCell className="px-3 py-2 align-middle text-sm">
                      <div className="line-clamp-2 leading-tight" title={row.yojana_surgery_name || undefined}>{row.yojana_surgery_name || <span className="text-xs text-muted-foreground">—</span>}</div>
                    </TableCell>
                    <TableCell className="px-3 py-2 align-middle">
                      <div className="flex max-w-full flex-wrap gap-1">
                        {row.tags.length ? row.tags.map((t) => (
                          <span key={t} className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] leading-none">{t}</span>
                        )) : <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2 align-middle text-sm">
                      {row.default_surgeon_name || row.default_anaesthetist_name ? (
                        <div className="leading-tight">
                          <div className="line-clamp-1" title={row.default_surgeon_name || undefined}>
                            {row.default_surgeon_name || <span className="text-xs text-muted-foreground">no surgeon</span>}
                          </div>
                          <div className="line-clamp-1 text-xs text-muted-foreground" title={row.default_anaesthetist_name || undefined}>
                            {row.default_anaesthetist_name || 'no anaesthetist'}
                          </div>
                        </div>
                      ) : (
                        // Not an error. These are only filled where the package
                        // name matched the Yojana master exactly; a guess here
                        // would put the wrong doctor on a payable.
                        <span className="text-xs text-muted-foreground">Not matched</span>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2 align-middle text-sm">
                      {row.anaesthesia_type
                        ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] capitalize">{row.anaesthesia_type}</span>
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className={`whitespace-nowrap px-3 py-2 text-right align-middle font-mono text-sm ${row.panel_rate == null ? 'text-amber-600' : ''}`}>
                      {money(row.panel_rate)}
                    </TableCell>
                    <TableCell className={`whitespace-nowrap px-3 py-2 text-right align-middle font-mono text-sm ${row.private_rate == null ? 'text-amber-600' : ''}`}>
                      {money(row.private_rate)}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right align-middle">
                      <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                        setDraft({
                          id: row.id,
                          procedure_name: row.procedure_name,
                          surgery_id: row.surgery_id,
                          yojana_surgery_name: row.yojana_surgery_name || '',
                          tags: row.tags,
                          panel_rate: row.panel_rate != null ? String(row.panel_rate) : '',
                          private_rate: row.private_rate != null ? String(row.private_rate) : '',
                          default_surgeon_name: row.default_surgeon_name || '',
                          default_anaesthetist_name: row.default_anaesthetist_name || '',
                          anaesthesia_type: row.anaesthesia_type || '',
                        });
                        setShowProcedureSuggestions(false);
                        setTagInput('');
                      }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => void remove(row)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? `Edit ${draft.procedure_name}` : 'Add package fee'}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Package name</Label>
                <div className="relative">
                  <Input
                    value={draft.procedure_name}
                    onPointerDown={() => setShowProcedureSuggestions(true)}
                    onBlur={() => window.setTimeout(() => setShowProcedureSuggestions(false), 150)}
                    onChange={(e) => {
                      setDraft({ ...draft, procedure_name: e.target.value, surgery_id: null });
                    }}
                    placeholder="Type a package name…"
                  />
                  {showProcedureSuggestions && draft.procedure_name.trim().length >= 2 && surgeries.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-md border bg-background shadow-lg">
                      {surgeries.map((sg: any) => (
                        <button
                          key={sg.id}
                          type="button"
                          className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/60"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            setDraft({ ...draft, procedure_name: sg.name, surgery_id: sg.id });
                            setShowProcedureSuggestions(false);
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
                <Label>Surgery name as per Yojana</Label>
                <Input
                  value={draft.yojana_surgery_name}
                  onChange={(e) => setDraft({ ...draft, yojana_surgery_name: e.target.value })}
                  placeholder="Enter the exact Yojana surgery name…"
                />
              </div>
              <div className="space-y-1">
                <Label>Keywords</Label>
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
                  <Label>Yojana amount (₹)</Label>
                  <Input type="number" inputMode="decimal" value={draft.panel_rate} onChange={(e) => setDraft({ ...draft, panel_rate: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Private amount (₹)</Label>
                  <Input type="number" inputMode="decimal" value={draft.private_rate} onChange={(e) => setDraft({ ...draft, private_rate: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Surgeon</Label>
                <Input
                  value={draft.default_surgeon_name}
                  onChange={(e) => setDraft({ ...draft, default_surgeon_name: e.target.value })}
                  placeholder="Who normally does this — separate several with commas"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Anaesthetist</Label>
                  <Input
                    value={draft.default_anaesthetist_name}
                    onChange={(e) => setDraft({ ...draft, default_anaesthetist_name: e.target.value })}
                    placeholder="Separate several with commas"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Anaesthesia type</Label>
                  <Input
                    list="anaesthesia-types"
                    value={draft.anaesthesia_type}
                    onChange={(e) => setDraft({ ...draft, anaesthesia_type: e.target.value })}
                    placeholder="general / spinal / sedation"
                  />
                  <datalist id="anaesthesia-types">
                    <option value="general" />
                    <option value="spinal" />
                    <option value="sedation" />
                  </datalist>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                These three pre-fill Gaurav’s OT schedule. The anaesthesia type also
                prices the anaesthetist, from the rates in Anaesthesia Fees — a type
                with no rate there pays nothing, so keep to the three above unless a
                rate exists for the new one.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
            <Button onClick={() => void save()} disabled={saving}>{draft?.id ? 'Save changes' : 'Add package'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SurgeryFeeMaster;
