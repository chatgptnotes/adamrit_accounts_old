import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { TallyScreen } from './tally/TallyChrome';

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

/**
 * Cash/Bank Book — Tally Prime replica: pick a cash or bank ledger, see the
 * monthly summary (Debit/Credit totals + running Closing Balance per month,
 * Apr–Mar), and drill into any month for its daily vouchers.
 */
const CashBankBook: React.FC<{ onOpenVoucher?: (id: string) => void }> = ({ onOpenVoucher }) => {
  const [fyYear, setFyYear] = useState(currentFyStartYear);
  const [selectedId, setSelectedId] = useState('');
  const [openMonth, setOpenMonth] = useState<string | null>(null); // 'YYYY-MM'

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
  const fyFrom = `${fyYear}-04-01`;
  const fyTo = `${fyYear + 1}-03-31`;

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
    ? (Number(account.opening_balance) || 0) * (account.opening_balance_type === 'Cr' ? -1 : 1)
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
    <TallyScreen
      title={openMonth ? 'Ledger Vouchers' : 'Cash/Bank Book'}
      onClose={openMonth ? () => setOpenMonth(null) : undefined}
      rail={[
        {
          hotkey: 'F2',
          label: `FY ${fyYear}-${String(fyYear + 1).slice(2)}`,
          onClick: () => setFyYear((y) => (y === currentFyStartYear() ? y - 1 : currentFyStartYear())),
        },
        { hotkey: 'F3', label: 'Company', disabled: true },
        ...accounts.map((a, i) => ({
          label: a.account_name,
          gapBefore: i === 0,
          active: a.id === selectedId,
          onClick: () => {
            setSelectedId(a.id);
            setOpenMonth(null);
          },
        })),
        { hotkey: 'P', label: 'Print', onClick: () => window.print(), gapBefore: true },
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
            {/* Monthly summary, Tally style */}
            <div className="text-center">
              <div className="font-bold">{account.account_name}</div>
              <div className="text-[11px]">
                {tallyDateLabel(fyFrom)} to {tallyDateLabel(fyTo)}
              </div>
            </div>
            <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
              <div className="min-w-0 flex-1 px-1">Particulars</div>
              <div className="w-36 px-1 text-right">Debit</div>
              <div className="w-36 px-1 text-right">Credit</div>
              <div className="w-40 px-1 text-right">Closing Balance</div>
            </div>
            <div className="flex border-b border-dashed border-gray-300 italic">
              <div className="min-w-0 flex-1 px-1 font-semibold">Opening Balance</div>
              <div className="w-36 px-1" />
              <div className="w-36 px-1" />
              <div className="w-40 px-1 text-right font-mono">
                {fmt(Math.abs(opening))} {opening >= 0 ? 'Dr' : 'Cr'}
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
                    onClick={() => (m.dr || m.cr) && setOpenMonth(m.ym)}
                    className={`flex w-full border-b border-dashed border-gray-200 text-left ${
                      m.dr || m.cr ? 'hover:bg-[#fdf6d8]' : 'text-gray-400'
                    }`}
                  >
                    <div className="min-w-0 flex-1 px-1">{m.label}</div>
                    <div className="w-36 px-1 text-right font-mono">{m.dr > 0 ? fmt(m.dr) : ''}</div>
                    <div className="w-36 px-1 text-right font-mono">{m.cr > 0 ? fmt(m.cr) : ''}</div>
                    <div className="w-40 px-1 text-right font-mono">
                      {fmt(Math.abs(m.closing))} {m.closing >= 0 ? 'Dr' : 'Cr'}
                    </div>
                  </button>
                ))}
                <div className="mt-1 flex border-t border-black pt-0.5 font-bold">
                  <div className="min-w-0 flex-1 px-1 tracking-[0.2em]">Grand Total</div>
                  <div className="w-36 px-1 text-right font-mono">{fmt(totalDr)}</div>
                  <div className="w-36 px-1 text-right font-mono">{fmt(totalCr)}</div>
                  <div className="w-40 px-1" />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </TallyScreen>
  );
};

export default CashBankBook;
