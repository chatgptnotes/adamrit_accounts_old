import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
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
import { GroupSearch, PRIMARY, type LedgerGroup } from './GroupCreation';

interface Ledger {
  id: string;
  code: string;
  name: string;
  alias: string | null;
  group_id: string | null;
  group_name: string | null;
  opening_balance: number | null;
  is_active: boolean | null;
}

const fmtINR = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));

// Ledger code derived from the name, e.g. "HDFC Bank A/c" -> "HDFC_BANK_A_C"
const codeFromName = (name: string): string =>
  name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);

const TallyLedgerCreation: React.FC = () => {
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [alias, setAlias] = useState('');
  const [under, setUnder] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingType, setOpeningType] = useState<'Dr' | 'Cr'>('Dr');
  const [saving, setSaving] = useState(false);

  const { data: groups = [] } = useQuery({
    queryKey: ['ledger_groups'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('ledger_groups').select('*').order('name');
      if (error) throw error;
      return (data ?? []) as LedgerGroup[];
    },
  });

  const { data: ledgers = [] } = useQuery({
    queryKey: ['ledgers_master'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ledgers')
        .select('id, code, name, alias, group_id, group_name, opening_balance, is_active')
        .order('name');
      if (error) throw error;
      return (data ?? []) as Ledger[];
    },
  });

  const handleClear = (): void => {
    setName('');
    setAlias('');
    setUnder('');
    setOpeningBalance('');
    setOpeningType('Dr');
  };

  const handleAccept = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Enter the ledger name');
      return;
    }
    if (!under || under === PRIMARY) {
      toast.error('Select the group (Under)');
      return;
    }
    const group = groups.find((g) => g.id === under);
    if (!group) {
      toast.error('Select a valid group');
      return;
    }
    const opening = (Number(openingBalance) || 0) * (openingType === 'Cr' ? -1 : 1);
    setSaving(true);
    try {
      const { error } = await (supabase as any).from('ledgers').insert({
        code: codeFromName(trimmed),
        name: trimmed,
        alias: alias.trim() || null,
        group_id: group.id,
        group_name: group.name,
        nature: group.nature,
        opening_balance: opening,
        current_balance: opening,
        is_active: true,
      });
      if (error) throw error;
      toast.success(`Ledger "${trimmed}" created`);
      queryClient.invalidateQueries({ queryKey: ['ledgers_master'] });
      handleClear();
    } catch (err: any) {
      console.error('Failed to create ledger:', err);
      toast.error(
        err?.code === '23505' ? 'A ledger with this name/code already exists' : 'Failed to save — please try again',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (l: Ledger): Promise<void> => {
    try {
      const { error } = await (supabase as any).from('ledgers').delete().eq('id', l.id);
      if (error) throw error;
      toast.info(`Ledger "${l.name}" deleted`);
      queryClient.invalidateQueries({ queryKey: ['ledgers_master'] });
    } catch (err: any) {
      console.error('Failed to delete ledger:', err);
      toast.error(
        err?.code === '23503' ? 'This ledger is in use and cannot be deleted' : 'Failed to delete — please try again',
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* ----- Tally-style Ledger Creation panel ----- */}
      <div className="overflow-hidden rounded-md border shadow-sm">
        <div className="bg-[#16437e] px-3 py-1.5 text-sm font-semibold text-white">Ledger Creation</div>

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
          <div className="mt-1 flex items-center gap-2">
            <span className="w-56 shrink-0 text-sm italic text-gray-600">(alias)</span>
            <span className="text-sm">:</span>
            <Input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              autoComplete="off"
              className="h-8 w-full max-w-md rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid"
            />
          </div>

          <div className="mt-6 flex items-center gap-2">
            <span className="w-56 shrink-0 text-sm">Under</span>
            <span className="text-sm">:</span>
            <GroupSearch groups={groups} value={under} onSelect={setUnder} includePrimary={false} />
          </div>

          <div className="mt-6 flex items-center gap-2 border-t border-gray-300 pt-3">
            <span className="w-56 shrink-0 text-sm">Opening Balance</span>
            <span className="text-sm">:</span>
            <Input
              type="number"
              inputMode="decimal"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              placeholder="0.00"
              className="h-8 w-40 rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-right font-mono shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <Select value={openingType} onValueChange={(v) => setOpeningType(v as 'Dr' | 'Cr')}>
              <SelectTrigger className="h-8 w-16 rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-sm font-semibold shadow-none focus:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Dr">Dr</SelectItem>
                <SelectItem value="Cr">Cr</SelectItem>
              </SelectContent>
            </Select>
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

      {/* ----- Existing ledgers ----- */}
      <div className="overflow-hidden rounded-md border shadow-sm">
        <div className="bg-[#16437e] px-3 py-1.5 text-sm font-semibold text-white">List of Ledgers</div>
        <Table>
          <TableHeader>
            <TableRow className="bg-[#f0f4fa]">
              <TableHead>Name</TableHead>
              <TableHead>Alias</TableHead>
              <TableHead>Under</TableHead>
              <TableHead className="text-right">Opening Balance</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledgers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-gray-400">
                  No ledgers yet.
                </TableCell>
              </TableRow>
            ) : (
              ledgers.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{l.alias || '-'}</TableCell>
                  <TableCell className="text-sm">{l.group_name || '-'}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {l.opening_balance
                      ? `${fmtINR(Number(l.opening_balance))} ${Number(l.opening_balance) >= 0 ? 'Dr' : 'Cr'}`
                      : '-'}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label="Delete ledger"
                      onClick={() => handleDelete(l)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default TallyLedgerCreation;
