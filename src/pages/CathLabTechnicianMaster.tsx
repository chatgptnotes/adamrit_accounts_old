import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Cath Lab Technician master — the outsourced technicians the OT scheduling
// screen offers for the Cath Lab slot, with the per-case fee decided
// beforehand. Picking one on the tablet prefills this fee on their bill.

interface TechRow {
  id: string;
  name: string;
  default_fee: number | null;
  is_active: boolean;
}

interface Draft {
  id: string | null;
  name: string;
  default_fee: string;
}

const EMPTY: Draft = { id: null, name: '', default_fee: '1000' };
const money = (v: number | null) => (v == null ? '—' : `₹ ${Number(v).toLocaleString('en-IN')}`);

const CathLabTechnicianMaster = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['cathlab-technicians'],
    queryFn: async (): Promise<TechRow[]> => {
      const { data, error } = await (supabase as any)
        .from('cathlab_technicians')
        .select('*')
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

  const save = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) { toast.error('Enter the technician name'); return; }
    const fee = Number(draft.default_fee);
    if (!fee || fee <= 0) { toast.error('Enter the per-case fee'); return; }
    setSaving(true);
    try {
      const fields = { name, default_fee: fee };
      const { error } = draft.id
        ? await (supabase as any).from('cathlab_technicians').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', draft.id)
        : await (supabase as any).from('cathlab_technicians').insert(fields);
      if (error) throw error;
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

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Wrench className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Cath Lab Technicians</h1>
            <p className="text-sm text-muted-foreground">
              The outsourced technicians the OT schedule can pick, with the per-case fee decided beforehand.
            </p>
          </div>
        </div>
        <Button onClick={() => setDraft({ ...EMPTY })}>
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
                  <TableHead className="text-right">Per-case fee</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right font-mono">{money(row.default_fee)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDraft({
                          id: row.id,
                          name: row.name,
                          default_fee: row.default_fee != null ? String(row.default_fee) : '',
                        })}
                      >
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
        <DialogContent className="max-w-sm">
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
