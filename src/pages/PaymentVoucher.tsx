import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Trash2, Printer, RotateCcw, X } from 'lucide-react';
import { pushLedgerToTally, pushPaymentVoucherToTally } from '@/lib/tally-auto-push';

interface PaymentVoucher {
  id: string;
  voucher_no: string;
  voucher_date: string;
  person_name: string;
  amount: number;
  purpose: string | null;
  paid_by: string | null;
  account_ledger_name: string | null;
  narration: string | null;
  created_at: string;
}

interface LedgerOption {
  id: string;
  name: string;
  parent_group: string | null;
  closing_balance: number | null;
}

interface TallyConfigRow {
  id: string;
  company_name: string;
  server_url: string;
}

interface VoucherLine {
  key: number;
  ledger: LedgerOption | null;
  amount: string;
}

const todayISO = (): string => new Date().toISOString().slice(0, 10);

const daysAgoISO = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

const fmtINR = (n: number | null | undefined): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
};

const dedupeLedgerOptions = (items: LedgerOption[]): LedgerOption[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const formatDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Tally-style short date, e.g. "4-Jul-26"
const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

const dayName = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { weekday: 'long' });
};

const escapeHTML = (s: string): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// ---------------------------------------------------------------------------
// Ledger search input — type to search tally_ledgers, pick with ↑/↓ + Enter
// ---------------------------------------------------------------------------
interface LedgerSearchProps {
  selected: LedgerOption | null;
  onSelect: (ledger: LedgerOption | null) => void;
  placeholder?: string;
  className?: string;
  inputRef?: (el: HTMLInputElement | null) => void;
  /** Enter pressed on an empty field (Tally: end of particulars entry) */
  onEmptyEnter?: () => void;
}

const LedgerSearch = ({ selected, onSelect, placeholder, className, inputRef, onEmptyEnter }: LedgerSearchProps) => {
  const [text, setText] = useState(selected?.name ?? '');
  const [options, setOptions] = useState<LedgerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [parentGroup, setParentGroup] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [groupOptions, setGroupOptions] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setText(selected?.name ?? '');
  }, [selected]);

  const trimmedText = text.trim();
  const canCreate =
    trimmedText.length > 0 &&
    !options.some((o) => o.name.trim().toLowerCase() === trimmedText.toLowerCase());

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      try {
        let query = (supabase as any)
          .from('tally_ledgers')
          .select('id, name, parent_group, closing_balance')
          .or('is_hidden.is.null,is_hidden.eq.false')
          .order('name')
          .limit(15);
        if (text.trim()) query = query.ilike('name', `%${text.trim()}%`);
        const { data, error } = await query;
        if (error) throw error;
        setOptions(dedupeLedgerOptions((data ?? []) as LedgerOption[]));
        setHighlight(0);
      } catch (err) {
        console.error('Ledger search failed:', err);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [text, open]);

  useEffect(() => {
    if (!createOpen) return;
    let cancelled = false;
    const loadGroups = async (): Promise<void> => {
      try {
        const [{ data: tallyGroups }, { data: ledgers }] = await Promise.all([
          (supabase as any).from('tally_groups').select('name').order('name').limit(300),
          (supabase as any).from('tally_ledgers').select('parent_group').not('parent_group', 'is', null).limit(1000),
        ]);
        if (cancelled) return;
        const names = new Set<string>();
        for (const g of tallyGroups ?? []) {
          if (g?.name) names.add(String(g.name));
        }
        for (const l of ledgers ?? []) {
          if (l?.parent_group) names.add(String(l.parent_group));
        }
        setGroupOptions([...names].sort((a, b) => a.localeCompare(b)));
      } catch (err) {
        console.error('Failed to load ledger groups:', err);
      }
    };
    loadGroups();
    return () => {
      cancelled = true;
    };
  }, [createOpen]);

  const pick = (l: LedgerOption): void => {
    onSelect(l);
    setOpen(false);
  };

  const openCreate = (): void => {
    const name = trimmedText;
    if (!name) return;
    setCreateName(name);
    setParentGroup('');
    setOpeningBalance('');
    setCreateOpen(true);
    setOpen(false);
  };

  const getActiveTallyConfig = async (): Promise<TallyConfigRow | null> => {
    try {
      const { data } = await (supabase as any)
        .from('tally_config')
        .select('id, company_name, server_url')
        .eq('is_active', true)
        .limit(1)
        .single();
      return (data ?? null) as TallyConfigRow | null;
    } catch {
      return null;
    }
  };

  const findLedgerByName = async (name: string, companyId?: string | null): Promise<LedgerOption | null> => {
    let query = (supabase as any)
      .from('tally_ledgers')
      .select('id, name, parent_group, closing_balance')
      .ilike('name', name)
      .or('is_hidden.is.null,is_hidden.eq.false')
      .order('name')
      .limit(1);
    if (companyId) query = query.eq('company_id', companyId);
    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? [])[0] ?? null) as LedgerOption | null;
  };

  const handleCreateLedger = async (): Promise<void> => {
    const name = createName.trim();
    const group = parentGroup.trim();
    const opening = Number(openingBalance) || 0;
    if (!name) {
      toast.error('Enter the ledger name');
      return;
    }
    if (!group) {
      toast.error('Select or enter the Under group');
      return;
    }

    setCreating(true);
    try {
      const tallyConfig = await getActiveTallyConfig();
      const existing = await findLedgerByName(name, tallyConfig?.id);
      if (existing) {
        pick(existing);
        setCreateOpen(false);
        toast.info(`Ledger "${existing.name}" already exists`);
        return;
      }

      const { data: inserted, error } = await (supabase as any)
        .from('tally_ledgers')
        .insert({
          name,
          parent_group: group,
          opening_balance: opening,
          closing_balance: opening,
          is_hidden: false,
          company_id: tallyConfig?.id ?? null,
          last_synced_at: null,
        })
        .select('id, name, parent_group, closing_balance')
        .single();

      if (error) {
        if (error.code === '23505') {
          const duplicate = (await findLedgerByName(name, tallyConfig?.id)) || (await findLedgerByName(name, null));
          if (duplicate) {
            pick(duplicate);
            setCreateOpen(false);
            toast.info(`Ledger "${duplicate.name}" already exists`);
            return;
          }
        }
        throw error;
      }

      const created = inserted as LedgerOption;
      pick(created);
      setText(created.name);
      setOptions((prev) => dedupeLedgerOptions([created, ...prev.filter((l) => l.id !== created.id)]));
      setCreateOpen(false);

      const tallyResult = await pushLedgerToTally({
        name,
        parentGroup: group,
        openingBalance: opening,
        companyId: tallyConfig?.id ?? null,
      });

      if (tallyResult.status === 'synced') {
        toast.success(`Ledger "${name}" created in Adamrit and Tally`);
      } else {
        toast.warning(`Ledger "${name}" saved in Adamrit; Tally creation queued`);
      }
    } catch (err: any) {
      console.error('Failed to create ledger:', err);
      toast.error(err?.message || 'Failed to create ledger');
    } finally {
      setCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(options.length + (canCreate ? 1 : 0) - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!text.trim() && !selected && onEmptyEnter) {
        setOpen(false);
        onEmptyEnter();
      } else if (open && options[highlight]) {
        pick(options[highlight]);
      } else if (open && canCreate && highlight === options.length) {
        openCreate();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={`relative ${className ?? ''}`}>
      <Input
        ref={inputRef}
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (selected) onSelect(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so an option click can register before the list closes.
          setTimeout(() => {
            setOpen(false);
            setText((cur) => (selected && cur !== selected.name ? selected.name : selected ? cur : ''));
          }, 150);
        }}
        onKeyDown={handleKeyDown}
        className="h-8 border-0 border-b border-dashed border-gray-400 bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid rounded-none"
      />
      {open && (options.length > 0 || canCreate) && (
        <div className="absolute z-30 mt-1 max-h-72 w-full min-w-[320px] overflow-y-auto rounded-md border bg-[#eef3fa] shadow-lg">
          <div className="border-b bg-[#16437e] px-3 py-1 text-xs font-semibold text-white">List of Ledger Accounts</div>
          {options.map((l, i) => (
            <button
              type="button"
              key={l.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(l)}
              onMouseEnter={() => setHighlight(i)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm ${
                i === highlight ? 'bg-[#fdf6d8]' : ''
              }`}
            >
              <span>{l.name}</span>
              {l.closing_balance !== null && (
                <span className="font-mono text-xs text-muted-foreground">{fmtINR(Number(l.closing_balance))}</span>
              )}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={openCreate}
              onMouseEnter={() => setHighlight(options.length)}
              className={`flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm font-semibold ${
                highlight === options.length ? 'bg-[#fdf6d8]' : 'bg-white'
              }`}
            >
              <Plus className="h-4 w-4 text-blue-700" />
              <span>Create new ledger "{trimmedText}"</span>
            </button>
          )}
        </div>
      )}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create ledger</DialogTitle>
            <DialogDescription>
              This ledger will be saved in Adamrit and pushed to Tally. If Tally is offline, it will be queued.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="new-ledger-name" className="text-xs">Ledger name</Label>
              <Input
                id="new-ledger-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-ledger-under" className="text-xs">Under</Label>
              <Input
                id="new-ledger-under"
                list="tally-ledger-groups"
                value={parentGroup}
                onChange={(e) => setParentGroup(e.target.value)}
                placeholder="Example: Sundry Creditors"
                autoComplete="off"
              />
              <datalist id="tally-ledger-groups">
                {groupOptions.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-ledger-opening" className="text-xs">Opening balance</Label>
              <Input
                id="new-ledger-opening"
                type="number"
                inputMode="decimal"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreateLedger} disabled={creating}>
              {creating ? 'Creating...' : 'Create Ledger'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
const PaymentVoucher = () => {
  const { hospitalConfig } = useAuth();
  const hospitalType = hospitalConfig.name;

  // --- Tally-style entry form state ---
  const lineKey = useRef(0);
  const newLine = (): VoucherLine => ({ key: ++lineKey.current, ledger: null, amount: '' });
  const [date, setDate] = useState(todayISO());
  const [voucherNoPreview, setVoucherNoPreview] = useState('');
  const [account, setAccount] = useState<LedgerOption | null>(null);
  const [lines, setLines] = useState<VoucherLine[]>(() => [newLine()]);
  const [narration, setNarration] = useState('');
  const [saving, setSaving] = useState(false);

  const lineLedgerRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const lineAmountRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const narrationRef = useRef<HTMLTextAreaElement | null>(null);

  // History date filter (default: last 30 days)
  const [fromDate, setFromDate] = useState<string>(() => daysAgoISO(30));
  const [toDate, setToDate] = useState<string>(todayISO);
  const [vouchers, setVouchers] = useState<ReadonlyArray<PaymentVoucher>>([]);
  const [loading, setLoading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const loadVouchers = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('payment_vouchers')
        .select('*')
        .eq('hospital_type', hospitalType)
        .gte('voucher_date', fromDate)
        .lte('voucher_date', toDate)
        .order('voucher_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      setVouchers((data ?? []) as PaymentVoucher[]);
    } catch (err) {
      console.error('Failed to load payment vouchers:', err);
      toast.error('Could not load vouchers from the database');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, hospitalType]);

  useEffect(() => {
    loadVouchers();
  }, [loadVouchers]);

  const total = useMemo(
    () => vouchers.reduce((sum, v) => sum + (Number(v.amount) || 0), 0),
    [vouchers],
  );

  const entryTotal = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0),
    [lines],
  );

  // Voucher number is human-readable and unique-per-day: PV-YYYYMMDD-NNN.
  // Derive next suffix from the MAX existing voucher_no for that date so a
  // prior deletion can't recycle a number that still exists (voucher_no is
  // globally UNIQUE, so count-based numbering collides after any delete).
  const nextVoucherNo = async (d: string): Promise<string> => {
    const datePart = d.replace(/-/g, '');
    const prefix = `PV-${datePart}-`;
    const { data, error } = await (supabase as any)
      .from('payment_vouchers')
      .select('voucher_no')
      .like('voucher_no', `${prefix}%`)
      .order('voucher_no', { ascending: false })
      .limit(1);
    if (error) throw error;
    const lastNo = data?.[0]?.voucher_no as string | undefined;
    const lastSeq = lastNo ? parseInt(lastNo.slice(prefix.length), 10) : 0;
    const seq = String((Number.isFinite(lastSeq) ? lastSeq : 0) + 1).padStart(3, '0');
    return `${prefix}${seq}`;
  };

  // Display-only preview of the number the next save will get.
  useEffect(() => {
    let cancelled = false;
    nextVoucherNo(date)
      .then((no) => {
        if (!cancelled) setVoucherNoPreview(no);
      })
      .catch(() => {
        if (!cancelled) setVoucherNoPreview('');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, vouchers]);

  const updateLine = (key: number, patch: Partial<VoucherLine>): void => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: number): void => {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  };

  // Enter on an amount → move to (or create) the next particulars row, Tally style.
  const handleAmountEnter = (idx: number): void => {
    const line = lines[idx];
    if (!line.ledger || !(Number(line.amount) > 0)) return;
    if (idx === lines.length - 1) {
      const added = newLine();
      setLines((prev) => [...prev, added]);
      setTimeout(() => lineLedgerRefs.current[added.key]?.focus(), 0);
    } else {
      lineLedgerRefs.current[lines[idx + 1].key]?.focus();
    }
  };

  const resetForm = (): void => {
    setAccount(null);
    setLines([newLine()]);
    setNarration('');
  };

  const handleSave = async (): Promise<void> => {
    const filled = lines.filter((l) => l.ledger && Number(l.amount) > 0);
    if (!account) {
      toast.error('Select the Account (cash/bank ledger)');
      return;
    }
    if (filled.length === 0) {
      toast.error('Add at least one particulars ledger with an amount');
      return;
    }
    const incomplete = lines.some((l) => (l.ledger && !(Number(l.amount) > 0)) || (!l.ledger && l.amount.trim() !== ''));
    if (incomplete) {
      toast.error('A particulars row is incomplete — give every ledger an amount');
      return;
    }
    const amount = filled.reduce((sum, l) => sum + Number(l.amount), 0);
    setSaving(true);
    try {
      const voucher_no = await nextVoucherNo(date);
      const { data: inserted, error } = await (supabase as any)
        .from('payment_vouchers')
        .insert({
          voucher_no,
          voucher_date: date,
          person_name: filled[0].ledger!.name,
          amount,
          purpose: null,
          paid_by: null,
          account_ledger_name: account.name,
          narration: narration.trim() || null,
          hospital_type: hospitalType,
        })
        .select('id')
        .single();
      if (error) throw error;

      const { error: linesError } = await (supabase as any).from('payment_voucher_lines').insert(
        filled.map((l, i) => ({
          voucher_id: inserted.id,
          ledger_id: l.ledger!.id,
          ledger_name: l.ledger!.name,
          amount: Number(l.amount),
          line_order: i,
        })),
      );
      if (linesError) throw linesError;

      toast.success(`Voucher ${voucher_no} saved`);
      pushPaymentVoucherToTally({
        voucherNo: voucher_no,
        date,
        amount,
        accountLedger: account.name,
        lines: filled.map((l) => ({ ledgerName: l.ledger!.name, amount: Number(l.amount) })),
        narration: narration.trim() || undefined,
      });
      resetForm();
      loadVouchers();
    } catch (err) {
      console.error('Failed to save payment voucher:', err);
      toast.error('Failed to save — please try again');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    try {
      const { error } = await (supabase as any).from('payment_vouchers').delete().eq('id', id);
      if (error) throw error;
      setDeleteConfirmId(null);
      toast.info('Voucher deleted');
      loadVouchers();
    } catch (err) {
      console.error('Failed to delete payment voucher:', err);
      toast.error('Failed to delete — please try again');
    }
  };

  // Print a single voucher as a Tally-style payment voucher document.
  const handlePrintOne = async (v: PaymentVoucher): Promise<void> => {
    let voucherLines: { ledger_name: string; amount: number }[] = [];
    try {
      const { data } = await (supabase as any)
        .from('payment_voucher_lines')
        .select('ledger_name, amount')
        .eq('voucher_id', v.id)
        .order('line_order');
      voucherLines = data ?? [];
    } catch {
      // Legacy voucher without lines — fall back to the flat fields below.
    }
    if (voucherLines.length === 0) {
      voucherLines = [{ ledger_name: v.person_name, amount: Number(v.amount) }];
    }
    const win = window.open('', '_blank', 'width=900,height=1100');
    if (!win) {
      toast.error('Popup blocked — please allow popups for this site to print');
      return;
    }
    const lineRows = voucherLines
      .map(
        (l) => `
      <tr>
        <td class="b">${escapeHTML(l.ledger_name)}</td>
        <td class="b num">${fmtINR(Number(l.amount))}</td>
      </tr>`,
      )
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8" />
<title>Payment Voucher — ${escapeHTML(v.voucher_no)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; margin: 14mm; color: #000; }
  .org { font-size: 15px; font-weight: 700; text-align: center; }
  .doc { text-align: center; font-size: 13px; margin: 2px 0 14px; text-transform: uppercase; letter-spacing: 1px; }
  .head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 10px; }
  .head .right { text-align: right; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { border: 1px solid #555; background: #f1f5f9; padding: 6px 10px; text-align: left; }
  td.b { border: 1px solid #555; padding: 7px 10px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; width: 22%; }
  tr.total td { border: 1px solid #555; font-weight: 700; background: #f1f5f9; }
  .narr { margin-top: 12px; font-size: 12px; }
  .narr .lbl { font-weight: 600; }
  .sign { margin-top: 56px; display: flex; justify-content: space-between; font-size: 12px; }
  .sign div { border-top: 1px solid #555; padding-top: 4px; width: 38%; text-align: center; }
  @page { size: A4 portrait; margin: 14mm; }
</style></head><body>
  <div class="org">${escapeHTML(hospitalType)}</div>
  <div class="doc">Payment Voucher</div>
  <div class="head">
    <div>No.: <b>${escapeHTML(v.voucher_no)}</b><br/>Account: <b>${escapeHTML(v.account_ledger_name || v.paid_by || 'Cash')}</b></div>
    <div class="right"><b>${escapeHTML(tallyDateLabel(v.voucher_date))}</b><br/>${escapeHTML(dayName(v.voucher_date))}</div>
  </div>
  <table>
    <thead><tr><th>Particulars</th><th class="num">Amount (₹)</th></tr></thead>
    <tbody>
      ${lineRows}
      <tr class="total"><td class="b num" style="text-align:right">Total</td><td class="b num">${fmtINR(Number(v.amount))}</td></tr>
    </tbody>
  </table>
  <div class="narr"><span class="lbl">Narration:</span> ${escapeHTML(v.narration || v.purpose || '-')}</div>
  <div class="sign">
    <div>Received By</div>
    <div>Authorised Signatory</div>
  </div>
  <script>window.onload=function(){setTimeout(function(){window.print()},150)}</script>
</body></html>`;
    win.document.open();
    win.document.write(html);
    win.document.close();
  };

  const handlePrint = (): void => {
    const win = window.open('', '_blank', 'width=900,height=1100');
    if (!win) {
      toast.error('Popup blocked — please allow popups for this site to print');
      return;
    }
    const rows = vouchers
      .map(
        (v, i) => `
        <tr>
          <td class="b center">${i + 1}</td>
          <td class="b">${escapeHTML(v.voucher_no)}</td>
          <td class="b">${escapeHTML(formatDateLabel(v.voucher_date))}</td>
          <td class="b">${escapeHTML(v.account_ledger_name || v.paid_by || '')}</td>
          <td class="b">${escapeHTML(v.person_name)}</td>
          <td class="b">${escapeHTML(v.narration || v.purpose || '')}</td>
          <td class="b num">${fmtINR(Number(v.amount))}</td>
        </tr>`,
      )
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8" />
<title>Payment Vouchers — ${escapeHTML(formatDateLabel(fromDate))} to ${escapeHTML(formatDateLabel(toDate))}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; margin: 14mm; color: #000; }
  h2 { margin: 0 0 4px; }
  .meta { color: #555; font-size: 12px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { border: 1px solid #555; background: #d9e1f2; padding: 6px 8px; text-align: left; }
  td.b { border: 1px solid #555; padding: 5px 8px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .center { text-align: center; }
  tr.total td { border: 1px solid #555; background: #d9e1f2; font-weight: 700; }
  @page { size: A4 portrait; margin: 12mm; }
</style></head><body>
  <h2>Payment Vouchers</h2>
  <div class="meta">${escapeHTML(formatDateLabel(fromDate))} to ${escapeHTML(formatDateLabel(toDate))} · ${vouchers.length} voucher(s)</div>
  <table>
    <thead><tr><th>#</th><th>Voucher No.</th><th>Date</th><th>Account</th><th>Particulars</th><th>Narration</th><th class="num">Amount</th></tr></thead>
    <tbody>
      ${rows}
      <tr class="total"><td colspan="6" class="num">TOTAL</td><td class="num">${fmtINR(total)}</td></tr>
    </tbody>
  </table>
  <script>window.onload=function(){setTimeout(function(){window.print()},150)}</script>
</body></html>`;
    win.document.open();
    win.document.write(html);
    win.document.close();
  };

  return (
    <div className="space-y-6 p-4">
      {/* Tally-style voucher entry */}
      <div className="overflow-hidden rounded-md border shadow-sm">
        {/* Title bar */}
        <div className="bg-[#16437e] px-3 py-1.5 text-sm font-semibold text-white">Accounting Voucher Creation</div>

        {/* Voucher type / No. / Date strip */}
        <div className="flex items-start justify-between border-b bg-[#dce6f2] px-3 py-2">
          <div className="flex items-center gap-3">
            <span className="bg-[#16437e] px-5 py-1 text-sm font-bold text-white">Payment</span>
            <span className="text-sm font-medium">No.</span>
            <span className="min-w-[150px] border border-gray-400 bg-[#fdf6d8] px-3 py-0.5 font-mono text-sm">
              {voucherNoPreview || '…'}
            </span>
          </div>
          <div className="text-right">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="ml-auto h-7 w-36 bg-white text-right text-sm"
            />
            <div className="mt-0.5 text-sm font-bold leading-tight">{tallyDateLabel(date)}</div>
            <div className="text-xs text-gray-600">{dayName(date)}</div>
          </div>
        </div>

        <div className="bg-[#fffefb] px-4 pb-4 pt-3">
          {/* Account (credit ledger) */}
          <div className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-sm font-semibold">Account</span>
            <span className="text-sm">:</span>
            <LedgerSearch
              selected={account}
              onSelect={setAccount}
              placeholder="Cash / Bank ledger — type to search"
              className="w-full max-w-md"
            />
          </div>
          <div className="flex items-center gap-2 text-xs italic text-gray-500">
            <span className="w-28 shrink-0">Current balance</span>
            <span>:</span>
            <span className="px-1 font-mono not-italic">
              {account?.closing_balance !== null && account?.closing_balance !== undefined
                ? fmtINR(Number(account.closing_balance))
                : ''}
            </span>
          </div>

          {/* Particulars */}
          <div className="mt-4 flex items-center justify-between border-y border-gray-400 bg-[#f0f4fa] px-2 py-1">
            <span className="text-sm font-bold">Particulars</span>
            <span className="pr-9 text-sm font-bold">Amount</span>
          </div>
          <div className="divide-y divide-dashed divide-gray-200">
            {lines.map((line, idx) => (
              <div key={line.key} className="flex items-start gap-2 py-1">
                <div className="flex-1">
                  <LedgerSearch
                    selected={line.ledger}
                    onSelect={(l) => {
                      updateLine(line.key, { ledger: l });
                      if (l) setTimeout(() => lineAmountRefs.current[line.key]?.focus(), 0);
                    }}
                    onEmptyEnter={() => narrationRef.current?.focus()}
                    placeholder={idx === 0 ? 'Type to search ledger…' : ''}
                    inputRef={(el) => {
                      lineLedgerRefs.current[line.key] = el;
                    }}
                  />
                  {line.ledger?.closing_balance !== null && line.ledger?.closing_balance !== undefined && (
                    <div className="px-1 text-xs italic text-gray-500">
                      Cur Bal: <span className="font-mono not-italic">{fmtINR(Number(line.ledger.closing_balance))}</span>
                    </div>
                  )}
                </div>
                <Input
                  ref={(el) => {
                    lineAmountRefs.current[line.key] = el;
                  }}
                  type="number"
                  inputMode="numeric"
                  value={line.amount}
                  onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAmountEnter(idx);
                    }
                  }}
                  className="h-8 w-40 rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-right font-mono shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  tabIndex={-1}
                  className="h-8 w-7 text-gray-400 hover:text-red-500"
                  aria-label="Remove row"
                  onClick={() => removeLine(line.key)}
                  disabled={lines.length === 1}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-end border-t border-gray-400 pr-9 pt-1">
            <span className="font-mono text-sm font-bold">{entryTotal > 0 ? fmtINR(entryTotal) : ''}</span>
          </div>

          {/* Narration + actions */}
          <div className="mt-6 flex items-end justify-between gap-4">
            <div className="w-full max-w-2xl">
              <Label htmlFor="pv-narration" className="text-sm font-semibold">
                Narration:
              </Label>
              <Textarea
                id="pv-narration"
                ref={narrationRef}
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                rows={2}
                className="mt-1 resize-none bg-white"
              />
            </div>
            <div className="flex shrink-0 gap-2">
              <Button onClick={handleSave} disabled={saving}>
                <Plus className="mr-1 h-4 w-4" /> {saving ? 'Saving…' : 'Save Voucher'}
              </Button>
              <Button variant="outline" onClick={resetForm} disabled={saving}>
                <RotateCcw className="mr-1 h-4 w-4" /> Clear
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* History */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg">Previous Vouchers</CardTitle>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="pv-from" className="text-xs">From</Label>
              <Input id="pv-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-auto" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pv-to" className="text-xs">To</Label>
              <Input id="pv-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-auto" />
            </div>
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={vouchers.length === 0}>
              <Printer className="mr-1 h-4 w-4" /> Print
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table className="border">
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Voucher No.</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Particulars</TableHead>
                  <TableHead>Narration</TableHead>
                  <TableHead className="text-right">Amount (₹)</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-sm text-gray-400">Loading…</TableCell>
                  </TableRow>
                ) : vouchers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-sm text-gray-400">No vouchers in this date range.</TableCell>
                  </TableRow>
                ) : (
                  vouchers.map((v, idx) => (
                    <TableRow key={v.id}>
                      <TableCell className="text-center text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-mono text-xs">{v.voucher_no}</TableCell>
                      <TableCell>{formatDateLabel(v.voucher_date)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{v.account_ledger_name || v.paid_by || '-'}</TableCell>
                      <TableCell className="font-medium">{v.person_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{v.narration || v.purpose || '-'}</TableCell>
                      <TableCell className="text-right font-mono">{fmtINR(Number(v.amount))}</TableCell>
                      <TableCell>
                        {deleteConfirmId === v.id ? (
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-600" onClick={() => handleDelete(v.id)}>Yes</Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setDeleteConfirmId(null)}>No</Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label="Print voucher"
                              title="Print voucher"
                              onClick={() => handlePrintOne(v)}
                            >
                              <Printer className="h-3.5 w-3.5 text-blue-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label="Delete voucher"
                              onClick={() => setDeleteConfirmId(v.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
                {vouchers.length > 0 && (
                  <TableRow className="bg-gray-100 font-bold">
                    <TableCell colSpan={6} className="text-right">TOTAL</TableCell>
                    <TableCell className="text-right font-mono">{fmtINR(total)}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PaymentVoucher;
