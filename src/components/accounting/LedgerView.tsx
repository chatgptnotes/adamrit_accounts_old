import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { TallyScreen } from './tally/TallyChrome';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  opening_balance: number | null;
  opening_balance_type: string | null;
}

interface VoucherEntryRow {
  id: string;
  debit_amount: number | null;
  credit_amount: number | null;
  narration: string | null;
  voucher: {
    id: string;
    voucher_number: string;
    voucher_date: string;
    narration: string | null;
    status: string;
    voucher_type: { voucher_type_name: string } | null;
  } | null;
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

const fy = (): { from: string; to: string } => {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: `${year}-04-01`, to: `${year + 1}-03-31` };
};

/**
 * Ledger Vouchers — Tally Prime replica: pick a ledger (type-to-search like
 * Tally's List of Ledger Accounts), see Date / Particulars / Vch Type /
 * Vch No. / Debit / Credit rows with Opening + Closing balance and totals.
 */
interface LedgerViewProps {
  onOpenVoucher?: (id: string) => void;
  /** Preselect a ledger (drill from Group Summary) */
  initialAccountId?: string;
  onClose?: () => void;
}

const LedgerView: React.FC<LedgerViewProps> = ({ onOpenVoucher, initialAccountId, onClose }) => {
  const [selectedAccountId, setSelectedAccountId] = useState<string>(initialAccountId ?? '');
  const [fromDate, setFromDate] = useState(fy().from);
  const [toDate, setToDate] = useState(fy().to);
  const [showPeriod, setShowPeriod] = useState(false);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ['ledger_accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_type, opening_balance, opening_balance_type')
        .eq('is_active', true)
        .order('account_code');
      if (error) throw error;
      return data as Account[];
    },
  });

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) || null,
    [accounts, selectedAccountId],
  );

  useEffect(() => {
    setSearch(selectedAccount ? selectedAccount.account_name : '');
  }, [selectedAccount]);

  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? accounts.filter((a) => a.account_name.toLowerCase().includes(q) || a.account_code.includes(q))
      : accounts;
    return list.slice(0, 15);
  }, [accounts, search]);

  const { data: rawEntries = [], isLoading } = useQuery({
    queryKey: ['ledger_entries', selectedAccountId, fromDate, toDate],
    enabled: !!selectedAccountId,
    queryFn: async () => {
      const data = await fetchAllRows((from, to) =>
        supabase
          .from('voucher_entries')
          .select(`
            id, debit_amount, credit_amount, narration,
            voucher:vouchers!inner(id, voucher_number, voucher_date, narration, status,
              voucher_type:voucher_types(voucher_type_name)
            )
          `)
          .eq('account_id', selectedAccountId)
          .eq('voucher.status', 'AUTHORISED')
          .gte('voucher.voucher_date', fromDate)
          .lte('voucher.voucher_date', toDate)
          .range(from, to),
      );
      return data as unknown as VoucherEntryRow[];
    },
  });

  const { rows, opening, totalDr, totalCr, closing } = useMemo(() => {
    const sorted = [...rawEntries].sort((a, b) =>
      (a.voucher?.voucher_date || '').localeCompare(b.voucher?.voucher_date || ''),
    );
    const opening = selectedAccount
      ? (Number(selectedAccount.opening_balance) || 0) * (selectedAccount.opening_balance_type === 'Cr' ? -1 : 1)
      : 0;
    let totalDr = 0;
    let totalCr = 0;
    const rows = sorted.map((e) => {
      const dr = Number(e.debit_amount) || 0;
      const cr = Number(e.credit_amount) || 0;
      totalDr += dr;
      totalCr += cr;
      return {
        id: e.id,
        voucherId: e.voucher?.id || '',
        date: e.voucher?.voucher_date || '',
        particulars: e.narration || e.voucher?.narration || '',
        type: e.voucher?.voucher_type?.voucher_type_name?.replace(' Voucher', '') || '',
        number: e.voucher?.voucher_number || '',
        dr,
        cr,
      };
    });
    return { rows, opening, totalDr, totalCr, closing: opening + totalDr - totalCr };
  }, [rawEntries, selectedAccount]);

  return (
    <TallyScreen
      title="Ledger Vouchers"
      onClose={onClose}
      rail={[
        { hotkey: 'F2', label: 'Period', onClick: () => setShowPeriod((v) => !v) },
        { hotkey: 'F3', label: 'Company', disabled: true },
        {
          hotkey: 'F4',
          label: 'Ledger',
          gapBefore: true,
          onClick: () => {
            setSelectedAccountId('');
            setSearch('');
            setTimeout(() => inputRef.current?.focus(), 0);
          },
        },
        { label: 'Save View', disabled: true, gapBefore: true },
        { hotkey: 'P', label: 'Print', onClick: () => window.print(), gapBefore: true },
      ]}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        {/* Ledger picker */}
        <div className="flex items-center gap-2">
          <span className="w-24 shrink-0 font-semibold">Ledger</span>
          <span>:</span>
          <div className="relative w-full max-w-md">
            <input
              ref={inputRef}
              value={search}
              placeholder="Type to search ledger…"
              onChange={(e) => {
                setSearch(e.target.value);
                setOpen(true);
                setHighlight(0);
                if (selectedAccountId) setSelectedAccountId('');
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHighlight((h) => Math.min(h + 1, options.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlight((h) => Math.max(h - 1, 0));
                } else if (e.key === 'Enter' && options[highlight]) {
                  e.preventDefault();
                  setSelectedAccountId(options[highlight].id);
                  setOpen(false);
                }
              }}
              className="h-7 w-full border-0 border-b border-dashed border-gray-400 bg-transparent px-1 font-semibold focus:border-solid focus:border-blue-600 focus:outline-none"
            />
            {open && options.length > 0 && (
              <div className="absolute z-30 mt-1 max-h-72 w-full min-w-[320px] overflow-y-auto border bg-[#eef3fa] shadow-lg">
                <div className="border-b bg-[#16437e] px-3 py-1 text-xs font-semibold text-white">List of Ledger Accounts</div>
                {options.map((a, i) => (
                  <button
                    key={a.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setSelectedAccountId(a.id);
                      setOpen(false);
                    }}
                    onMouseEnter={() => setHighlight(i)}
                    className={`block w-full px-3 py-1 text-left ${i === highlight ? 'bg-[#fdf6d8]' : ''}`}
                  >
                    {a.account_name}
                    <span className="ml-2 text-xs text-muted-foreground">({a.account_code})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {showPeriod && (
          <div className="mt-2 flex items-center gap-2 border border-[#9db8d8] bg-[#fdf6d8] px-2 py-1">
            <span>Period:</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="border bg-white px-1" />
            <span>to</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="border bg-white px-1" />
          </div>
        )}

        {selectedAccount && (
          <>
            {/* Ledger header, Tally style */}
            <div className="mt-2 text-center">
              <div className="font-bold">{selectedAccount.account_name}</div>
              <div className="text-[11px]">
                {tallyDateLabel(fromDate)} to {tallyDateLabel(toDate)}
              </div>
            </div>

            {/* Column header */}
            <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
              <div className="w-20 px-1">Date</div>
              <div className="min-w-0 flex-1 px-1">Particulars</div>
              <div className="w-28 px-1">Vch Type</div>
              <div className="w-28 px-1">Vch No.</div>
              <div className="w-32 px-1 text-right">Debit</div>
              <div className="w-32 px-1 text-right">Credit</div>
            </div>

            {/* Opening balance */}
            <div className="flex border-b border-dashed border-gray-300 italic">
              <div className="w-20 px-1" />
              <div className="min-w-0 flex-1 px-1 font-semibold">Opening Balance</div>
              <div className="w-28 px-1" />
              <div className="w-28 px-1" />
              <div className="w-32 px-1 text-right font-mono">{opening > 0 ? fmt(opening) : ''}</div>
              <div className="w-32 px-1 text-right font-mono">{opening < 0 ? fmt(-opening) : ''}</div>
            </div>

            {isLoading ? (
              <div className="py-10 text-center text-gray-400">Loading…</div>
            ) : (
              <>
                {rows.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => r.voucherId && onOpenVoucher?.(r.voucherId)}
                    title="Open voucher (alter)"
                    className="flex cursor-pointer border-b border-dashed border-gray-200 hover:bg-[#fdf6d8]"
                  >
                    <div className="w-20 px-1">{tallyDateLabel(r.date)}</div>
                    <div className="min-w-0 flex-1 truncate px-1">{r.particulars}</div>
                    <div className="w-28 px-1">{r.type}</div>
                    <div className="w-28 px-1 font-mono text-[12px]">{r.number}</div>
                    <div className="w-32 px-1 text-right font-mono">{r.dr > 0 ? fmt(r.dr) : ''}</div>
                    <div className="w-32 px-1 text-right font-mono">{r.cr > 0 ? fmt(r.cr) : ''}</div>
                  </div>
                ))}

                {/* Totals + closing, Tally style */}
                <div className="mt-1 flex border-t border-gray-400 pt-0.5 font-semibold">
                  <div className="w-20 px-1" />
                  <div className="min-w-0 flex-1 px-1" />
                  <div className="w-28 px-1" />
                  <div className="w-28 px-1" />
                  <div className="w-32 px-1 text-right font-mono">{fmt(totalDr + Math.max(0, opening))}</div>
                  <div className="w-32 px-1 text-right font-mono">{fmt(totalCr + Math.max(0, -opening))}</div>
                </div>
                <div className="flex italic">
                  <div className="w-20 px-1" />
                  <div className="min-w-0 flex-1 px-1 font-semibold">Closing Balance</div>
                  <div className="w-28 px-1" />
                  <div className="w-28 px-1" />
                  <div className="w-32 px-1 text-right font-mono">{closing < 0 ? fmt(-closing) : ''}</div>
                  <div className="w-32 px-1 text-right font-mono">{closing > 0 ? fmt(closing) : ''}</div>
                </div>
                <div className="mt-1 text-right text-[12px] text-gray-600">
                  {rows.length} voucher(s) · Closing: <span className="font-mono font-semibold">{fmt(Math.abs(closing))} {closing >= 0 ? 'Dr' : 'Cr'}</span>
                </div>
              </>
            )}
          </>
        )}
        {!selectedAccount && (
          <div className="py-16 text-center text-gray-400">Select a ledger to view its vouchers (F4).</div>
        )}
      </div>
    </TallyScreen>
  );
};

export default LedgerView;
