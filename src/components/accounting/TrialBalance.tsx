import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { accountMovements, type Movement } from '@/lib/accountMovements';
import { format } from 'date-fns';
import { useCompanies } from '@/hooks/useCompanies';
import { TallyScreen } from './tally/TallyChrome';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  opening_balance: number | null;
  opening_balance_type: string | null;
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);


const shiftYear = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  d.setFullYear(d.getFullYear() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

import { HEAD_OF, HEAD_ORDER } from './tally/heads';

/**
 * Trial Balance — Tally Prime replica: Particulars with grouped heads,
 * Debit/Credit closing-balance columns, ledger drill-down, Grand Total.
 */
const TrialBalance: React.FC<{ onOpenGroup?: (head: string) => void }> = ({ onOpenGroup }) => {
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [asOfDate, setAsOfDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showPeriod, setShowPeriod] = useState(false);
  const [detailed, setDetailed] = useState(true);
  // C: New Column — comparison as-at date (defaults to same day last year)
  const [compareAsOf, setCompareAsOf] = useState<string | null>(null);

  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ['tb_accounts'],
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

  const { data: movements = new Map<string, Movement>(), isLoading: entriesLoading } = useQuery({
    queryKey: ['tb_movements', selectedCompanyId, asOfDate],
    queryFn: () => accountMovements({ upto: asOfDate, companyId: selectedCompanyId }),
  });

  const { data: movements2 = new Map<string, Movement>() } = useQuery({
    queryKey: ['tb_movements', selectedCompanyId, compareAsOf],
    enabled: !!compareAsOf,
    queryFn: () => accountMovements({ upto: compareAsOf!, companyId: selectedCompanyId }),
  });

  const computeGroups = (mov: Map<string, Movement>) => {
    const byHead = new Map<string, { dr: number; cr: number; ledgers: { name: string; bal: number }[] }>();
    for (const a of accounts) {
      const t = a.account_type?.toUpperCase() ?? '';
      const head = HEAD_OF.find((h) => h.match(t))?.head;
      if (!head) continue;
      const opening = (Number(a.opening_balance) || 0) * (a.opening_balance_type === 'Cr' ? -1 : 1);
      const m = mov.get(a.id);
      const bal = opening + (m ? m.debit - m.credit : 0);
      if (Math.abs(bal) < 0.005) continue;
      const g = byHead.get(head) ?? { dr: 0, cr: 0, ledgers: [] };
      if (bal > 0) g.dr += bal;
      else g.cr += -bal;
      g.ledgers.push({ name: a.account_name, bal });
      byHead.set(head, g);
    }
    let grandDr = 0;
    let grandCr = 0;
    for (const g of byHead.values()) {
      grandDr += g.dr;
      grandCr += g.cr;
    }
    return { byHead, grandDr, grandCr };
  };

  const { groups, grandDr, grandCr, byHead2, grandDr2, grandCr2 } = useMemo(() => {
    const cur = computeGroups(movements);
    const cmp = compareAsOf ? computeGroups(movements2) : null;
    const heads = HEAD_ORDER.filter((h) => cur.byHead.has(h) || cmp?.byHead.has(h));
    const groups = heads.map((h) => ({ head: h, ...(cur.byHead.get(h) ?? { dr: 0, cr: 0, ledgers: [] }) }));
    return {
      groups,
      grandDr: cur.grandDr,
      grandCr: cur.grandCr,
      byHead2: cmp?.byHead ?? null,
      grandDr2: cmp?.grandDr ?? 0,
      grandCr2: cmp?.grandCr ?? 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, movements, movements2, compareAsOf]);

  const isLoading = accountsLoading || entriesLoading;
  const companyName = companies.find((c) => c.id === selectedCompanyId)?.company_name || 'All Companies';

  return (
    <TallyScreen
      title="Trial Balance"
      rail={[
        { hotkey: 'F2', label: 'Period', onClick: () => setShowPeriod((v) => !v) },
        {
          hotkey: 'F3',
          label: 'Company',
          onClick: () =>
            setSelectedCompanyId((cur) => {
              const ids = ['', ...companies.map((c) => c.id)];
              return ids[(ids.indexOf(cur) + 1) % ids.length];
            }),
        },
        { hotkey: 'F5', label: 'Ledger-wise', gapBefore: true, onClick: () => setDetailed((v) => !v), active: detailed },
        {
          hotkey: 'C',
          label: compareAsOf ? 'Del Column' : 'New Column',
          onClick: () => setCompareAsOf((c) => (c ? null : shiftYear(asOfDate))),
          active: !!compareAsOf,
        },
        { label: 'Basis of Values', disabled: true, gapBefore: true },
        { label: 'Exception Reports', disabled: true },
        { label: 'Save View', disabled: true },
        { hotkey: 'P', label: 'Print', onClick: () => window.print(), gapBefore: true },
      ]}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        {showPeriod && (
          <div className="mb-2 flex items-center gap-2 border border-[#9db8d8] bg-[#fdf6d8] px-2 py-1">
            <span>As at:</span>
            <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="border bg-white px-1" />
            <span className="ml-4">Company:</span>
            <select value={selectedCompanyId} onChange={(e) => setSelectedCompanyId(e.target.value)} className="border bg-white px-1">
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company_name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Header */}
        <div className="flex border-b border-black">
          <div className="flex-1 pt-8 font-semibold tracking-[0.3em]">Particulars</div>
          <div className="w-72 border-l border-gray-400 text-center">
            <div className="font-bold">{companyName}</div>
            <div className="text-[11px]">as at {tallyDateLabel(asOfDate)}</div>
            <div className="font-bold">Closing Balance</div>
            <div className="flex border-t border-gray-400 font-semibold">
              <div className="w-1/2 border-r border-gray-400">Debit</div>
              <div className="w-1/2">Credit</div>
            </div>
          </div>
          {compareAsOf && (
            <div className="w-72 border-l border-gray-400 text-center">
              <div className="font-bold">{companyName}</div>
              <div className="flex items-center justify-center gap-1 text-[11px]">
                as at
                <input
                  type="date"
                  value={compareAsOf}
                  onChange={(e) => setCompareAsOf(e.target.value)}
                  className="border bg-white px-0.5 text-[11px]"
                />
              </div>
              <div className="font-bold">Closing Balance</div>
              <div className="flex border-t border-gray-400 font-semibold">
                <div className="w-1/2 border-r border-gray-400">Debit</div>
                <div className="w-1/2">Credit</div>
              </div>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-gray-400">Loading…</div>
        ) : (
          <>
            {groups.map((g) => (
              <React.Fragment key={g.head}>
                <button
                  type="button"
                  onClick={() => onOpenGroup?.(g.head)}
                  title="Open Group Summary"
                  className="mt-1.5 flex w-full text-left hover:bg-[#fdf6d8]"
                >
                  <div className="flex-1 font-bold">{g.head}</div>
                  <div className="flex w-72">
                    <div className="w-1/2 pr-2 text-right font-mono font-semibold">{g.dr > 0 ? fmt(g.dr) : ''}</div>
                    <div className="w-1/2 pr-2 text-right font-mono font-semibold">{g.cr > 0 ? fmt(g.cr) : ''}</div>
                  </div>
                  {byHead2 && (
                    <div className="flex w-72">
                      <div className="w-1/2 pr-2 text-right font-mono font-semibold">
                        {(byHead2.get(g.head)?.dr ?? 0) > 0 ? fmt(byHead2.get(g.head)!.dr) : ''}
                      </div>
                      <div className="w-1/2 pr-2 text-right font-mono font-semibold">
                        {(byHead2.get(g.head)?.cr ?? 0) > 0 ? fmt(byHead2.get(g.head)!.cr) : ''}
                      </div>
                    </div>
                  )}
                </button>
                {detailed && !byHead2 &&
                  g.ledgers.map((l) => (
                    <div key={l.name} className="flex text-[12px] italic text-gray-700">
                      <div className="flex-1 pl-5">{l.name}</div>
                      <div className="flex w-72">
                        <div className="w-1/2 pr-2 text-right font-mono">{l.bal > 0 ? fmt(l.bal) : ''}</div>
                        <div className="w-1/2 pr-2 text-right font-mono">{l.bal < 0 ? fmt(-l.bal) : ''}</div>
                      </div>
                    </div>
                  ))}
              </React.Fragment>
            ))}

            <div className="mt-10 flex border-t border-black pt-1 font-bold">
              <div className="flex-1 tracking-[0.3em]">Grand Total</div>
              <div className="flex w-72">
                <div className="w-1/2 pr-2 text-right font-mono">{fmt(grandDr)}</div>
                <div className="w-1/2 pr-2 text-right font-mono">{fmt(grandCr)}</div>
              </div>
              {byHead2 && (
                <div className="flex w-72">
                  <div className="w-1/2 pr-2 text-right font-mono">{fmt(grandDr2)}</div>
                  <div className="w-1/2 pr-2 text-right font-mono">{fmt(grandCr2)}</div>
                </div>
              )}
            </div>
            {Math.abs(grandDr - grandCr) > 0.01 && (
              <div className="mt-1 text-right text-[12px] font-semibold text-red-600">
                Difference: {fmt(Math.abs(grandDr - grandCr))}
              </div>
            )}
          </>
        )}
      </div>
    </TallyScreen>
  );
};

export default TrialBalance;
