import React, { useEffect, useMemo, useState } from 'react';
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

export interface LedgerGroup {
  id: string;
  name: string;
  alias: string | null;
  group_type: string;
  nature: string | null;
  parent_group_id: string | null;
  behaves_like_subledger: boolean;
  net_debit_credit_balances: boolean;
  used_for_calculation: boolean;
  allocation_method: string;
  is_predefined: boolean;
}

const NATURES: Record<string, { group_type: string; nature: string }> = {
  Assets: { group_type: 'Assets', nature: 'Debit' },
  Liabilities: { group_type: 'Liabilities', nature: 'Credit' },
  Income: { group_type: 'Income', nature: 'Credit' },
  Expenses: { group_type: 'Expenses', nature: 'Debit' },
};

const ALLOCATION_METHODS = ['Not Applicable', 'Appropriate by Qty', 'Appropriate by Value'];

// "Primary" is Tally's pseudo-parent for top-level groups.
export const PRIMARY = '__primary__';

// ---------------------------------------------------------------------------
// Under (parent group) search — Tally's "List of Groups" popup
// ---------------------------------------------------------------------------
interface GroupSearchProps {
  groups: LedgerGroup[];
  value: string; // group id or PRIMARY or ''
  onSelect: (value: string) => void;
  /** Offer Tally's "Primary" pseudo-parent (group creation only) */
  includePrimary?: boolean;
  /**
   * Groups that exist only as chart_of_accounts.account_group text — the real
   * Tally groups a company's imported ledgers sit under, which have no
   * ledger_groups row. Ledger Creation offers these so a new ledger can be
   * filed where its siblings already are.
   */
  extraOptions?: { id: string; label: string; detail: string }[];
}

export const GroupSearch = ({
  groups,
  value,
  onSelect,
  includePrimary = true,
  extraOptions = [],
}: GroupSearchProps) => {
  const selectedLabel =
    value === PRIMARY
      ? 'Primary'
      : groups.find((g) => g.id === value)?.name ?? extraOptions.find((o) => o.id === value)?.label ?? '';
  const [text, setText] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    setText(selectedLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, groups.length, extraOptions.length]);

  const options = useMemo(() => {
    const q = text.trim().toLowerCase();
    const list: { id: string; label: string; detail: string }[] = [
      ...(includePrimary ? [{ id: PRIMARY, label: 'Primary', detail: '' }] : []),
      ...groups.map((g) => ({
        id: g.id,
        label: g.name,
        detail: g.parent_group_id
          ? groups.find((p) => p.id === g.parent_group_id)?.name ?? ''
          : 'Primary',
      })),
      ...extraOptions,
    ];
    const filtered = q ? list.filter((o) => o.label.toLowerCase().includes(q)) : list;
    return filtered.slice(0, 20);
  }, [groups, text, includePrimary, extraOptions]);

  const pick = (id: string): void => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <div className="relative w-full max-w-md">
      <Input
        value={text}
        autoComplete="off"
        placeholder="Type to search group…"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => {
            setOpen(false);
            setText(selectedLabel);
          }, 150);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && options[highlight]) pick(options[highlight].id);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="h-8 border-0 border-b border-dashed border-gray-400 bg-transparent px-1 font-semibold shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid rounded-none"
      />
      {open && options.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-80 w-full min-w-[320px] overflow-y-auto rounded-md border bg-[#eef3fa] shadow-lg">
          <div className="border-b bg-[#16437e] px-3 py-1 text-xs font-semibold text-white">List of Groups</div>
          {options.map((o, i) => (
            <button
              type="button"
              key={o.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o.id)}
              onMouseEnter={() => setHighlight(i)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm ${
                i === highlight ? 'bg-[#fdf6d8]' : ''
              } ${o.id === PRIMARY ? 'font-semibold' : ''}`}
            >
              <span>{o.label}</span>
              {o.detail && <span className="text-xs text-muted-foreground">{o.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// A Tally-style "Yes/No" value — click to toggle.
const YesNo = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
  <button
    type="button"
    onClick={() => onChange(!value)}
    className="min-w-[48px] border-b border-dashed border-gray-400 px-2 py-0.5 text-left text-sm font-semibold hover:bg-[#fdf6d8]"
    title="Click to toggle"
  >
    {value ? 'Yes' : 'No'}
  </button>
);

const GroupCreation: React.FC = () => {
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [alias, setAlias] = useState('');
  const [under, setUnder] = useState<string>('');
  const [natureOfGroup, setNatureOfGroup] = useState('');
  const [subLedger, setSubLedger] = useState(false);
  const [netBalances, setNetBalances] = useState(false);
  const [usedForCalc, setUsedForCalc] = useState(false);
  const [allocationMethod, setAllocationMethod] = useState('Not Applicable');
  // When set, the form is in Tally's Group Alteration mode for this group
  const [editing, setEditing] = useState<LedgerGroup | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: groups = [] } = useQuery({
    queryKey: ['ledger_groups'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ledger_groups')
        .select('*')
        .order('name');
      if (error) throw error;
      return (data ?? []) as LedgerGroup[];
    },
  });

  const parentGroup = groups.find((g) => g.id === under);

  const handleClear = (): void => {
    setEditing(null);
    setName('');
    setAlias('');
    setUnder('');
    setNatureOfGroup('');
    setSubLedger(false);
    setNetBalances(false);
    setUsedForCalc(false);
    setAllocationMethod('Not Applicable');
  };

  // Load a group into the form (Tally's Group Alteration)
  const startEdit = (g: LedgerGroup): void => {
    setEditing(g);
    setName(g.name);
    setAlias(g.alias ?? '');
    setUnder(g.parent_group_id ?? PRIMARY);
    setNatureOfGroup(g.parent_group_id ? '' : g.group_type);
    setSubLedger(g.behaves_like_subledger);
    setNetBalances(g.net_debit_credit_balances);
    setUsedForCalc(g.used_for_calculation);
    setAllocationMethod(g.allocation_method || 'Not Applicable');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAccept = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Enter the group name');
      return;
    }
    if (!under) {
      toast.error('Select the parent group (Under)');
      return;
    }
    if (under === PRIMARY && !natureOfGroup) {
      toast.error('Select the Nature of Group for a primary group');
      return;
    }
    const typing =
      under === PRIMARY
        ? NATURES[natureOfGroup]
        : { group_type: parentGroup!.group_type, nature: parentGroup!.nature ?? 'Debit' };
    setSaving(true);
    try {
      if (editing) {
        // Alteration: predefined groups may change alias/behaviour only
        const patch: Record<string, unknown> = {
          alias: alias.trim() || null,
          behaves_like_subledger: subLedger,
          net_debit_credit_balances: netBalances,
          used_for_calculation: usedForCalc,
          allocation_method: allocationMethod,
        };
        if (!editing.is_predefined) {
          patch.name = trimmed;
          patch.parent_group_id = under === PRIMARY ? null : under;
          patch.group_type = typing.group_type;
          patch.nature = typing.nature;
        }
        const { error } = await (supabase as any).from('ledger_groups').update(patch).eq('id', editing.id);
        if (error) throw error;
        toast.success(`Group "${trimmed}" altered`);
        queryClient.invalidateQueries({ queryKey: ['ledger_groups'] });
        handleClear();
        return;
      }
      const { error } = await (supabase as any).from('ledger_groups').insert({
        name: trimmed,
        alias: alias.trim() || null,
        parent_group_id: under === PRIMARY ? null : under,
        group_type: typing.group_type,
        nature: typing.nature,
        behaves_like_subledger: subLedger,
        net_debit_credit_balances: netBalances,
        used_for_calculation: usedForCalc,
        allocation_method: allocationMethod,
        is_predefined: false,
      });
      if (error) throw error;
      toast.success(`Group "${trimmed}" created`);
      queryClient.invalidateQueries({ queryKey: ['ledger_groups'] });
      handleClear();
    } catch (err: any) {
      console.error('Failed to create group:', err);
      toast.error(
        err?.code === '23505' ? 'A group with this name already exists' : 'Failed to save — please try again',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (g: LedgerGroup): Promise<void> => {
    try {
      const { error } = await (supabase as any).from('ledger_groups').delete().eq('id', g.id);
      if (error) throw error;
      toast.info(`Group "${g.name}" deleted`);
      queryClient.invalidateQueries({ queryKey: ['ledger_groups'] });
    } catch (err: any) {
      console.error('Failed to delete group:', err);
      toast.error(
        err?.code === '23503'
          ? 'This group is in use (it has sub-groups or ledgers) and cannot be deleted'
          : 'Failed to delete — please try again',
      );
    }
  };

  const underLabel = (g: LedgerGroup): string =>
    g.parent_group_id ? groups.find((p) => p.id === g.parent_group_id)?.name ?? '' : 'Primary';

  return (
    <div className="space-y-6">
      {/* ----- Tally-style Group Creation panel ----- */}
      <div className="overflow-hidden rounded-md border shadow-sm">
        <div className="bg-[#16437e] px-3 py-1.5 text-sm font-semibold text-white">
          {editing ? `Group Alteration — ${editing.name}` : 'Group Creation'}
          {editing?.is_predefined ? ' (predefined: alias & behaviour only)' : ''}
        </div>

        <div className="bg-[#fffefb] px-4 pb-3 pt-3">
          {/* Name / alias */}
          <div className="flex items-center gap-2">
            <span className="w-56 shrink-0 text-sm">Name</span>
            <span className="text-sm">:</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              disabled={!!editing?.is_predefined}
              className="h-8 w-full max-w-md rounded-none border border-gray-400 bg-[#fdf6d8] px-2 shadow-none focus-visible:ring-0 focus-visible:border-blue-600 disabled:opacity-60"
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

          {/* Under */}
          <div className="mt-6 flex items-center gap-2">
            <span className="w-56 shrink-0 text-sm">Under</span>
            <span className="text-sm">:</span>
            <GroupSearch groups={groups} value={under} onSelect={setUnder} />
          </div>
          {under === PRIMARY && (
            <div className="mt-1 flex items-center gap-2">
              <span className="w-56 shrink-0 text-sm">Nature of Group</span>
              <span className="text-sm">:</span>
              <Select value={natureOfGroup} onValueChange={setNatureOfGroup}>
                <SelectTrigger className="h-8 w-48 rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-sm font-semibold shadow-none focus:ring-0">
                  <SelectValue placeholder="Select nature" />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(NATURES).map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Behaviour flags */}
          <div className="mt-6 border-t border-gray-300 pt-3">
            <div className="flex items-center gap-2 py-0.5">
              <span className="w-[420px] shrink-0 text-sm">Group behaves like a sub-ledger</span>
              <span className="text-sm">:</span>
              <YesNo value={subLedger} onChange={setSubLedger} />
            </div>
            <div className="flex items-center gap-2 py-0.5">
              <span className="w-[420px] shrink-0 text-sm">Nett Debit/Credit Balances for Reporting</span>
              <span className="text-sm">:</span>
              <YesNo value={netBalances} onChange={setNetBalances} />
            </div>
            <div className="flex items-start gap-2 py-0.5">
              <span className="w-[420px] shrink-0 text-sm">
                Used for calculation (for example: taxes, discounts)
                <span className="block text-xs italic text-gray-600">(for sales invoice entries)</span>
              </span>
              <span className="text-sm">:</span>
              <YesNo value={usedForCalc} onChange={setUsedForCalc} />
            </div>
            <div className="flex items-center gap-2 py-0.5">
              <span className="w-[420px] shrink-0 text-sm">Method to allocate when used in purchase invoice</span>
              <span className="text-sm">:</span>
              <Select value={allocationMethod} onValueChange={setAllocationMethod}>
                <SelectTrigger className="h-7 w-56 rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-sm font-semibold shadow-none focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALLOCATION_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Tally-style bottom action bar */}
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
            <span className="mr-1 font-bold underline">A</span>: {saving ? 'Saving…' : editing ? 'Accept (Alter)' : 'Accept'}
          </Button>
        </div>
      </div>

      {/* ----- Existing groups ----- */}
      <div className="overflow-hidden rounded-md border shadow-sm">
        <div className="bg-[#16437e] px-3 py-1.5 text-sm font-semibold text-white">List of Groups</div>
        <Table>
          <TableHeader>
            <TableRow className="bg-[#f0f4fa]">
              <TableHead>Name</TableHead>
              <TableHead>Alias</TableHead>
              <TableHead>Under</TableHead>
              <TableHead>Nature</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-gray-400">
                  No groups yet — run the ledger groups migration to seed Tally's predefined groups.
                </TableCell>
              </TableRow>
            ) : (
              groups.map((g) => (
                <TableRow
                  key={g.id}
                  onClick={() => startEdit(g)}
                  title="Alter group"
                  className={`cursor-pointer ${editing?.id === g.id ? 'bg-[#fdf6d8]' : ''}`}
                >
                  <TableCell className={g.parent_group_id ? 'pl-8' : 'font-semibold'}>{g.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{g.alias || '-'}</TableCell>
                  <TableCell className="text-sm">{underLabel(g)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {g.group_type}
                    {g.nature ? ` · ${g.nature}` : ''}
                  </TableCell>
                  <TableCell>
                    {!g.is_predefined && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label="Delete group"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(g);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    )}
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

export default GroupCreation;
