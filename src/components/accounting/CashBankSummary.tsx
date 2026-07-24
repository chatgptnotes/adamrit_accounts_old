import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { accountMovements } from '@/lib/accountMovements';
import { format } from 'date-fns';
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

interface Row {
  key: string;
  kind: 'group' | 'ledger';
  name: string;
  dr: number;
  cr: number;
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const fyStart = (): string => {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-04-01`;
};

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

const GROUP_FILTERS = ['All Items', 'Cash-in-Hand', 'Bank Accounts'] as const;

/**
 * Cash/Bank Summary — replica of Tally's report: Cash-in-Hand and Bank
 * Accounts groups with ledger-wise closing balances in Debit/Credit columns,
 * a highlighted row cursor, Space to select and R/U to remove/restore lines.
 */
const CashBankSummary: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const accountingCompany = useAccountingCompanyOptional();
  const [fromDate, setFromDate] = useState(fyStart);
  const [toDate, setToDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showPeriod, setShowPeriod] = useState(false);
  const [groupFilter, setGroupFilter] = useState(0);
  const [ledgerWise, setLedgerWise] = useState(true);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[][]>([]);

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

  const accountIds = useMemo(() => accounts.map((a) => a.id), [accounts]);

  const { data: sums = {}, isLoading } = useQuery({
    queryKey: ['cash_bank_sums', accountIds.join(','), toDate],
    enabled: accountIds.length > 0,
    queryFn: async () => {
      const movements = await accountMovements({ upto: toDate });
      const byAccount: Record<string, number> = {};
      for (const id of accountIds) {
        const m = movements.get(id);
        if (m) byAccount[id] = m.debit - m.credit;
      }
      return byAccount;
    },
  });

  const closing = (a: Account): number => {
    const opening = (Number(a.opening_balance) || 0) * (a.opening_balance_type?.toUpperCase() === 'CR' ? -1 : 1);
    return opening + (sums[a.id] ?? 0);
  };

  // Group + ledger lines as one flat list, so the cursor walks them like Tally
  const rows = useMemo(() => {
    const groups = [
      { name: 'Cash-in-Hand', items: accounts.filter((a) => a.account_code.startsWith('111')) },
      { name: 'Bank Accounts', items: accounts.filter((a) => a.account_code.startsWith('112')) },
    ].filter((g) => groupFilter === 0 || g.name === GROUP_FILTERS[groupFilter]);

    const out: Row[] = [];
    for (const g of groups) {
      out.push({
        key: `g:${g.name}`,
        kind: 'group',
        name: g.name,
        dr: g.items.reduce((s, a) => s + Math.max(0, closing(a)), 0),
        cr: g.items.reduce((s, a) => s + Math.max(0, -closing(a)), 0),
      });
      if (!ledgerWise) continue;
      for (const a of g.items) {
        const bal = closing(a);
        if (bal === 0) continue;
        out.push({
          key: `l:${a.id}`,
          kind: 'ledger',
          name: a.account_name,
          dr: Math.max(0, bal),
          cr: Math.max(0, -bal),
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, sums, groupFilter, ledgerWise]);

  const hidden = useMemo(() => new Set(removed.flat()), [removed]);
  const visible = useMemo(() => rows.filter((r) => !hidden.has(r.key)), [rows, hidden]);

  const grandDr = visible.filter((r) => r.kind === 'group').reduce((s, r) => s + r.dr, 0);
  const grandCr = visible.filter((r) => r.kind === 'group').reduce((s, r) => s + r.cr, 0);

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, visible.length - 1)));
  }, [visible.length]);

  // Arrow keys move the row cursor (Space / R / U are bound by the key bar)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showPeriod || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      setCursor((c) => Math.max(0, Math.min(visible.length - 1, c + (e.key === 'ArrowDown' ? 1 : -1))));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible.length, showPeriod]);

  const toggleSelect = () => {
    const row = visible[cursor];
    if (!row) return;
    setSelected((s) => (s.includes(row.key) ? s.filter((k) => k !== row.key) : [...s, row.key]));
  };

  const removeLine = () => {
    const keys = selected.length > 0 ? selected : visible[cursor] ? [visible[cursor].key] : [];
    if (keys.length === 0) return;
    setRemoved((r) => [...r, keys]);
    setSelected([]);
  };

  const restoreLine = () => setRemoved((r) => r.slice(0, -1));

  const amountCells = (row: Row, className: string) => (
    <>
      <div className={`w-[112px] pr-2 text-right font-mono ${className}`}>{row.dr > 0 ? fmt(row.dr) : ''}</div>
      <div className={`w-[112px] pr-2 text-right font-mono ${className}`}>{row.cr > 0 ? fmt(row.cr) : ''}</div>
    </>
  );

  return (
    <>
      <TallyScreen
        title="Cash/Bank Summary"
        closeLabel="✕"
        onClose={onClose}
        rail={[
          { hotkey: 'F2', label: 'Period', onClick: () => setShowPeriod(true) },
          { hotkey: 'F3', label: 'Company', onClick: accountingCompany?.cycleCompany },
          {
            hotkey: 'F4',
            label: groupFilter === 0 ? 'Group' : GROUP_FILTERS[groupFilter],
            onClick: () => setGroupFilter((g) => (g + 1) % GROUP_FILTERS.length),
          },
          { hotkey: 'F5', label: 'Ledger-wise', active: ledgerWise, onClick: () => setLedgerWise((v) => !v), gapBefore: true },
          { hotkey: 'F6', label: '', disabled: true },
          { hotkey: 'F7', label: '', disabled: true },
          { hotkey: 'F8', label: '', disabled: true },
          { hotkey: 'F9', label: '', disabled: true },
          { hotkey: 'F10', label: '', disabled: true },
          { hotkey: 'B', label: 'Basis of Values', disabled: true, gapBefore: true },
          { hotkey: 'H', label: 'Change View', disabled: true },
          {
            hotkey: 'J',
            label: 'Exception Reports',
            onClick: () => window.dispatchEvent(new CustomEvent('tally-goto', { detail: 'exception-reports' })),
          },
          { hotkey: 'L', label: 'Save View', onClick: () => window.dispatchEvent(new CustomEvent('tally-save-view')) },
          {
            hotkey: 'F',
            label: 'Apply Filter',
            onClick: () => setGroupFilter((g) => (g + 1) % GROUP_FILTERS.length),
            gapBefore: true,
          },
          { hotkey: 'F', label: 'Filter Details', disabled: true },
          { hotkey: 'C', label: 'New Column', disabled: true, gapBefore: true },
          { hotkey: 'A', label: 'Alter Column', disabled: true },
          { hotkey: 'D', label: 'Delete Column', disabled: true },
          { hotkey: 'N', label: 'Auto Column', disabled: true },
        ]}
        bottomBar={[
          { hotkey: 'Q', label: 'Quit', onClick: () => (onClose ? onClose() : window.dispatchEvent(new CustomEvent('tally-escape'))) },
          { hotkey: 'Space', label: 'Select', onClick: toggleSelect },
          { hotkey: 'R', label: 'Remove Line', onClick: removeLine },
          { hotkey: 'U', label: 'Restore Line', onClick: restoreLine, disabled: removed.length === 0 },
          { hotkey: 'F12', label: 'Configure', onClick: () => window.dispatchEvent(new CustomEvent('tally-configure')) },
        ]}
      >
        <div className="flex min-h-[calc(100vh-140px)] flex-col px-3 pb-2 pt-1 text-[13px]">
          {/* Column header block */}
          <div className="flex border-b border-black">
            <div className="flex flex-1 items-center pl-1 font-semibold tracking-[0.3em]">Particulars</div>
            <div className="w-[224px] border-l border-gray-400 pt-1">
              <div className="text-center italic">
                {groupFilter === 0 ? 'Cash & Bank Accounts' : GROUP_FILTERS[groupFilter]}
              </div>
              <div className="truncate text-center font-bold">
                {accountingCompany?.companies.find((c) => c.id === accountingCompany.selectedCompanyId)?.company_name ?? ''}
              </div>
              <div className="text-center">
                {tallyDateLabel(fromDate)} to {tallyDateLabel(toDate)}
              </div>
              <div className="border-t border-gray-400 text-center font-bold">Closing Balance</div>
              <div className="flex border-t border-gray-400 font-semibold">
                <div className="w-[112px] pr-2 text-right">Debit</div>
                <div className="w-[112px] pr-2 text-right">Credit</div>
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="py-10 text-center text-gray-400">Loading…</div>
          ) : (
            <div className="pt-2">
              {visible.map((row, i) => {
                const isCursor = i === cursor;
                const isSelected = selected.includes(row.key);
                return (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => setCursor(i)}
                    className={`flex w-full text-left ${
                      isCursor ? 'bg-[#ffc423]' : isSelected ? 'bg-[#fdf0b8]' : ''
                    }`}
                  >
                    <div
                      className={`min-w-0 flex-1 truncate pl-1 ${
                        row.kind === 'group' ? 'font-bold' : 'pl-4 italic'
                      }`}
                    >
                      {row.name}
                    </div>
                    <div className="flex w-[224px]">
                      {amountCells(row, row.kind === 'group' ? 'font-semibold' : 'italic')}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-auto flex border-t border-black pt-1 font-bold">
            <div className="flex-1 pl-1 tracking-[0.3em]">Grand Total</div>
            <div className="flex w-[224px]">
              <div className="w-[112px] pr-2 text-right font-mono">{fmt(grandDr)}</div>
              <div className="w-[112px] pr-2 text-right font-mono">{fmt(grandCr)}</div>
            </div>
          </div>
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

export default CashBankSummary;
