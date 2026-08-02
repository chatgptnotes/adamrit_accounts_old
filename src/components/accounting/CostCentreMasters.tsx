import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Category {
  id: string;
  name: string;
}

interface Centre {
  id: string;
  name: string;
  alias: string | null;
  category_id: string | null;
}

/**
 * Tally's Cost Category / Cost Centre masters over the existing
 * cost_categories and cost_centres tables (already used by the Cost Centre
 * Breakup report). Create, rename and deactivate.
 */
const CostCentreMasters: React.FC<{ kind: 'category' | 'centre' }> = ({ kind }) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [alias, setAlias] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ['cost_categories', 'masters'],
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await (supabase as any)
        .from('cost_categories')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: centres = [] } = useQuery({
    queryKey: ['cost_centres', 'masters'],
    enabled: kind === 'centre',
    queryFn: async (): Promise<Centre[]> => {
      const { data, error } = await (supabase as any)
        .from('cost_centres')
        .select('id, name, alias, category_id')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['cost_categories'] });
    queryClient.invalidateQueries({ queryKey: ['cost_centres'] });
  };

  const reset = () => {
    setEditingId(null);
    setName('');
    setAlias('');
    setCategoryId('');
  };

  const save = async () => {
    if (!name.trim()) {
      toast.error('Name is required.');
      return;
    }
    const table = kind === 'category' ? 'cost_categories' : 'cost_centres';
    const payload: Record<string, unknown> =
      kind === 'category'
        ? { name: name.trim() }
        : { name: name.trim(), alias: alias.trim() || null, category_id: categoryId || null };
    const { error } = editingId
      ? await (supabase as any).from(table).update(payload).eq('id', editingId)
      : await (supabase as any).from(table).insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success(editingId ? 'Saved.' : 'Created.');
    reset();
    refresh();
  };

  const deactivate = async (id: string) => {
    const table = kind === 'category' ? 'cost_categories' : 'cost_centres';
    const { error } = await (supabase as any).from(table).update({ is_active: false }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    if (editingId === id) reset();
    refresh();
  };

  const list: { id: string; label: string; sub?: string }[] =
    kind === 'category'
      ? categories.map((c) => ({ id: c.id, label: c.name }))
      : centres.map((c) => ({
          id: c.id,
          label: c.name,
          sub: categories.find((cat) => cat.id === c.category_id)?.name,
        }));

  const startEdit = (id: string) => {
    setEditingId(id);
    if (kind === 'category') {
      const c = categories.find((x) => x.id === id);
      setName(c?.name ?? '');
    } else {
      const c = centres.find((x) => x.id === id);
      setName(c?.name ?? '');
      setAlias(c?.alias ?? '');
      setCategoryId(c?.category_id ?? '');
    }
  };

  return (
    <div className="mx-auto max-w-[560px] border border-[#8fb0d4] bg-[#dfeaf7] text-sm">
      <div className="bg-[#2a68a8] px-3 py-1.5 font-semibold text-white">
        {kind === 'category' ? 'Cost Categories' : 'Cost Centres'}
      </div>

      <div className="border-b border-[#b8c9dd] p-3">
        <div className="grid grid-cols-[7rem_1fr] items-center gap-y-2">
          <span>Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-7 rounded-none bg-[#fdf6d8]" />
          {kind === 'centre' && (
            <>
              <span>Alias</span>
              <Input value={alias} onChange={(e) => setAlias(e.target.value)} className="h-7 rounded-none bg-[#fdf6d8]" />
              <span>Under Category</span>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="h-7 rounded-none border border-input bg-[#fdf6d8] px-2"
              >
                <option value="">— Primary —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </>
          )}
        </div>
        <div className="mt-2 flex gap-2">
          <Button size="sm" className="h-7 rounded-none text-xs" onClick={save}>
            {editingId ? 'Save Changes' : 'Create'}
          </Button>
          {editingId && (
            <Button variant="outline" size="sm" className="h-7 rounded-none text-xs" onClick={reset}>
              New instead
            </Button>
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <p className="px-3 py-5 text-center text-gray-600">Nothing here yet.</p>
      ) : (
        list.map((item) => (
          <div key={item.id} className="flex items-center border-b border-white px-3 py-1 hover:bg-[#fdf6d8]">
            <button type="button" className="min-w-0 flex-1 truncate text-left text-[#1a4d8f]" onClick={() => startEdit(item.id)}>
              {item.label}
              {item.sub && <span className="ml-2 text-xs text-gray-500">under {item.sub}</span>}
            </button>
            <button type="button" className="ml-2 text-xs text-red-700 hover:underline" onClick={() => deactivate(item.id)}>
              Deactivate
            </button>
          </div>
        ))
      )}
    </div>
  );
};

export default CostCentreMasters;
