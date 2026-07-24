import React, { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { useRowCursor } from './tally/useRowCursor';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  parent_account_id: string | null;
}

interface EntryRow {
  id: string;
  debit_amount: number | null;
  credit_amount: number | null;
  bill_ref: string | null;
  voucher: { id: string; voucher_number: string; voucher_date: string } | null;
}


const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

/**
 * Bill-wise Outstandings — Tally's ledger outstandings: entries on a party
 * ledger grouped by bill reference (New Ref / Against Ref), pending amount
 * per bill with days, un-referenced amounts shown as On Account.
 */
const BillwiseOutstanding: React.FC<{ onOpenVoucher?: (id: string) => void }> = ({ onOpenVoucher }) => {
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const report = useTallyReport({
    filterFields: ['Ref. No.'],
    views: [
      { label: 'Bills Receivable', target: 'bills-receivable' },
      { label: 'Bills Payable', target: 'bills-payable' },
      { label: 'Ledger Vouchers', target: 'ledger-view' },
      { label: 'Bill Aging Statement', target: 'bill-aging' },
    ],
    screenKeys: [
      {
        hotkey: 'F4',
        label: 'Ledger',
        onClick: () => {
          setSelectedId('');
          setSearch('');
          setTimeout(() => inputRef.current?.focus(), 0);
        },
      },
    ],
  });
  const fmt = report.fmtAmount;

  const { data: accounts = [] } = useQuery({
    queryKey: ['chart_of_accounts_leaves_bw'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, parent_account_id')
        .eq('is_active', true)
        .order('account_code');
      if (error) throw error;
      const parents = new Set((data ?? []).map((a: any) => a.parent_account_id).filter(Boolean));
      return ((data ?? []) as Account[]).filter((a) => !parents.has(a.id));
    },
  });

  const account = accounts.find((a) => a.id === selectedId) || null;

  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? accounts.filter((a) => a.account_name.toLowerCase().includes(q) || a.account_code.includes(q))
      : accounts;
    return list.slice(0, 15);
  }, [accounts, search]);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['billwise', selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const data = await fetchAllRows((from, to) =>
        (supabase as any)
          .from('voucher_entries')
          .select('id, debit_amount, credit_amount, bill_ref, voucher:vouchers!inner(id, voucher_number, voucher_date, status)')
          .eq('account_id', selectedId)
          .eq('voucher.status', 'AUTHORISED')
          .range(from, to),
      );
      return data as unknown as EntryRow[];
    },
  });

  const bills = useMemo(() => {
    const byRef = new Map<string, { pending: number; first: string; entries: EntryRow[] }>();
    for (const e of entries) {
      const ref = e.bill_ref?.trim() || 'On Account';
      const g = byRef.get(ref) ?? { pending: 0, first: e.voucher?.voucher_date ?? '', entries: [] };
      g.pending += (Number(e.debit_amount) || 0) - (Number(e.credit_amount) || 0);
      if (e.voucher?.voucher_date && (!g.first || e.voucher.voucher_date < g.first)) g.first = e.voucher.voucher_date;
      g.entries.push(e);
      byRef.set(ref, g);
    }
    return [...byRef.entries()]
      .map(([ref, g]) => ({ ref, ...g, days: Math.floor((Date.now() - new Date(g.first).getTime()) / 86400000) }))
      .filter((b) => report.passesBasis(b.pending) && report.passesFilter({ 'Ref. No.': b.ref }))
      .sort((a, b) => Math.abs(b.pending) - Math.abs(a.pending));
  }, [entries, report.passesBasis, report.passesFilter]);

  const total = bills.reduce((s, b) => s + b.pending, 0);

  const { cursor, setCursor } = useRowCursor({
    count: bills.length,
    enabled: !open,
    onEnter: (index) => {
      const voucherId = bills[index]?.entries[0]?.voucher?.id;
      if (voucherId) onOpenVoucher?.(voucherId);
    },
  });

  return (
    <>
    <TallyScreen title="Bill-wise Outstandings" rail={report.rail}>
      <div className="px-3 pb-4 pt-1 text-[13px]">
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
                if (selectedId) setSelectedId('');
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
                  setSelectedId(options[highlight].id);
                  setSearch(options[highlight].account_name);
                  setOpen(false);
                }
              }}
              className="h-7 w-full border-0 border-b border-dashed border-gray-400 bg-transparent px-1 font-semibold focus:border-solid focus:border-blue-600 focus:outline-none"
            />
            {open && options.length > 0 && (
              <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto border bg-[#eef3fa] shadow-lg">
                <div className="border-b bg-[#16437e] px-3 py-1 text-xs font-semibold text-white">List of Ledger Accounts</div>
                {options.map((a, i) => (
                  <button
                    key={a.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setSelectedId(a.id);
                      setSearch(a.account_name);
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

        {!account ? (
          <div className="py-16 text-center text-gray-400">
            Select a party ledger — bills entered with a Ref on voucher lines appear here bill-by-bill.
          </div>
        ) : (
          <>
            <div className="mt-2 text-center">
              <div className="font-bold">{account.account_name}</div>
              <div className="text-[11px]">bill-wise pending as at {tallyDateLabel(new Date().toISOString().slice(0, 10))}</div>
            </div>
            <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
              <div className="w-24 px-1">Date</div>
              <div className="min-w-0 flex-1 px-1">Ref. No.</div>
              <div className="w-24 px-1 text-right">Entries</div>
              <div className="w-40 px-1 text-right">Pending Amount</div>
              <div className="w-24 px-1 text-right">Days</div>
            </div>
            {isLoading ? (
              <div className="py-10 text-center text-gray-400">Loading…</div>
            ) : bills.length === 0 ? (
              <div className="py-10 text-center text-gray-400">Nothing pending on this ledger.</div>
            ) : (
              <>
                {bills.map((b, i) => (
                  <button
                    key={b.ref}
                    type="button"
                    onClick={() => b.entries[0]?.voucher?.id && onOpenVoucher?.(b.entries[0].voucher.id)}
                    onMouseEnter={() => setCursor(i)}
                    title="Open first voucher of this bill"
                    className={`flex w-full border-b border-dashed border-gray-200 text-left ${
                      cursor === i ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'
                    }`}
                  >
                    <div className="w-24 shrink-0 px-1">{b.first ? tallyDateLabel(b.first) : ''}</div>
                    <div className={`min-w-0 flex-1 truncate px-1 ${b.ref === 'On Account' ? 'italic text-gray-500' : 'font-semibold'}`}>
                      {b.ref}
                    </div>
                    <div className="w-24 shrink-0 px-1 text-right font-mono">{b.entries.length}</div>
                    <div className="w-40 shrink-0 px-1 text-right font-mono">
                      {fmt(Math.abs(b.pending))} {b.pending >= 0 ? 'Dr' : 'Cr'}
                    </div>
                    <div className="w-24 shrink-0 px-1 text-right font-mono">{b.days}</div>
                  </button>
                ))}
                <div className="mt-1 flex border-t border-black pt-0.5 font-bold">
                  <div className="w-24 px-1" />
                  <div className="min-w-0 flex-1 px-1 tracking-[0.2em]">Total — {bills.length} bill(s)</div>
                  <div className="w-24 px-1" />
                  <div className="w-40 px-1 text-right font-mono">
                    {fmt(Math.abs(total))} {total >= 0 ? 'Dr' : 'Cr'}
                  </div>
                  <div className="w-24 px-1" />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </TallyScreen>

    {report.popups}
    </>
  );
};

export default BillwiseOutstanding;
