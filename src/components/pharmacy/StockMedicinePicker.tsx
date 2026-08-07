// Stock-aware medicine picker — searches medicine_master and shows live stock
// aggregated from medicine_batch_inventory, so a pharmacist can swap a
// prescription item for a medicine that is actually available.
import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useDebounce } from 'use-debounce';
import { Badge } from '@/components/ui/badge';
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
} from '@/components/ui/command';

const LOW_STOCK_THRESHOLD = 10;

export interface SelectedMedicine {
  medicineMasterId: string;
  name: string;
  generic: string;
  type: string;
  totalStock: number;
  fefoBatch: {
    batch_number: string;
    expiry_date: string;
    selling_price: number;
    mrp: number;
  } | null;
}

interface StockMedicinePickerProps {
  onSelect: (medicine: SelectedMedicine) => void;
}

const formatExpiry = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const StockMedicinePicker: React.FC<StockMedicinePickerProps> = ({ onSelect }) => {
  const [query, setQuery] = useState('');
  const [debouncedQuery] = useDebounce(query, 300);
  const [results, setResults] = useState<SelectedMedicine[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const run = async () => {
      // Strip characters that would break the PostgREST .or() filter syntax.
      const term = debouncedQuery.replace(/[%,()]/g, ' ').trim();
      if (term.length < 2) {
        setResults([]);
        return;
      }
      setIsSearching(true);
      try {
        // Step 1: search the medicine catalog.
        const { data: medicines, error: medError } = await supabase
          .from('medicine_master')
          .select('id, medicine_name, generic_name, type')
          .eq('is_deleted', false)
          .or(`medicine_name.ilike.%${term}%,generic_name.ilike.%${term}%`)
          .limit(20);

        if (medError || !medicines || medicines.length === 0) {
          setResults([]);
          setIsSearching(false);
          return;
        }

        // Step 2: pull in-stock batches (FEFO order) for those medicines.
        const medicineIds = medicines.map((m: any) => m.id);
        const { data: batches } = await supabase
          .from('medicine_batch_inventory')
          .select('medicine_id, batch_number, expiry_date, current_stock, selling_price, mrp')
          .in('medicine_id', medicineIds)
          .eq('is_active', true)
          .eq('is_expired', false)
          .gt('current_stock', 0)
          .order('expiry_date', { ascending: true });

        // Step 3: one result per medicine with stock aggregated across batches.
        const mapped: SelectedMedicine[] = medicines.map((med: any) => {
          const medBatches = (batches || []).filter((b: any) => b.medicine_id === med.id);
          const totalStock = medBatches.reduce(
            (sum: number, b: any) => sum + (b.current_stock || 0),
            0
          );
          const fefo = medBatches[0]; // already sorted by expiry ascending
          return {
            medicineMasterId: med.id,
            name: med.medicine_name,
            generic: med.generic_name || '',
            type: med.type || '',
            totalStock,
            fefoBatch: fefo
              ? {
                  batch_number: fefo.batch_number || '',
                  expiry_date: fefo.expiry_date || '',
                  selling_price: fefo.selling_price || 0,
                  mrp: fefo.mrp || 0,
                }
              : null,
          };
        });

        // In-stock medicines first, then alphabetical.
        mapped.sort((a, b) => {
          if ((a.totalStock > 0) !== (b.totalStock > 0)) return a.totalStock > 0 ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

        setResults(mapped);
      } catch (e) {
        console.error('Stock medicine search failed:', e);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    };
    run();
  }, [debouncedQuery]);

  const ready = debouncedQuery.replace(/[%,()]/g, ' ').trim().length >= 2;

  const handleSelect = (medicine: SelectedMedicine) => {
    onSelect(medicine);
    // The selection is displayed by the parent dialog. Collapse the result list
    // so its confirmation controls stay within reach on smaller tablet screens.
    setQuery('');
    setResults([]);
  };

  return (
    <Command shouldFilter={false} className="border rounded-md">
      <CommandInput
        placeholder="Search medicine by name or generic..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {isSearching && (
          <div className="py-4 text-center text-sm text-muted-foreground">Searching…</div>
        )}
        {!isSearching && !ready && (
          <div className="py-4 text-center text-sm text-muted-foreground">
            Type at least 2 characters to search.
          </div>
        )}
        {!isSearching && ready && results.length === 0 && (
          <div className="py-4 text-center text-sm text-muted-foreground">No medicines found.</div>
        )}
        {results.map((r) => {
          const out = r.totalStock <= 0;
          const low = !out && r.totalStock <= LOW_STOCK_THRESHOLD;
          return (
            <CommandItem
              key={r.medicineMasterId}
              value={r.medicineMasterId}
              onSelect={() => handleSelect(r)}
              className={`flex flex-col items-start gap-1 ${out ? 'opacity-60' : ''}`}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="font-medium text-sm">{r.name}</span>
                <Badge
                  className={
                    out
                      ? 'bg-red-100 text-red-700 border-red-200'
                      : low
                        ? 'bg-amber-100 text-amber-800 border-amber-200'
                        : 'bg-green-100 text-green-700 border-green-200'
                  }
                >
                  {out ? 'Out of stock' : low ? `Low: ${r.totalStock}` : `In stock: ${r.totalStock}`}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {[r.generic, r.type].filter(Boolean).join(' · ')}
                {r.fefoBatch
                  ? `${r.generic || r.type ? '  ·  ' : ''}MRP ₹${r.fefoBatch.mrp} · Exp ${formatExpiry(
                      r.fefoBatch.expiry_date
                    )}`
                  : ''}
              </div>
            </CommandItem>
          );
        })}
      </CommandList>
    </Command>
  );
};

export default StockMedicinePicker;
