import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { useAccountingPeriod, dayLabel } from './tally/PeriodContext';
import { useAccountingCompany } from './AccountingCompanyContext';
import { HEAD_OF, LIABILITY_HEADS } from './tally/heads';

interface NegativeRow {
  accountId: string;
  name: string;
  head: string;
  closing: number; // signed, Dr positive
  expected: 'DR' | 'CR';
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));

const headOfType = (type: string): string => {
  const t = (type || '').toUpperCase();
  return HEAD_OF.find((r) => r.match(t))?.head ?? 'Suspense A/c';
};

// Income heads also naturally carry credit balances.
const CREDIT_NATURE = new Set([...LIABILITY_HEADS, 'Sales Accounts', 'Direct Incomes', 'Indirect Incomes']);

/**
 * Negative Ledgers — Tally's exception report: every ledger whose closing
 * balance sits on the wrong side of its nature (an asset or expense showing
 * credit, a liability or income showing debit) as at the period end.
 */
const NegativeLedgers: React.FC<{ onOpenLedger?: (accountId: string) => void }> = ({ onOpenLedger }) => {
  const { selectedCompanyId } = useAccountingCompany();
  const { period } = useAccountingPeriod();

  const report = useTallyReport({
    supportsColumns: false,
    filterFields: ['Ledger'],
    views: [
      { label: 'Exception Reports', target: 'exception-reports' },
      { label: 'Trial Balance', target: 'trial-balance' },
      { label: 'Group Summary', target: 'group-summary' },
      { label: 'Ledger Vouchers', target: 'ledger-view' },
    ],
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['negative_ledgers', selectedCompanyId, period.to],
    enabled: !!selectedCompanyId,
    queryFn: async (): Promise<NegativeRow[]> => {
      const { data: accounts, error: accErr } = await (supabase as any)
        .from('chart_of_accounts')
        .select('id, account_name, account_type, opening_balance, opening_balance_type')
        .eq('company_id', selectedCompanyId)
        .eq('is_active', true);
      if (accErr) throw accErr;

      // Net movement per account up to the period end. PostgREST caps at 1000
      // rows, so page through the entries.
      const net = new Map<string, number>();
      for (let fromRow = 0; ; fromRow += 1000) {
        const { data: entries, error: entErr } = await (supabase as any)
          .from('voucher_entries')
          .select('account_id, debit_amount, credit_amount, voucher:vouchers!inner(company_id, voucher_date)')
          .eq('voucher.company_id', selectedCompanyId)
          .lte('voucher.voucher_date', period.to)
          .order('id')
          .range(fromRow, fromRow + 999);
        if (entErr) throw entErr;
        for (const e of entries ?? []) {
          net.set(
            e.account_id,
            (net.get(e.account_id) ?? 0) + (Number(e.debit_amount) || 0) - (Number(e.credit_amount) || 0),
          );
        }
        if (!entries || entries.length < 1000) break;
      }

      const out: NegativeRow[] = [];
      for (const a of accounts ?? []) {
        const head = headOfType(a.account_type);
        if (head === 'Suspense A/c') continue; // suspense has no expected side
        const opening =
          (Number(a.opening_balance) || 0) *
          ((a.opening_balance_type || 'DR').toUpperCase() === 'CR' ? -1 : 1);
        const closing = opening + (net.get(a.id) ?? 0);
        if (Math.abs(closing) < 0.005) continue;
        const expected: 'DR' | 'CR' = CREDIT_NATURE.has(head) ? 'CR' : 'DR';
        const wrongSide = expected === 'DR' ? closing < 0 : closing > 0;
        if (wrongSide) out.push({ accountId: a.id, name: a.account_name, head, closing, expected });
      }
      return out.sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing));
    },
  });

  const grouped = useMemo(() => {
    const byHead = new Map<string, NegativeRow[]>();
    for (const r of rows) {
      if (!byHead.has(r.head)) byHead.set(r.head, []);
      byHead.get(r.head)!.push(r);
    }
    return [...byHead.entries()];
  }, [rows]);

  return (
    <>
      <TallyScreen title="Negative Ledgers" rail={report.rail}>
        <div className="px-3 pb-4 pt-1 text-[13px]">
          <div className="text-center">
            <div className="font-bold">Negative Ledgers</div>
            <div className="text-[11px]">as at {dayLabel(period.to)}</div>
          </div>

          <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
            <div className="min-w-0 flex-1 px-1">Particulars</div>
            <div className="w-36 shrink-0 px-1 text-right">Closing Balance</div>
            <div className="w-24 shrink-0 px-1 text-center">Should be</div>
          </div>

          {isLoading ? (
            <div className="py-10 text-center text-gray-400">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-gray-400">
              No ledger is carrying a balance on the wrong side. All clear.
            </div>
          ) : (
            grouped.map(([head, list]) => (
              <React.Fragment key={head}>
                <div className="mt-1.5 bg-[#eef3fa] px-1 font-bold">{head}</div>
                {list.map((r) => (
                  <button
                    key={r.accountId}
                    type="button"
                    onClick={() => onOpenLedger?.(r.accountId)}
                    className="flex w-full border-b border-dashed border-gray-200 text-left hover:bg-[#fdf6d8]"
                  >
                    <div className="min-w-0 flex-1 truncate px-1 pl-4">{r.name}</div>
                    <div className="w-36 shrink-0 px-1 text-right font-mono text-red-700">
                      {fmt(r.closing)} {r.closing < 0 ? 'Cr' : 'Dr'}
                    </div>
                    <div className="w-24 shrink-0 px-1 text-center italic text-gray-600">{r.expected.toLowerCase() === 'dr' ? 'Dr' : 'Cr'}</div>
                  </button>
                ))}
              </React.Fragment>
            ))
          )}

          {!isLoading && rows.length > 0 && (
            <div className="mt-2 border-t border-black pt-0.5 font-bold">
              {rows.length} ledger{rows.length === 1 ? '' : 's'} on the wrong side
            </div>
          )}
        </div>
      </TallyScreen>

      {report.popups}
    </>
  );
};

export default NegativeLedgers;
