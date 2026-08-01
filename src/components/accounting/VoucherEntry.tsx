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
import { TallyScreen, getTallyFeatures, type RailItem, type TallyFeatureFlags } from './tally/TallyChrome';
import { useFieldRing } from './tally/useFieldRing';
import { useShortcuts } from './tally/keyboard';
import QuickLedgerPopup from './tally/QuickLedgerPopup';
import { TallyChoiceField, TallyPopup, TallyTextField } from './tally/TallyPopup';
import { TallyConfirm } from './tally/TallyConfirm';
import { useCostCentres } from './CostCentres';
import { useAccountingRights } from './tally/rights';
import { useAccountingCompany } from './AccountingCompanyContext';
import { useVoucherActions } from '@/hooks/useVoucherActions';
import { VoucherAttachmentFields } from './VoucherAttachmentFields';
import { fmtINR, tallyDateLabel, printTallyVoucher } from '@/lib/tallyPrint';
import {
  discardVoucherAttachments,
  linkVoucherAttachments,
  VOUCHER_ATTACHMENT_CATEGORIES,
  type VoucherAttachment,
  type VoucherAttachmentCategory,
} from '@/lib/voucher-attachments';

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
  patient_ledger_id?: string;
  patient_id?: string;
  patient_name?: string;
}

interface NarrationPatient {
  id: string;
  name: string;
  patientCode: string;
  phone: string;
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
const RAIL_KEYS: { hotkey: string; mod?: 'ctrl'; category: string; label: string }[] = [
  { hotkey: 'F4', category: 'CONTRA', label: 'Contra' },
  { hotkey: 'F5', category: 'PAYMENT', label: 'Payment' },
  { hotkey: 'F6', category: 'RECEIPT', label: 'Receipt' },
  { hotkey: 'F7', category: 'JOURNAL', label: 'Journal' },
  { hotkey: 'F8', category: 'SALES', label: 'Sales' },
  // Tally puts the notes on the shifted sales/purchase keys
  { hotkey: 'F8', mod: 'ctrl', category: 'CREDIT NOTE', label: 'Credit Note' },
  { hotkey: 'F9', category: 'PURCHASE', label: 'Purchase' },
  { hotkey: 'F9', mod: 'ctrl', category: 'DEBIT NOTE', label: 'Debit Note' },
];

/**
 * Tally's Bill-wise Details / Cost Centre Allocation sub-screen, opened from
 * the ledger line it belongs to.
 *
 * Both fields were already persisted and reloaded with the voucher — there was
 * simply no way to type them in. Each half only appears when the matching
 * F11 company feature is on, exactly as Tally hides them.
 */
const AllocationPopup: React.FC<{
  ledgerName: string;
  amount: string;
  billRef: string;
  costCentreId: string;
  costCentres: { id: string; name: string }[];
  features: TallyFeatureFlags;
  onAccept: (next: { billRef: string; costCentreId: string }) => void;
  onClose: () => void;
}> = ({ ledgerName, amount, billRef, costCentreId, costCentres, features, onAccept, onClose }) => {
  const [ref, setRef] = useState(billRef);
  const [centre, setCentre] = useState(costCentreId);
  const centreNames = ['(none)', ...costCentres.map((c) => c.name)];
  const centreName = costCentres.find((c) => c.id === centre)?.name ?? '(none)';

  return (
    <TallyPopup
      title={features.billWise ? 'Bill-wise Details' : 'Cost Centre Allocation'}
      width={360}
      onAccept={() => onAccept({ billRef: ref.trim(), costCentreId: centre })}
      onClose={onClose}
    >
      <div className="pb-1 text-center text-[12px]">
        <span className="font-semibold">{ledgerName || '(ledger)'}</span>
        {Number(amount) > 0 && <span className="pl-2 font-mono">{fmtINR(Number(amount))}</span>}
      </div>
      {features.billWise && (
        <TallyTextField label="Bill Reference" value={ref} onChange={setRef} width={170} labelWidth={130} />
      )}
      {features.costCentres && costCentres.length > 0 && (
        <TallyChoiceField
          label="Cost Centre"
          value={centreName}
          options={centreNames}
          width={170}
          labelWidth={130}
          onChange={(name) => setCentre(costCentres.find((c) => c.name === name)?.id ?? '')}
        />
      )}
      {!features.billWise && !(features.costCentres && costCentres.length > 0) && (
        <div className="py-2 text-center text-[12px] italic text-gray-500">
          Turn on Bill-wise details or Cost Centres in F11: Features.
        </div>
      )}
    </TallyPopup>
  );
};

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
  /** Alt+C — create the ledger being typed without leaving the voucher */
  onCreateLedger?: (name: string) => void;
  /** Ctrl+Enter — alter the ledger under the cursor */
  onAlterLedger?: (account: Account) => void;
}

const AccountSearch = ({
  accounts,
  selected,
  onSelect,
  placeholder,
  className,
  inputRef,
  onEmptyEnter,
  onCreateLedger,
  onAlterLedger,
}: AccountSearchProps) => {
  const [text, setText] = useState(selected?.account_name ?? '');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [focused, setFocused] = useState(false);

  // Tally's two master keys, live only while the cursor is in this field:
  // Alt+C creates what you typed, Ctrl+Enter alters what you picked. They sit
  // on the `field` layer so they beat the screen's own rail.
  useShortcuts(
    [
      {
        combo: 'Alt+C',
        layer: 'field',
        allowInInput: true,
        label: 'Create the ledger being typed',
        disabled: !onCreateLedger,
        run: () => onCreateLedger?.(text.trim()),
      },
      {
        combo: 'Ctrl+Enter',
        layer: 'field',
        allowInInput: true,
        label: 'Alter the ledger under the cursor',
        disabled: !onAlterLedger || !selected,
        run: () => selected && onAlterLedger?.(selected),
      },
    ],
    focused,
  );

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
    // Keep every company ledger available in Particulars. The menu is
    // vertically capped and scrollable, so large charts remain usable while
    // users can still type to narrow the list.
    return list;
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
        data-tally-field
        // While the "List of Ledger Accounts" is open this field answers Enter
        // and the arrows itself, so the form's field cursor stands aside.
        data-tally-own-keys={open ? 'Enter,ArrowDown,ArrowUp' : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setHighlight(0);
          if (selected) onSelect(null);
        }}
        onFocus={() => {
          setOpen(true);
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
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
              key={a.patient_ledger_id || a.id}
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

type NarrationTagTrigger = '@' | '#';

interface ActiveNarrationTag {
  trigger: NarrationTagTrigger;
  query: string;
  start: number;
  end: number;
}

interface NarrationTagTextareaProps {
  value: string;
  onChange: (value: string) => void;
  ledgerAccounts: Account[];
  patients: NarrationPatient[];
  onPatientSelect: (patient: NarrationPatient) => void;
  textareaRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  rows: number;
  className?: string;
}

interface NarrationTagOption {
  key: string;
  label: string;
  secondary: string;
  searchText: string;
  patient?: NarrationPatient;
}

const activeNarrationTag = (value: string, caret: number): ActiveNarrationTag | null => {
  const beforeCaret = value.slice(0, caret);
  const match = beforeCaret.match(/(?:^|[\s([{,:;])([@#])([^\s@#]*)$/);
  if (!match) return null;

  const trigger = match[1] as NarrationTagTrigger;
  const query = match[2] || '';
  const start = caret - query.length - 1;
  let end = caret;
  while (end < value.length && !/[\s@#]/.test(value[end])) end += 1;
  return { trigger, query, start, end };
};

/**
 * Plain-text @ledger / #patient autocomplete. Tags stay normal narration text
 * so existing report search and exports continue to work without a new format.
 */
const NarrationTagTextarea = ({
  value,
  onChange,
  ledgerAccounts,
  patients,
  onPatientSelect,
  textareaRef,
  rows,
  className,
}: NarrationTagTextareaProps) => {
  const [activeTag, setActiveTag] = useState<ActiveNarrationTag | null>(null);
  const [highlight, setHighlight] = useState(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const options = useMemo<NarrationTagOption[]>(() => {
    if (!activeTag) return [];
    const query = activeTag.query.trim().toLocaleLowerCase();
    const source = activeTag.trigger === '#'
      ? patients.map((patient) => ({
          key: patient.id,
          label: patient.name,
          secondary: [patient.patientCode, patient.phone].filter(Boolean).join(' · '),
          searchText: `${patient.name} ${patient.patientCode} ${patient.phone}`.toLocaleLowerCase(),
          patient,
        }))
      : ledgerAccounts.map((account) => ({
          key: account.id,
          label: account.account_name,
          secondary: account.account_code,
          searchText: `${account.account_name} ${account.account_code}`.toLocaleLowerCase(),
        }));
    return query ? source.filter((option) => option.searchText.includes(query)) : source;
  }, [activeTag, ledgerAccounts, patients]);

  const updateActiveTag = (nextValue: string, caret: number | null) => {
    const next = activeNarrationTag(nextValue, caret ?? nextValue.length);
    setActiveTag(next);
    setHighlight(0);
  };

  const pick = (option: NarrationTagOption) => {
    if (!activeTag) return;
    const tag = `${activeTag.trigger}${option.label}`;
    const before = value.slice(0, activeTag.start);
    const after = value.slice(activeTag.end);
    const separator = after.startsWith(' ') ? '' : ' ';
    const nextValue = `${before}${tag}${separator}${after}`;
    const nextCaret = before.length + tag.length + separator.length;

    onChange(nextValue);
    if (option.patient) onPatientSelect(option.patient);
    setActiveTag(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  return (
    <div className="relative">
      <Textarea
        id="voucher_narration"
        ref={textareaRef}
        value={value}
        data-tally-field
        // An open @ledger / #patient list answers Enter and the arrows itself.
        data-tally-own-keys={activeTag ? 'Enter,ArrowDown,ArrowUp,Tab' : undefined}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange(nextValue);
          updateActiveTag(nextValue, event.target.selectionStart);
        }}
        onSelect={(event) => {
          const target = event.currentTarget;
          updateActiveTag(value, target.selectionStart);
        }}
        onFocus={(event) => updateActiveTag(value, event.currentTarget.selectionStart)}
        onBlur={() => {
          closeTimer.current = setTimeout(() => setActiveTag(null), 150);
        }}
        onKeyDown={(event) => {
          if (!activeTag) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            setActiveTag(null);
            return;
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlight((current) => Math.min(current + 1, Math.max(options.length - 1, 0)));
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlight((current) => Math.max(current - 1, 0));
            return;
          }
          if ((event.key === 'Enter' || event.key === 'Tab') && options[highlight]) {
            event.preventDefault();
            pick(options[highlight]);
          }
        }}
        rows={rows}
        placeholder="Type @ for ledgers or # for patients"
        className={className}
      />

      {activeTag && (
        <div className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto border border-[#9db8d8] bg-white text-slate-900 shadow-xl">
          <div className={`sticky top-0 flex items-center justify-between px-3 py-1.5 text-xs font-semibold text-white ${
            activeTag.trigger === '#' ? 'bg-violet-700' : 'bg-[#16437e]'
          }`}>
            <span>{activeTag.trigger === '#' ? 'Patients' : 'Ledger Accounts'}</span>
            <span>{options.length}</span>
          </div>
          {options.length > 0 ? options.map((option, index) => (
              <button
                type="button"
                key={option.key}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => pick(option)}
                className={`flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left text-sm ${
                  index === highlight ? 'bg-[#fdf6d8]' : 'bg-white hover:bg-slate-50'
                }`}
              >
                <span className="min-w-0 truncate font-medium">{activeTag.trigger}{option.label}</span>
                {option.secondary && (
                  <span className="shrink-0 font-mono text-xs text-slate-500">{option.secondary}</span>
                )}
              </button>
            )) : (
            <div className="px-3 py-3 text-sm text-slate-500">
              No {activeTag.trigger === '#' ? 'patients' : 'ledger accounts'} match “{activeTag.query}”.
            </div>
          )}
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
  /** Select this exact active voucher type when opening from the voucher picker. */
  initialVoucherTypeId?: string;
  /** Tally's "2: Duplicate Vch" — copy this voucher into a new, unsaved one */
  duplicateFromId?: string;
  /** Tally's "I: Insert Vch" — open a new voucher already dated to this day */
  initialDate?: string;
  /** Keep a tablet tile on its requested voucher type. */
  lockedVoucherCategory?: string;
  /** Applies touch-sized controls while retaining the canonical form and save path. */
  tabletMode?: boolean;
  /** Alt+V — open the voucher to read, with every altering action greyed */
  displayOnly?: boolean;
}

const VoucherEntry: React.FC<VoucherEntryProps> = ({
  voucherId,
  onDone,
  initialVoucherCategory,
  initialVoucherTypeId,
  duplicateFromId,
  initialDate,
  lockedVoucherCategory,
  tabletMode = false,
  displayOnly = false,
}) => {
  const queryClient = useQueryClient();
  const { user, hospitalConfig } = useAuth();
  // Alt+V opens a voucher to look at. Tally's Display mode is Alteration with
  // every action that changes something switched off, so it rides on canAlter.
  const { canAlter: mayAlter } = useAccountingRights();
  const canAlter = mayAlter && !displayOnly;
  const { companies, selectedCompanyId, setSelectedCompanyId } = useAccountingCompany();
  const {
    cancelVoucher: cancelVoucherById,
    deleteVoucher: deleteVoucherById,
    confirmUI,
  } = useVoucherActions();
  const alterMode = !!voucherId;
  // Duplicating loads a voucher exactly like alteration does, but saves as new
  const sourceVoucherId = voucherId ?? duplicateFromId;
  const username = user?.username || user?.email || 'system';

  // Form state
  const [selectedVoucherType, setSelectedVoucherType] = useState('');
  const [voucherDate, setVoucherDate] = useState(initialDate ?? format(new Date(), 'yyyy-MM-dd'));
  const [voucherNumberOverride, setVoucherNumberOverride] = useState('');
  const [datePickerRequest, setDatePickerRequest] = useState(0);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [referenceDate, setReferenceDate] = useState('');
  const [narration, setNarration] = useState('');
  const [patientId, setPatientId] = useState('');
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState<VoucherAttachment[]>([]);
  // Alteration mode: keep the original number/status; force journal layout
  // when an old voucher's entries don't fit the single-account shape.
  const [loadedNumber, setLoadedNumber] = useState('');
  const [forceJournal, setForceJournal] = useState(false);
  // The type the typist has asked to switch to, waiting on the confirm box
  const [pendingTypeId, setPendingTypeId] = useState<string | null>(null);
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
  // Which ledger line has its Bill-wise / Cost Centre sub-screen open
  const [allocFor, setAllocFor] = useState<{ kind: 'part' | 'journal'; key: number } | null>(null);
  const [features, setFeatures] = useState<TallyFeatureFlags>(getTallyFeatures);
  useEffect(() => {
    const onChange = () => setFeatures(getTallyFeatures());
    window.addEventListener('tally-features-changed', onChange);
    return () => window.removeEventListener('tally-features-changed', onChange);
  }, []);
  const allocationsOn = features.billWise || features.costCentres;
  const loadBalance = useCallback(async (accountId: string) => {
    if (accountId in balances) return;
    try {
      const [{ data: acc }, movements] = await Promise.all([
        supabase
          .from('chart_of_accounts')
          .select('opening_balance, opening_balance_type')
          .eq('id', accountId)
          .single(),
        accountMovements({ companyId: selectedCompanyId }),
      ]);
      const opening = (Number(acc?.opening_balance) || 0) * (acc?.opening_balance_type?.toUpperCase() === 'CR' ? -1 : 1);
      const m = movements.get(accountId);
      const movement = m ? m.debit - m.credit : 0;
      setBalances((prev) => ({ ...prev, [accountId]: opening + movement }));
    } catch (err) {
      console.error('Balance lookup failed:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balances, selectedCompanyId]);

  // Cur Bal is memoised per account id, so switching company would otherwise
  // keep showing the previous company's figure for an already-seen ledger.
  useEffect(() => {
    setBalances({});
  }, [selectedCompanyId]);

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
      const pageSize = 1000;
      // A company's own ledgers plus the shared ones. Cash, the banks and the
      // income heads carry no company on purpose — that is how one voucher
      // balances in every company's books — so filtering on company alone drops
      // exactly the ledgers most vouchers are posted to and both legs of a
      // receipt come up blank. Two plain queries rather than one compound
      // PostgREST OR, which loses rows on this table.
      const fetchScope = async (scope: 'company' | 'shared') => {
        const rows: any[] = [];
        for (let from = 0; ; from += pageSize) {
          let query = supabase
            .from('chart_of_accounts')
            .select('id, account_code, account_name, account_type, account_group, parent_account_id')
            .eq('is_active', true);
          query = scope === 'shared'
            ? query.is('company_id', null)
            : query.eq('company_id', selectedCompanyId);
          const { data, error } = await query
            .order('account_code')
            .range(from, from + pageSize - 1);
          if (error) throw error;
          rows.push(...(data || []));
          if (!data || data.length < pageSize) break;
        }
        return rows;
      };
      const allRows = (await Promise.all([fetchScope('company'), fetchScope('shared')])).flat();
      // Tally never posts to group headers — offer leaf accounts only
      const parents = new Set(allRows.map((a: any) => a.parent_account_id).filter(Boolean));
      return (allRows as (Account & { parent_account_id: string | null })[]).filter((a) => !parents.has(a.id));
    },
  });

  const { data: patientLedgerAccounts = [] } = useQuery({
    queryKey: ['voucher_patient_ledgers', selectedCompanyId],
    enabled: !!selectedCompanyId,
    queryFn: async () => {
      const pageSize = 1000;
      const allRows: any[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await (supabase as any)
          .from('patient_ledgers')
          .select(`
            id, patient_id, ledger_name, account_id,
            patient:patients(id, name),
            account:chart_of_accounts!inner(id, account_code, account_name, account_type, account_group, company_id)
          `)
          .eq('is_active', true)
          .eq('account.company_id', selectedCompanyId)
          .order('ledger_name')
          .range(from, from + pageSize - 1);
        if (error) throw error;
        allRows.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }
      return allRows
        .filter((row: any) => row.account_id && row.patient_id)
        .map((row: any): Account => ({
          id: row.account_id,
          account_code: row.account?.account_code || '',
          account_name: row.patient?.name || row.ledger_name || 'Patient',
          account_type: row.account?.account_type || 'CURRENT_ASSETS',
          account_group: row.account?.account_group || null,
          patient_ledger_id: row.id,
          patient_id: row.patient_id,
          patient_name: row.patient?.name || row.ledger_name || 'Patient',
        }));
    },
  });

  const { data: narrationPatients = [] } = useQuery({
    queryKey: ['voucher_narration_patients', hospitalConfig.name],
    enabled: !!hospitalConfig.name,
    queryFn: async () => {
      const pageSize = 1000;
      const allRows: NarrationPatient[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from('patients')
          .select('id, name, patients_id, phone')
          .eq('hospital_name', hospitalConfig.name)
          .order('name')
          .order('id')
          .range(from, from + pageSize - 1);
        if (error) throw error;
        allRows.push(...(data || []).map((patient) => ({
          id: patient.id,
          name: patient.name,
          patientCode: patient.patients_id || '',
          phone: patient.phone || '',
        })));
        if (!data || data.length < pageSize) break;
      }
      return allRows;
    },
  });

  // Patient ledgers are deliberately absent when writing a new voucher.
  //
  // A receipt typed here would post correctly - the entry carries
  // patient_ledger_id and bill_ref - but it would never become an
  // advance_payment or final_payments row. So the Final Bill would still show
  // the money as unpaid, discharge and gate pass would not know it was
  // collected, and the front desk would chase a patient who had already paid.
  // Worse, the same money can be taken at the desk AND typed here, and nothing
  // would catch it, because they are two separate records of one payment.
  //
  // Patient money is collected on the Final Bill page, which raises its own
  // voucher. This screen is for what only it can do: vendors, expenses,
  // contras and corrections.
  //
  // They stay available when altering, so an existing patient voucher still
  // renders its ledger name instead of coming up blank.
  const selectableAccounts = useMemo(
    () => (alterMode ? [...patientLedgerAccounts, ...accounts] : accounts),
    [alterMode, patientLedgerAccounts, accounts],
  );

  const { data: linkedAttachments = [] } = useQuery({
    queryKey: ['voucher-entry-attachments', voucherId],
    enabled: !!voucherId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('file_uploads')
        .select('id, voucher_id, file_name, file_url, file_type, file_size, storage_path, category, created_at')
        .eq('voucher_id', voucherId)
        .in('category', [...VOUCHER_ATTACHMENT_CATEGORIES])
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []).map((row: any): VoucherAttachment => ({
        id: row.id,
        voucherId: row.voucher_id,
        fileName: row.file_name,
        fileUrl: row.file_url || '',
        fileType: row.file_type || 'application/octet-stream',
        fileSize: Number(row.file_size || 0),
        storagePath: row.storage_path || '',
        category: row.category as VoucherAttachmentCategory,
        createdAt: row.created_at,
      }));
    },
  });

  useEffect(() => {
    if (linkedAttachments.length) setAttachments(linkedAttachments);
  }, [linkedAttachments]);

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
    const requestedCategory = lockedVoucherCategory || initialVoucherCategory;
    if (alterMode || selectedVoucherType || initialVoucherTypeId || !requestedCategory || voucherTypes.length === 0) return;
    const requested = requestedCategory.toUpperCase();
    const matchingType = voucherTypes.find((type) => type.voucher_category?.toUpperCase() === requested);
    if (matchingType) setSelectedVoucherType(matchingType.id);
  }, [alterMode, initialVoucherCategory, initialVoucherTypeId, lockedVoucherCategory, selectedVoucherType, voucherTypes]);

  useEffect(() => {
    if (alterMode || selectedVoucherType || !initialVoucherTypeId || voucherTypes.length === 0) return;
    if (voucherTypes.some((type) => type.id === initialVoucherTypeId)) {
      setSelectedVoucherType(initialVoucherTypeId);
    }
  }, [alterMode, initialVoucherTypeId, selectedVoucherType, voucherTypes]);

  // New voucher entry opens on Payment by default. Explicit shortcuts and
  // alteration mode take priority over this default.
  useEffect(() => {
    if (alterMode || selectedVoucherType || initialVoucherCategory || initialVoucherTypeId || lockedVoucherCategory || voucherTypes.length === 0) return;
    const paymentType = voucherTypes.find((type) => type.voucher_category?.toUpperCase() === 'PAYMENT');
    if (paymentType) setSelectedVoucherType(paymentType.id);
  }, [alterMode, initialVoucherCategory, initialVoucherTypeId, lockedVoucherCategory, selectedVoucherType, voucherTypes]);

  // ------ Alteration mode: load the voucher and populate the form ------
  const { data: loadedVoucher } = useQuery({
    queryKey: ['alter_voucher', sourceVoucherId],
    enabled: !!sourceVoucherId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vouchers')
        .select('*, voucher_entries(*)')
        .eq('id', sourceVoucherId!)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  // The ledgers this voucher was actually posted to, fetched by id with none of
  // the filters the picker applies. A saved voucher must show what it posted to
  // even when that ledger has since been deactivated, has grown children, or
  // sits under another company — a Hope patient's ledger is on the legacy
  // partnership while their voucher resolves to DRM Hope Pvt Ltd. Display only:
  // these never reach selectableAccounts, so they cannot be picked for new lines.
  const entryAccountIds = useMemo<string[]>(() => {
    const ids = (loadedVoucher?.voucher_entries ?? [])
      .map((e: any) => e.account_id)
      .filter(Boolean) as string[];
    return Array.from(new Set(ids));
  }, [loadedVoucher]);

  const { data: entryAccounts = [] } = useQuery({
    queryKey: ['voucher_entry_accounts', entryAccountIds.join(',')],
    enabled: entryAccountIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_type, account_group')
        .in('id', entryAccountIds);
      if (error) throw error;
      return (data || []) as Account[];
    },
  });

  useEffect(() => {
    if (!loadedVoucher || accounts.length === 0 || voucherTypes.length === 0) return;
    const vt = voucherTypes.find((t) => t.id === loadedVoucher.voucher_type_id);
    setSelectedVoucherType(loadedVoucher.voucher_type_id || '');
    // A duplicate keeps everything but the identity — it takes the next number
    setLoadedNumber(alterMode ? loadedVoucher.voucher_number || '' : '');
    setVoucherDate(loadedVoucher.voucher_date || format(new Date(), 'yyyy-MM-dd'));
    setReferenceNumber(loadedVoucher.reference_number || '');
    setReferenceDate(loadedVoucher.reference_date || '');
    setNarration(loadedVoucher.narration || '');
    setPatientId(loadedVoucher.patient_id || '');
    if (loadedVoucher.company_id) setSelectedCompanyId(loadedVoucher.company_id);
    setIsOptional(!!loadedVoucher.is_optional);

    const byId = new Map(accounts.map((a) => [a.id, a]));
    const patientByLedgerId = new Map<string, Account>(
      patientLedgerAccounts
        .filter((a) => !!a.patient_ledger_id)
        .map((a) => [a.patient_ledger_id!, a]),
    );
    const postedById = new Map(entryAccounts.map((a) => [a.id, a]));
    const resolveAccount = (entry: any): Account | null =>
      (entry.patient_ledger_id ? patientByLedgerId.get(entry.patient_ledger_id) : undefined)
      ?? byId.get(entry.account_id)
      ?? postedById.get(entry.account_id)
      ?? null;
    const entries = [...(loadedVoucher.voucher_entries ?? [])].sort(
      (a: any, b: any) => (a.entry_order || 0) - (b.entry_order || 0),
    );
    const cat = (vt?.voucher_category || '').toUpperCase();
    const mode = SINGLE_ACCOUNT_MODES[cat];
    const accSide = mode
      ? entries.filter((e: any) => (mode.accountIsDebit ? Number(e.debit_amount) > 0 : Number(e.credit_amount) > 0))
      : [];
    if (mode && accSide.length === 1 && resolveAccount(accSide[0])) {
      setForceJournal(false);
      setAccount(resolveAccount(accSide[0]));
      const partSide = entries.filter((e: any) =>
        mode.accountIsDebit ? Number(e.credit_amount) > 0 : Number(e.debit_amount) > 0,
      );
      setPartLines(
        partSide.length > 0
          ? partSide.map((e: any) => ({
              key: ++lineKey.current,
              account: resolveAccount(e),
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
          account: resolveAccount(e),
          amount: String(Number(e.debit_amount) > 0 ? Number(e.debit_amount) : Number(e.credit_amount)),
          costCentreId: e.cost_centre_id ?? undefined,
          billRef: e.bill_ref ?? undefined,
        }));
      setJournalLines(rows.length >= 2 ? rows : [newJournalLine('Dr'), newJournalLine('Cr')]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedVoucher, accounts, patientLedgerAccounts, entryAccounts, voucherTypes]);

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
  }, [selectedVoucherType]);

  // Tally renumbers a voucher into the new type's series when you change its
  // type during alteration, so the number on screen follows the selection.
  const typeChanged = alterMode && !!loadedVoucher && selectedVoucherType !== loadedVoucher.voucher_type_id;
  const voucherNumber = alterMode
    ? (typeChanged ? generatedVoucherNumber : loadedNumber)
    : voucherNumberOverride || generatedVoucherNumber;
  const singleMode = forceJournal ? undefined : SINGLE_ACCOUNT_MODES[category];
  const voucherAccounts = useMemo(() => {
    if (singleMode) {
      return [
        ...(account ? [account] : []),
        ...partLines.filter((line) => line.account && Number(line.amount) > 0).map((line) => line.account!),
      ];
    }
    return journalLines.filter((line) => line.account && Number(line.amount) > 0).map((line) => line.account!);
  }, [singleMode, account, partLines, journalLines]);
  // Only the patient has to be named in the narration. The ledgers are already
  // chosen in Account and Particulars, so requiring them again as @mentions
  // made the typist repeat what the voucher already says, and blocked the save
  // when they did not.
  const requiredTags = useMemo(
    () => [...new Set(
      voucherAccounts
        .filter((ledger) => ledger.patient_ledger_id)
        .map((ledger) => `#${ledger.patient_name || ledger.account_name}`),
    )],
    [voucherAccounts],
  );
  const inferredPatientId = useMemo(() => {
    const ids = [...new Set(voucherAccounts.map((ledger) => ledger.patient_id).filter(Boolean))];
    return ids.length === 1 ? ids[0]! : '';
  }, [voucherAccounts]);

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

  // ------ Changing the voucher type (Tally's F4–F9 while a voucher is open) ------
  // The single-account layout (Payment/Receipt/Contra) and the Dr/Cr grid keep
  // separate state, so switching between them has to carry the rows across by
  // hand — otherwise the amounts on screen simply disappear. The debit/credit
  // sides themselves need no work: buildEntries() derives them from the new
  // category, and alteration replaces every voucher_entries row anyway.
  const applyVoucherType = useCallback((nextTypeId: string): void => {
    const nextType = voucherTypes.find((vt) => vt.id === nextTypeId);
    if (!nextType) return;
    const nextMode = SINGLE_ACCOUNT_MODES[(nextType.voucher_category || '').toUpperCase()];

    if (singleMode && !nextMode) {
      // Single account -> Dr/Cr grid. Open the grid showing the sides the
      // voucher posts today, not blank rows.
      const rows: JournalLine[] = [
        ...(account && partTotal > 0
          ? [{
              key: ++lineKey.current,
              drcr: (singleMode.accountIsDebit ? 'Dr' : 'Cr') as 'Dr' | 'Cr',
              account,
              amount: String(partTotal),
            }]
          : []),
        ...partLines
          .filter((l) => l.account && Number(l.amount) > 0)
          .map((l) => ({
            key: ++lineKey.current,
            drcr: (singleMode.accountIsDebit ? 'Cr' : 'Dr') as 'Dr' | 'Cr',
            account: l.account,
            amount: l.amount,
            costCentreId: l.costCentreId,
            billRef: l.billRef,
          })),
      ];
      setJournalLines(rows.length >= 2 ? rows : [newJournalLine('Dr'), newJournalLine('Cr')]);
      setForceJournal(false);
    } else if (!singleMode && nextMode) {
      // Dr/Cr grid -> single account. This only collapses when exactly one
      // cash or bank row sits on the new Account side; anything else has no
      // single-account rendering, so keep the grid rather than drop rows.
      const filled = journalLines.filter((l) => l.account && Number(l.amount) > 0);
      const accSide = filled.filter((l) => (nextMode.accountIsDebit ? l.drcr === 'Dr' : l.drcr === 'Cr'));
      const isCashBank = accSide.length === 1 && cashBankAccounts.some((a) => a.id === accSide[0].account!.id);
      if (filled.length >= 2 && isCashBank) {
        setAccount(accSide[0].account);
        setPartLines(
          filled
            .filter((l) => l.key !== accSide[0].key)
            .map((l) => ({
              key: ++lineKey.current,
              account: l.account,
              amount: l.amount,
              costCentreId: l.costCentreId,
              billRef: l.billRef,
            })),
        );
        setForceJournal(false);
      } else {
        setForceJournal(true);
      }
    } else {
      // Receipt <-> Payment <-> Contra, or one grid type to another: the rows
      // are already in the right shape.
      setForceJournal(false);
    }
    setSelectedVoucherType(nextTypeId);
  }, [
    voucherTypes, singleMode, account, partLines, partTotal, journalLines, cashBankAccounts,
  ]);

  // Altering a saved voucher asks first, in the module's own centred box.
  // This used to be window.confirm, which Chrome lets a user silence after a
  // couple of dialogs — from then on it returned false without showing
  // anything, so the type quietly refused to change and the voucher saved
  // unaltered, with nothing on screen to say why.
  const changeVoucherType = useCallback((nextTypeId: string): void => {
    if (nextTypeId === selectedVoucherType) return;
    if (!voucherTypes.some((vt) => vt.id === nextTypeId)) return;
    if (!alterMode) {
      applyVoucherType(nextTypeId);
      return;
    }
    setPendingTypeId(nextTypeId);
  }, [selectedVoucherType, voucherTypes, alterMode, applyVoucherType]);

  const pendingType = voucherTypes.find((vt) => vt.id === pendingTypeId);
  const typeChangeMessage = ((): string => {
    if (!pendingType) return '';
    const fromName = selectedType?.voucher_type_name?.replace(' Voucher', '') || 'its current type';
    const toName = pendingType.voucher_type_name.replace(' Voucher', '');
    // Picking the type the voucher was loaded as is an undo, not a change — it
    // keeps its own number, so don't threaten to renumber it.
    if (pendingTypeId === loadedVoucher?.voucher_type_id) {
      return `Put voucher ${loadedNumber} back to ${toName}?`;
    }
    // The number is only issued when the voucher is saved, so don't name one
    // here — the database may well hand out a different one by then.
    return `Change voucher ${loadedNumber} from ${fromName} to ${toName}? It will be renumbered into the ${toName} series and leave a gap in the ${fromName} series.`;
  })();

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

  // Tablet number keyboards do not consistently emit Enter. Keep one blank
  // journal row available as soon as the current last row is complete; the
  // Enter handler above then only needs to move focus to that row.
  useEffect(() => {
    setJournalLines((current) => {
      const last = current[current.length - 1];
      if (!last?.account || !(Number(last.amount) > 0)) return current;
      return [...current, newJournalLine(last.drcr === 'Dr' ? 'Cr' : 'Dr')];
    });
  }, [journalLines]);

  // ------ Clear / reset the entire form ------
  const resetForm = () => {
    setIsOptional(false);
    setVoucherDate(format(new Date(), 'yyyy-MM-dd'));
    setReferenceNumber('');
    setReferenceDate('');
    setNarration('');
    setPatientId('');
    setAccount(null);
    setPartLines([newParticularsLine()]);
    setJournalLines([newJournalLine('Dr'), newJournalLine('Cr')]);
    setAttachments([]);
  };

  const handleClear = async () => {
    await discardVoucherAttachments(attachments);
    resetForm();
  };

  const handleQuit = async () => {
    await discardVoucherAttachments(attachments);
    if (alterMode) onDone?.();
    else resetForm();
  };

  // Build the double-entry rows for the current mode.
  const buildEntries = (): {
    account_id: string;
    patient_ledger_id?: string | null;
    debit_amount: number;
    credit_amount: number;
    narration: string;
    cost_centre_id?: string | null;
    bill_ref?: string | null;
  }[] | null => {
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
        patient_ledger_id: account.patient_ledger_id || null,
      };
      const lineRows = filled.map((l) => ({
        account_id: l.account!.id,
        debit_amount: singleMode.accountIsDebit ? 0 : Number(l.amount),
        credit_amount: singleMode.accountIsDebit ? Number(l.amount) : 0,
        narration: '',
        cost_centre_id: l.costCentreId || null,
        bill_ref: l.billRef?.trim() || null,
        patient_ledger_id: l.account!.patient_ledger_id || null,
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
      patient_ledger_id: l.account!.patient_ledger_id || null,
    }));
  };

  // The database hands out every voucher number, for the triggers and for this
  // screen alike. It holds a row lock while it does, and steps past anything
  // already issued, so two typists and a posting routine can save at the same
  // moment without landing on vouchers_voucher_number_key. Numbering here from a
  // cached current_number is what used to break that. Returns '' once the reason
  // has been shown.
  const allocateVoucherNumber = async (voucherType: VoucherType | undefined): Promise<string> => {
    const code = voucherType?.voucher_type_code;
    if (!code) {
      toast.error('This voucher type has no code — set one in Voucher Types first.');
      return '';
    }
    const { data, error } = await supabase.rpc('generate_voucher_number', {
      p_voucher_type_code: code,
    });
    if (error || !data) {
      toast.error('Could not get a voucher number: ' + (error?.message || 'none returned'));
      return '';
    }
    return data as string;
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
        // ------ Alteration: update header, replace entries ------
        // The number is kept unless the type was changed, in which case Tally
        // moves the voucher into the new type's series.
        const retypedNumber = typeChanged ? await allocateVoucherNumber(voucherType) : '';
        if (typeChanged && !retypedNumber) return;
        const { error: uErr } = await supabase
          .from('vouchers')
          .update({
            ...(typeChanged ? { voucher_type_id: selectedVoucherType, voucher_number: retypedNumber } : {}),
            voucher_date: voucherDate,
            reference_number: referenceNumber || null,
            reference_date: referenceDate || null,
            narration: narration || '',
            total_amount: debitSum,
            patient_id: patientId || inferredPatientId || null,
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
            patient_ledger_id: e.patient_ledger_id || null,
            ...(costCentres.length > 0 ? { cost_centre_id: (e as any).cost_centre_id ?? null } : {}),
            ...(billRefEnabled ? { bill_ref: (e as any).bill_ref ?? null } : {}),
          })),
        );
        if (iErr) {
          toast.error('Failed to save entries: ' + iErr.message);
          throw iErr;
        }
        await linkVoucherAttachments(voucherId!, attachments, username);
        if (typeChanged) {
          toast.success(
            `Voucher ${loadedNumber} changed to ${voucherType?.voucher_type_name?.replace(' Voucher', '')} as ${retypedNumber}.`,
          );
        } else {
          toast.success(`Voucher ${loadedNumber} altered.`);
        }
        queryClient.invalidateQueries({ queryKey: ['vouchers'] });
        queryClient.invalidateQueries({ queryKey: ['daybook_vouchers'] });
        queryClient.invalidateQueries({ queryKey: ['ledger_entries'] });
        queryClient.invalidateQueries({ queryKey: ['voucher-attachments'] });
        // The counter this screen numbers from moved, so a second conversion in
        // the same session must not read the stale current_number and reuse it.
        if (typeChanged) {
          queryClient.invalidateQueries({ queryKey: ['voucher_types'] });
          queryClient.invalidateQueries({ queryKey: ['alter_voucher', voucherId] });
        }
        setBalances({});
        onDone?.();
        return;
      }

      // A number the typist put in stands as typed; otherwise the database issues one.
      const numberToSave = voucherNumberOverride.trim() || (await allocateVoucherNumber(voucherType));
      if (!numberToSave) return;

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
          patient_id: patientId || inferredPatientId || null,
          company_id: selectedCompanyId || null,
          // vouchers.status CHECK constraint allows PENDING / AUTHORISED / CANCELLED
          status: isOptional ? 'PENDING' : status === 'posted' ? 'AUTHORISED' : 'PENDING',
          is_optional: isOptional,
          // The one screen where a person types a voucher; everything else posts itself.
          is_auto: false,
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
        patient_ledger_id: e.patient_ledger_id || null,
        ...(costCentres.length > 0 ? { cost_centre_id: (e as any).cost_centre_id ?? null } : {}),
        ...(billRefEnabled ? { bill_ref: (e as any).bill_ref ?? null } : {}),
      }));

      const { error: eErr } = await supabase.from('voucher_entries').insert(entryRows);
      if (eErr) {
        await supabase.from('vouchers').delete().eq('id', voucher.id);
        toast.error('Failed to save entries: ' + eErr.message);
        throw eErr;
      }

      try {
        await linkVoucherAttachments(voucher.id, attachments, username);
      } catch (attachmentError) {
        await supabase.from('vouchers').delete().eq('id', voucher.id);
        await discardVoucherAttachments(attachments);
        throw attachmentError;
      }

      toast.success(`Voucher ${numberToSave} saved${status === 'posted' ? '' : ' as pending'}.`);
      // Ctrl+R repeats this on the next voucher of the same type
      if (narration.trim()) localStorage.setItem(narrationMemoryKey, narration);

      const voucherTypeName = (voucherType?.voucher_type_name || '').toLowerCase();
      if ((voucherTypeName.includes('receipt') || voucherTypeName.includes('receive')) && debitSum >= 10000) {
        sendPaymentAlert({
          alert_type: 'receipt',
          amount: debitSum,
          patient_name: narration || 'Voucher Entry',
          // The company the voucher was actually entered against, not a
          // hardcoded "Hope" — this alert goes out for either hospital.
          hospital_name:
            companies.find((c) => c.id === selectedCompanyId)?.company_name || hospitalConfig.name,
            additional_info: `Voucher: ${numberToSave}, Type: ${voucherType?.voucher_type_name || 'N/A'}`,
        });
      }

      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      queryClient.invalidateQueries({ queryKey: ['voucher_types'] });
      queryClient.invalidateQueries({ queryKey: ['voucher-attachments'] });
      setBalances({});
      resetForm();
    } catch (error) {
      if (error instanceof Error && !error.message.toLowerCase().includes('failed')) {
        toast.error(error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  // ------ Alteration actions: Cancel Vch (soft) and Delete (hard) ------
  // The mutations live in useVoucherActions so the Day Book key bar runs the
  // exact same code path (confirm, edit-log stamp, cache invalidation).
  const cancelVoucher = async (): Promise<void> => {
    if (!alterMode) return;
    if (await cancelVoucherById(voucherId!, loadedNumber)) onDone?.();
  };

  const deleteVoucher = async (): Promise<void> => {
    if (!alterMode) return;
    if (await deleteVoucherById(voucherId!, loadedNumber)) onDone?.();
  };

  // ------ Tally's PgUp / PgDn: the voucher before or after this one ------
  // Ordered by date then number, so it walks the books the way the Day Book
  // lists them rather than by insertion order.
  const stepVoucher = async (direction: 1 | -1): Promise<void> => {
    if (!alterMode || !selectedCompanyId) return;
    const forward = direction === 1;
    const { data, error } = await (supabase as any)
      .from('vouchers')
      .select('id, voucher_date, voucher_number')
      .eq('company_id', selectedCompanyId)
      .or(
        forward
          ? `voucher_date.gt.${voucherDate},and(voucher_date.eq.${voucherDate},voucher_number.gt.${loadedNumber})`
          : `voucher_date.lt.${voucherDate},and(voucher_date.eq.${voucherDate},voucher_number.lt.${loadedNumber})`,
      )
      .order('voucher_date', { ascending: forward })
      .order('voucher_number', { ascending: forward })
      .limit(1);
    if (error) {
      toast.error('Could not find the next voucher');
      return;
    }
    const next = data?.[0];
    if (!next) {
      toast.info(forward ? 'Last voucher' : 'First voucher');
      return;
    }
    window.dispatchEvent(new CustomEvent('tally-open-voucher-id', { detail: next.id }));
  };

  // ------ Ctrl+R: repeat the last narration used on this voucher type ------
  const narrationMemoryKey = `tally-last-narration:${selectedVoucherType || 'none'}`;
  const repeatNarration = (): void => {
    const last = localStorage.getItem(narrationMemoryKey);
    if (!last) {
      toast.info('No narration to repeat yet on this voucher type');
      return;
    }
    setNarration(last);
    narrationRef.current?.focus();
  };

  // ------ Formal A4 voucher print (Tally-style) ------
  const printVoucher = (): void => {
    const rows: { name: string; dr: number; cr: number }[] = [];
    // Tally puts the cash/bank side in the header as "Through :" rather than in
    // the Particulars table, so in single-account mode it never becomes a row.
    let through: string | null = null;
    if (singleMode && account) {
      through = account.account_name;
      for (const l of partLines) {
        if (!l.account || !(Number(l.amount) > 0)) continue;
        rows.push({
          name: l.account.account_name,
          dr: singleMode.accountIsDebit ? 0 : Number(l.amount),
          cr: singleMode.accountIsDebit ? Number(l.amount) : 0,
        });
      }
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
    const company = companies.find((c) => c.id === selectedCompanyId);
    const printed = printTallyVoucher({
      orgName: company?.company_name || hospitalConfig.fullName,
      addressLines: [company?.address_line1, company?.address_line2].filter(Boolean) as string[],
      voucherTypeName: selectedType?.voucher_type_name || 'Voucher',
      voucherNumber: voucherNumber || '',
      voucherDate,
      category,
      through,
      rows,
      narration,
    });
    if (!printed) toast.error('Popup blocked — allow popups to print');
  };

  // ------ Tally right rail: F2 Date + F4–F9 voucher types + other types ------
  const rail = useMemo<RailItem[]>(() => {
    // Match on the category, falling back to the type's name — companies label
    // these inconsistently ("CREDIT NOTE" / "CREDIT_NOTE" / a Credit Note type
    // filed under the Sales category), and a greyed Ctrl+F8 next to a working
    // "Credit Note" button lower down is just confusing.
    const squash = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z]/g, '');
    const byCategory = (cat: string) => {
      const want = squash(cat);
      return (
        voucherTypes.find((vt) => squash(vt.voucher_category) === want) ??
        voucherTypes.find((vt) => squash(vt.voucher_type_name).replace('VOUCHER', '') === want)
      );
    };
    // F4–F9 plus every remaining active type beneath, Tally style. Shared by
    // creation and alteration: Tally keeps these live while a saved voucher is
    // open, which is how a receipt booked as a payment gets corrected.
    const typeItems = (): RailItem[] => {
      const mainIds = new Set<string>();
      const items: RailItem[] = [];
      RAIL_KEYS.forEach(({ hotkey, mod, category: cat, label }, i) => {
        const vt = byCategory(cat);
        if (vt) mainIds.add(vt.id);
        items.push({
          hotkey,
          mod,
          label,
          gapBefore: i === 0,
          onClick: vt ? () => changeVoucherType(vt.id) : undefined,
          disabled: !vt,
          active: vt ? selectedVoucherType === vt.id : false,
        });
      });
      voucherTypes
        .filter((vt) => !mainIds.has(vt.id))
        .forEach((vt, i) => {
          items.push({
            label: vt.voucher_type_name,
            gapBefore: i === 0,
            onClick: () => changeVoucherType(vt.id),
            active: selectedVoucherType === vt.id,
          });
        });
      return items;
    };

    if (alterMode) {
      return [
        { hotkey: 'F2', label: 'Date', onClick: openDatePicker },
        // Only someone who may alter vouchers may reclassify one.
        ...(canAlter ? typeItems() : []),
        { hotkey: 'L', label: 'Optional', gapBefore: true, onClick: () => setIsOptional((v) => !v), active: isOptional },
        { hotkey: 'P', mod: 'alt' as const, aliases: [{ hotkey: 'P' }], label: 'Print Vch', gapBefore: true, onClick: printVoucher },
        ...(canAlter
          ? [
              {
                hotkey: 'X',
                mod: 'alt' as const,
                aliases: [{ hotkey: 'X' }],
                label: 'Cancel Vch',
                gapBefore: true,
                onClick: cancelVoucher,
              },
              { hotkey: 'D', mod: 'alt' as const, aliases: [{ hotkey: 'D' }], label: 'Delete', onClick: deleteVoucher },
            ]
          : []),
      ];
    }
    if (lockedVoucherCategory) {
      return [
        { hotkey: 'F2', label: 'Date', onClick: openDatePicker },
        { hotkey: 'L', label: 'Optional', gapBefore: true, onClick: () => setIsOptional((v) => !v), active: isOptional },
        { hotkey: 'P', mod: 'alt' as const, aliases: [{ hotkey: 'P' }], label: 'Print Vch', gapBefore: true, onClick: printVoucher },
      ];
    }
    const items: RailItem[] = [
      { hotkey: 'F2', label: 'Date', onClick: openDatePicker },
      ...typeItems(),
    ];
    items.push({ hotkey: 'L', label: 'Optional', gapBefore: true, onClick: () => setIsOptional((v) => !v), active: isOptional });
    items.push({
      hotkey: 'T',
      label: 'Post-Dated',
      active: voucherDate > format(new Date(), 'yyyy-MM-dd'),
      onClick: () => {
        // Tally: a post-dated voucher simply carries a future date, so this
        // opens the date picker rather than guessing 30 days ahead.
        openDatePicker();
      },
    });
    items.push({ hotkey: 'P', mod: 'alt' as const, aliases: [{ hotkey: 'P' }], label: 'Print Vch', gapBefore: true, onClick: printVoucher });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voucherTypes, selectedVoucherType, changeVoucherType, alterMode, isOptional, canAlter, openDatePicker, voucherDate, lockedVoucherCategory]);

  // Alt+C — which ledger field asked for a new ledger, and what was typed in it
  const [quickLedger, setQuickLedger] = useState<{ name: string; assign: (a: Account) => void } | null>(null);

  /**
   * Turn a freshly created chart_of_accounts row into a pickable Account. The
   * type is only used for display here — the ledger list refetches behind the
   * pop-up and the real row replaces this one.
   */
  const asAccount = (created: { id: string; account_name: string; account_code: string }): Account => ({
    id: created.id,
    account_name: created.account_name,
    account_code: created.account_code,
    account_type: '',
  });

  /** Ctrl+Enter — Tally opens the ledger master over the voucher. */
  const alterLedger = (account: Account): void => {
    window.dispatchEvent(new CustomEvent('tally-alter-master', { detail: account.id }));
  };

  // Tally's voucher keys that are not buttons on the rail.
  //
  // Ctrl+V is bound outside text fields only — inside one it is still paste,
  // which nobody would forgive us for taking away.
  useShortcuts([
    {
      combo: 'Alt+I',
      layer: 'screen',
      label: 'Insert Voucher',
      run: () => window.dispatchEvent(new CustomEvent('tally-insert-voucher', { detail: voucherDate })),
    },
    {
      combo: 'Ctrl+V',
      layer: 'screen',
      label: 'Change voucher mode (single entry / double entry)',
      // Only Payment / Receipt / Contra have two modes to change between; on a
      // Journal there is only ever the grid.
      disabled: !SINGLE_ACCOUNT_MODES[category],
      run: () => setForceJournal((v) => !v),
    },
    {
      combo: 'Alt+V',
      layer: 'screen',
      label: 'Display the current voucher',
      disabled: !alterMode,
      run: () => window.dispatchEvent(new CustomEvent('tally-display-voucher', { detail: voucherId })),
    },
    { combo: 'Ctrl+R', layer: 'screen', allowInInput: true, label: 'Repeat the last narration', run: repeatNarration },
    {
      combo: 'PageDown',
      layer: 'screen',
      label: 'Next voucher',
      disabled: !alterMode,
      run: () => void stepVoucher(1),
    },
    {
      combo: 'PageUp',
      layer: 'screen',
      label: 'Previous voucher',
      disabled: !alterMode,
      run: () => void stepVoucher(-1),
    },
  ]);

  // Tally's field cursor: Enter walks the form forward, Backspace walks back.
  // The fields that do more than step — a ledger picker choosing from its list,
  // an amount adding the next line — claim Enter for themselves and the ring
  // stands aside. Enter on the last field accepts, exactly as Ctrl+A does.
  const formRef = React.useRef<HTMLDivElement>(null);
  useFieldRing({
    containerRef: formRef,
    onAccept: () => {
      if (canAlter && !saving && selectedType) void saveVoucher('posted');
    },
  });

  const accountBalance = account ? balances[account.id] : undefined;

  const amountInputClass =
    'h-7 w-36 rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-right font-mono text-[13px] shadow-none focus-visible:ring-0 focus-visible:border-blue-600 focus-visible:border-solid disabled:border-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  const allocLine =
    allocFor?.kind === 'part'
      ? partLines.find((l) => l.key === allocFor.key)
      : allocFor
        ? journalLines.find((l) => l.key === allocFor.key)
        : undefined;

  return (
    <div ref={formRef} className={tabletMode ? 'tablet-voucher-flow h-full overflow-auto' : undefined}>
    <TallyScreen
      title={
        displayOnly
          ? 'Accounting Voucher Display'
          : alterMode
            ? 'Accounting Voucher Alteration'
            : 'Accounting Voucher Creation'
      }
      rail={rail}
      onClose={onDone}
      // A: Accept and Q: Quit were drawn with underlined hotkeys but bound to
      // nothing — only the mouse worked. Ctrl+A / Ctrl+Q are Tally's own.
      bottomBar={[
        {
          hotkey: 'A',
          mod: 'ctrl',
          aliases: [{ hotkey: 'A' }],
          label: 'Accept',
          onClick: canAlter && !saving && selectedType ? () => void saveVoucher('posted') : undefined,
        },
        {
          hotkey: 'Q',
          mod: 'ctrl',
          aliases: [{ hotkey: 'Q' }],
          label: 'Quit',
          onClick: () => void handleQuit(),
        },
        { hotkey: 'F1', label: 'Help', onClick: () => window.dispatchEvent(new CustomEvent('tally-help')) },
        // Unconditional: a disabled binding still swallows the key, and this
        // one shadows the rail's Print, so gating it on selectedType made the
        // shortcut silently do nothing. printVoucher's own guard toasts instead.
        { hotkey: 'P', mod: 'alt', aliases: [{ hotkey: 'P' }], label: 'Print Vch', onClick: printVoucher },
      ]}
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
                data-tally-field
                value={voucherNumberOverride || generatedVoucherNumber}
                onChange={(e) => setVoucherNumberOverride(e.target.value)}
                className="h-7 min-w-[100px] rounded-none border border-gray-400 bg-[#fdf6d8] px-2 font-mono text-sm"
                aria-label="Voucher number"
              />
            ) : (
              <span className="min-w-[100px] border border-gray-400 bg-[#fdf6d8] px-2 font-mono">
                {/* Renumbering happens when the database issues the number, on save. */}
                {typeChanged ? 'on save' : voucherNumber || '…'}
              </span>
            )}
            {typeChanged && (
              <span className="text-[11px] italic text-gray-600">was {loadedNumber}</span>
            )}
            {isOptional && <span className="bg-orange-600 px-2 py-0.5 text-[11px] font-bold text-white">OPTIONAL</span>}
            {voucherDate > format(new Date(), 'yyyy-MM-dd') && (
              <span className="bg-purple-700 px-2 py-0.5 text-[11px] font-bold text-white">POST-DATED</span>
            )}
          </div>
          {/* Tally's party Ref. No. / Ref. Date. Both were already saved and
              reloaded with the voucher — there was simply nowhere to type them. */}
          <div className="mt-1 flex items-center gap-2 text-[12px]">
            <span className="font-medium">Ref. No.</span>
            <Input
              data-tally-field
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="—"
              className="h-6 w-36 rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-[12px] shadow-none focus-visible:border-solid focus-visible:border-blue-600 focus-visible:ring-0"
              aria-label="Reference number"
            />
            <span className="pl-2 font-medium">Ref. Date</span>
            <Input
              data-tally-field
              type="date"
              value={referenceDate}
              onChange={(e) => setReferenceDate(e.target.value)}
              className="h-6 w-36 rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-[12px] shadow-none focus-visible:border-solid focus-visible:border-blue-600 focus-visible:ring-0"
              aria-label="Reference date"
            />
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
                onCreateLedger={(typed) =>
                  setQuickLedger({
                    name: typed,
                    assign: (a) => {
                      setAccount(a);
                      loadBalance(a.id);
                    },
                  })
                }
                onAlterLedger={alterLedger}
              />
            </div>
            <div className="flex items-center gap-2 text-xs italic text-gray-500">
              <span className="w-28 shrink-0">Current balance</span>
              <span>:</span>
              <span className="px-1 font-mono not-italic">{account ? balanceLabel(accountBalance) : ''}</span>
            </div>

            {/* Particulars */}
            {!alterMode && (
              <p className="mt-3 text-xs italic text-gray-500">
                Patient receipts and advances are entered on the Final Bill page, not
                here, so the bill and the discharge know they have been paid.
              </p>
            )}
            <div className="mt-3 flex items-center justify-between border-y border-gray-400 bg-[#f0f4fa] px-2 py-0.5">
              <span className="font-bold">Particulars</span>
              <span className="pr-9 font-bold">Amount</span>
            </div>
            <div className="divide-y divide-dashed divide-gray-200">
              {partLines.map((line, idx) => (
                <div key={line.key} className="flex items-start gap-2 py-0.5">
                  <div className="flex-1">
                    <AccountSearch
                      accounts={selectableAccounts.filter((candidate) =>
                        candidate.patient_ledger_id || candidate.id !== account?.id,
                      )}
                      selected={line.account}
                      onSelect={(a) => {
                        updatePartLine(line.key, { account: a });
                        if (a) {
                          loadBalance(a.id);
                          setTimeout(() => partAmountRefs.current[line.key]?.focus(), 0);
                        }
                      }}
                      onEmptyEnter={() => narrationRef.current?.focus()}
                      onCreateLedger={(typed) =>
                        setQuickLedger({
                          name: typed,
                          assign: (a) => updatePartLine(line.key, { account: a }),
                        })
                      }
                      onAlterLedger={alterLedger}
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
                    data-tally-field
                    data-tally-own-keys="Enter"
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
                  {allocationsOn && (
                    <button
                      type="button"
                      tabIndex={-1}
                      title="Bill-wise details / Cost centre allocation"
                      onClick={() => setAllocFor({ kind: 'part', key: line.key })}
                      className={`h-7 shrink-0 px-1 text-[11px] leading-7 ${
                        line.billRef || line.costCentreId
                          ? 'font-bold text-[#16437e] underline'
                          : 'text-gray-400 hover:text-[#16437e]'
                      }`}
                    >
                      Alloc
                    </button>
                  )}
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
                    {/* Tally writes a journal as By (debit) / To (credit) */}
                    <SelectTrigger
                      title={line.drcr === 'Dr' ? 'By — debit side' : 'To — credit side'}
                      className="h-7 w-12 rounded-none border-0 border-b border-dashed border-gray-400 bg-transparent px-1 text-[13px] font-semibold shadow-none focus:ring-0"
                    >
                      {line.drcr === 'Dr' ? 'By' : 'To'}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Dr">By (Dr)</SelectItem>
                      <SelectItem value="Cr">To (Cr)</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex-1">
                    <AccountSearch
                      accounts={selectableAccounts}
                      selected={line.account}
                      onSelect={(a) => {
                        updateJournalLine(line.key, { account: a });
                        if (a) {
                          loadBalance(a.id);
                          setTimeout(() => journalAmountRefs.current[line.key]?.focus(), 0);
                        }
                      }}
                      onEmptyEnter={() => narrationRef.current?.focus()}
                      onCreateLedger={(typed) =>
                        setQuickLedger({
                          name: typed,
                          assign: (a) => updateJournalLine(line.key, { account: a }),
                        })
                      }
                      onAlterLedger={alterLedger}
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
                    data-tally-field
                    data-tally-own-keys="Enter"
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
                    data-tally-field
                    data-tally-own-keys="Enter"
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
                  {allocationsOn && (
                    <button
                      type="button"
                      tabIndex={-1}
                      title="Bill-wise details / Cost centre allocation"
                      onClick={() => setAllocFor({ kind: 'journal', key: line.key })}
                      className={`h-7 shrink-0 px-1 text-[11px] leading-7 ${
                        line.billRef || line.costCentreId
                          ? 'font-bold text-[#16437e] underline'
                          : 'text-gray-400 hover:text-[#16437e]'
                      }`}
                    >
                      Alloc
                    </button>
                  )}
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

        {/* Voucher evidence, searchable narration tags, and actions */}
        {selectedType && (
          <div className="mt-8 space-y-4">
            {(['PAYMENT', 'RECEIPT', 'CONTRA', 'JOURNAL'].includes(category) || attachments.length > 0) && (
              <VoucherAttachmentFields
                attachments={attachments}
                onChange={setAttachments}
                disabled={saving || !canAlter}
                compact={!tabletMode}
              />
            )}
            <div className={`flex items-end justify-between gap-4 ${tabletMode ? 'flex-col items-stretch' : ''}`}>
              <div className="w-full max-w-3xl">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="voucher_narration" className="text-[13px] font-semibold">
                    Narration:
                  </Label>
                  {requiredTags.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1">
                      {requiredTags.map((tag) => (
                        <span
                          key={tag}
                          className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                            tag.startsWith('#') ? 'bg-violet-100 text-violet-800' : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <NarrationTagTextarea
                  value={narration}
                  onChange={setNarration}
                  ledgerAccounts={accounts}
                  patients={narrationPatients}
                  onPatientSelect={(patient) => setPatientId(patient.id)}
                  textareaRef={narrationRef}
                  rows={tabletMode ? 4 : 2}
                  className={`mt-1 resize-none rounded-none border-gray-400 bg-white ${
                    tabletMode ? 'min-h-28 text-base' : 'text-[13px]'
                  }`}
                />
                {inferredPatientId && (
                  <div className="mt-1 text-xs font-medium text-violet-700">
                    Patient ledger linked automatically from the selected #patient.
                  </div>
                )}
              </div>
              <div className={`flex shrink-0 flex-wrap gap-2 ${tabletMode ? 'w-full' : ''}`}>
                {!canAlter && (
                  <span className="self-center bg-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600">VIEW ONLY</span>
                )}
                {canAlter && (
                <>
                <Button
                  variant="outline"
                  size={tabletMode ? 'default' : 'sm'}
                  className={tabletMode ? 'h-12 flex-1 text-base' : 'h-7 rounded-none text-xs'}
                  onClick={() => void saveVoucher('draft')}
                  disabled={saving}
                >
                  {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Save as Pending
                </Button>
                {!tabletMode && <span className="self-center pl-2 pr-1 text-[13px] font-semibold">Accept?</span>}
                <Button
                  size={tabletMode ? 'default' : 'sm'}
                  className={tabletMode ? 'h-12 flex-1 bg-[#16437e] text-base' : 'h-7 rounded-none bg-[#16437e] text-xs hover:bg-[#0f3363]'}
                  onClick={() => void saveVoucher('posted')}
                  disabled={saving}
                >
                  {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  {tabletMode ? 'Save Voucher' : 'Yes'}
                </Button>
                <Button
                  variant="secondary"
                  size={tabletMode ? 'default' : 'sm'}
                  className={tabletMode ? 'h-12' : 'h-7 rounded-none text-xs'}
                  onClick={() => void handleQuit()}
                  disabled={saving}
                >
                  {tabletMode ? 'Clear' : 'No'}
                </Button>
                </>
                )}
                {!canAlter && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 rounded-none text-xs"
                    onClick={() => void handleQuit()}
                  >
                    <span className="underline">Q</span>: Quit
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </TallyScreen>

    {allocFor && allocLine && (
      <AllocationPopup
        ledgerName={allocLine.account?.account_name ?? ''}
        amount={allocLine.amount}
        billRef={allocLine.billRef ?? ''}
        costCentreId={allocLine.costCentreId ?? ''}
        costCentres={costCentres}
        features={features}
        onAccept={({ billRef, costCentreId }) => {
          if (allocFor.kind === 'part') updatePartLine(allocFor.key, { billRef, costCentreId });
          else updateJournalLine(allocFor.key, { billRef, costCentreId });
          setAllocFor(null);
        }}
        onClose={() => setAllocFor(null)}
      />
    )}

    {/* Alt+C — create the ledger being typed without leaving the voucher */}
    {quickLedger && (
      <QuickLedgerPopup
        initialName={quickLedger.name}
        onCreated={(created) => {
          quickLedger.assign(asAccount(created));
          setQuickLedger(null);
        }}
        onClose={() => setQuickLedger(null)}
      />
    )}

    {/* F4–F9 on a saved voucher: reclassify it, once the typist agrees */}
    {pendingType && (
      <TallyConfirm
        title="Change Voucher Type"
        message={typeChangeMessage}
        onAccept={() => {
          applyVoucherType(pendingType.id);
          setPendingTypeId(null);
        }}
        onClose={() => setPendingTypeId(null)}
      />
    )}

    {/* Tally asks before Alt+D deletes or Alt+X cancels */}
    {confirmUI}
    </div>
  );
};

export default VoucherEntry;
