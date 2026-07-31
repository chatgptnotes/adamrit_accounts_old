import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { fetchActiveAccounts } from '@/lib/fetchAccounts';
import { useAccountingCompany } from './AccountingCompanyContext';
import { TallyScreen, voucherBottomBar } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { useRowCursor } from './tally/useRowCursor';
import { dayBefore, dayLabel, monthsInPeriod } from './tally/PeriodContext';
import { fetchTallyVouchers } from '@/lib/mergedVouchers';
import { normalizeName } from '@/lib/tallyCompanyMatch';
import { accountMovements, type Movement } from '@/lib/accountMovements';
import { isCashBankLedger, optionalNetByAccount } from '@/lib/cashBankOptional';
import { headOfType, PL_HEADS } from './tally/heads';
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
    /** Every line of the voucher, so the contra ledger can be named */
    entries: {
      account_id: string;
      debit_amount: number | null;
      credit_amount: number | null;
      account: { account_name: string } | null;
    }[] | null;
  } | null;
}

/** The other side of a voucher, as Tally prints it under Particulars. */
interface ContraLine {
  name: string;
  dr: number;
  cr: number;
}

/** Rows shown at once in the List of Ledger Accounts drop-down */
const PICKER_LIMIT = 50;

/**
 * What Tally prints under Particulars: the single ledger on the other side, or
 * "(as per details)" when the voucher has several — the breakup then shows in
 * Detailed mode.
 */
const particularsOf = (contra: ContraLine[]): string =>
  contra.length === 0 ? '' : contra.length === 1 ? contra[0].name : '(as per details)';

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
  const [monthly, setMonthly] = useState(false);
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
    // Tally's Ledger Vouchers F12
    configFields: [
      { key: 'runningBalance', label: 'Show Running Balance' },
      { key: 'narrations', label: 'Show Narrations also', value: true },
    ],
    detailedToggle: { hotkey: 'F5', label: 'Ledger-wise' },
    // Whichever view is on screen: the monthly summary or the vouchers.
    exportData: () =>
      monthly
        ? {
            title: `Ledger Monthly Summary — ${selectedAccount?.account_name ?? ''}`,
            period: report.periodLabel,
            columns: ['Month', 'Debit', 'Credit', 'Closing'],
            rows: monthRows.map((m) => [m.label, m.dr, m.cr, m.closing]),
          }
        : {
            title: `Ledger Vouchers — ${selectedAccount?.account_name ?? ''}`,
            period: report.periodLabel,
            columns: ['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit', 'Credit', 'Narration'],
            rows: rows.map((r) => [
              r.date,
              particularsOf(r.contra),
              r.type,
              r.number,
              r.dr,
              r.cr,
              r.narration,
            ]),
          },
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
      // Tally's Ledger Monthly Summary — one line per month instead of per voucher
      { hotkey: 'F6', label: 'Monthly', active: monthly, onClick: () => setMonthly((v) => !v) },
      sourceRail,
    ],
  });
  const { from: fromDate, to: toDate, fmtAmount: fmt, detailed, config } = report;
  const showRunning = !!config.runningBalance;

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

  const dropOptional = isCashBankLedger(selectedAccount?.account_code);

  const { data: rawEntries = [], isLoading } = useQuery({
    queryKey: ['ledger_entries', selectedCompanyId, selectedAccountId, fromDate, toDate, dropOptional],
    enabled: !!selectedCompanyId && !!selectedAccountId && accounts.length > 0,
    queryFn: async () => {
      const data = await fetchAllRows((from, to) => {
        let query = supabase
          .from('voucher_entries')
          .select(`
            id, debit_amount, credit_amount, narration,
            voucher:vouchers!inner(id, voucher_number, voucher_date, narration, status, is_optional,
              voucher_type:voucher_types(voucher_type_name),
              entries:voucher_entries(account_id, debit_amount, credit_amount,
                account:chart_of_accounts(account_name)
              )
            )
          `)
          .eq('account_id', selectedAccountId)
          .eq('voucher.status', 'AUTHORISED')
          .eq('voucher.company_id', selectedCompanyId)
          .gte('voucher.voucher_date', fromDate)
          .lte('voucher.voucher_date', toDate);
        // A cash or bank ledger shows its own transactions only — see
        // cashBankOptional. Every other ledger keeps the pharmacy JVs.
        if (dropOptional) query = query.eq('voucher.is_optional', false);
        return query.range(from, to);
      });
      return data as unknown as VoucherEntryRow[];
    },
  });

  // Tally mirror vouchers touching this ledger (by name). Tally-preferred: a
  // Tally row overwrites a native row that shares the same voucher number.
  // Scoped to the selected company — without companyId this pulled the mirror
  // vouchers of every Tally company into whichever ledger you were looking at.
  const { data: tallyVouchers = [] } = useQuery({
    queryKey: ['ledger_tally', selectedCompanyId, fromDate, toDate],
    enabled: !!selectedAccountId,
    queryFn: () => fetchTallyVouchers({ companyId: selectedCompanyId, from: fromDate, upto: toDate }),
  });

  // Everything posted before the period, so the Opening Balance below is the
  // ledger's balance on the day the period starts.
  const { data: priorMovements = new Map<string, Movement>() } = useQuery({
    queryKey: ['ledger_prior', selectedCompanyId, fromDate],
    enabled: !!selectedAccountId,
    queryFn: () => accountMovements({ upto: dayBefore(fromDate), companyId: selectedCompanyId }),
  });

  // The pharmacy JVs this screen hides must also come off the ledger's
  // Opening Balance, or the running balance starts from a figure the rows
  // below can never reach.
  const { data: priorOptionalNet = new Map<string, number>() } = useQuery({
    queryKey: ['ledger_prior_cash_bank_optional', selectedCompanyId, fromDate],
    enabled: !!selectedAccountId && dropOptional,
    queryFn: () => optionalNetByAccount({ upto: dayBefore(fromDate), companyId: selectedCompanyId }),
  });

  const { rows, opening, totalDr, totalCr, closing } = useMemo(() => {
    // Tally's Opening Balance is the ledger as it stood the day before the
    // period, not the figure typed into the master. Reading the master alone
    // meant that setting F2 to July still showed the 1-Apr balance, and every
    // running balance below it inherited the error. Revenue ledgers are closed
    // to Profit & Loss A/c each year, so they open at zero — the same rule the
    // Trial Balance and P&L apply.
    const head = headOfType(selectedAccount?.account_type);
    const master =
      selectedAccount && !(head && PL_HEADS.has(head))
        ? (Number(selectedAccount.opening_balance) || 0) *
          (selectedAccount.opening_balance_type?.toUpperCase() === 'CR' ? -1 : 1)
        : 0;
    const prior = selectedAccountId ? priorMovements.get(selectedAccountId) : undefined;
    const priorOptional = (dropOptional && selectedAccountId ? priorOptionalNet.get(selectedAccountId) : 0) ?? 0;
    const opening = master + (prior ? prior.debit - prior.credit : 0) - priorOptional;

    type Row = {
      id: string;
      voucherId: string;
      date: string;
      /** The ledger(s) on the other side — what Tally prints under Particulars */
      contra: ContraLine[];
      narration: string;
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
      // Tally names the opposite ledger here, not the narration. This screen
      // printed the narration, which is the one thing Tally does NOT put in
      // this column (it belongs under the row, in Detailed mode).
      contra: (e.voucher?.entries ?? [])
        .filter((line) => line.account_id !== selectedAccountId)
        .map((line) => ({
          name: line.account?.account_name || '',
          dr: Number(line.debit_amount) || 0,
          cr: Number(line.credit_amount) || 0,
        })),
      narration: e.narration || e.voucher?.narration || '',
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
        tallyRows.push({
          id: `${v.id}:${idx}`,
          voucherId: '',
          date: v.date,
          contra: v.entries
            .filter((x) => normalizeName(x.ledger) !== ledgerKey)
            .map((x) => ({ name: x.ledger, dr: x.debit, cr: x.credit })),
          narration: v.narration || '',
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
      .filter((r) =>
        report.passesFilter({ Particulars: particularsOf(r.contra), 'Vch Type': r.type, 'Vch No.': r.number }),
      )
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    let totalDr = 0;
    let totalCr = 0;
    for (const r of rows) {
      totalDr += r.dr;
      totalCr += r.cr;
    }
    return { rows, opening, totalDr, totalCr, closing: opening + totalDr - totalCr };
  }, [rawEntries, tallyVouchers, selectedAccount, selectedAccountId, priorMovements, dropOptional, priorOptionalNet, srcFilter, report.passesFilter]);

  // F6: Monthly — Tally's Ledger Monthly Summary, one line per month with the
  // balance carried forward.
  const monthRows = useMemo(() => {
    if (!monthly) return [];
    let running = opening;
    return monthsInPeriod({ from: fromDate, to: toDate }).map((m) => {
      const inMonth = rows.filter((r) => r.date >= m.from && r.date <= m.upto);
      const dr = inMonth.reduce((sum, r) => sum + r.dr, 0);
      const cr = inMonth.reduce((sum, r) => sum + r.cr, 0);
      running += dr - cr;
      return { key: m.ym, label: m.label, from: m.from, upto: m.upto, dr, cr, closing: running, count: inMonth.length };
    });
  }, [monthly, rows, opening, fromDate, toDate]);

  const { cursor, setCursor } = useRowCursor({
    count: monthly ? monthRows.length : rows.length,
    enabled: !open,
    onEnter: (index) => {
      // Tally drills a month down to that month's vouchers
      if (monthly) {
        const month = monthRows[index];
        if (!month) return;
        report.setPeriod(month.from, month.upto);
        setMonthly(false);
        return;
      }
      const voucherId = rows[index]?.voucherId;
      if (voucherId) onOpenVoucher?.(voucherId);
    },
  });

  return (
    <>
    <TallyScreen
      title={monthly ? 'Ledger Monthly Summary' : 'Ledger Vouchers'}
      onClose={onClose}
      rail={report.rail}
      bottomBar={voucherBottomBar({
        onQuit: onClose,
        onAlter: () => {
          const voucherId = rows[cursor]?.voucherId;
          if (voucherId) onOpenVoucher?.(voucherId);
        },
      })}
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
                {dayLabel(fromDate)} to {dayLabel(toDate)}
              </div>
            </div>

            {monthly ? (
              <>
                {/* F6: Monthly — Tally's Ledger Monthly Summary */}
                <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
                  <div className="min-w-0 flex-1 px-1">Particulars</div>
                  <div className="w-32 px-1 text-right">Debit</div>
                  <div className="w-32 px-1 text-right">Credit</div>
                  <div className="w-36 px-1 text-right">Closing Balance</div>
                </div>
                {monthRows.map((m, i) => (
                  <div
                    key={m.key}
                    onClick={() => {
                      report.setPeriod(m.from, m.upto);
                      setMonthly(false);
                    }}
                    onMouseEnter={() => setCursor(i)}
                    title="Show this month's vouchers"
                    className={`flex cursor-pointer border-b border-dashed border-gray-200 ${
                      cursor === i ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'
                    }`}
                  >
                    <div className="min-w-0 flex-1 px-1">{m.label}</div>
                    <div className="w-32 px-1 text-right font-mono">{m.dr > 0 ? fmt(m.dr) : ''}</div>
                    <div className="w-32 px-1 text-right font-mono">{m.cr > 0 ? fmt(m.cr) : ''}</div>
                    <div className="w-36 px-1 text-right font-mono">
                      {fmt(Math.abs(m.closing))} {m.closing >= 0 ? 'Dr' : 'Cr'}
                    </div>
                  </div>
                ))}
                <div className="mt-1 flex border-t border-gray-400 pt-0.5 font-semibold">
                  <div className="min-w-0 flex-1 px-1">Grand Total</div>
                  <div className="w-32 px-1 text-right font-mono">{fmt(totalDr)}</div>
                  <div className="w-32 px-1 text-right font-mono">{fmt(totalCr)}</div>
                  <div className="w-36 px-1 text-right font-mono">
                    {fmt(Math.abs(closing))} {closing >= 0 ? 'Dr' : 'Cr'}
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Column header */}
                <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
                  <div className="w-20 px-1">Date</div>
                  <div className="min-w-0 flex-1 px-1">Particulars</div>
                  <div className="w-28 px-1">Vch Type</div>
                  <div className="w-28 px-1">Vch No.</div>
                  <div className="w-32 px-1 text-right">Debit</div>
                  <div className="w-32 px-1 text-right">Credit</div>
                  {showRunning && <div className="w-36 px-1 text-right">Balance</div>}
                </div>

                {/* Opening balance */}
                <div className="flex border-b border-dashed border-gray-300 italic">
                  <div className="w-20 px-1" />
                  <div className="min-w-0 flex-1 px-1 font-semibold">Opening Balance</div>
                  <div className="w-28 px-1" />
                  <div className="w-28 px-1" />
                  <div className="w-32 px-1 text-right font-mono">{opening > 0 ? fmt(opening) : ''}</div>
                  <div className="w-32 px-1 text-right font-mono">{opening < 0 ? fmt(-opening) : ''}</div>
                  {showRunning && (
                    <div className="w-36 px-1 text-right font-mono">
                      {fmt(Math.abs(opening))} {opening >= 0 ? 'Dr' : 'Cr'}
                    </div>
                  )}
                </div>

                {isLoading ? (
                  <div className="py-10 text-center text-gray-400">Loading…</div>
                ) : (
                  <>
                    {(() => {
                      let running = opening;
                      return rows.map((r, i) => {
                        running += r.dr - r.cr;
                        const balance = running;
                        return (
                          <div key={r.id}>
                            <div
                              onClick={() => r.voucherId && onOpenVoucher?.(r.voucherId)}
                              onMouseEnter={() => setCursor(i)}
                              title="Open voucher (alter)"
                              className={`flex cursor-pointer border-b border-dashed border-gray-200 ${
                                cursor === i ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'
                              }`}
                            >
                              <div className="w-20 px-1">{dayLabel(r.date)}</div>
                              <div className="min-w-0 flex-1 truncate px-1">{particularsOf(r.contra)}</div>
                              <div className="w-28 px-1">{r.type}</div>
                              <div className="w-28 px-1 font-mono text-[12px]">{r.number}</div>
                              <div className="w-32 px-1 text-right font-mono">{r.dr > 0 ? fmt(r.dr) : ''}</div>
                              <div className="w-32 px-1 text-right font-mono">{r.cr > 0 ? fmt(r.cr) : ''}</div>
                              {showRunning && (
                                <div className="w-36 px-1 text-right font-mono">
                                  {fmt(Math.abs(balance))} {balance >= 0 ? 'Dr' : 'Cr'}
                                </div>
                              )}
                            </div>
                            {/* Detailed: the full other side, then the narration */}
                            {detailed && (
                              <div className="border-b border-dashed border-gray-100 pb-0.5">
                                {r.contra.map((line, li) => (
                                  <div key={`${r.id}-c${li}`} className="flex italic text-[12px] text-gray-700">
                                    <div className="w-20 px-1" />
                                    <div className="min-w-0 flex-1 truncate px-1 pl-4">
                                      {line.dr > 0 ? 'By' : 'To'} {line.name}
                                    </div>
                                    <div className="w-28 px-1" />
                                    <div className="w-28 px-1" />
                                    <div className="w-32 px-1 text-right font-mono">
                                      {line.dr > 0 ? fmt(line.dr) : ''}
                                    </div>
                                    <div className="w-32 px-1 text-right font-mono">
                                      {line.cr > 0 ? fmt(line.cr) : ''}
                                    </div>
                                    {showRunning && <div className="w-36 px-1" />}
                                  </div>
                                ))}
                                {!!config.narrations && r.narration && (
                                  <div className="flex text-[12px] italic text-gray-500">
                                    <div className="w-20 px-1" />
                                    <div className="min-w-0 flex-1 px-1 pl-4">({r.narration})</div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}

                    {/* Tally closes a ledger with Current Total, then Closing Balance */}
                    <div className="mt-1 flex border-t border-gray-400 pt-0.5 font-semibold">
                      <div className="w-20 px-1" />
                      <div className="min-w-0 flex-1 px-1">Current Total</div>
                      <div className="w-28 px-1" />
                      <div className="w-28 px-1" />
                      <div className="w-32 px-1 text-right font-mono">{fmt(totalDr)}</div>
                      <div className="w-32 px-1 text-right font-mono">{fmt(totalCr)}</div>
                      {showRunning && <div className="w-36 px-1" />}
                    </div>
                    <div className="flex italic">
                      <div className="w-20 px-1" />
                      <div className="min-w-0 flex-1 px-1 font-semibold">Closing Balance</div>
                      <div className="w-28 px-1" />
                      <div className="w-28 px-1" />
                      <div className="w-32 px-1 text-right font-mono">{closing < 0 ? fmt(-closing) : ''}</div>
                      <div className="w-32 px-1 text-right font-mono">{closing > 0 ? fmt(closing) : ''}</div>
                      {showRunning && (
                        <div className="w-36 px-1 text-right font-mono">
                          {fmt(Math.abs(closing))} {closing >= 0 ? 'Dr' : 'Cr'}
                        </div>
                      )}
                    </div>
                  </>
                )}
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
