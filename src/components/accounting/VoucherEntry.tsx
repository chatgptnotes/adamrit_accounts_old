import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { X, Loader2 } from 'lucide-react';
import { sendPaymentAlert } from '@/lib/payment-alert-service';
import { accountMovements } from '@/lib/accountMovements';
import { useAuth } from '@/contexts/AuthContext';
import { amountInWords } from '@/lib/amountInWords';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EnhancedDatePicker } from '@/components/ui/enhanced-date-picker';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TallyScreen, type RailItem } from './tally/TallyChrome';
import { useCostCentres } from './CostCentres';
import { useAccountingRights } from './tally/rights';
import { useAccountingCompany } from './AccountingCompanyContext';

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
  account_group?: string | null;
}

// A particulars row (single-amount modes: Payment / Receipt / Contra)
interface ParticularsLine {
  key: number;
  account: Account | null;
  amount: string;
  costCentreId?: string;
  billRef?: string;
}

// A journal-style row (By/To modes: Journal / Sales / Credit Note / Debit Note …)
interface JournalLine {
  key: number;
  drcr: 'Dr' | 'Cr';
  account: Account | null;
  amount: string;
  costCentreId?: string;
  billRef?: string;
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

// Current balance = opening + posted debits - credits, formatted "1,234.00 Dr".
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
              <span>{a.account_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

interface VoucherEntryProps {
  /** When set, opens this voucher in Tally-style Alteration mode */
  voucherId?: string;
  /** Called after Accept / Cancel Vch / Delete / Quit in alteration mode */
  onDone?: () => void;
  /** Select an active voucher type when opening a new voucher from a shortcut. */
  initialVoucherCategory?: string;
}

const VoucherEntry: React.FC<VoucherEntryProps> = ({ voucherId, onDone, initialVoucherCategory }) => {
  const queryClient = useQueryClient();
  const { user, hospitalConfig } = useAuth();
  const { canAlter } = useAccountingRights();
  const { selectedCompanyId, setSelectedCompanyId } = useAccountingCompany();
  const alterMode = !!voucherId;
  const username = user?.username || user?.email || 'system';

  // Form state
  const [selectedVoucherType, setSelectedVoucherType] = useState('');
  const [voucherDate, setVoucherDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [voucherNumberOverride, setVoucherNumberOverride] = useState('');
  const [datePickerRequest, setDatePickerRequest] = useState(0);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [referenceDate, setReferenceDate] = useState('');
  const [narration, setNarration] = useState('');
  const [patientId, setPatientId] = useState('');
  const [saving, setSaving] = useState(false);
  // Alteration mode: keep the original number/status; force journal layout
  // when an old voucher's entries don't fit the single-account shape.
  const [loadedNumber, setLoadedNumber] = useState('');
  const [forceJournal, setForceJournal] = useState(false);
  // Tally's L: Optional — saved outside the books until made regular
  const [isOptional, setIsOptional] = useState(false);

  // Entry rows
  const lineKey = useRef(0);
  const newParticularsLine = (): ParticularsLine => ({ key: ++lineKey.current, account: null, amount: '' });
  const newJournalLine = (drcr: 'Dr' | 'Cr'): JournalLine => ({ key: ++lineKey.current, drcr, account: null, amount: '' });
  const [account, setAccount] = useState<Account | null>(null);
  const [partLines, setPartLines] = useState<ParticularsLine[]>(() => [newParticularsLine()]);
  const [journalLines, setJournalLines] = useState<JournalLine[]>(() => [newJournalLine('Dr'), newJournalLine('Cr')]);
  const previousCompanyId = useRef('');

  const voucherDateValue = useMemo(() => new Date(`${voucherDate}T00:00:00`), [voucherDate]);
  const openDatePicker = useCallback(() => setDatePickerRequest((request) => request + 1), []);
  const handleVoucherDateChange = useCallback((date: Date | undefined) => {
    if (date) setVoucherDate(format(date, 'yyyy-MM-dd'));
  }, []);

  useEffect(() => {
    if (!selectedCompanyId) return;
    if (previousCompanyId.current && previousCompanyId.current !== selectedCompanyId) {
      setAccount(null);
      setPartLines([newParticularsLine()]);
      setJournalLines([newJournalLine('Dr'), newJournalLine('Cr')]);
    }
    previousCompanyId.current = selectedCompanyId;
  }, [selectedCompanyId]);

  const partLedgerRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const partAmountRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const journalLedgerRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const journalAmountRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const narrationRef = useRef<HTMLTextAreaElement | null>(null);

  // Current-balance cache per account id (opening + AUTHORISED debits - credits)
  const [balances, setBalances] = useState<Record<string, number>>({});
  const loadBalance = useCallback(async (accountId: string) => {
    if (accountId in balances) return;
    try {
      const [{ data: acc }, movements] = await Promise.all([
        supabase
          .from('chart_of_accounts')
          .select('opening_balance, opening_balance_type')
          .eq('id', accountId)
          .single(),
        accountMovements({}),
      ]);
      const opening = (Number(acc?.opening_balance) || 0) * (acc?.opening_balance_type?.toUpperCase() === 'CR' ? -1 : 1);
      const m = movements.get(accountId);
      const movement = m ? m.debit - m.credit : 0;
      setBalances((prev) => ({ ...prev, [accountId]: opening + movement }));
    } catch (err) {
      console.error('Balance lookup failed:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balances]);

  // ------ Data ------
  const { data: costCentres = [] } = useCostCentres();
  const { data: billRefEnabled = false } = useQuery({
    queryKey: ['billref_probe'],
    queryFn: async () => {
      const { error } = await (supabase as any).from('voucher_entries').select('bill_ref').limit(1);
      return !error;
    },
  });

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
    queryKey: ['chart_of_accounts_leaves', selectedCompanyId],
    enabled: !!selectedCompanyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_type, account_group, parent_account_id')
        .eq('is_active', true)
        // Legacy default ledgers have no company_id and are shared system
        // accounts; never include ledgers belonging to another company.
        .or(`company_id.eq.${selectedCompanyId},company_id.is.null`)
        .order('account_code');
      if (error) throw error;
      // Tally never posts to group headers — offer leaf accounts only
      const parents = new Set((data ?? []).map((a: any) => a.parent_account_id).filter(Boolean));
      return ((data || []) as (Account & { parent_account_id: string | null })[]).filter((a) => !parents.has(a.id));
    },
  });

  // In payment, receipt and contra vouchers the Account side must be a cash or
  // bank ledger, matching the account picker in Tally. Particulars still shows
  // the remaining company ledgers.
  const cashBankAccounts = useMemo(() => accounts.filter((account) => {
    const searchable = `${account.account_name} ${account.account_type} ${account.account_group || ''}`.toLowerCase();
    return searchable.includes('cash') || searchable.includes('bank');
  }), [accounts]);

  // When opened from a Tally shortcut, select the requested voucher category
  // once the active voucher types have loaded. Alteration mode always wins.
  useEffect(() => {
    if (alterMode || selectedVoucherType || !initialVoucherCategory || voucherTypes.length === 0) return;
    const requested = initialVoucherCategory.toUpperCase();
    const matchingType = voucherTypes.find((type) => type.voucher_category?.toUpperCase() === requested);
    if (matchingType) setSelectedVoucherType(matchingType.id);
  }, [alterMode, initialVoucherCategory, selectedVoucherType, voucherTypes]);

  // New voucher entry opens on Payment by default. Explicit shortcuts and
  // alteration mode take priority over this default.
  useEffect(() => {
    if (alterMode || selectedVoucherType || initialVoucherCategory || voucherTypes.length === 0) return;
    const paymentType = voucherTypes.find((type) => type.voucher_category?.toUpperCase() === 'PAYMENT');
    if (paymentType) setSelectedVoucherType(paymentType.id);
  }, [alterMode, initialVoucherCategory, selectedVoucherType, voucherTypes]);

  // ------ Alteration mode: load the voucher and populate the form ------
  const { data: loadedVoucher } = useQuery({
    queryKey: ['alter_voucher', voucherId],
    enabled: alterMode,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vouchers')
        .select('*, voucher_entries(*)')
        .eq('id', voucherId!)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  useEffect(() => {
    if (!loadedVoucher || accounts.length === 0 || voucherTypes.length === 0) return;
    const vt = voucherTypes.find((t) => t.id === loadedVoucher.voucher_type_id);
    setSelectedVoucherType(loadedVoucher.voucher_type_id || '');
    setLoadedNumber(loadedVoucher.voucher_number || '');
    setVoucherDate(loadedVoucher.voucher_date || format(new Date(), 'yyyy-MM-dd'));
    setReferenceNumber(loadedVoucher.reference_number || '');
    setReferenceDate(loadedVoucher.reference_date || '');
    setNarration(loadedVoucher.narration || '');
    setPatientId(loadedVoucher.patient_id || '');
    if (loadedVoucher.company_id) setSelectedCompanyId(loadedVoucher.company_id);
    setIsOptional(!!loadedVoucher.is_optional);

    const byId = new Map(accounts.map((a) => [a.id, a]));
    const entries = [...(loadedVoucher.voucher_entries ?? [])].sort(
      (a: any, b: any) => (a.entry_order || 0) - (b.entry_order || 0),
    );
    const cat = (vt?.voucher_category || '').toUpperCase();
    const mode = SINGLE_ACCOUNT_MODES[cat];
    const accSide = mode
      ? entries.filter((e: any) => (mode.accountIsDebit ? Number(e.debit_amount) > 0 : Number(e.credit_amount) > 0))
      : [];
    if (mode && accSide.length === 1 && byId.has(accSide[0].account_id)) {
      setForceJournal(false);
      setAccount(byId.get(accSide[0].account_id) ?? null);
      const partSide = entries.filter((e: any) =>
        mode.accountIsDebit ? Number(e.credit_amount) > 0 : Number(e.debit_amount) > 0,
      );
      setPartLines(
        partSide.length > 0
          ? partSide.map((e: any) => ({
              key: ++lineKey.current,
              account: byId.get(e.account_id) ?? null,
              amount: String(mode.accountIsDebit ? Number(e.credit_amount) : Number(e.debit_amount)),
              costCentreId: e.cost_centre_id ?? undefined,
              billRef: e.bill_ref ?? undefined,
            }))
          : [newParticularsLine()],
      );
    } else {
      // Journal types, or a single-mode voucher whose shape doesn't fit
      setForceJournal(!!mode);
      const rows = entries
        .filter((e: any) => Number(e.debit_amount) > 0 || Number(e.credit_amount) > 0)
        .map((e: any) => ({
          key: ++lineKey.current,
          drcr: (Number(e.debit_amount) > 0 ? 'Dr' : 'Cr') as 'Dr' | 'Cr',
          account: byId.get(e.account_id) ?? null,
          amount: String(Number(e.debit_amount) > 0 ? Number(e.debit_amount) : Number(e.credit_amount)),
          costCentreId: e.cost_centre_id ?? undefined,
          billRef: e.bill_ref ?? undefined,
        }));
      setJournalLines(rows.length >= 2 ? rows : [newJournalLine('Dr'), newJournalLine('Cr')]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedVoucher, accounts, voucherTypes]);

  // ------ Derive the auto-generated voucher number ------
  const selectedType = useMemo(
    () => voucherTypes.find((vt) => vt.id === selectedVoucherType),
    [voucherTypes, selectedVoucherType]
  );

  const generatedVoucherNumber = useMemo(() => {
    if (!selectedType) return '';
    const nextNum = (selectedType.current_number || 0) + 1;
    return generateVoucherNumber(selectedType.prefix || '', nextNum);
  }, [selectedType]);

  const category = (selectedType?.voucher_category || '').toUpperCase();
  useEffect(() => {
    setVoucherNumberOverride('');
  }, [selectedVoucherType, alterMode]);

  const voucherNumber = alterMode
    ? loadedNumber
    : voucherNumberOverride || generatedVoucherNumber;
  const singleMode = forceJournal ? undefined : SINGLE_ACCOUNT_MODES[category];

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
  const updateJournalDebitAmount = (key: number, amount: string): void => {
    setJournalLines((prev) => {
      const firstDebit = prev.find((line) => line.drcr === 'Dr');
      const firstCredit = prev.find((line) => line.drcr === 'Cr');
      return prev.map((line) => {
        if (line.key === key) return { ...line, amount };
        if (firstDebit?.key === key && firstCredit?.key === line.key) return { ...line, amount };
        return line;
      });
    });
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
    setIsOptional(false);
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
        cost_centre_id: null as string | null,
      };
      const lineRows = filled.map((l) => ({
        account_id: l.account!.id,
        debit_amount: singleMode.accountIsDebit ? 0 : Number(l.amount),
        credit_amount: singleMode.accountIsDebit ? Number(l.amount) : 0,
        narration: '',
        cost_centre_id: l.costCentreId || null,
        bill_ref: l.billRef?.trim() || null,
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
      cost_centre_id: l.costCentreId || null,
      bill_ref: l.billRef?.trim() || null,
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

      if (alterMode) {
        // ------ Alteration: update header, replace entries, keep the number ------
        const { error: uErr } = await supabase
          .from('vouchers')
          .update({
            voucher_date: voucherDate,
            reference_number: referenceNumber || null,
            reference_date: referenceDate || null,
            narration: narration || '',
            total_amount: debitSum,
            patient_id: patientId || null,
            status: isOptional ? 'PENDING' : status === 'posted' ? 'AUTHORISED' : 'PENDING',
            is_optional: isOptional,
            last_modified_by: username,
          })
          .eq('id', voucherId!);
        if (uErr) {
          toast.error('Failed to update voucher: ' + uErr.message);
          throw uErr;
        }
        const { error: dErr } = await supabase.from('voucher_entries').delete().eq('voucher_id', voucherId!);
        if (dErr) {
          toast.error('Failed to replace entries: ' + dErr.message);
          throw dErr;
        }
        const { error: iErr } = await supabase.from('voucher_entries').insert(
          validEntries.map((e, i) => ({
            voucher_id: voucherId!,
            account_id: e.account_id,
            debit_amount: e.debit_amount || 0,
            credit_amount: e.credit_amount || 0,
            narration: e.narration || '',
            entry_order: i + 1,
            ...(costCentres.length > 0 ? { cost_centre_id: (e as any).cost_centre_id ?? null } : {}),
            ...(billRefEnabled ? { bill_ref: (e as any).bill_ref ?? null } : {}),
          })),
        );
        if (iErr) {
          toast.error('Failed to save entries: ' + iErr.message);
          throw iErr;
        }
        toast.success(`Voucher ${loadedNumber} altered.`);
        queryClient.invalidateQueries({ queryKey: ['vouchers'] });
        queryClient.invalidateQueries({ queryKey: ['daybook_vouchers'] });
        queryClient.invalidateQueries({ queryKey: ['ledger_entries'] });
        setBalances({});
        onDone?.();
        return;
      }

      const nextNum = (voucherType?.current_number || 0) + 1;
      const generatedNumber = generateVoucherNumber(voucherType?.prefix || '', nextNum);
      const numberToSave = voucherNumber.trim() || generatedNumber;
      if (!numberToSave) {
        toast.error('Enter a voucher number.');
        return;
      }

      const { data: voucher, error: vErr } = await supabase
        .from('vouchers')
        .insert({
          voucher_number: numberToSave,
          voucher_type_id: selectedVoucherType,
          voucher_date: voucherDate,
          reference_number: referenceNumber || null,
          reference_date: referenceDate || null,
          narration: narration || '',
          total_amount: debitSum,
          patient_id: patientId || null,
          company_id: selectedCompanyId || null,
          // vouchers.status CHECK constraint allows PENDING / AUTHORISED / CANCELLED
          status: isOptional ? 'PENDING' : status === 'posted' ? 'AUTHORISED' : 'PENDING',
          is_optional: isOptional,
          created_by: 'system',
          last_modified_by: username,
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
        ...(costCentres.length > 0 ? { cost_centre_id: (e as any).cost_centre_id ?? null } : {}),
        ...(billRefEnabled ? { bill_ref: (e as any).bill_ref ?? null } : {}),
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

      toast.success(`Voucher ${numberToSave} saved${status === 'posted' ? '' : ' as pending'}.`);

      const voucherTypeName = (voucherType?.voucher_type_name || '').toLowerCase();
      if ((voucherTypeName.includes('receipt') || voucherTypeName.includes('receive')) && debitSum >= 10000) {
        sendPaymentAlert({
          alert_type: 'receipt',
          amount: debitSum,
          patient_name: narration || 'Voucher Entry',
          hospital_name: 'Hope',
            additional_info: `Voucher: ${numberToSave}, Type: ${voucherType?.voucher_type_name || 'N/A'}`,
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

  // ------ Alteration actions: Cancel Vch (soft) and Delete (hard) ------
  const cancelVoucher = async (): Promise<void> => {
    if (!alterMode) return;
    if (!window.confirm(`Cancel voucher ${loadedNumber}? It will stop affecting all reports.`)) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('vouchers')
        .update({ status: 'CANCELLED', last_modified_by: username })
        .eq('id', voucherId!);
      if (error) throw error;
      toast.info(`Voucher ${loadedNumber} cancelled`);
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['daybook_vouchers'] });
      onDone?.();
    } catch (err) {
      console.error('Cancel failed:', err);
      toast.error('Failed to cancel — please try again');
    } finally {
      setSaving(false);
    }
  };

  const deleteVoucher = async (): Promise<void> => {
    if (!alterMode) return;
    if (!window.confirm(`Permanently DELETE voucher ${loadedNumber} and its entries? This cannot be undone.`)) return;
    setSaving(true);
    try {
      // Stamp who is deleting so the edit-log trigger records it
      await supabase.from('vouchers').update({ last_modified_by: username }).eq('id', voucherId!);
      const { error: eErr } = await supabase.from('voucher_entries').delete().eq('voucher_id', voucherId!);
      if (eErr) throw eErr;
      const { error: vErr } = await supabase.from('vouchers').delete().eq('id', voucherId!);
      if (vErr) throw vErr;
      toast.info(`Voucher ${loadedNumber} deleted`);
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['daybook_vouchers'] });
      onDone?.();
    } catch (err) {
      console.error('Delete failed:', err);
      toast.error('Failed to delete — it may be referenced elsewhere');
    } finally {
      setSaving(false);
    }
  };

  // ------ Formal A4 voucher print (Tally-style) ------
  const printVoucher = (): void => {
    const esc = (t: string) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows: { name: string; dr: number; cr: number }[] = [];
    if (singleMode && account) {
      const total = partLines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
      for (const l of partLines) {
        if (!l.account || !(Number(l.amount) > 0)) continue;
        rows.push({
          name: l.account.account_name,
          dr: singleMode.accountIsDebit ? 0 : Number(l.amount),
          cr: singleMode.accountIsDebit ? Number(l.amount) : 0,
        });
      }
      rows.push({
        name: account.account_name,
        dr: singleMode.accountIsDebit ? total : 0,
        cr: singleMode.accountIsDebit ? 0 : total,
      });
    } else {
      for (const l of journalLines) {
        if (!l.account || !(Number(l.amount) > 0)) continue;
        rows.push({
          name: l.account.account_name,
          dr: l.drcr === 'Dr' ? Number(l.amount) : 0,
          cr: l.drcr === 'Cr' ? Number(l.amount) : 0,
        });
      }
    }
    if (rows.length === 0) {
      toast.error('Nothing to print — fill the voucher first');
      return;
    }
    const total = rows.reduce((s, r) => s + r.dr, 0);
    const win = window.open('', '_blank', 'width=900,height=1100');
    if (!win) {
      toast.error('Popup blocked — allow popups to print');
      return;
    }
    const body = rows
      .map(
        (r) => `<tr>
          <td class="b">${r.dr > 0 ? 'Dr' : 'Cr'} ${esc(r.name)}</td>
          <td class="b num">${r.dr > 0 ? fmtINR(r.dr) : ''}</td>
          <td class="b num">${r.cr > 0 ? fmtINR(r.cr) : ''}</td>
        </tr>`,
      )
      .join('');
    win.document.write(`<!doctype html><html><head><meta charset="utf-8" />
<title>${esc(selectedType?.voucher_type_name || 'Voucher')} — ${esc(voucherNumber)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; margin: 14mm; color: #000; font-size: 13px; }
  .org { text-align: center; font-size: 16px; font-weight: 700; }
  .doc { text-align: center; text-transform: uppercase; letter-spacing: 2px; margin: 2px 0 12px; }
  .head { display: flex; justify-content: space-between; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th { border: 1px solid #444; background: #eef; padding: 6px 8px; text-align: left; }
  td.b { border: 1px solid #444; padding: 6px 8px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; width: 20%; }
  tr.total td { font-weight: 700; background: #eef; }
  .words { margin-top: 8px; font-style: italic; }
  .narr { margin-top: 6px; }
  .sign { margin-top: 64px; display: flex; justify-content: space-between; font-size: 12px; }
  .sign div { border-top: 1px solid #444; padding-top: 4px; width: 30%; text-align: center; }
  @page { size: A4 portrait; margin: 14mm; }
</style></head><body>
  <div class="org">${esc(hospitalConfig.name)} Hospital</div>
  <div class="doc">${esc(selectedType?.voucher_type_name || 'Voucher')}</div>
  <div class="head">
    <div>No.: <b>${esc(voucherNumber || '(unsaved)')}</b></div>
    <div>Date: <b>${esc(tallyDateLabel(voucherDate))}</b></div>
  </div>
  <table>
    <thead><tr><th>Particulars</th><th class="num">Debit (₹)</th><th class="num">Credit (₹)</th></tr></thead>
    <tbody>${body}
      <tr class="total"><td class="b num" style="text-align:right">Total</td><td class="b num">${fmtINR(total)}</td><td class="b num">${fmtINR(total)}</td></tr>
    </tbody>
  </table>
  <div class="words">Amount (in words): <b>${esc(amountInWords(total))}</b></div>
  <div class="narr">Narration: ${esc(narration || '-')}</div>
  <div class="sign"><div>Prepared By</div><div>Checked By</div><div>Authorised Signatory</div></div>
  <script>window.onload=function(){setTimeout(function(){window.print()},150)}</script>
</body></html>`);
    win.document.close();
  };

  // ------ Tally right rail: F2 Date + F4–F9 voucher types + other types ------
  const rail = useMemo<RailItem[]>(() => {
    if (alterMode) {
      return [
        { hotkey: 'F2', label: 'Date', onClick: openDatePicker },
        { hotkey: 'L', label: 'Optional', gapBefore: true, onClick: () => setIsOptional((v) => !v), active: isOptional },
        { hotkey: 'P', label: 'Print Vch', gapBefore: true, onClick: printVoucher },
        ...(canAlter
          ? [
              { hotkey: 'X', label: 'Cancel Vch', gapBefore: true, onClick: cancelVoucher },
              { hotkey: 'D', label: 'Delete', onClick: deleteVoucher },
            ]
          : []),
      ];
    }
    const byCategory = (cat: string) => voucherTypes.find((vt) => vt.voucher_category?.toUpperCase() === cat);
    const mainIds = new Set<string>();
    const items: RailItem[] = [
      { hotkey: 'F2', label: 'Date', onClick: openDatePicker },
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
    items.push({ hotkey: 'L', label: 'Optional', gapBefore: true, onClick: () => setIsOptional((v) => !v), active: isOptional });
    items.push({
      hotkey: 'T',
      label: 'Post-Dated',
      onClick: () => {
        // Tally: a post-dated voucher simply carries a future date
        const d = new Date();
        d.setDate(d.getDate() + 30);
        setVoucherDate(format(d, 'yyyy-MM-dd'));
        toast.info('Date set 30 days ahead — adjust as needed. Post-dated vouchers stay out of reports until due.');
        setTimeout(openDatePicker, 0);
      },
    });
    items.push({ hotkey: 'P', label: 'Print Vch', gapBefore: true, onClick: printVoucher });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voucherTypes, selectedVoucherType, alterMode, isOptional, canAlter, openDatePicker]);

  const accountBalance = account ? balances[account.id] : undefined;

  const amountInputClass =
    'h-7 w-36 rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-right font-mono text-[13px] shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid disabled:border-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  return (
    <TallyScreen
      title={alterMode ? "Accounting Voucher Alteration" : "Accounting Voucher Creation"}
      rail={rail}
      onClose={onDone}
    >
      {/* Voucher type / No. / Ref / Date strip */}
      <div className="flex items-start justify-between border-b border-[#9db8d8] bg-[#eef3fa] px-2 py-1 text-[13px]">
        <div>
          <div className="flex items-center gap-3">
            <span className="min-w-[90px] bg-[#16437e] px-4 py-0.5 text-center font-bold text-white">
              {selectedType?.voucher_type_name?.replace(' Voucher', '') || 'Voucher'}
            </span>
            <span className="font-medium">No.</span>
            {!alterMode ? (
              <Input
                value={voucherNumberOverride || generatedVoucherNumber}
                onChange={(e) => setVoucherNumberOverride(e.target.value)}
                className="h-7 min-w-[100px] rounded-none border border-gray-400 bg-[#fdf6d8] px-2 font-mono text-sm"
                aria-label="Voucher number"
              />
            ) : (
              <span className="min-w-[100px] border border-gray-400 bg-[#fdf6d8] px-2 font-mono">
                {voucherNumber || '…'}
              </span>
            )}
            {isOptional && <span className="bg-orange-600 px-2 py-0.5 text-[11px] font-bold text-white">OPTIONAL</span>}
            {voucherDate > format(new Date(), 'yyyy-MM-dd') && (
              <span className="bg-purple-700 px-2 py-0.5 text-[11px] font-bold text-white">POST-DATED</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <EnhancedDatePicker
            value={voucherDateValue}
            onChange={handleVoucherDateChange}
            openRequest={datePickerRequest}
            manualInput
            className="ml-auto w-40"
            buttonClassName="h-6 border-[#9db8d8] bg-white px-2 text-right text-xs"
            calendarButtonClassName="h-6 w-7 border-[#9db8d8] bg-white"
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
                accounts={cashBankAccounts}
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
                      accounts={accounts.filter((candidate) => candidate.id !== account?.id)}
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
                      <SelectItem value="Dr">Dr</SelectItem>
                      <SelectItem value="Cr">Cr</SelectItem>
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
                      if (line.drcr === 'Dr') journalAmountRefs.current[line.key] = el;
                    }}
                    type="number"
                    inputMode="decimal"
                    value={line.drcr === 'Dr' ? line.amount : ''}
                    disabled={line.drcr !== 'Dr'}
                    onChange={(e) => updateJournalDebitAmount(line.key, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleJournalAmountEnter(idx);
                      }
                    }}
                    className={amountInputClass}
                  />
                  <Input
                    ref={(el) => {
                      if (line.drcr === 'Cr') journalAmountRefs.current[line.key] = el;
                    }}
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
              {!canAlter && (
                <span className="self-center bg-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600">VIEW ONLY</span>
              )}
              {canAlter && (
              <>
              <Button variant="outline" size="sm" className="h-7 rounded-none text-xs" onClick={() => saveVoucher('draft')} disabled={saving}>
                {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Save as Pending
              </Button>
              <Button size="sm" className="h-7 rounded-none bg-[#16437e] text-xs hover:bg-[#0f3363]" onClick={() => saveVoucher('posted')} disabled={saving}>
                {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                <span className="underline">A</span>: Accept
              </Button>
              </>
              )}
              <Button
                variant="secondary"
                size="sm"
                className="h-7 rounded-none text-xs"
                onClick={() => (alterMode ? onDone?.() : handleClear())}
                disabled={saving}
              >
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
