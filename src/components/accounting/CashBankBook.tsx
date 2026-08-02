import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { fetchActiveAccounts } from '@/lib/fetchAccounts';
import { accountMovements } from '@/lib/accountMovements';
import { isCashBankLedger, optionalNetByAccount } from '@/lib/cashBankOptional';
import { TallyScreen } from './tally/TallyChrome';
import { TallyList } from './tally/TallyPopup';
import { useTallyReport } from './tally/useTallyReport';
import { useRowCursor } from './tally/useRowCursor';
import { monthsInPeriod } from './tally/PeriodContext';
import { useAccountingCompany } from './AccountingCompanyContext';
import { VoucherAttachmentButton, useVoucherAttachmentMap } from './VoucherAttachmentViewer';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  opening_balance: number | null;
  opening_balance_type: string | null;
}

interface EntryRow {
  id: string;
  debit_amount: number | null;
  credit_amount: number | null;
  narration: string | null;
  voucher: {
    id: string;
    voucher_number: string;
    voucher_date: string;
    narration: string | null;
    voucher_type: { voucher_type_name: string } | null;
  } | null;
}

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

/** Round an axis maximum up to the next 1 / 2 / 5 × 10ⁿ step, like Tally's scale */
const niceCeil = (value: number): number => {
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  const scaled = value / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
};

interface MonthRow {
  label: string;
  ym: string;
  dr: number;
  cr: number;
  closing: number;
}

/** Tally's monthly bar graph — net movement per month around a zero line. */
const MonthlyChart: React.FC<{ months: MonthRow[] }> = ({ months }) => {
  const nets = months.map((m) => m.dr - m.cr);
  const peak = Math.max(...nets.map(Math.abs));
  if (peak <= 0) return null;
  const scale = niceCeil(peak);
  const half = 60; // px from the zero line to the top of the plot

  const axisLabel = (n: number) =>
    new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

  return (
    <div className="mt-10 flex text-[11px] print:hidden">
      <div className="relative w-16 shrink-0" style={{ height: half * 2 }}>
        <span className="absolute right-2 -translate-y-1/2" style={{ top: 0 }}>{axisLabel(scale)}</span>
        <span className="absolute right-2 -translate-y-1/2" style={{ top: half }}>0</span>
        <span className="absolute right-2 -translate-y-1/2" style={{ top: half * 2 }}>(-){axisLabel(scale)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height: half * 2 }}>
          <div className="absolute inset-x-0 border-t border-black" style={{ top: half }} />
          <div className="absolute inset-0 flex">
            {months.map((m, i) => {
              const height = Math.round((Math.abs(nets[i]) / scale) * half);
              return (
                <div key={m.ym} className="relative flex-1" title={`${m.label}: ${axisLabel(nets[i])}`}>
                  {height > 0 && (
                    <div
                      className="absolute left-1/2 w-[44%] -translate-x-1/2 bg-[#e01b1b]"
                      style={nets[i] >= 0 ? { bottom: half, height } : { top: half, height }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex pt-1">
          {months.map((m) => (
            <div key={m.ym} className="flex-1 text-center">
              {m.label.slice(0, 3)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * Cash/Bank Book — Tally Prime replica: pick a cash or bank ledger, see the
 * monthly summary (Debit/Credit totals + running Closing Balance per month,
 * Apr–Mar), and drill into any month for its daily vouchers.
 */
const CashBankBook: React.FC<{ onOpenVoucher?: (id: string) => void }> = ({ onOpenVoucher }) => {
  const { companies, selectedCompanyId } = useAccountingCompany();
  const headerCompanyName = companies.find((c) => c.id === selectedCompanyId)?.company_name ?? '';
  const [selectedId, setSelectedId] = useState('');
  const [openMonth, setOpenMonth] = useState<string | null>(null); // 'YYYY-MM'
  const [ledgerPicker, setLedgerPicker] = useState(false);

  // Cash-in-hand + bank ledgers — picked by GROUP as well as the native
  // 111x/112x codes, because Tally-imported banks (State Bank of India,
  // Pusad Urban...) carry TL... codes and were invisible to the prefix filter.
  const { data: accounts = [] } = useQuery({
    queryKey: ['cash_bank_accounts', selectedCompanyId],
    enabled: !!selectedCompanyId,
    queryFn: async () => {
      const all = await fetchActiveAccounts<Account & { account_group?: string | null; account_type?: string }>({
        columns: 'id, account_code, account_name, account_group, account_type, opening_balance, opening_balance_type',
        companyId: selectedCompanyId,
      });
      return all.filter((a) => {
        const group = ((a as any).account_group || '').toLowerCase();
        const liability = ((a as any).account_type || '').toUpperCase().includes('LIABILIT');
        if (liability) return false;
        return (
          a.account_code.startsWith('111') ||
          a.account_code.startsWith('112') ||
          group.includes('cash') ||
          group.includes('bank')
        );
      });
    },
  });

  const account = accounts.find((a) => a.id === selectedId) || null;
  // Every account offered by this screen is a cash/bank ledger by
  // construction, whatever its code says.
  const dropOptional = isCashBankLedger(account?.account_code) || !!account;

  const report = useTallyReport({
    filterFields: ['Particulars', 'Narration', 'Vch Type', 'Vch No.'],
    views: [
      { label: 'Cash/Bank Summary', target: 'cash-bank-summary' },
      { label: 'Bank Reconciliation', target: 'bank-reconciliation' },
      { label: 'Ledger Vouchers', target: 'ledger-view' },
      { label: 'Day Book', target: 'day-book' },
    ],
    // The rail carries shortcuts only. The cash/bank ledgers are report content,
    // so they are listed in the body below — F4 still opens them as a picker.
    screenKeys: [
      { hotkey: 'F4', label: 'Ledger', onClick: () => setLedgerPicker(true) },
      { hotkey: 'F6', label: 'Monthly', active: !openMonth, onClick: () => setOpenMonth(null) },
    ],
    // The book drills ledger → month → vouchers; export whichever is on screen.
    exportData: () =>
      openMonth
        ? {
            title: `${account?.account_name ?? 'Cash/Bank'} Book — ${openMonth}`,
            period: report.periodLabel,
            columns: ['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit', 'Credit'],
            rows: monthEntries.map((e) => [
              e.voucher?.voucher_date ?? '',
              e.narration || e.voucher?.narration || '',
              e.voucher?.voucher_type?.voucher_type_name ?? '',
              e.voucher?.voucher_number ?? '',
              Number(e.debit_amount) || 0,
              Number(e.credit_amount) || 0,
            ]),
          }
        : {
            title: `${account?.account_name ?? 'Cash/Bank'} Book`,
            period: report.periodLabel,
            columns: ['Month', 'Debit', 'Credit', 'Closing'],
            rows: months.map((m) => [m.label, m.dr, m.cr, m.closing]),
          },
  });

  // The monthly grid always spans the financial year the period starts in
  const fyFrom = report.from;
  const fyTo = report.to;

  // Closing balance per ledger for the opening list — same source and arithmetic
  // as Cash/Bank Summary, so the two screens can never disagree.
  const { data: movements = {}, isLoading: listLoading } = useQuery({
    queryKey: ['cash_bank_book_movements', selectedCompanyId, fyTo],
    enabled: !!selectedCompanyId && !selectedId && accounts.length > 0,
    queryFn: async () => {
      const [map, optionalNet] = await Promise.all([
        accountMovements({ upto: fyTo, companyId: selectedCompanyId }),
        optionalNetByAccount({ upto: fyTo, companyId: selectedCompanyId }),
      ]);
      const byAccount: Record<string, number> = {};
      for (const a of accounts) {
        const m = map.get(a.id);
        if (m) byAccount[a.id] = m.debit - m.credit;
        // Every ledger here is a cash or bank one, and each shows its own
        // transactions only — so the pharmacy JVs the drill-down hides must
        // come off the closing balance too.
        const optional = optionalNet.get(a.id);
        if (optional) byAccount[a.id] = (byAccount[a.id] ?? 0) - optional;
      }
      return byAccount;
    },
  });

  const closingOf = (a: Account): number => {
    const openingBalance = (Number(a.opening_balance) || 0) * (a.opening_balance_type?.toUpperCase() === 'CR' ? -1 : 1);
    return openingBalance + (movements[a.id] ?? 0);
  };

  // Cash-in-Hand (111x) and Bank Accounts (112x) as one flat list, so the
  // cursor walks group headers and ledgers exactly like Tally.
  const ledgerGroups = useMemo(
    () =>
      [
        {
          name: 'Cash-in-Hand',
          items: accounts.filter(
            (a) => a.account_code.startsWith('111') || ((a as any).account_group || '').toLowerCase().includes('cash'),
          ),
        },
        {
          name: 'Bank Accounts',
          items: accounts.filter(
            (a) => !(a.account_code.startsWith('111') || ((a as any).account_group || '').toLowerCase().includes('cash')),
          ),
        },
      ].filter((g) => g.items.length > 0),
    [accounts],
  );
  const ledgerRows = useMemo(() => ledgerGroups.flatMap((g) => g.items), [ledgerGroups]);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['cash_bank_book', selectedCompanyId, selectedId, fyFrom, fyTo, dropOptional],
    enabled: !!selectedCompanyId && !!selectedId && accounts.length > 0,
    queryFn: async () => {
      const data = await fetchAllRows((from, to) => {
        let query = supabase
          .from('voucher_entries')
          .select(`
            id, debit_amount, credit_amount, narration,
            voucher:vouchers!inner(id, voucher_number, voucher_date, narration, status, is_optional,
              voucher_type:voucher_types(voucher_type_name)
            )
          `)
          .eq('account_id', selectedId)
          .eq('voucher.status', 'AUTHORISED')
          .eq('voucher.company_id', selectedCompanyId)
          .gte('voucher.voucher_date', fyFrom)
          .lte('voucher.voucher_date', fyTo);
        // A cash or bank ledger shows its own transactions only — see
        // cashBankOptional. Every other ledger keeps the pharmacy JVs.
        if (dropOptional) query = query.eq('voucher.is_optional', false);
        return query.order('created_at', { ascending: true }).range(from, to);
      });
      return data as unknown as EntryRow[];
    },
  });
  const voucherIds = useMemo(
    () => entries.map((entry) => entry.voucher?.id || '').filter(Boolean),
    [entries],
  );
  const { data: attachmentMap = new Map() } = useVoucherAttachmentMap(voucherIds);

  const opening = account
    ? (Number(account.opening_balance) || 0) * (account.opening_balance_type?.toUpperCase() === 'CR' ? -1 : 1)
    : 0;

  const months = useMemo(() => {
    const byMonth = new Map<string, { dr: number; cr: number }>();
    for (const e of entries) {
      const ym = (e.voucher?.voucher_date || '').slice(0, 7);
      const m = byMonth.get(ym) ?? { dr: 0, cr: 0 };
      m.dr += Number(e.debit_amount) || 0;
      m.cr += Number(e.credit_amount) || 0;
      byMonth.set(ym, m);
    }
    let running = opening;
    // The months the report's own period covers — `fyMonths` never existed, so
    // this threw the moment the screen rendered.
    return monthsInPeriod({ from: report.from, to: report.to }).map(({ label, ym }) => {
      const m = byMonth.get(ym) ?? { dr: 0, cr: 0 };
      running += m.dr - m.cr;
      return { label, ym, dr: m.dr, cr: m.cr, closing: running };
    });
  }, [entries, opening, report.from, report.to]);

  const totalDr = months.reduce((s, m) => s + m.dr, 0);
  const totalCr = months.reduce((s, m) => s + m.cr, 0);

  const monthEntries = useMemo(() => {
    if (!openMonth) return [];
    return entries
      .filter((e) => (e.voucher?.voucher_date || '').startsWith(openMonth))
      .filter((e) =>
        report.passesFilter({
          Particulars: e.narration || e.voucher?.narration || '',
          Narration: e.voucher?.narration || e.narration || '',
          'Vch Type': e.voucher?.voucher_type?.voucher_type_name ?? '',
          'Vch No.': e.voucher?.voucher_number ?? '',
        }),
      )
      .sort((a, b) => (a.voucher?.voucher_date || '').localeCompare(b.voucher?.voucher_date || ''));
  }, [entries, openMonth, report.passesFilter]);

  const monthOpening = useMemo(() => {
    if (!openMonth) return 0;
    const idx = months.findIndex((m) => m.ym === openMonth);
    return idx <= 0 ? opening : months[idx - 1].closing;
  }, [months, openMonth, opening]);

  // One cursor for whichever list is on screen — the ledgers, a ledger's
  // months, or a month's vouchers
  const { cursor, setCursor } = useRowCursor({
    count: !account ? ledgerRows.length : openMonth ? monthEntries.length : months.length,
    onEnter: (index) => {
      if (!account) {
        const ledger = ledgerRows[index];
        if (ledger) setSelectedId(ledger.id);
        return;
      }
      if (openMonth) {
        const voucherId = monthEntries[index]?.voucher?.id;
        if (voucherId) onOpenVoucher?.(voucherId);
        return;
      }
      const month = months[index];
      if (month && (month.dr || month.cr)) setOpenMonth(month.ym);
    },
  });

  return (
    <>
    <TallyScreen
      title={openMonth ? 'Ledger Vouchers' : account ? 'Ledger Monthly Summary' : 'Cash/Bank Book'}
      closeLabel="✕"
      onClose={openMonth ? () => setOpenMonth(null) : undefined}
      rail={report.rail}
      bottomBar={[
        { hotkey: 'Q', label: 'Quit', onClick: () => window.dispatchEvent(new CustomEvent('tally-escape')) },
        {
          hotkey: 'Space',
          label: 'Select',
          onClick: () => {
            const month = months[cursor];
            if (month && (month.dr || month.cr)) setOpenMonth(month.ym);
          },
          disabled: !!openMonth,
        },
        { hotkey: 'F12', label: 'Configure', onClick: () => window.dispatchEvent(new CustomEvent('tally-configure')) },
      ]}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        {!account ? (
          <>
            {/* Ledger list — Tally opens Cash/Bank Book on the ledgers themselves */}
            <div className="text-center">
              <div className="font-bold">{headerCompanyName}</div>
              <div className="text-[11px]">Closing balance as on {tallyDateLabel(fyTo)}</div>
            </div>
            <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
              <div className="min-w-0 flex-1 px-1">Particulars</div>
              <div className="w-44 px-1 text-right">Closing Balance</div>
            </div>
            {listLoading ? (
              <div className="py-10 text-center text-gray-400">Loading…</div>
            ) : (
              <>
                {ledgerGroups.map((group) => {
                  const groupTotal = group.items.reduce((sum, a) => sum + closingOf(a), 0);
                  return (
                    <React.Fragment key={group.name}>
                      <div className="mt-1.5 bg-[#eef3fa] px-1 font-bold">{group.name}</div>
                      {group.items.map((a) => {
                        const index = ledgerRows.findIndex((row) => row.id === a.id);
                        const balance = closingOf(a);
                        return (
                          <button
                            key={a.id}
                            type="button"
                            onMouseEnter={() => setCursor(index)}
                            onClick={() => setSelectedId(a.id)}
                            title={`Open ${a.account_name}`}
                            className={`flex w-full border-b border-dashed border-gray-200 text-left ${
                              cursor === index ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'
                            }`}
                          >
                            <div className="min-w-0 flex-1 px-1 pl-4">{a.account_name}</div>
                            <div className="w-44 px-1 text-right font-mono">
                              {report.fmtAmount(Math.abs(balance))} {balance < 0 ? 'Cr' : 'Dr'}
                            </div>
                          </button>
                        );
                      })}
                      <div className="flex border-b border-gray-400 font-semibold">
                        <div className="min-w-0 flex-1 px-1 pl-4 italic">Total — {group.name}</div>
                        <div className="w-44 px-1 text-right font-mono">
                          {report.fmtAmount(Math.abs(groupTotal))} {groupTotal < 0 ? 'Cr' : 'Dr'}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
                <div className="mt-2 flex border-t border-black pt-1 font-bold">
                  <div className="min-w-0 flex-1 px-1">Grand Total</div>
                  {(() => {
                    const total = ledgerRows.reduce((sum, a) => sum + closingOf(a), 0);
                    return (
                      <div className="w-44 px-1 text-right font-mono">
                        {report.fmtAmount(Math.abs(total))} {total < 0 ? 'Cr' : 'Dr'}
                      </div>
                    );
                  })()}
                </div>
              </>
            )}
          </>
        ) : openMonth ? (
          <>
            {/* Month drill-down: daily vouchers */}
            <div className="text-center">
              <div className="font-bold">{account.account_name}</div>
              <div className="text-[11px]">{months.find((m) => m.ym === openMonth)?.label}</div>
            </div>
            <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
              <div className="w-20 px-1">Date</div>
              <div className="min-w-0 flex-1 px-1">Particulars</div>
              <div className="w-28 px-1">Vch Type</div>
              <div className="w-28 px-1">Vch No.</div>
              <div className="w-10 px-1 text-center">Files</div>
              <div className="w-32 px-1 text-right">Debit</div>
              <div className="w-32 px-1 text-right">Credit</div>
            </div>
            <div className="flex border-b border-dashed border-gray-300 italic">
              <div className="w-20 px-1" />
              <div className="min-w-0 flex-1 px-1 font-semibold">Opening Balance</div>
              <div className="w-28 px-1" />
              <div className="w-28 px-1" />
              <div className="w-10 px-1" />
              <div className="w-32 px-1 text-right font-mono">
                {monthOpening > 0 ? report.fmtAmount(monthOpening) : ''}
              </div>
              <div className="w-32 px-1 text-right font-mono">
                {monthOpening < 0 ? report.fmtAmount(-monthOpening) : ''}
              </div>
            </div>
            {monthEntries.map((e, i) => (
              <div
                key={e.id}
                onClick={() => e.voucher?.id && onOpenVoucher?.(e.voucher.id)}
                onMouseEnter={() => setCursor(i)}
                title="Open voucher (alter)"
                className={`flex cursor-pointer border-b border-dashed border-gray-200 ${
                  cursor === i ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'
                }`}
              >
                <div className="w-20 px-1">{tallyDateLabel(e.voucher?.voucher_date || '')}</div>
                <div className="min-w-0 flex-1 truncate px-1">{e.narration || e.voucher?.narration || ''}</div>
                <div className="w-28 px-1">{e.voucher?.voucher_type?.voucher_type_name?.replace(' Voucher', '') || ''}</div>
                <div className="w-28 px-1 font-mono text-[12px]">{e.voucher?.voucher_number || ''}</div>
                <div className="w-10 px-1 text-center">
                  {e.voucher?.id && (
                    <VoucherAttachmentButton
                      attachments={attachmentMap.get(e.voucher.id) || []}
                      voucherNumber={e.voucher.voucher_number || ''}
                    />
                  )}
                </div>
                <div className="w-32 px-1 text-right font-mono">
                  {Number(e.debit_amount) > 0 ? report.fmtAmount(Number(e.debit_amount)) : ''}
                </div>
                <div className="w-32 px-1 text-right font-mono">
                  {Number(e.credit_amount) > 0 ? report.fmtAmount(Number(e.credit_amount)) : ''}
                </div>
              </div>
            ))}
            <div className="flex italic">
              <div className="w-20 px-1" />
              <div className="min-w-0 flex-1 px-1 font-semibold">Closing Balance</div>
              <div className="w-28 px-1" />
              <div className="w-28 px-1" />
              <div className="w-10 px-1" />
              {(() => {
                const c = months.find((m) => m.ym === openMonth)?.closing ?? 0;
                return (
                  <>
                    <div className="w-32 px-1 text-right font-mono">{c < 0 ? report.fmtAmount(-c) : ''}</div>
                    <div className="w-32 px-1 text-right font-mono">{c > 0 ? report.fmtAmount(c) : ''}</div>
                  </>
                );
              })()}
            </div>
          </>
        ) : (
          <>
            {/* Monthly summary, Tally style: Transactions + Closing Balance */}
            <div className="flex border-b border-black">
              <div className="flex flex-1 items-center px-1 font-semibold tracking-[0.3em]">Particulars</div>
              <div className="w-[340px] border-l border-gray-400 pt-1">
                <div className="text-center italic">{account.account_name}</div>
                <div className="truncate text-center font-bold">{headerCompanyName}</div>
                <div className="text-center">
                  {tallyDateLabel(fyFrom)} to {tallyDateLabel(fyTo)}
                </div>
                <div className="flex border-t border-gray-400 text-center font-semibold">
                  <div className="w-[230px] border-r border-gray-400">Transactions</div>
                  <div className="w-[110px]">Closing</div>
                </div>
                <div className="flex border-t border-gray-400 font-semibold">
                  <div className="w-[115px] pr-2 text-right">Debit</div>
                  <div className="w-[115px] border-r border-gray-400 pr-2 text-right">Credit</div>
                  <div className="w-[110px] pr-2 text-center">Balance</div>
                </div>
              </div>
            </div>
            <div className="flex pt-2 italic">
              <div className="min-w-0 flex-1 px-1">Opening Balance</div>
              <div className="flex w-[340px]">
                <div className="w-[115px]" />
                <div className="w-[115px]" />
                <div className="w-[110px] pr-2 text-right font-mono font-semibold">
                  {report.fmtAmount(Math.abs(opening))} {opening >= 0 ? 'Dr' : 'Cr'}
                </div>
              </div>
            </div>
            {isLoading ? (
              <div className="py-10 text-center text-gray-400">Loading…</div>
            ) : (
              <>
                {months.map((m, i) => (
                  <button
                    key={m.ym}
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => (m.dr || m.cr) && setOpenMonth(m.ym)}
                    className={`flex w-full text-left ${cursor === i ? 'bg-[#ffc423]' : ''}`}
                  >
                    <div className="min-w-0 flex-1 px-1">{m.label.split('-')[0]}</div>
                    <div className="flex w-[340px] italic">
                      <div className="w-[115px] pr-2 text-right font-mono">
                        {m.dr > 0 ? report.fmtAmount(m.dr) : ''}
                      </div>
                      <div className="w-[115px] pr-2 text-right font-mono">
                        {m.cr > 0 ? report.fmtAmount(m.cr) : ''}
                      </div>
                      <div className="w-[110px] pr-2 text-right font-mono">
                        {m.dr || m.cr
                          ? `${report.fmtAmount(Math.abs(m.closing))} ${m.closing >= 0 ? 'Dr' : 'Cr'}`
                          : ''}
                      </div>
                    </div>
                  </button>
                ))}
                <div className="mt-6 flex border-t border-black pt-0.5 font-bold">
                  <div className="min-w-0 flex-1 px-1 tracking-[0.3em]">Grand Total</div>
                  <div className="flex w-[340px]">
                    <div className="w-[115px] pr-2 text-right font-mono">{report.fmtAmount(totalDr)}</div>
                    <div className="w-[115px] pr-2 text-right font-mono">{report.fmtAmount(totalCr)}</div>
                    <div className="w-[110px] pr-2 text-right font-mono">
                      {report.fmtAmount(Math.abs(months[months.length - 1]?.closing ?? opening))}{' '}
                      {(months[months.length - 1]?.closing ?? opening) >= 0 ? 'Dr' : 'Cr'}
                    </div>
                  </div>
                </div>
                <MonthlyChart months={months} />
              </>
            )}
          </>
        )}
      </div>
    </TallyScreen>

    {report.popups}

    {ledgerPicker && (
      <TallyList
        title="List of Cash / Bank Ledgers"
        onClose={() => setLedgerPicker(false)}
        items={accounts.map((a) => ({
          label: a.account_name,
          active: a.id === selectedId,
          onSelect: () => {
            setSelectedId(a.id);
            setOpenMonth(null);
            setLedgerPicker(false);
          },
        }))}
      />
    )}
    </>
  );
};

export default CashBankBook;
