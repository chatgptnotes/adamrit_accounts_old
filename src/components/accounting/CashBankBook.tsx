import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { TallyScreen } from './tally/TallyChrome';
import ChangePeriod from './tally/ChangePeriod';
import { useAccountingCompanyOptional } from './AccountingCompanyContext';

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

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

// Financial year months Apr..Mar as {label, ym}
const fyMonths = (fyStartYear: number): { label: string; ym: string }[] => {
  const out: { label: string; ym: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const m = 3 + i; // 0-based month index from April
    const year = fyStartYear + (m > 11 ? 1 : 0);
    const month = (m % 12) + 1;
    const d = new Date(year, month - 1, 1);
    out.push({
      label: d.toLocaleDateString('en-GB', { month: 'long', year: '2-digit' }).replace(' ', '-'),
      ym: `${year}-${String(month).padStart(2, '0')}`,
    });
  }
  return out;
};

const currentFyStartYear = (): number => {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
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
  const accountingCompany = useAccountingCompanyOptional();
  const headerCompanyName =
    accountingCompany?.companies.find((c) => c.id === accountingCompany.selectedCompanyId)?.company_name ?? '';
  const [fromDate, setFromDate] = useState(() => `${currentFyStartYear()}-04-01`);
  const [toDate, setToDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [showPeriod, setShowPeriod] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [openMonth, setOpenMonth] = useState<string | null>(null); // 'YYYY-MM'
  // Tally parks its row cursor on the current month
  const [cursorYm, setCursorYm] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // Cash-in-hand + bank ledgers (codes 111x / 112x)
  const { data: accounts = [] } = useQuery({
    queryKey: ['cash_bank_accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, opening_balance, opening_balance_type')
        .eq('is_active', true)
        .or('account_code.like.111%,account_code.like.112%')
        .order('account_code');
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });

  const account = accounts.find((a) => a.id === selectedId) || null;
  // The monthly grid always spans the financial year the period starts in
  const fyYear = Number(fromDate.slice(0, 4)) - (Number(fromDate.slice(5, 7)) >= 4 ? 0 : 1);
  const fyFrom = fromDate;
  const fyTo = toDate;

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['cash_bank_book', selectedId, fyFrom, fyTo],
    enabled: !!selectedId,
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
          .eq('account_id', selectedId)
          .eq('voucher.status', 'AUTHORISED')
          .gte('voucher.voucher_date', fyFrom)
          .lte('voucher.voucher_date', fyTo)
          .order('created_at', { ascending: true })
          .range(from, to),
      );
      return data as unknown as EntryRow[];
    },
  });

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
    return fyMonths(fyYear).map(({ label, ym }) => {
      const m = byMonth.get(ym) ?? { dr: 0, cr: 0 };
      running += m.dr - m.cr;
      return { label, ym, dr: m.dr, cr: m.cr, closing: running };
    });
  }, [entries, opening, fyYear]);

  const totalDr = months.reduce((s, m) => s + m.dr, 0);
  const totalCr = months.reduce((s, m) => s + m.cr, 0);

  const monthEntries = useMemo(() => {
    if (!openMonth) return [];
    return entries
      .filter((e) => (e.voucher?.voucher_date || '').startsWith(openMonth))
      .sort((a, b) => (a.voucher?.voucher_date || '').localeCompare(b.voucher?.voucher_date || ''));
  }, [entries, openMonth]);

  const monthOpening = useMemo(() => {
    if (!openMonth) return 0;
    const idx = months.findIndex((m) => m.ym === openMonth);
    return idx <= 0 ? opening : months[idx - 1].closing;
  }, [months, openMonth, opening]);

  return (
    <>
    <TallyScreen
      title={openMonth ? 'Ledger Vouchers' : account ? 'Ledger Monthly Summary' : 'Cash/Bank Book'}
      closeLabel="✕"
      onClose={openMonth ? () => setOpenMonth(null) : undefined}
      rail={[
        { hotkey: 'F2', label: 'Period', onClick: () => setShowPeriod(true) },
        { hotkey: 'F3', label: 'Company', onClick: accountingCompany?.cycleCompany },
        { hotkey: 'F4', label: 'Ledger', disabled: true },
        ...accounts.map((a, i) => ({
          label: a.account_name,
          gapBefore: i === 0,
          active: a.id === selectedId,
          onClick: () => {
            setSelectedId(a.id);
            setOpenMonth(null);
          },
        })),
        { hotkey: 'F6', label: 'Monthly', active: !openMonth, onClick: () => setOpenMonth(null), gapBefore: true },
        { hotkey: 'B', label: 'Basis of Values', disabled: true, gapBefore: true },
        { hotkey: 'H', label: 'Change View', disabled: true },
        {
          hotkey: 'J',
          label: 'Exception Reports',
          onClick: () => window.dispatchEvent(new CustomEvent('tally-goto', { detail: 'exception-reports' })),
        },
        { hotkey: 'L', label: 'Save View', onClick: () => window.dispatchEvent(new CustomEvent('tally-save-view')) },
        { hotkey: 'P', label: 'Print', onClick: () => window.print(), gapBefore: true },
      ]}
      bottomBar={[
        { hotkey: 'Q', label: 'Quit', onClick: () => window.dispatchEvent(new CustomEvent('tally-escape')) },
        {
          hotkey: 'Space',
          label: 'Select',
          onClick: () => {
            const month = months.find((m) => m.ym === cursorYm);
            if (month && (month.dr || month.cr)) setOpenMonth(month.ym);
          },
          disabled: !!openMonth,
        },
        { hotkey: 'F12', label: 'Configure', onClick: () => window.dispatchEvent(new CustomEvent('tally-configure')) },
      ]}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        {!account ? (
          <div className="py-16 text-center text-gray-400">
            Select a cash or bank ledger from the panel on the right.
          </div>
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
              <div className="w-32 px-1 text-right">Debit</div>
              <div className="w-32 px-1 text-right">Credit</div>
            </div>
            <div className="flex border-b border-dashed border-gray-300 italic">
              <div className="w-20 px-1" />
              <div className="min-w-0 flex-1 px-1 font-semibold">Opening Balance</div>
              <div className="w-28 px-1" />
              <div className="w-28 px-1" />
              <div className="w-32 px-1 text-right font-mono">{monthOpening > 0 ? fmt(monthOpening) : ''}</div>
              <div className="w-32 px-1 text-right font-mono">{monthOpening < 0 ? fmt(-monthOpening) : ''}</div>
            </div>
            {monthEntries.map((e) => (
              <div
                key={e.id}
                onClick={() => e.voucher?.id && onOpenVoucher?.(e.voucher.id)}
                title="Open voucher (alter)"
                className="flex cursor-pointer border-b border-dashed border-gray-200 hover:bg-[#fdf6d8]"
              >
                <div className="w-20 px-1">{tallyDateLabel(e.voucher?.voucher_date || '')}</div>
                <div className="min-w-0 flex-1 truncate px-1">{e.narration || e.voucher?.narration || ''}</div>
                <div className="w-28 px-1">{e.voucher?.voucher_type?.voucher_type_name?.replace(' Voucher', '') || ''}</div>
                <div className="w-28 px-1 font-mono text-[12px]">{e.voucher?.voucher_number || ''}</div>
                <div className="w-32 px-1 text-right font-mono">
                  {Number(e.debit_amount) > 0 ? fmt(Number(e.debit_amount)) : ''}
                </div>
                <div className="w-32 px-1 text-right font-mono">
                  {Number(e.credit_amount) > 0 ? fmt(Number(e.credit_amount)) : ''}
                </div>
              </div>
            ))}
            <div className="flex italic">
              <div className="w-20 px-1" />
              <div className="min-w-0 flex-1 px-1 font-semibold">Closing Balance</div>
              <div className="w-28 px-1" />
              <div className="w-28 px-1" />
              {(() => {
                const c = months.find((m) => m.ym === openMonth)?.closing ?? 0;
                return (
                  <>
                    <div className="w-32 px-1 text-right font-mono">{c < 0 ? fmt(-c) : ''}</div>
                    <div className="w-32 px-1 text-right font-mono">{c > 0 ? fmt(c) : ''}</div>
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
                  {fmt(Math.abs(opening))} {opening >= 0 ? 'Dr' : 'Cr'}
                </div>
              </div>
            </div>
            {isLoading ? (
              <div className="py-10 text-center text-gray-400">Loading…</div>
            ) : (
              <>
                {months.map((m) => (
                  <button
                    key={m.ym}
                    type="button"
                    onMouseEnter={() => setCursorYm(m.ym)}
                    onClick={() => (m.dr || m.cr) && setOpenMonth(m.ym)}
                    className={`flex w-full text-left ${cursorYm === m.ym ? 'bg-[#ffc423]' : ''}`}
                  >
                    <div className="min-w-0 flex-1 px-1">{m.label.split('-')[0]}</div>
                    <div className="flex w-[340px] italic">
                      <div className="w-[115px] pr-2 text-right font-mono">{m.dr > 0 ? fmt(m.dr) : ''}</div>
                      <div className="w-[115px] pr-2 text-right font-mono">{m.cr > 0 ? fmt(m.cr) : ''}</div>
                      <div className="w-[110px] pr-2 text-right font-mono">
                        {m.dr || m.cr ? `${fmt(Math.abs(m.closing))} ${m.closing >= 0 ? 'Dr' : 'Cr'}` : ''}
                      </div>
                    </div>
                  </button>
                ))}
                <div className="mt-6 flex border-t border-black pt-0.5 font-bold">
                  <div className="min-w-0 flex-1 px-1 tracking-[0.3em]">Grand Total</div>
                  <div className="flex w-[340px]">
                    <div className="w-[115px] pr-2 text-right font-mono">{fmt(totalDr)}</div>
                    <div className="w-[115px] pr-2 text-right font-mono">{fmt(totalCr)}</div>
                    <div className="w-[110px] pr-2 text-right font-mono">
                      {fmt(Math.abs(months[months.length - 1]?.closing ?? opening))}{' '}
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

    {showPeriod && (
      <ChangePeriod
        from={fromDate}
        to={toDate}
        onAccept={(nextFrom, nextTo) => {
          setFromDate(nextFrom);
          setToDate(nextTo);
          setShowPeriod(false);
        }}
        onClose={() => setShowPeriod(false)}
      />
    )}
    </>
  );
};

export default CashBankBook;
