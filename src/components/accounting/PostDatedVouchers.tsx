import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { dayLabel } from './tally/PeriodContext';
import { useAccountingCompany } from './AccountingCompanyContext';

interface PendingVoucher {
  id: string;
  date: string;
  number: string;
  type: string;
  narration: string | null;
  amount: number;
  isOptional: boolean;
  status: string;
  party: string;
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const todayISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Post-Dated / Optional voucher registers — Tally's two exception registers.
 *
 * A post-dated voucher here is one dated in the future: the books are
 * period-bounded, so it enters every report automatically on its date, exactly
 * as Tally regularises PDVs. Optional vouchers carry is_optional and stay out
 * of the books until Regularised from this screen.
 */
const PostDatedVouchers: React.FC<{
  initialMode?: 'post-dated' | 'optional';
  onOpenVoucher?: (id: string) => void;
}> = ({ initialMode = 'post-dated', onOpenVoucher }) => {
  const { selectedCompanyId } = useAccountingCompany();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'post-dated' | 'optional'>(initialMode);
  const today = todayISO();

  const report = useTallyReport({
    supportsColumns: false,
    filterFields: ['Particulars', 'Vch No.'],
    views: [
      { label: 'Exception Reports', target: 'exception-reports' },
      { label: 'Day Book', target: 'day-book' },
      { label: 'Voucher Entry', target: 'voucher-entry' },
    ],
    screenKeys: [
      {
        hotkey: 'F4',
        label: mode === 'post-dated' ? 'Post-Dated' : 'Optional',
        onClick: () => setMode((m) => (m === 'post-dated' ? 'optional' : 'post-dated')),
      },
    ],
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['pending_vouchers', mode, selectedCompanyId, today],
    enabled: !!selectedCompanyId,
    queryFn: async (): Promise<PendingVoucher[]> => {
      let query = (supabase as any)
        .from('vouchers')
        .select(
          'id, voucher_date, voucher_number, narration, total_amount, is_optional, status, voucher_type:voucher_types(voucher_type_name), voucher_entries(debit_amount, account:chart_of_accounts(account_name))',
        )
        .eq('company_id', selectedCompanyId)
        .neq('status', 'CANCELLED')
        .order('voucher_date', { ascending: true })
        .limit(2000);
      query =
        mode === 'post-dated'
          ? query.gt('voucher_date', today).eq('is_optional', false)
          : query.eq('is_optional', true);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((v: any) => ({
        id: v.id,
        date: v.voucher_date,
        number: v.voucher_number ?? '',
        type: v.voucher_type?.voucher_type_name ?? '',
        narration: v.narration,
        amount: Number(v.total_amount) || 0,
        isOptional: !!v.is_optional,
        status: v.status,
        party:
          (v.voucher_entries ?? []).find((e: any) => Number(e.debit_amount) > 0)?.account?.account_name ??
          (v.voucher_entries ?? [])[0]?.account?.account_name ??
          '',
      }));
    },
  });

  const regularise = async (v: PendingVoucher) => {
    // Turning an optional voucher regular is Tally's Ctrl+L in alteration:
    // the voucher enters the books the moment the flag comes off.
    const { error } = await (supabase as any)
      .from('vouchers')
      .update({ is_optional: false, status: 'AUTHORISED' })
      .eq('id', v.id)
      .eq('is_optional', true);
    if (error) { toast.error(error.message); return; }
    toast.success(`${v.number || 'Voucher'} regularised — it is in the books now.`);
    queryClient.invalidateQueries({ queryKey: ['pending_vouchers'] });
  };

  const byMonth = useMemo(() => {
    const groups = new Map<string, PendingVoucher[]>();
    for (const r of rows) {
      const key = r.date.slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return [...groups.entries()];
  }, [rows]);

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const monthLabel = (ym: string): string =>
    new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <>
      <TallyScreen title={mode === 'post-dated' ? 'Post-Dated Vouchers' : 'Optional Vouchers'} rail={report.rail}>
        <div className="px-3 pb-4 pt-1 text-[13px]">
          <div className="text-center">
            <div className="font-bold">{mode === 'post-dated' ? 'Post-Dated Vouchers' : 'Optional Vouchers'}</div>
            <div className="text-[11px]">
              {mode === 'post-dated'
                ? `dated after ${dayLabel(today)} — each enters the books on its date`
                : 'kept out of the books until regularised'}
            </div>
          </div>

          <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
            <div className="w-20 shrink-0 px-1">Date</div>
            <div className="w-24 shrink-0 px-1">Vch Type</div>
            <div className="w-24 shrink-0 px-1">Vch No.</div>
            <div className="min-w-0 flex-1 px-1">Particulars</div>
            <div className="w-32 shrink-0 px-1 text-right">Amount</div>
            <div className="w-28 shrink-0 px-1 text-center">
              {mode === 'post-dated' ? 'Due in' : ''}
            </div>
          </div>

          {isLoading ? (
            <div className="py-10 text-center text-gray-400">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-gray-400">
              {mode === 'post-dated'
                ? 'No post-dated vouchers. Enter one from Voucher Entry with a future date (T: Post-Dated).'
                : 'No optional vouchers. Mark one in Voucher Entry with L: Optional.'}
            </div>
          ) : (
            byMonth.map(([ym, list]) => (
              <React.Fragment key={ym}>
                <div className="mt-1.5 flex bg-[#eef3fa] font-bold">
                  <div className="min-w-0 flex-1 px-1">{monthLabel(ym)}</div>
                  <div className="w-32 shrink-0 px-1 text-right font-mono">
                    {fmt(list.reduce((s, r) => s + r.amount, 0))}
                  </div>
                  <div className="w-28 shrink-0 px-1 text-center text-[11px] font-normal italic text-gray-600">
                    {list.length} vch{list.length === 1 ? '' : 's'}
                  </div>
                </div>
                {list.map((r) => {
                  const daysToDue = Math.ceil(
                    (new Date(`${r.date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000,
                  );
                  return (
                    <div key={r.id} className="flex border-b border-dashed border-gray-200 hover:bg-[#fdf6d8]">
                      <button
                        type="button"
                        onClick={() => onOpenVoucher?.(r.id)}
                        className="flex min-w-0 flex-1 text-left"
                      >
                        <div className="w-20 shrink-0 px-1">{dayLabel(r.date)}</div>
                        <div className="w-24 shrink-0 px-1 italic text-gray-600">{r.type}</div>
                        <div className="w-24 shrink-0 px-1">{r.number}</div>
                        <div className="min-w-0 flex-1 truncate px-1">{r.party}{r.narration ? ` — ${r.narration}` : ''}</div>
                        <div className="w-32 shrink-0 px-1 text-right font-mono">{fmt(r.amount)}</div>
                      </button>
                      <div className="w-28 shrink-0 px-1 text-center">
                        {mode === 'post-dated' ? (
                          <span className="italic text-gray-600">{daysToDue} day{daysToDue === 1 ? '' : 's'}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => regularise(r)}
                            className="border border-emerald-600 px-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50"
                          >
                            Regularise
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </React.Fragment>
            ))
          )}

          {!isLoading && rows.length > 0 && (
            <div className="mt-2 flex border-t border-black pt-0.5 font-bold">
              <div className="min-w-0 flex-1 px-1 tracking-[0.2em]">
                Total — {rows.length} voucher{rows.length === 1 ? '' : 's'}
              </div>
              <div className="w-32 shrink-0 px-1 text-right font-mono">{fmt(total)}</div>
              <div className="w-28 shrink-0 px-1" />
            </div>
          )}
        </div>
      </TallyScreen>

      {report.popups}
    </>
  );
};

export default PostDatedVouchers;
