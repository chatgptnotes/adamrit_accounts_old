import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchActiveAccounts } from '@/lib/fetchAccounts';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { useRowCursor } from './tally/useRowCursor';
import { HEAD_ORDER, headOfType } from './tally/heads';
import { useAccountingCompany } from './AccountingCompanyContext';

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

interface AccountLite {
  id: string;
  account_name: string;
  account_type: string;
  account_group: string | null;
}

interface EntryRow {
  entryId: string;
  voucherId: string;
  date: string;
  ledgerName: string;
  vchType: string;
  vchNo: string;
  debit: number;
  credit: number;
}

/**
 * Group Vouchers — Tally Prime replica: pick a group (a primary head or a
 * custom group), see every voucher entry that touched a ledger of that group
 * in the period, columns Date | Particulars (ledger) | Vch Type | Vch No. |
 * Debit | Credit, with totals. Enter opens the voucher in Alteration.
 */
const GroupVouchers: React.FC<{ onOpenVoucher?: (id: string) => void }> = ({ onOpenVoucher }) => {
  const { selectedCompanyId } = useAccountingCompany();
  const [group, setGroup] = useState<string | null>(null);

  const report = useTallyReport({
    supportsColumns: false,
    filterFields: ['Particulars', 'Vch No.'],
    views: [
      { label: 'Group Summary', target: 'group-summary' },
      { label: 'Day Book', target: 'day-book' },
      { label: 'Ledger Vouchers', target: 'ledger-view' },
      { label: 'Trial Balance', target: 'trial-balance' },
    ],
    screenKeys: [{ hotkey: 'F4', label: 'Group', onClick: () => setGroup(null) }],
    exportData: () => ({
      title: `Group Vouchers${group ? ` — ${group}` : ''}`,
      period: report.periodLabel,
      columns: ['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit', 'Credit'],
      rows: entries.map((e) => [e.date, e.ledgerName, e.vchType, e.vchNo, e.debit, e.credit]),
    }),
  });
  const { from: fromDate, to: toDate, fmtAmount: fmt } = report;

  const { data: accounts = [] } = useQuery({
    queryKey: ['group-vouchers-accounts', selectedCompanyId],
    enabled: !!selectedCompanyId,
    staleTime: 60_000,
    queryFn: () =>
      fetchActiveAccounts<AccountLite>({
        columns: 'id, account_name, account_type, account_group',
        companyId: selectedCompanyId,
      }),
  });

  // List of Groups: the primary heads plus every custom account_group,
  // indented under its head — same list Group Summary offers.
  const groupList = useMemo(() => {
    const byHead = new Map<string, Set<string>>();
    for (const a of accounts) {
      const head = headOfType(a.account_type);
      const g = (a.account_group || '').trim();
      if (!head || !g || g === head) continue;
      const set = byHead.get(head) || new Set<string>();
      set.add(g);
      byHead.set(head, set);
    }
    const items: { label: string; isHead: boolean }[] = [];
    for (const h of HEAD_ORDER) {
      items.push({ label: h, isHead: true });
      for (const g of [...(byHead.get(h) || [])].sort((a, b) => a.localeCompare(b))) {
        items.push({ label: g, isHead: false });
      }
    }
    return items;
  }, [accounts]);

  const groupLedgers = useMemo(() => {
    if (!group) return [];
    const isHead = HEAD_ORDER.includes(group);
    return accounts.filter((a) =>
      isHead ? headOfType(a.account_type) === group : (a.account_group || '').trim() === group,
    );
  }, [accounts, group]);

  const ledgerNameById = useMemo(
    () => new Map(groupLedgers.map((a) => [a.id, a.account_name])),
    [groupLedgers],
  );

  const { data: rawEntries = [], isLoading } = useQuery({
    queryKey: ['group-vouchers-entries', selectedCompanyId, group, fromDate, toDate],
    enabled: !!selectedCompanyId && !!group && groupLedgers.length > 0,
    queryFn: async (): Promise<EntryRow[]> => {
      // .in() with thousands of ids breaks the URL — chunk the ledger list.
      const out: EntryRow[] = [];
      for (let i = 0; i < groupLedgers.length; i += 150) {
        const ids = groupLedgers.slice(i, i + 150).map((a) => a.id);
        const rows = await fetchAllRows<any>((from, to) =>
          supabase
            .from('voucher_entries')
            .select(
              'id, account_id, debit_amount, credit_amount, voucher:vouchers!inner(id, voucher_number, voucher_date, status, company_id, voucher_type:voucher_types(voucher_type_name))',
            )
            .in('account_id', ids)
            .eq('voucher.status', 'AUTHORISED')
            .eq('voucher.company_id', selectedCompanyId)
            .gte('voucher.voucher_date', fromDate)
            .lte('voucher.voucher_date', toDate)
            .order('id')
            .range(from, to),
        );
        for (const r of rows as any[]) {
          out.push({
            entryId: r.id,
            voucherId: r.voucher?.id,
            date: r.voucher?.voucher_date || '',
            ledgerName: '',
            vchType: r.voucher?.voucher_type?.voucher_type_name || '',
            vchNo: r.voucher?.voucher_number || '',
            debit: Number(r.debit_amount) || 0,
            credit: Number(r.credit_amount) || 0,
            ...( { accountId: r.account_id } as any),
          } as EntryRow & { accountId?: string });
        }
      }
      return out.sort((a, b) => a.date.localeCompare(b.date) || a.vchNo.localeCompare(b.vchNo));
    },
  });

  const entries = useMemo(
    () =>
      rawEntries
        .map((e: any) => ({ ...e, ledgerName: ledgerNameById.get(e.accountId) || e.ledgerName || '' }))
        .filter((e) => report.passesFilter({ Particulars: e.ledgerName, 'Vch No.': e.vchNo }))
        .filter((e) => report.passesBasis(e.debit || e.credit)),
    [rawEntries, ledgerNameById, report.passesFilter, report.passesBasis],
  );

  const totalDr = entries.reduce((s, e) => s + e.debit, 0);
  const totalCr = entries.reduce((s, e) => s + e.credit, 0);

  const { cursor, setCursor } = useRowCursor({
    count: group ? entries.length : groupList.length,
    onEnter: (index) => {
      if (!group) {
        const item = groupList[index];
        if (item) setGroup(item.label);
        return;
      }
      const entry = entries[index];
      if (entry?.voucherId) onOpenVoucher?.(entry.voucherId);
    },
  });

  return (
    <>
    <TallyScreen
      title={group ? `Group Vouchers — ${group}` : 'Group Vouchers'}
      onClose={group ? () => setGroup(null) : undefined}
      rail={report.rail}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        {!group ? (
          <div className="mx-auto max-w-md pt-4">
            <div className="border bg-[#eef3fa]">
              <div className="bg-[#16437e] px-3 py-1 text-xs font-semibold text-white">List of Groups</div>
              <div className="max-h-[60vh] overflow-y-auto">
                {groupList.map((item, i) => (
                  <button
                    key={`${item.isHead ? 'h' : 'g'}:${item.label}`}
                    type="button"
                    onClick={() => setGroup(item.label)}
                    onMouseEnter={() => setCursor(i)}
                    className={`block w-full border-b border-white py-1 text-left ${
                      item.isHead ? 'px-3 font-semibold' : 'px-7'
                    } ${cursor === i ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="text-center">
              <div className="font-bold">{group}</div>
              <div className="text-[11px]">{report.periodLabel}</div>
            </div>
            <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
              <div className="w-20 px-1">Date</div>
              <div className="min-w-0 flex-1 px-1">Particulars</div>
              <div className="w-28 px-1">Vch Type</div>
              <div className="w-28 px-1">Vch No.</div>
              <div className="w-32 px-1 text-right">Debit</div>
              <div className="w-32 px-1 text-right">Credit</div>
            </div>
            {isLoading ? (
              <div className="py-10 text-center text-gray-400">Loading…</div>
            ) : entries.length === 0 ? (
              <div className="py-10 text-center text-gray-400">
                No vouchers touched this group's ledgers in the period.
              </div>
            ) : (
              <>
                {entries.map((e, i) => (
                  <button
                    key={e.entryId}
                    type="button"
                    onClick={() => e.voucherId && onOpenVoucher?.(e.voucherId)}
                    onMouseEnter={() => setCursor(i)}
                    title="Open voucher (alter)"
                    className={`flex w-full border-b border-dashed border-gray-200 text-left ${
                      cursor === i ? 'bg-[#ffc423]' : 'hover:bg-[#fdf6d8]'
                    }`}
                  >
                    <div className="w-20 px-1">{tallyDateLabel(e.date)}</div>
                    <div className="min-w-0 flex-1 truncate px-1">{e.ledgerName}</div>
                    <div className="w-28 truncate px-1">{e.vchType}</div>
                    <div className="w-28 px-1 font-mono text-[12px]">{e.vchNo}</div>
                    <div className="w-32 px-1 text-right font-mono">{e.debit > 0 ? fmt(e.debit) : ''}</div>
                    <div className="w-32 px-1 text-right font-mono">{e.credit > 0 ? fmt(e.credit) : ''}</div>
                  </button>
                ))}
                <div className="mt-1 flex border-t border-black pt-0.5 font-bold">
                  <div className="w-20 px-1" />
                  <div className="min-w-0 flex-1 px-1">Total — {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</div>
                  <div className="w-28 px-1" />
                  <div className="w-28 px-1" />
                  <div className="w-32 px-1 text-right font-mono">{fmt(totalDr)}</div>
                  <div className="w-32 px-1 text-right font-mono">{fmt(totalCr)}</div>
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

export default GroupVouchers;
