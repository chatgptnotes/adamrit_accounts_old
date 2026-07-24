import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { fetchActiveAccounts } from '@/lib/fetchAccounts';
import { useAccountingCompany } from './AccountingCompanyContext';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { useRowCursor } from './tally/useRowCursor';
import { fetchTallyVouchers } from '@/lib/mergedVouchers';
import { normalizeName } from '@/lib/tallyCompanyMatch';
import { useSourceFilter, matchesSource } from './useSourceFilter';

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

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

/** Rows shown at once in the List of Ledger Accounts drop-down */
const PICKER_LIMIT = 50;

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
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { source: srcFilter, railItem: sourceRail } = useSourceFilter();
  const { selectedCompanyId } = useAccountingCompany();

  const report = useTallyReport({
    filterFields: ['Particulars', 'Vch Type', 'Vch No.'],
    views: [
      { label: 'Group Summary', target: 'group-summary' },
      { label: 'Day Book', target: 'day-book' },
      { label: 'Registers', target: 'voucher-register' },
      { label: 'Trial Balance', target: 'trial-balance' },
    ],
    screenKeys: [
      {
        hotkey: 'F4',
        label: 'Ledger',
        onClick: () => {
          setSelectedAccountId('');
          setSearch('');
          setTimeout(() => inputRef.current?.focus(), 0);
        },
      },
      sourceRail,
    ],
  });
  const { from: fromDate, to: toDate, fmtAmount: fmt } = report;

  const { data: accounts = [] } = useQuery({
    queryKey: ['ledger_accounts', selectedCompanyId],
    queryFn: () =>
      fetchActiveAccounts<Account>({
        columns: 'id, account_code, account_name, account_type, opening_balance, opening_balance_type',
        companyId: selectedCompanyId,
      }),
  });

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) || null,
    [accounts, selectedAccountId],
  );

  useEffect(() => {
    setSearch(selectedAccount ? selectedAccount.account_name : '');
  }, [selectedAccount]);

  // Show a window of the matches, but keep the total visible so a long list
  // never looks like the whole answer.
  const { options, matchCount } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? accounts.filter((a) => a.account_name.toLowerCase().includes(q) || a.account_code.includes(q))
      : accounts;
    return { options: list.slice(0, PICKER_LIMIT), matchCount: list.length };
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

  // Tally mirror vouchers touching this ledger (by name). Tally-preferred: a
  // Tally row overwrites a native row that shares the same voucher number.
  const { data: tallyVouchers = [] } = useQuery({
    queryKey: ['ledger_tally', fromDate, toDate],
    enabled: !!selectedAccountId,
    queryFn: () => fetchTallyVouchers({ from: fromDate, upto: toDate }),
  });

  const { rows, opening, totalDr, totalCr, closing } = useMemo(() => {
    const opening = selectedAccount
      ? (Number(selectedAccount.opening_balance) || 0) * (selectedAccount.opening_balance_type?.toUpperCase() === 'CR' ? -1 : 1)
      : 0;

    type Row = {
      id: string;
      voucherId: string;
      date: string;
      particulars: string;
      type: string;
      number: string;
      dr: number;
      cr: number;
      source: 'adamrit' | 'tally';
    };

    const nativeRows: Row[] = rawEntries.map((e) => ({
      id: e.id,
      voucherId: e.voucher?.id || '',
      date: e.voucher?.voucher_date || '',
      particulars: e.narration || e.voucher?.narration || '',
      type: e.voucher?.voucher_type?.voucher_type_name?.replace(' Voucher', '') || '',
      number: e.voucher?.voucher_number || '',
      dr: Number(e.debit_amount) || 0,
      cr: Number(e.credit_amount) || 0,
      source: 'adamrit',
    }));

    const ledgerKey = normalizeName(selectedAccount?.account_name);
    const tallyRows: Row[] = [];
    for (const v of tallyVouchers) {
      v.entries.forEach((entry, idx) => {
        if (normalizeName(entry.ledger) !== ledgerKey) return;
        const other = v.entries.find((x) => normalizeName(x.ledger) !== ledgerKey);
        tallyRows.push({
          id: `${v.id}:${idx}`,
          voucherId: '',
          date: v.date,
          particulars: v.narration || other?.ledger || '',
          type: v.voucher_type.replace(' Voucher', ''),
          number: v.voucher_number,
          dr: entry.debit,
          cr: entry.credit,
          source: 'tally',
        });
      });
    }

    const byNumber = new Map<string, Row>();
    const passthrough: Row[] = [];
    for (const r of [...nativeRows, ...tallyRows]) {
      const key = normalizeName(r.number);
      if (!key) { passthrough.push(r); continue; }
      const existing = byNumber.get(key);
      if (!existing || r.source === 'tally') byNumber.set(key, r);
    }
    const rows = [...byNumber.values(), ...passthrough]
      .filter((r) => matchesSource(r.source, srcFilter))
      .filter((r) => report.passesFilter({ Particulars: r.particulars, 'Vch Type': r.type, 'Vch No.': r.number }))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    let totalDr = 0;
    let totalCr = 0;
    for (const r of rows) {
      totalDr += r.dr;
      totalCr += r.cr;
    }
    return { rows, opening, totalDr, totalCr, closing: opening + totalDr - totalCr };
  }, [rawEntries, tallyVouchers, selectedAccount, srcFilter, report.passesFilter]);

  const { cursor, setCursor } = useRowCursor({
    count: rows.length,
    enabled: !open,
    onEnter: (index) => {
      const voucherId = rows[index]?.voucherId;
      if (voucherId) onOpenVoucher?.(voucherId);
    },
  });

  return (
    <>
    <TallyScreen title="Ledger Vouchers" onClose={onClose} rail={report.rail}>
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
                <div className="sticky top-0 flex items-baseline justify-between border-b bg-[#16437e] px-3 py-1 text-xs font-semibold text-white">
                  <span>List of Ledger Accounts</span>
                  <span className="font-normal">
                    {matchCount > options.length
                      ? `${options.length} of ${matchCount} — keep typing`
                      : `${matchCount} ledger${matchCount === 1 ? '' : 's'}`}
                  </span>
                </div>
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
                {rows.map((r, i) => (
                  <div
                    key={r.id}
                    onClick={() => r.voucherId && onOpenVoucher?.(r.voucherId)}
                    onMouseEnter={() => setCursor(i)}
                    title="Open voucher (alter)"
                    className={`flex cursor-pointer border-b border-dashed border-gray-200 ${
                      cursor === i ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'
                    }`}
                  >
                    <div className="w-20 px-1">{tallyDateLabel(r.date)}</div>
                    <div className="min-w-0 flex-1 truncate px-1">
                      {r.particulars}
                    </div>
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

    {report.popups}
    </>
  );
};

export default LedgerView;
