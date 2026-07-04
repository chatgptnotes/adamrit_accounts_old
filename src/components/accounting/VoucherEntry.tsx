import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { X, Loader2 } from 'lucide-react';
import { sendPaymentAlert } from '@/lib/payment-alert-service';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { useCompanies } from '@/hooks/useCompanies';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TallyScreen, type RailItem } from './tally/TallyChrome';

// Type definition for a voucher type record
interface VoucherType {
  id: string;
  voucher_type_code: string;
  voucher_type_name: string;
  voucher_category: string;
  prefix: string;
  current_number: number;
  is_active: boolean;
}

// Type definition for a chart of accounts record used in the ledger search
interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
}

// A particulars row (single-amount modes: Payment / Receipt / Contra)
interface ParticularsLine {
  key: number;
  account: Account | null;
  amount: string;
}

// A journal-style row (By/To modes: Journal / Sales / Credit Note / Debit Note …)
interface JournalLine {
  key: number;
  drcr: 'Dr' | 'Cr';
  account: Account | null;
  amount: string;
}

/**
 * Generates the voucher number from a voucher type's prefix and next sequence number.
 * The number is zero-padded to 4 digits. Example: "REC0005"
 */
const generateVoucherNumber = (prefix: string, nextNum: number): string => {
  return `${prefix}${String(nextNum).padStart(4, '0')}`;
};

const fmtINR = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

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

// Voucher categories that use Tally's single Account + Particulars layout.
const SINGLE_ACCOUNT_MODES: Record<string, { accountIsDebit: boolean }> = {
  PAYMENT: { accountIsDebit: false }, // cash/bank credited, particulars debited
  RECEIPT: { accountIsDebit: true },  // cash/bank debited, particulars credited
  CONTRA: { accountIsDebit: true },   // destination debited, particulars credited
};

// Tally's F4–F9 rail order
const RAIL_KEYS: { hotkey: string; category: string; label: string }[] = [
  { hotkey: 'F4', category: 'CONTRA', label: 'Contra' },
  { hotkey: 'F5', category: 'PAYMENT', label: 'Payment' },
  { hotkey: 'F6', category: 'RECEIPT', label: 'Receipt' },
  { hotkey: 'F7', category: 'JOURNAL', label: 'Journal' },
  { hotkey: 'F8', category: 'SALES', label: 'Sales' },
  { hotkey: 'F9', category: 'PURCHASE', label: 'Purchase' },
];

// Current balance = opening + posted debits − credits, formatted "1,234.00 Dr".
const balanceLabel = (bal: number | undefined): string => {
  if (bal === undefined) return '';
  if (bal === 0) return '0.00';
  return `${fmtINR(Math.abs(bal))} ${bal >= 0 ? 'Dr' : 'Cr'}`;
};

// ---------------------------------------------------------------------------
// Account search input — type to search chart_of_accounts, pick with ↑/↓ + Enter
// ---------------------------------------------------------------------------
interface AccountSearchProps {
  accounts: Account[];
  selected: Account | null;
  onSelect: (account: Account | null) => void;
  placeholder?: string;
  className?: string;
  inputRef?: (el: HTMLInputElement | null) => void;
  /** Enter pressed on an empty field (Tally: end of particulars entry) */
  onEmptyEnter?: () => void;
}

const AccountSearch = ({ accounts, selected, onSelect, placeholder, className, inputRef, onEmptyEnter }: AccountSearchProps) => {
  const [text, setText] = useState(selected?.account_name ?? '');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    setText(selected?.account_name ?? '');
  }, [selected]);

  const options = useMemo(() => {
    const q = text.trim().toLowerCase();
    const list = q
      ? accounts.filter(
          (a) => a.account_name.toLowerCase().includes(q) || a.account_code.toLowerCase().includes(q),
        )
      : accounts;
    return list.slice(0, 15);
  }, [accounts, text]);

  const pick = (a: Account): void => {
    onSelect(a);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, options.length - 1));
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
          setHighlight(0);
          if (selected) onSelect(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => {
            setOpen(false);
            setText((cur) => (selected && cur !== selected.account_name ? selected.account_name : selected ? cur : ''));
          }, 150);
        }}
        onKeyDown={handleKeyDown}
        className="h-7 border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-[13px] shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid rounded-none"
      />
      {open && options.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-72 w-full min-w-[320px] overflow-y-auto rounded-none border bg-[#eef3fa] shadow-lg">
          <div className="border-b bg-[#16437e] px-3 py-1 text-xs font-semibold text-white">List of Ledger Accounts</div>
          {options.map((a, i) => (
            <button
              type="button"
              key={a.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(a)}
              onMouseEnter={() => setHighlight(i)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-1 text-left text-[13px] ${
                i === highlight ? 'bg-[#fdf6d8]' : ''
              }`}
            >
              <span>
                {a.account_name}
                <span className="ml-2 text-xs text-muted-foreground">({a.account_code})</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const VoucherEntry: React.FC = () => {
  const queryClient = useQueryClient();

  // Form state
  const [selectedVoucherType, setSelectedVoucherType] = useState('');
  const [voucherDate, setVoucherDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [referenceNumber, setReferenceNumber] = useState('');
  const [referenceDate, setReferenceDate] = useState('');
  const [narration, setNarration] = useState('');
  const [patientId, setPatientId] = useState('');
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [saving, setSaving] = useState(false);

  // Entry rows
  const lineKey = useRef(0);
  const newParticularsLine = (): ParticularsLine => ({ key: ++lineKey.current, account: null, amount: '' });
  const newJournalLine = (drcr: 'Dr' | 'Cr'): JournalLine => ({ key: ++lineKey.current, drcr, account: null, amount: '' });
  const [account, setAccount] = useState<Account | null>(null);
  const [partLines, setPartLines] = useState<ParticularsLine[]>(() => [newParticularsLine()]);
  const [journalLines, setJournalLines] = useState<JournalLine[]>(() => [newJournalLine('Dr'), newJournalLine('Cr')]);

  const partLedgerRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const partAmountRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const journalLedgerRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const journalAmountRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const narrationRef = useRef<HTMLTextAreaElement | null>(null);
  const dateRef = useRef<HTMLInputElement | null>(null);

  // Current-balance cache per account id (opening + AUTHORISED debits − credits)
  const [balances, setBalances] = useState<Record<string, number>>({});
  const loadBalance = useCallback(async (accountId: string) => {
    if (accountId in balances) return;
    try {
      const [{ data: acc }, entries] = await Promise.all([
        supabase
          .from('chart_of_accounts')
          .select('opening_balance, opening_balance_type')
          .eq('id', accountId)
          .single(),
        fetchAllRows((from, to) =>
          (supabase as any)
            .from('voucher_entries')
            .select('debit_amount, credit_amount, voucher:vouchers!inner(status)')
            .eq('account_id', accountId)
            .eq('voucher.status', 'AUTHORISED')
            .range(from, to),
        ),
      ]);
      const opening = (Number(acc?.opening_balance) || 0) * (acc?.opening_balance_type === 'Cr' ? -1 : 1);
      const movement = (entries as any[]).reduce(
        (sum, e) => sum + (Number(e.debit_amount) || 0) - (Number(e.credit_amount) || 0),
        0,
      );
      setBalances((prev) => ({ ...prev, [accountId]: opening + movement }));
    } catch (err) {
      console.error('Balance lookup failed:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balances]);

  // ------ Data ------
  const { data: companies = [] } = useCompanies();

  const { data: voucherTypes = [] } = useQuery({
    queryKey: ['voucher_types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('voucher_types')
        .select('*')
        .eq('is_active', true)
        .order('voucher_type_name');
      if (error) throw error;
      return (data || []) as VoucherType[];
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['chart_of_accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_type')
        .eq('is_active', true)
        .order('account_code');
      if (error) throw error;
      return (data || []) as Account[];
    },
  });

  // Default company: first one, so the screen is immediately usable like Tally
  useEffect(() => {
    if (!selectedCompanyId && companies.length > 0) setSelectedCompanyId(companies[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies]);

  // ------ Derive the auto-generated voucher number ------
  const selectedType = useMemo(
    () => voucherTypes.find((vt) => vt.id === selectedVoucherType),
    [voucherTypes, selectedVoucherType]
  );

  const voucherNumber = useMemo(() => {
    if (!selectedType) return '';
    const nextNum = (selectedType.current_number || 0) + 1;
    return generateVoucherNumber(selectedType.prefix || '', nextNum);
  }, [selectedType]);

  const category = (selectedType?.voucher_category || '').toUpperCase();
  const singleMode = SINGLE_ACCOUNT_MODES[category];

  // ------ Computed totals ------
  const partTotal = useMemo(
    () => partLines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0),
    [partLines],
  );
  const totalDebit = useMemo(
    () =>
      singleMode
        ? partTotal
        : journalLines.reduce((sum, l) => sum + (l.drcr === 'Dr' ? Number(l.amount) || 0 : 0), 0),
    [singleMode, partTotal, journalLines],
  );
  const totalCredit = useMemo(
    () =>
      singleMode
        ? partTotal
        : journalLines.reduce((sum, l) => sum + (l.drcr === 'Cr' ? Number(l.amount) || 0 : 0), 0),
    [singleMode, partTotal, journalLines],
  );

  const difference = Math.abs(totalDebit - totalCredit);
  const isBalanced = difference < 0.01;

  // ------ Row handlers ------
  const updatePartLine = (key: number, patch: Partial<ParticularsLine>): void => {
    setPartLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const removePartLine = (key: number): void => {
    setPartLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  };
  const handlePartAmountEnter = (idx: number): void => {
    const line = partLines[idx];
    if (!line.account || !(Number(line.amount) > 0)) return;
    if (idx === partLines.length - 1) {
      const added = newParticularsLine();
      setPartLines((prev) => [...prev, added]);
      setTimeout(() => partLedgerRefs.current[added.key]?.focus(), 0);
    } else {
      partLedgerRefs.current[partLines[idx + 1].key]?.focus();
    }
  };

  const updateJournalLine = (key: number, patch: Partial<JournalLine>): void => {
    setJournalLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const removeJournalLine = (key: number): void => {
    setJournalLines((prev) => (prev.length > 2 ? prev.filter((l) => l.key !== key) : prev));
  };
  const handleJournalAmountEnter = (idx: number): void => {
    const line = journalLines[idx];
    if (!line.account || !(Number(line.amount) > 0)) return;
    if (idx === journalLines.length - 1) {
      // Tally alternates: after a By (Dr) line, the next defaults to To (Cr)
      const added = newJournalLine(line.drcr === 'Dr' ? 'Cr' : 'Dr');
      setJournalLines((prev) => [...prev, added]);
      setTimeout(() => journalLedgerRefs.current[added.key]?.focus(), 0);
    } else {
      journalLedgerRefs.current[journalLines[idx + 1].key]?.focus();
    }
  };

  // ------ Clear / reset the entire form ------
  const handleClear = () => {
    setVoucherDate(format(new Date(), 'yyyy-MM-dd'));
    setReferenceNumber('');
    setReferenceDate('');
    setNarration('');
    setPatientId('');
    setAccount(null);
    setPartLines([newParticularsLine()]);
    setJournalLines([newJournalLine('Dr'), newJournalLine('Cr')]);
  };

  // Build the double-entry rows for the current mode.
  const buildEntries = (): { account_id: string; debit_amount: number; credit_amount: number; narration: string }[] | null => {
    if (singleMode) {
      if (!account) {
        toast.error('Select the Account ledger.');
        return null;
      }
      const filled = partLines.filter((l) => l.account && Number(l.amount) > 0);
      if (filled.length === 0) {
        toast.error('Add at least one particulars ledger with an amount.');
        return null;
      }
      const total = filled.reduce((s, l) => s + Number(l.amount), 0);
      const accountRow = {
        account_id: account.id,
        debit_amount: singleMode.accountIsDebit ? total : 0,
        credit_amount: singleMode.accountIsDebit ? 0 : total,
        narration: '',
      };
      const lineRows = filled.map((l) => ({
        account_id: l.account!.id,
        debit_amount: singleMode.accountIsDebit ? 0 : Number(l.amount),
        credit_amount: singleMode.accountIsDebit ? Number(l.amount) : 0,
        narration: '',
      }));
      return [accountRow, ...lineRows];
    }
    const filled = journalLines.filter((l) => l.account && Number(l.amount) > 0);
    if (filled.length < 2) {
      toast.error('At least 2 entries with ledgers are required.');
      return null;
    }
    return filled.map((l) => ({
      account_id: l.account!.id,
      debit_amount: l.drcr === 'Dr' ? Number(l.amount) : 0,
      credit_amount: l.drcr === 'Cr' ? Number(l.amount) : 0,
      narration: '',
    }));
  };

  // ------ Save voucher (draft or posted) ------
  const saveVoucher = async (status: 'draft' | 'posted') => {
    if (!selectedCompanyId) {
      toast.error('Select a company.');
      return;
    }
    if (!selectedVoucherType) {
      toast.error('Select a voucher type.');
      return;
    }

    const validEntries = buildEntries();
    if (!validEntries) return;

    const debitSum = validEntries.reduce((s, e) => s + (e.debit_amount || 0), 0);
    const creditSum = validEntries.reduce((s, e) => s + (e.credit_amount || 0), 0);

    if (debitSum <= 0) {
      toast.error('Total debit amount must be greater than zero.');
      return;
    }
    if (status === 'posted' && Math.abs(debitSum - creditSum) > 0.01) {
      toast.error('Debit and Credit must be equal to post the voucher.');
      return;
    }

    setSaving(true);
    try {
      const voucherType = voucherTypes.find((vt) => vt.id === selectedVoucherType);
      const nextNum = (voucherType?.current_number || 0) + 1;
      const generatedNumber = generateVoucherNumber(voucherType?.prefix || '', nextNum);

      const { data: voucher, error: vErr } = await supabase
        .from('vouchers')
        .insert({
          voucher_number: generatedNumber,
          voucher_type_id: selectedVoucherType,
          voucher_date: voucherDate,
          reference_number: referenceNumber || null,
          reference_date: referenceDate || null,
          narration: narration || '',
          total_amount: debitSum,
          patient_id: patientId || null,
          company_id: selectedCompanyId || null,
          // vouchers.status CHECK constraint allows PENDING / AUTHORISED / CANCELLED
          status: status === 'posted' ? 'AUTHORISED' : 'PENDING',
          created_by: 'system',
        })
        .select()
        .single();

      if (vErr) {
        toast.error('Failed to create voucher: ' + vErr.message);
        throw vErr;
      }

      const entryRows = validEntries.map((e, i) => ({
        voucher_id: voucher.id,
        account_id: e.account_id,
        debit_amount: e.debit_amount || 0,
        credit_amount: e.credit_amount || 0,
        narration: e.narration || '',
        entry_order: i + 1,
      }));

      const { error: eErr } = await supabase.from('voucher_entries').insert(entryRows);
      if (eErr) {
        toast.error('Failed to save entries: ' + eErr.message);
        throw eErr;
      }

      await supabase
        .from('voucher_types')
        .update({ current_number: nextNum })
        .eq('id', selectedVoucherType);

      toast.success(`Voucher ${generatedNumber} saved${status === 'posted' ? '' : ' as pending'}.`);

      const voucherTypeName = (voucherType?.voucher_type_name || '').toLowerCase();
      if ((voucherTypeName.includes('receipt') || voucherTypeName.includes('receive')) && debitSum >= 10000) {
        sendPaymentAlert({
          alert_type: 'receipt',
          amount: debitSum,
          patient_name: narration || 'Voucher Entry',
          hospital_name: 'Hope',
          additional_info: `Voucher: ${generatedNumber}, Type: ${voucherType?.voucher_type_name || 'N/A'}`,
        });
      }

      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['voucher_types'] });
      setBalances({});
      handleClear();
    } catch {
      // Error toasts are already shown above
    } finally {
      setSaving(false);
    }
  };

  // ------ Tally right rail: F2 Date + F4–F9 voucher types + other types ------
  const rail = useMemo<RailItem[]>(() => {
    const byCategory = (cat: string) => voucherTypes.find((vt) => vt.voucher_category?.toUpperCase() === cat);
    const mainIds = new Set<string>();
    const items: RailItem[] = [
      { hotkey: 'F2', label: 'Date', onClick: () => dateRef.current?.showPicker?.() ?? dateRef.current?.focus() },
      { hotkey: 'F3', label: 'Company', disabled: true },
    ];
    RAIL_KEYS.forEach(({ hotkey, category: cat, label }, i) => {
      const vt = byCategory(cat);
      if (vt) mainIds.add(vt.id);
      items.push({
        hotkey,
        label,
        gapBefore: i === 0,
        onClick: vt ? () => setSelectedVoucherType(vt.id) : undefined,
        disabled: !vt,
        active: vt ? selectedVoucherType === vt.id : false,
      });
    });
    // F10: Other Vouchers — remaining active types listed beneath, Tally style
    const others = voucherTypes.filter((vt) => !mainIds.has(vt.id));
    others.forEach((vt, i) => {
      items.push({
        label: vt.voucher_type_name,
        gapBefore: i === 0,
        onClick: () => setSelectedVoucherType(vt.id),
        active: selectedVoucherType === vt.id,
      });
    });
    return items;
  }, [voucherTypes, selectedVoucherType]);

  const accountBalance = account ? balances[account.id] : undefined;

  const amountInputClass =
    'h-7 w-36 rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-right font-mono text-[13px] shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid disabled:border-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  return (
    <TallyScreen title="Accounting Voucher Creation" rail={rail}>
      {/* Voucher type / No. / Ref / Date strip */}
      <div className="flex items-start justify-between border-b border-[#9db8d8] bg-[#eef3fa] px-2 py-1 text-[13px]">
        <div>
          <div className="flex items-center gap-3">
            <span className="min-w-[90px] bg-[#16437e] px-4 py-0.5 text-center font-bold text-white">
              {selectedType?.voucher_type_name?.replace(' Voucher', '') || 'Voucher'}
            </span>
            <span className="font-medium">No.</span>
            <span className="min-w-[100px] border border-gray-400 bg-[#fdf6d8] px-2 font-mono">
              {voucherNumber || '…'}
            </span>
            <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
              <SelectTrigger className="h-6 w-56 border-gray-300 bg-white text-xs shadow-none">
                <SelectValue placeholder="Select company" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.company_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs text-gray-600">Ref:</span>
            <Input
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="Reference no."
              className="h-6 w-32 bg-white text-xs"
            />
            <Input
              type="date"
              value={referenceDate}
              onChange={(e) => setReferenceDate(e.target.value)}
              className="h-6 w-32 bg-white text-xs"
            />
          </div>
        </div>
        <div className="text-right">
          <Input
            ref={dateRef}
            type="date"
            value={voucherDate}
            onChange={(e) => setVoucherDate(e.target.value)}
            className="ml-auto h-6 w-32 bg-white text-right text-xs"
          />
          <div className="mt-0.5 font-bold leading-tight">{tallyDateLabel(voucherDate)}</div>
          <div className="text-xs text-gray-600">{dayName(voucherDate)}</div>
        </div>
      </div>

      <div className="px-3 pb-4 pt-2 text-[13px]">
        {!selectedType ? (
          <div className="py-16 text-center text-gray-400">
            Select a voucher type from the buttons on the right (F4–F9) to begin.
          </div>
        ) : singleMode ? (
          <>
            {/* Account (implied side of the double entry) */}
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 font-semibold">Account</span>
              <span>:</span>
              <AccountSearch
                accounts={accounts}
                selected={account}
                onSelect={(a) => {
                  setAccount(a);
                  if (a) loadBalance(a.id);
                }}
                placeholder="Cash / Bank ledger — type to search"
                className="w-full max-w-md"
              />
            </div>
            <div className="flex items-center gap-2 text-xs italic text-gray-500">
              <span className="w-28 shrink-0">Current balance</span>
              <span>:</span>
              <span className="px-1 font-mono not-italic">{account ? balanceLabel(accountBalance) : ''}</span>
            </div>

            {/* Particulars */}
            <div className="mt-3 flex items-center justify-between border-y border-gray-400 bg-[#f0f4fa] px-2 py-0.5">
              <span className="font-bold">Particulars</span>
              <span className="pr-9 font-bold">Amount</span>
            </div>
            <div className="divide-y divide-dashed divide-gray-200">
              {partLines.map((line, idx) => (
                <div key={line.key} className="flex items-start gap-2 py-0.5">
                  <div className="flex-1">
                    <AccountSearch
                      accounts={accounts}
                      selected={line.account}
                      onSelect={(a) => {
                        updatePartLine(line.key, { account: a });
                        if (a) {
                          loadBalance(a.id);
                          setTimeout(() => partAmountRefs.current[line.key]?.focus(), 0);
                        }
                      }}
                      onEmptyEnter={() => narrationRef.current?.focus()}
                      placeholder={idx === 0 ? 'Type to search ledger…' : ''}
                      inputRef={(el) => {
                        partLedgerRefs.current[line.key] = el;
                      }}
                    />
                    {line.account && (
                      <div className="px-1 text-xs italic text-gray-500">
                        Cur Bal:{' '}
                        <span className="font-mono not-italic">{balanceLabel(balances[line.account.id])}</span>
                      </div>
                    )}
                  </div>
                  <Input
                    ref={(el) => {
                      partAmountRefs.current[line.key] = el;
                    }}
                    type="number"
                    inputMode="decimal"
                    value={line.amount}
                    onChange={(e) => updatePartLine(line.key, { amount: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handlePartAmountEnter(idx);
                      }
                    }}
                    className={amountInputClass}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    tabIndex={-1}
                    className="h-7 w-6 text-gray-400 hover:text-red-500"
                    aria-label="Remove row"
                    onClick={() => removePartLine(line.key)}
                    disabled={partLines.length === 1}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-end border-t border-gray-400 pr-8 pt-0.5">
              <span className="font-mono font-bold">{partTotal > 0 ? fmtINR(partTotal) : ''}</span>
            </div>
          </>
        ) : (
          <>
            {/* Journal-style By/To entry */}
            <div className="flex items-center border-y border-gray-400 bg-[#f0f4fa] px-2 py-0.5 font-bold">
              <span className="w-12"></span>
              <span className="flex-1">Particulars</span>
              <span className="w-36 pr-1 text-right">Debit</span>
              <span className="w-36 pr-1 text-right">Credit</span>
              <span className="w-6"></span>
            </div>
            <div className="divide-y divide-dashed divide-gray-200">
              {journalLines.map((line, idx) => (
                <div key={line.key} className="flex items-start gap-2 py-0.5">
                  <Select
                    value={line.drcr}
                    onValueChange={(v) => updateJournalLine(line.key, { drcr: v as 'Dr' | 'Cr' })}
                  >
                    <SelectTrigger className="h-7 w-12 rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-[13px] font-semibold shadow-none focus:ring-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Dr">By</SelectItem>
                      <SelectItem value="Cr">To</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex-1">
                    <AccountSearch
                      accounts={accounts}
                      selected={line.account}
                      onSelect={(a) => {
                        updateJournalLine(line.key, { account: a });
                        if (a) {
                          loadBalance(a.id);
                          setTimeout(() => journalAmountRefs.current[line.key]?.focus(), 0);
                        }
                      }}
                      onEmptyEnter={() => narrationRef.current?.focus()}
                      placeholder={idx === 0 ? 'Type to search ledger…' : ''}
                      inputRef={(el) => {
                        journalLedgerRefs.current[line.key] = el;
                      }}
                    />
                    {line.account && (
                      <div className="px-1 text-xs italic text-gray-500">
                        Cur Bal:{' '}
                        <span className="font-mono not-italic">{balanceLabel(balances[line.account.id])}</span>
                      </div>
                    )}
                  </div>
                  <Input
                    ref={(el) => {
                      journalAmountRefs.current[line.key] = el;
                    }}
                    type="number"
                    inputMode="decimal"
                    value={line.drcr === 'Dr' ? line.amount : ''}
                    disabled={line.drcr !== 'Dr'}
                    onChange={(e) => updateJournalLine(line.key, { amount: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleJournalAmountEnter(idx);
                      }
                    }}
                    className={amountInputClass}
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={line.drcr === 'Cr' ? line.amount : ''}
                    disabled={line.drcr !== 'Cr'}
                    onChange={(e) => updateJournalLine(line.key, { amount: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleJournalAmountEnter(idx);
                      }
                    }}
                    className={amountInputClass}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    tabIndex={-1}
                    className="h-7 w-6 text-gray-400 hover:text-red-500"
                    aria-label="Remove row"
                    onClick={() => removeJournalLine(line.key)}
                    disabled={journalLines.length <= 2}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-1 flex items-center justify-end border-t border-gray-400 pt-0.5">
              <span className="w-36 pr-1 text-right font-mono font-bold">{totalDebit > 0 ? fmtINR(totalDebit) : ''}</span>
              <span className="w-36 pr-1 text-right font-mono font-bold">{totalCredit > 0 ? fmtINR(totalCredit) : ''}</span>
              <span className="w-6"></span>
            </div>
            <div className="mt-1 text-right text-xs">
              {isBalanced ? (
                <span className="font-semibold text-green-600">Balanced</span>
              ) : (
                <span className="font-semibold text-red-600">Difference: ₹{fmtINR(difference)}</span>
              )}
            </div>
          </>
        )}

        {/* Narration + patient + actions */}
        {selectedType && (
          <div className="mt-8 flex items-end justify-between gap-4">
            <div className="w-full max-w-2xl">
              <Label htmlFor="voucher_narration" className="text-[13px] font-semibold">
                Narration:
              </Label>
              <Textarea
                id="voucher_narration"
                ref={narrationRef}
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                rows={2}
                className="mt-1 resize-none rounded-none border-gray-400 bg-white text-[13px]"
              />
              <div className="mt-2 flex items-center gap-2">
                <Label htmlFor="patient_id" className="shrink-0 text-xs text-gray-600">
                  Patient (optional)
                </Label>
                <Input
                  id="patient_id"
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  placeholder="Enter patient ID"
                  className="h-6 w-56 text-xs"
                />
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button variant="outline" size="sm" className="h-7 rounded-none text-xs" onClick={() => saveVoucher('draft')} disabled={saving}>
                {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Save as Pending
              </Button>
              <Button size="sm" className="h-7 rounded-none bg-[#16437e] text-xs hover:bg-[#0f3363]" onClick={() => saveVoucher('posted')} disabled={saving}>
                {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                <span className="underline">A</span>: Accept
              </Button>
              <Button variant="secondary" size="sm" className="h-7 rounded-none text-xs" onClick={handleClear} disabled={saving}>
                <span className="underline">Q</span>: Quit
              </Button>
            </div>
          </div>
        )}
      </div>
    </TallyScreen>
  );
};

export default VoucherEntry;
