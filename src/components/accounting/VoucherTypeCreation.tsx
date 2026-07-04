import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

interface VoucherType {
  id: string;
  voucher_type_code: string;
  voucher_type_name: string;
  voucher_category: string;
  prefix: string;
  current_number: number;
  is_active: boolean;
}

// Tally's "Select type of voucher" list, restricted to categories this app supports.
const CATEGORIES = [
  'PAYMENT',
  'RECEIPT',
  'CONTRA',
  'JOURNAL',
  'SALES',
  'PURCHASE',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
];

const VoucherTypeCreation: React.FC = () => {
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [prefix, setPrefix] = useState('');
  const [startNumber, setStartNumber] = useState('1');
  const [saving, setSaving] = useState(false);

  const { data: voucherTypes = [] } = useQuery({
    queryKey: ['voucher_types_all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('voucher_types')
        .select('*')
        .order('voucher_type_name');
      if (error) throw error;
      return (data ?? []) as VoucherType[];
    },
  });

  const handleClear = (): void => {
    setName('');
    setCategory('');
    setPrefix('');
    setStartNumber('1');
  };

  const handleAccept = async (): Promise<void> => {
    const trimmed = name.trim();
    const pfx = prefix.trim().toUpperCase();
    if (!trimmed) {
      toast.error('Enter the voucher type name');
      return;
    }
    if (!category) {
      toast.error('Select the type of voucher');
      return;
    }
    if (!pfx) {
      toast.error('Enter the abbreviation (prefix)');
      return;
    }
    const start = Math.max(1, Math.floor(Number(startNumber) || 1));
    setSaving(true);
    try {
      const { error } = await supabase.from('voucher_types').insert({
        voucher_type_code: pfx,
        voucher_type_name: trimmed,
        voucher_category: category,
        prefix: pfx,
        current_number: start - 1,
        is_active: true,
      });
      if (error) throw error;
      toast.success(`Voucher type "${trimmed}" created`);
      queryClient.invalidateQueries({ queryKey: ['voucher_types_all'] });
      queryClient.invalidateQueries({ queryKey: ['voucher_types'] });
      handleClear();
    } catch (err: any) {
      console.error('Failed to create voucher type:', err);
      toast.error(
        err?.code === '23505'
          ? 'A voucher type with this name/code already exists'
          : 'Failed to save — please try again',
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (vt: VoucherType): Promise<void> => {
    try {
      const { error } = await supabase
        .from('voucher_types')
        .update({ is_active: !vt.is_active })
        .eq('id', vt.id);
      if (error) throw error;
      toast.info(`"${vt.voucher_type_name}" ${vt.is_active ? 'deactivated' : 'activated'}`);
      queryClient.invalidateQueries({ queryKey: ['voucher_types_all'] });
      queryClient.invalidateQueries({ queryKey: ['voucher_types'] });
    } catch (err) {
      console.error('Failed to update voucher type:', err);
      toast.error('Failed to update — please try again');
    }
  };

  return (
    <div className="space-y-6">
      {/* ----- Tally-style Voucher Type Creation panel ----- */}
      <div className="overflow-hidden rounded-md border shadow-sm">
        <div className="bg-[#16437e] px-3 py-1.5 text-sm font-semibold text-white">Voucher Type Creation</div>

        <div className="bg-[#fffefb] px-4 pb-3 pt-3">
          <div className="flex items-center gap-2">
            <span className="w-56 shrink-0 text-sm">Name</span>
            <span className="text-sm">:</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              className="h-8 w-full max-w-md rounded-none border border-gray-400 bg-[#fdf6d8] px-2 shadow-none focus-visible:ring-0 focus-visible:border-blue-600"
            />
          </div>

          <div className="mt-6 flex items-center gap-2">
            <span className="w-56 shrink-0 text-sm">Select type of voucher</span>
            <span className="text-sm">:</span>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-8 w-56 rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-sm font-semibold shadow-none focus:ring-0">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="w-56 shrink-0 text-sm">Abbreviation (prefix)</span>
            <span className="text-sm">:</span>
            <Input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.toUpperCase())}
              autoComplete="off"
              placeholder="e.g. PV"
              className="h-8 w-28 rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 font-mono uppercase shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid"
            />
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="w-56 shrink-0 text-sm">Starting number</span>
            <span className="text-sm">:</span>
            <Input
              type="number"
              inputMode="numeric"
              value={startNumber}
              onChange={(e) => setStartNumber(e.target.value)}
              className="h-8 w-28 rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-right font-mono shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-1 border-t bg-[#dce6f2] px-2 py-1.5">
          <Button variant="outline" size="sm" className="h-7 bg-white text-xs" onClick={handleClear} disabled={saving}>
            <span className="mr-1 font-bold underline">Q</span>: Quit
          </Button>
          <Button
            size="sm"
            className="h-7 bg-[#16437e] text-xs hover:bg-[#0f3363]"
            onClick={handleAccept}
            disabled={saving}
          >
            <span className="mr-1 font-bold underline">A</span>: {saving ? 'Saving…' : 'Accept'}
          </Button>
        </div>
      </div>

      {/* ----- Existing voucher types ----- */}
      <div className="overflow-hidden rounded-md border shadow-sm">
        <div className="bg-[#16437e] px-3 py-1.5 text-sm font-semibold text-white">List of Voucher Types</div>
        <Table>
          <TableHeader>
            <TableRow className="bg-[#f0f4fa]">
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead className="text-right">Current No.</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {voucherTypes.map((vt) => (
              <TableRow key={vt.id} className={vt.is_active ? '' : 'opacity-50'}>
                <TableCell className="font-medium">{vt.voucher_type_name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{vt.voucher_category}</TableCell>
                <TableCell className="font-mono text-sm">{vt.prefix}</TableCell>
                <TableCell className="text-right font-mono text-sm">{vt.current_number}</TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => toggleActive(vt)}
                  >
                    {vt.is_active ? 'Active' : 'Inactive'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default VoucherTypeCreation;
