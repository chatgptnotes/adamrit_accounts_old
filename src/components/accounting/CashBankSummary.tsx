import React, { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { accountMovements } from '@/lib/accountMovements';
import { optionalNetByAccount } from '@/lib/cashBankOptional';
import { fetchActiveAccounts } from '@/lib/fetchAccounts';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { useRowCursor } from './tally/useRowCursor';
import { useAccountingCompany } from './AccountingCompanyContext';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  opening_balance: number | null;
  opening_balance_type: string | null;
}

interface Amounts {
  dr: number;
  cr: number;
}

interface Row extends Amounts {
  key: string;
  kind: 'group' | 'ledger';
  name: string;
  /** Set on ledger lines, so Enter can drill into its vouchers */
  accountId?: string;
  /** One entry per comparison column added with C / A / N */
  cols: Amounts[];
}

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
  const { companies, selectedCompanyId } = useAccountingCompany();
  const [groupFilter, setGroupFilter] = useState(0);
  const [ledgerWise, setLedgerWise] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[][]>([]);

  const report = useTallyReport({
    filterFields: ['Particulars'],
    views: [
      { label: 'Cash/Bank Book', target: 'cash-bank-book' },
      { label: 'Group Summary', target: 'group-summary' },
      { label: 'Trial Balance', target: 'trial-balance' },
      { label: 'Bank Reconciliation', target: 'bank-reconciliation' },
    ],
    screenKeys: [
      {
        hotkey: 'F4',
        label: groupFilter === 0 ? 'Group' : GROUP_FILTERS[groupFilter],
        onClick: () => setGroupFilter((g) => (g + 1) % GROUP_FILTERS.length),
      },
      { hotkey: 'F5', label: 'Ledger-wise', active: ledgerWise, onClick: () => setLedgerWise((v) => !v) },
    ],
  });
  const { from: fromDate, to: toDate } = report;

  const { data: accounts = [] } = useQuery({
    queryKey: ['cash_bank_accounts', selectedCompanyId],
    enabled: !!selectedCompanyId,
    queryFn: async () => {
      // Banks are picked by GROUP, not by account-code prefix: Tally-imported
      // ledgers (State Bank of India, Pusad Urban, Shikshak Sahakari...) carry
      // TL... codes and were invisible to the old 111/112 prefix filter.
      const all = await fetchActiveAccounts<Account & { account_group: string | null; account_type: string }>({
        columns: 'id, account_code, account_name, account_group, account_type, opening_balance, opening_balance_type',
        companyId: selectedCompanyId,
      });
      return all.filter((a) => {
        const group = (a.account_group || '').toLowerCase();
        const liability = (a.account_type || '').toUpperCase().includes('LIABILIT');
        if (liability) return false; // Bank OD / loans live under Loans, as in Tally
        return (
          a.account_code.startsWith('111') ||
          a.account_code.startsWith('112') ||
          group.includes('cash') ||
          group.includes('bank')
        );
      });
    },
  });

  const accountIds = useMemo(() => accounts.map((a) => a.id), [accounts]);

  const movementsFor = async (upto: string, ids: string[]) => {
    const [movements, optionalNet] = await Promise.all([
      accountMovements({ upto, companyId: selectedCompanyId }),
      optionalNetByAccount({ upto, companyId: selectedCompanyId }),
    ]);
    const byAccount: Record<string, number> = {};
    for (const id of ids) {
      const m = movements.get(id);
      if (m) byAccount[id] = m.debit - m.credit;
      // Each cash/bank ledger shows its own transactions only, so the pharmacy
      // JVs come off here the same way the Cash/Bank Book drops them.
      const optional = optionalNet.get(id);
      if (optional) byAccount[id] = (byAccount[id] ?? 0) - optional;
    }
    return byAccount;
  };

  const { data: sums = {}, isLoading } = useQuery({
    queryKey: ['cash_bank_sums', selectedCompanyId, accountIds.join(','), toDate],
    enabled: !!selectedCompanyId && accountIds.length > 0,
    queryFn: () => movementsFor(toDate, accountIds),
  });

  // One query per comparison column added with C / A / N
  const columnSums = useQueries({
    queries: report.columns.map((c) => ({
      queryKey: ['cash_bank_sums', selectedCompanyId, accountIds.join(','), c.to],
      enabled: !!selectedCompanyId && accountIds.length > 0,
      queryFn: () => movementsFor(c.to, accountIds),
    })),
  });

  const closingIn = (a: Account, totals: Record<string, number>): number => {
    const opening = (Number(a.opening_balance) || 0) * (a.opening_balance_type?.toUpperCase() === 'CR' ? -1 : 1);
    return opening + (totals[a.id] ?? 0);
  };
  const closing = (a: Account): number => closingIn(a, sums);

  // Group + ledger lines as one flat list, so the cursor walks them like Tally
  const rows = useMemo(() => {
    const isCash = (a: Account & { account_group?: string | null }) =>
      a.account_code.startsWith('111') || ((a as any).account_group || '').toLowerCase().includes('cash');
    const groups = [
      { name: 'Cash-in-Hand', items: accounts.filter((a) => isCash(a)) },
      { name: 'Bank Accounts', items: accounts.filter((a) => !isCash(a)) },
    ].filter((g) => groupFilter === 0 || g.name === GROUP_FILTERS[groupFilter]);

    const columnTotals = columnSums.map((q) => q.data ?? {});
    const sides = (balance: number): Amounts => ({ dr: Math.max(0, balance), cr: Math.max(0, -balance) });

    const out: Row[] = [];
    for (const g of groups) {
      out.push({
        key: `g:${g.name}`,
        kind: 'group',
        name: g.name,
        dr: g.items.reduce((s, a) => s + Math.max(0, closing(a)), 0),
        cr: g.items.reduce((s, a) => s + Math.max(0, -closing(a)), 0),
        cols: columnTotals.map((totals) => ({
          dr: g.items.reduce((s, a) => s + Math.max(0, closingIn(a, totals)), 0),
          cr: g.items.reduce((s, a) => s + Math.max(0, -closingIn(a, totals)), 0),
        })),
      });
      if (!ledgerWise) continue;
      for (const a of g.items) {
        const bal = closing(a);
        // Basis of Values decides which balances are worth a line
        if (!report.passesBasis(bal)) continue;
        if (!report.passesFilter({ Particulars: a.account_name })) continue;
        out.push({
          key: `l:${a.id}`,
          kind: 'ledger',
          name: a.account_name,
          accountId: a.id,
          ...sides(bal),
          cols: columnTotals.map((totals) => sides(closingIn(a, totals))),
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    accounts,
    sums,
    columnSums.map((q) => q.dataUpdatedAt).join(','),
    groupFilter,
    ledgerWise,
    report.passesBasis,
    report.passesFilter,
  ]);

  const hidden = useMemo(() => new Set(removed.flat()), [removed]);
  const visible = useMemo(() => rows.filter((r) => !hidden.has(r.key)), [rows, hidden]);

  const grandDr = visible.filter((r) => r.kind === 'group').reduce((s, r) => s + r.dr, 0);
  const grandCr = visible.filter((r) => r.kind === 'group').reduce((s, r) => s + r.cr, 0);

  // Arrow keys walk the rows; Enter opens the ledger's Cash/Bank Book
  const { cursor, setCursor } = useRowCursor({
    count: visible.length,
    onEnter: (index) => {
      const row = visible[index];
      if (!row) return;
      if (row.kind === 'group') {
        // Tally drills a group line into its ledger breakup — the Cash/Bank
        // Book's ledger list is exactly that here.
        window.dispatchEvent(new CustomEvent('tally-goto', { detail: 'cash-bank-book' }));
        return;
      }
      if (row.accountId)
        window.dispatchEvent(new CustomEvent('tally-open-ledger', { detail: { accountId: row.accountId, monthly: true } }));
    },
  });

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

  const amountCells = (amounts: Amounts, className: string) => (
    <div className="flex w-[224px] shrink-0">
      <div className={`w-[112px] pr-2 text-right font-mono ${className}`}>
        {amounts.dr > 0 ? report.fmtAmount(amounts.dr) : ''}
      </div>
      <div className={`w-[112px] pr-2 text-right font-mono ${className}`}>
        {amounts.cr > 0 ? report.fmtAmount(amounts.cr) : ''}
      </div>
    </div>
  );

  const columnHeader = (subtitle: string) => (
    <div className="w-[224px] shrink-0 border-l border-gray-400 pt-1">
      <div className="text-center italic">
        {groupFilter === 0 ? 'Cash & Bank Accounts' : GROUP_FILTERS[groupFilter]}
      </div>
      <div className="truncate text-center font-bold">
        {companies.find((c) => c.id === selectedCompanyId)?.company_name ?? ''}
      </div>
      <div className="text-center">{subtitle}</div>
      <div className="border-t border-gray-400 text-center font-bold">Closing Balance</div>
      <div className="flex border-t border-gray-400 font-semibold">
        <div className="w-[112px] pr-2 text-right">Debit</div>
        <div className="w-[112px] pr-2 text-right">Credit</div>
      </div>
    </div>
  );

  return (
    <>
      <TallyScreen
        title="Cash/Bank Summary"
        closeLabel="✕"
        onClose={onClose}
        rail={report.rail}
        bottomBar={[
          { hotkey: 'Q', label: 'Quit', onClick: () => (onClose ? onClose() : window.dispatchEvent(new CustomEvent('tally-escape'))) },
          { hotkey: 'Space', label: 'Select', onClick: toggleSelect },
          { hotkey: 'R', label: 'Remove Line', onClick: removeLine },
          { hotkey: 'U', label: 'Restore Line', onClick: restoreLine, disabled: removed.length === 0 },
          { hotkey: 'F12', label: 'Configure', onClick: () => window.dispatchEvent(new CustomEvent('tally-configure')) },
        ]}
      >
        <div className="flex min-h-[calc(100vh-140px)] min-w-max flex-col px-3 pb-2 pt-1 text-[13px]">
          {/* Column header block */}
          <div className="flex border-b border-black">
            <div className="flex w-64 flex-1 items-center pl-1 font-semibold tracking-[0.3em]">Particulars</div>
            {columnHeader(`${tallyDateLabel(fromDate)} to ${tallyDateLabel(toDate)}`)}
            {report.columns.map((c) => (
              <React.Fragment key={c.id}>{columnHeader(c.title)}</React.Fragment>
            ))}
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
                    onClick={() => {
                      setCursor(i);
                      if (row.accountId) {
                        window.dispatchEvent(new CustomEvent('tally-open-ledger', { detail: { accountId: row.accountId, monthly: true } }));
                      }
                    }}
                    className={`flex w-full text-left ${
                      isCursor ? 'bg-[#ffc423]' : isSelected ? 'bg-[#fdf0b8]' : ''
                    }`}
                  >
                    <div
                      className={`w-64 min-w-0 flex-1 truncate pl-1 ${
                        row.kind === 'group' ? 'font-bold' : 'pl-4 italic'
                      }`}
                    >
                      {row.name}
                    </div>
                    {amountCells(row, row.kind === 'group' ? 'font-semibold' : 'italic')}
                    {row.cols.map((amounts, ci) => (
                      <React.Fragment key={report.columns[ci].id}>
                        {amountCells(amounts, row.kind === 'group' ? 'font-semibold' : 'italic')}
                      </React.Fragment>
                    ))}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-auto flex border-t border-black pt-1 font-bold">
            <div className="w-64 flex-1 pl-1 tracking-[0.3em]">Grand Total</div>
            {amountCells({ dr: grandDr, cr: grandCr }, '')}
            {report.columns.map((c, ci) => {
              const groups = visible.filter((r) => r.kind === 'group');
              return (
                <React.Fragment key={c.id}>
                  {amountCells(
                    {
                      dr: groups.reduce((s, r) => s + (r.cols[ci]?.dr ?? 0), 0),
                      cr: groups.reduce((s, r) => s + (r.cols[ci]?.cr ?? 0), 0),
                    },
                    '',
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </TallyScreen>

      {report.popups}
    </>
  );
};

export default CashBankSummary;
