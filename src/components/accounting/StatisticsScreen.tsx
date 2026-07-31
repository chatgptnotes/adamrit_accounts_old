import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { useAccountingCompany } from './AccountingCompanyContext';

const count = async (table: string, filter?: (q: any) => any): Promise<number> => {
  let query = (supabase as any).from(table).select('id', { count: 'exact', head: true });
  if (filter) query = filter(query);
  const { count: c, error } = await query;
  if (error) return 0;
  return c ?? 0;
};

/**
 * Statistics — Tally Prime replica: voucher counts per type for the period
 * (plus pending/cancelled), and the masters counts, side by side.
 */
const StatisticsScreen: React.FC = () => {
  const report = useTallyReport({
    supportsColumns: false,
    filterFields: ['Particulars'],
    views: [
      { label: 'Exception Reports', target: 'exception-reports' },
      { label: 'Day Book', target: 'day-book' },
      { label: 'Edit Log', target: 'edit-log' },
      { label: 'Trial Balance', target: 'trial-balance' },
    ],
  });
  const { selectedCompanyId } = useAccountingCompany();
  const { from: fromDate, to: toDate } = report;

  const { data, isLoading } = useQuery({
    queryKey: ['statistics', selectedCompanyId, fromDate, toDate],
    enabled: !!selectedCompanyId,
    queryFn: async () => {
      const { data: types, error } = await supabase
        .from('voucher_types')
        .select('id, voucher_type_name')
        .eq('is_active', true)
        .order('voucher_type_name');
      if (error) throw error;

      // The voucher counts below are company-scoped. The master counts that
      // follow are not: voucher_types, ledger_groups, ledgers and cost_centres
      // have no company_id — those masters are shared across all companies.
      const inPeriod = (q: any) =>
        q.gte('voucher_date', fromDate).lte('voucher_date', toDate).eq('company_id', selectedCompanyId);
      const [typeCounts, pending, cancelled, ...masters] = await Promise.all([
        Promise.all(
          (types ?? []).map(async (t) => ({
            name: t.voucher_type_name,
            n: await count('vouchers', (q) => inPeriod(q).eq('voucher_type_id', t.id).eq('status', 'AUTHORISED')),
          })),
        ),
        count('vouchers', (q) => inPeriod(q).eq('status', 'PENDING')),
        count('vouchers', (q) => inPeriod(q).eq('status', 'CANCELLED')),
        count('chart_of_accounts', (q) => q.eq('is_active', true)),
        count('ledger_groups'),
        count('ledgers', (q) => q.eq('is_active', true)),
        count('cost_centres', (q) => q.eq('is_active', true)),
        count('voucher_types', (q) => q.eq('is_active', true)),
      ]);
      const [accounts, groups, ledgers, costCentres, voucherTypes] = masters;
      return { typeCounts: typeCounts.filter((t) => t.n > 0), pending, cancelled, accounts, groups, ledgers, costCentres, voucherTypes };
    },
  });

  const totalVouchers = (data?.typeCounts ?? []).reduce((s, t) => s + t.n, 0);

  const row = (name: string, n: number, bold = false) => (
    <div key={name} className={`flex justify-between border-b border-dashed border-gray-200 py-0.5 ${bold ? 'font-bold' : ''}`}>
      <span>{name}</span>
      <span className="font-mono">{n}</span>
    </div>
  );

  return (
    <>
    <TallyScreen
      title="Statistics"
      rail={report.rail}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        <div className="text-center text-[11px]">
          {fromDate} to {toDate}
        </div>
        {isLoading || !data ? (
          <div className="py-16 text-center text-gray-400">Counting…</div>
        ) : (
          <div className="mt-1 flex">
            {/* Vouchers */}
            <div className="min-w-0 flex-1 border-r border-gray-400 pr-3">
              <div className="border-b border-black pb-0.5 font-semibold tracking-[0.2em]">Vouchers</div>
              <div className="mt-1">
                {data.typeCounts.map((t) => row(t.name, t.n))}
                {data.pending > 0 && row('Pending (unposted)', data.pending)}
                {data.cancelled > 0 && row('Cancelled', data.cancelled)}
                <div className="mt-2 flex justify-between border-t border-black pt-0.5 font-bold">
                  <span className="tracking-[0.2em]">Total</span>
                  <span className="font-mono">{totalVouchers}</span>
                </div>
              </div>
            </div>
            {/* Masters */}
            <div className="min-w-0 flex-1 pl-3">
              <div className="border-b border-black pb-0.5 font-semibold tracking-[0.2em]">Masters</div>
              <div className="mt-1">
                {row('Chart of Accounts', data.accounts)}
                {row('Groups', data.groups)}
                {row('Ledgers', data.ledgers)}
                {row('Cost Centres', data.costCentres)}
                {row('Voucher Types', data.voucherTypes)}
              </div>
            </div>
          </div>
        )}
      </div>
    </TallyScreen>

    {report.popups}
    </>
  );
};

export default StatisticsScreen;
