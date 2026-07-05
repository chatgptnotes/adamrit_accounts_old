import React, { useMemo, useState } from 'react';
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
  // Mailing / Banking / Tax details (Tally Ledger Creation right panel)
  const [mailingName, setMailingName] = useState('');
  const [address, setAddress] = useState('');
  const [stateName, setStateName] = useState('Maharashtra');
  const [country, setCountry] = useState('India');
  const [pincode, setPincode] = useState('');
  const [provideBank, setProvideBank] = useState(false);
  const [bankName, setBankName] = useState('');
  const [bankBranch, setBankBranch] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [pan, setPan] = useState('');
  const [gstin, setGstin] = useState('');
  // When set, the form is in Tally's Ledger Alteration mode
  const [editing, setEditing] = useState<any | null>(null);
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
        .select('*')
        .order('name');
      if (error) throw error;
      return (data ?? []) as Ledger[];
    },
  });

  // Tally's Total Opening Balance panel (top-right): Dr vs Cr across ledgers
  const totalOpening = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const l of ledgers) {
      const v = Number(l.opening_balance) || 0;
      if (v > 0) dr += v;
      else cr += -v;
    }
    const pending = Number(openingBalance) || 0;
    if (pending > 0) {
      if (openingType === 'Dr') dr += pending;
      else cr += pending;
    }
    return { dr, cr };
  }, [ledgers, openingBalance, openingType]);

  const startEdit = (l: any): void => {
    setEditing(l);
    setName(l.name ?? '');
    setAlias(l.alias ?? '');
    setUnder(l.group_id ?? '');
    const ob = Number(l.opening_balance) || 0;
    setOpeningBalance(ob ? String(Math.abs(ob)) : '');
    setOpeningType(ob < 0 ? 'Cr' : 'Dr');
    setMailingName(l.mailing_name ?? '');
    setAddress(l.address ?? '');
    setStateName(l.state ?? 'Maharashtra');
    setCountry(l.country ?? 'India');
    setPincode(l.pincode ?? '');
    const hasBank = !!(l.bank_name || l.account_number || l.ifsc_code);
    setProvideBank(hasBank);
    setBankName(l.bank_name ?? '');
    setBankBranch(l.bank_branch ?? '');
    setAccountNumber(l.account_number ?? '');
    setIfsc(l.ifsc_code ?? '');
    setPan(l.pan ?? '');
    setGstin(l.gstin ?? '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleClear = (): void => {
    setEditing(null);
    setName('');
    setAlias('');
    setUnder('');
    setOpeningBalance('');
    setOpeningType('Dr');
    setMailingName('');
    setAddress('');
    setStateName('Maharashtra');
    setCountry('India');
    setPincode('');
    setProvideBank(false);
    setBankName('');
    setBankBranch('');
    setAccountNumber('');
    setIfsc('');
    setPan('');
    setGstin('');
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
      if (editing) {
        const { error } = await (supabase as any)
          .from('ledgers')
          .update({
            name: trimmed,
            alias: alias.trim() || null,
            group_id: group.id,
            group_name: group.name,
            nature: group.nature === 'Credit' ? 'Cr' : group.nature === 'Debit' ? 'Dr' : null,
            opening_balance: opening,
            mailing_name: mailingName.trim() || trimmed,
            address: address.trim() || null,
            state: stateName.trim() || null,
            country: country.trim() || null,
            pincode: pincode.trim() || null,
            bank_name: provideBank ? bankName.trim() || null : null,
            bank_branch: provideBank ? bankBranch.trim() || null : null,
            account_number: provideBank ? accountNumber.trim() || null : null,
            ifsc_code: provideBank ? ifsc.trim() || null : null,
            pan: pan.trim() || null,
            gstin: gstin.trim() || null,
          })
          .eq('id', editing.id);
        if (error) throw error;
        toast.success(`Ledger "${trimmed}" altered`);
        queryClient.invalidateQueries({ queryKey: ['ledgers_master'] });
        handleClear();
        return;
      }
      const { error } = await (supabase as any).from('ledgers').insert({
        code: codeFromName(trimmed),
        name: trimmed,
        alias: alias.trim() || null,
        group_id: group.id,
        group_name: group.name,
        // ledgers.nature has a legacy CHECK constraint allowing only 'Dr'/'Cr'
        nature: group.nature === 'Credit' ? 'Cr' : group.nature === 'Debit' ? 'Dr' : null,
        opening_balance: opening,
        current_balance: opening,
        is_active: true,
        mailing_name: mailingName.trim() || trimmed,
        address: address.trim() || null,
        state: stateName.trim() || null,
        country: country.trim() || null,
        pincode: pincode.trim() || null,
        bank_name: provideBank ? bankName.trim() || null : null,
        bank_branch: provideBank ? bankBranch.trim() || null : null,
        account_number: provideBank ? accountNumber.trim() || null : null,
        ifsc_code: provideBank ? ifsc.trim() || null : null,
        pan: pan.trim() || null,
        gstin: gstin.trim() || null,
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
        <div className="bg-[#16437e] px-3 py-1.5 text-sm font-semibold text-white">
          {editing ? `Ledger Alteration — ${editing.name}` : 'Ledger Creation'}
        </div>

        <div className="bg-[#fffefb] px-4 pb-3 pt-3">
          {/* Total Opening Balance panel, Tally top-right */}
          <div className="float-right w-64 border border-gray-400 bg-white px-3 py-2 text-right text-sm">
            <div className="border-b border-gray-300 pb-1 font-bold">Total Opening Balance</div>
            <div className="mt-1 font-mono">{new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(totalOpening.dr)} Dr</div>
            <div className="font-mono">{new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(totalOpening.cr)} Cr</div>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-40 shrink-0 text-sm">Name</span>
            <span className="text-sm">:</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              className="h-8 w-full max-w-md rounded-none border border-gray-400 bg-[#fdf6d8] px-2 shadow-none focus-visible:ring-0 focus-visible:border-blue-600"
            />
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="w-40 shrink-0 text-sm italic text-gray-600">(alias)</span>
            <span className="text-sm">:</span>
            <Input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              autoComplete="off"
              className="h-8 w-full max-w-md rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid"
            />
          </div>

          <div className="mt-4 clear-none flex gap-8">
            {/* Left column: Under + Opening */}
            <div className="w-[46%] shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-40 shrink-0 text-sm">Under</span>
                <span className="text-sm">:</span>
                <GroupSearch groups={groups} value={under} onSelect={setUnder} includePrimary={false} />
              </div>

              <div className="mt-6 flex items-center gap-2 border-t border-gray-300 pt-3">
                <span className="w-40 shrink-0 text-sm">Opening Balance</span>
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

            {/* Right column: Mailing / Banking / Tax, like Tally's image */}
            <div className="min-w-0 flex-1 text-sm">
              <div className="border-b border-gray-400 font-semibold">Mailing Details</div>
              {[
                ['Name', mailingName, setMailingName, name || ''],
                ['Address', address, setAddress, ''],
                ['State', stateName, setStateName, ''],
                ['Country', country, setCountry, ''],
                ['Pincode', pincode, setPincode, ''],
              ].map(([label, value, setter, ph]: any) => (
                <div key={label} className="mt-0.5 flex items-center gap-2">
                  <span className="w-24 shrink-0">{label}</span>
                  <span>:</span>
                  <Input
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    placeholder={ph}
                    autoComplete="off"
                    className="h-7 w-full rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid"
                  />
                </div>
              ))}

              <div className="mt-3 border-b border-gray-400 font-semibold">Banking Details</div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="w-40 shrink-0">Provide bank details</span>
                <span>:</span>
                <button
                  type="button"
                  onClick={() => setProvideBank((v) => !v)}
                  className="min-w-[44px] border-b border-dashed border-gray-400 px-2 text-left font-semibold hover:bg-[#fdf6d8]"
                >
                  {provideBank ? 'Yes' : 'No'}
                </button>
              </div>
              {provideBank &&
                [
                  ['Bank name', bankName, setBankName],
                  ['Branch', bankBranch, setBankBranch],
                  ['A/c number', accountNumber, setAccountNumber],
                  ['IFSC code', ifsc, setIfsc],
                ].map(([label, value, setter]: any) => (
                  <div key={label} className="mt-0.5 flex items-center gap-2">
                    <span className="w-24 shrink-0">{label}</span>
                    <span>:</span>
                    <Input
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                      autoComplete="off"
                      className="h-7 w-full rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid"
                    />
                  </div>
                ))}

              <div className="mt-3 border-b border-gray-400 font-semibold">Tax Registration Details</div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="w-24 shrink-0">PAN/IT No.</span>
                <span>:</span>
                <Input
                  value={pan}
                  onChange={(e) => setPan(e.target.value.toUpperCase())}
                  autoComplete="off"
                  className="h-7 w-full rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 font-mono text-sm uppercase shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid"
                />
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="w-24 shrink-0">GSTIN/UIN</span>
                <span>:</span>
                <Input
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase())}
                  autoComplete="off"
                  className="h-7 w-full rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 font-mono text-sm uppercase shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid"
                />
              </div>
            </div>
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
                <TableRow
                  key={l.id}
                  onClick={() => startEdit(l)}
                  title="Alter ledger"
                  className={`cursor-pointer ${editing?.id === l.id ? 'bg-[#fdf6d8]' : ''}`}
                >
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
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(l);
                      }}
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
