import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { InventoryManagement } from '@/components/operation-room/inventory/InventoryManagement';
import type { InventoryItem } from '@/types/operation-theatre';

/**
 * Stores & Inventory.
 *
 * The screens already existed — 1,806 lines under components/operation-room/
 * inventory, built to take their data as props, and nothing ever passed any.
 * So they were unreachable and untested rather than absent. This is the data
 * layer they were waiting for; not one line of the UI is duplicated here.
 *
 * Stock changes go through record_stock_movement rather than an UPDATE from the
 * browser. A movement is two writes — the level on the item and the row in the
 * ledger explaining it — and done separately they drift: two people issuing the
 * same item both read 30, both write 25, and five units disappear from the
 * count while the ledger says ten went out. The function does both at once,
 * holds the row while it recalculates, and works the before/after out itself.
 *
 * inventory_items and stock_transactions are authenticated-only, so this is
 * also the first screen that depends on the signed-in database identity. If it
 * shows nothing while other screens work, that is the thing to suspect.
 */

const CATEGORIES = ['surgical_instruments', 'consumables', 'implants', 'medications', 'anesthesia_supplies'] as const;

export default function StoresInventory() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const who = user?.username || user?.email || 'staff';

  const inventory = useQuery({
    queryKey: ['stores-inventory'],
    queryFn: async (): Promise<InventoryItem[]> => {
      const { data, error } = await (supabase as any)
        .from('inventory_items')
        .select('*')
        .order('name');
      if (error) throw new Error(error.message);
      return (data ?? []) as InventoryItem[];
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['stores-inventory'] });

  const updateStock = useMutation({
    mutationFn: async ({ itemId, quantity, notes }: { itemId: string; quantity: number; notes?: string }) => {
      const { data, error } = await (supabase as any).rpc('record_stock_movement', {
        p_item_id: itemId,
        p_quantity_change: quantity,
        // The five the table's own check constraint allows. Anything else is
        // refused by the function before the level is touched.
        p_transaction_type: quantity > 0 ? 'addition' : 'consumption',
        p_notes: notes ?? null,
        p_performed_by: who,
      });
      if (error) throw new Error(error.message);
      return data as { newStock: number; name: string };
    },
    onSuccess: (r) => { toast.success(`${r.name}: now ${r.newStock} in stock.`); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not record the movement'),
  });

  const addItem = useMutation({
    mutationFn: async (item: Omit<InventoryItem, 'id'>) => {
      const { error } = await (supabase as any).from('inventory_items').insert({
        name: item.name,
        category: CATEGORIES.includes(item.category as any) ? item.category : 'consumables',
        current_stock: item.current_stock ?? 0,
        min_stock_level: item.min_stock_level ?? 0,
        max_stock_level: item.max_stock_level ?? 0,
        unit_cost: item.unit_cost ?? 0,
        supplier: item.supplier ?? null,
        expiry_date: item.expiry_date || null,
        batch_number: item.batch_number || null,
        sterilization_required: Boolean(item.sterilization_required),
        usage_per_day: item.usage_per_day ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success('Item added to stores.'); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not add the item'),
  });

  const updateItem = useMutation({
    mutationFn: async ({ itemId, updates }: { itemId: string; updates: Partial<InventoryItem> }) => {
      // current_stock is deliberately not updatable here. Changing a level
      // without a ledger row is how a count stops being explainable; that is
      // what record_stock_movement is for.
      const { current_stock: _ignored, id: _id, ...safe } = updates as any;
      const { error } = await (supabase as any)
        .from('inventory_items')
        .update({ ...safe, updated_at: new Date().toISOString() })
        .eq('id', itemId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success('Item updated.'); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update the item'),
  });

  const deleteItem = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await (supabase as any).from('inventory_items').delete().eq('id', itemId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast.success('Item removed from stores.'); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not remove the item'),
  });

  if (inventory.isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (inventory.error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="font-semibold text-red-800">Stores could not be loaded.</p>
          <p className="mt-1 text-sm text-red-700">
            {(inventory.error as Error).message}
          </p>
          <p className="mt-2 text-xs text-red-700">
            This screen needs a signed-in database identity. If other screens work and this
            one does not, that is what to check.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Stores &amp; Inventory</h1>
        <p className="text-sm text-muted-foreground">
          Stock levels, movements and reorder alerts. Every change in and out is recorded
          against the person who made it.
        </p>
      </div>

      <InventoryManagement
        inventory={inventory.data ?? []}
        onUpdateStock={(itemId, quantity, notes) => updateStock.mutate({ itemId, quantity, notes })}
        onAddItem={(item) => addItem.mutate(item)}
        onUpdateItem={(itemId, updates) => updateItem.mutate({ itemId, updates })}
        onDeleteItem={(itemId) => deleteItem.mutate(itemId)}
      />
    </div>
  );
}
