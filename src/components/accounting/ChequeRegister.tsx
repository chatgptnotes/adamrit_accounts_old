import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { useAccountingPeriod, dayLabel } from './tally/PeriodContext';
import { useAccountingCompany } from './AccountingCompanyContext';

interface RegisterRow {
  voucherId: string;
  date: string;
  voucherNumber: string;
  voucherType: string;
  party: string;
  bank: string;
  instrumentNo: string;
  instrumentDate: string | null;
  amount: number;
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/**
 * Cheque Register — Tally's Banking register of instruments issued/received:
 * every Payment/Receipt/Contra voucher that moved a bank ledger and carries an
 * instrument (reference) number, with its favouring party, bank and amount.
 */
const ChequeRegister: React.FC<{ onOpenVoucher?: (id: string) => void }> = ({ onOpenVoucher }) => {
  const { selectedCompanyId } = useAccountingCompany();
  const { period } = useAccountingPeriod();
  const [side, setSide] = useState<'all' | 'issued' | 'received'>('all');

  const report = useTallyReport({
    supportsColumns: false,
    filterFields: ['Party', 'Instrument No.', 'Bank'],
    views: [
      { label: 'Banking', target: 'banking' },
      { label: 'Bank Reconciliation', target: 'bank-reconciliation' },
      { label: 'Cash/Bank Book', target: 'cash-bank-book' },
      { label: 'Payment Register', target: 'voucher-register:Payment' },
    ],
    screenKeys: [
      {
        hotkey: 'F4',
        label: side === 'all' ? 'All Instruments' : side === 'issued' ? 'Issued' : 'Received',
        onClick: () => setSide((s) => (s === 'all' ? 'issued' : s === 'issued' ? 'received' : 'all')),
      },
    ],
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['cheque_register', selectedCompanyId, period.from, period.to],
    enabled: !!selectedCompanyId,
    queryFn: async (): Promise<RegisterRow[]> => {
      // Bank ledgers of this company, picked by group (matches Cash/Bank Summary)
      const { data: accounts, error: accErr } = await (supabase as any)
        .from('chart_of_accounts')
        .select('id, account_name, account_group, account_type')
        .eq('company_id', selectedCompanyId)
        .eq('is_active', true);
      if (accErr) throw accErr;
      const bankIds = new Set(
        (accounts ?? [])
          .filter((a: any) => {
            const group = (a.account_group || '').toLowerCase();
            const type = (a.account_type || '').toUpperCase();
            if (type.includes('LIABILIT') || type.includes('LOAN')) return false;
            return group.includes('bank');
          })
          .map((a: any) => a.id),
      );
      const nameOf = new Map<string, string>((accounts ?? []).map((a: any) => [a.id, a.account_name]));
      if (bankIds.size === 0) return [];

      const { data: vouchers, error: vErr } = await (supabase as any)
        .from('vouchers')
        .select(
          'id, voucher_date, voucher_number, reference_number, reference_date, total_amount, voucher_type:voucher_types(voucher_type_name), voucher_entries(account_id, debit_amount, credit_amount)',
        )
        .eq('company_id', selectedCompanyId)
        .not('reference_number', 'is', null)
        .neq('reference_number', '')
        .gte('voucher_date', period.from)
        .lte('voucher_date', period.to)
        .order('voucher_date', { ascending: true })
        .limit(5000);
      if (vErr) throw vErr;

      const out: RegisterRow[] = [];
      for (const v of vouchers ?? []) {
        const entries: any[] = v.voucher_entries ?? [];
        const bankEntry = entries.find((e) => bankIds.has(e.account_id));
        if (!bankEntry) continue; // instrument numbers on non-bank vouchers are ordinary references
        const partyEntry = entries.find((e) => !bankIds.has(e.account_id));
        out.push({
          voucherId: v.id,
          date: v.voucher_date,
          voucherNumber: v.voucher_number ?? '',
          voucherType: v.voucher_type?.voucher_type_name ?? '',
          party: partyEntry ? nameOf.get(partyEntry.account_id) ?? '' : '',
          bank: nameOf.get(bankEntry.account_id) ?? '',
          instrumentNo: v.reference_number,
          instrumentDate: v.reference_date ?? null,
          // Money leaving the bank (credit) is an issued instrument
          amount:
            Number(bankEntry.credit_amount) > 0
              ? -Number(bankEntry.credit_amount)
              : Number(bankEntry.debit_amount) || 0,
        });
      }
      return out;
    },
  });

  const visible = useMemo(() => {
    if (side === 'issued') return rows.filter((r) => r.amount < 0);
    if (side === 'received') return rows.filter((r) => r.amount > 0);
    return rows;
  }, [rows, side]);

  const totalIssued = visible.reduce((s, r) => s + (r.amount < 0 ? -r.amount : 0), 0);
  const totalReceived = visible.reduce((s, r) => s + (r.amount > 0 ? r.amount : 0), 0);

  return (
    <>
      <TallyScreen title="Cheque Register" rail={report.rail}>
        <div className="px-3 pb-4 pt-1 text-[13px]">
          <div className="text-center">
            <div className="font-bold">
              Cheque Register{side !== 'all' ? ` — ${side === 'issued' ? 'Instruments Issued' : 'Instruments Received'}` : ''}
            </div>
            <div className="text-[11px]">
              {dayLabel(period.from)} to {dayLabel(period.to)}
            </div>
          </div>

          <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
            <div className="w-20 shrink-0 px-1">Date</div>
            <div className="w-24 shrink-0 px-1">Vch Type</div>
            <div className="min-w-0 flex-1 px-1">Favouring / Party</div>
            <div className="w-32 shrink-0 px-1">Bank</div>
            <div className="w-28 shrink-0 px-1">Instrument No.</div>
            <div className="w-24 shrink-0 px-1">Inst. Date</div>
            <div className="w-28 shrink-0 px-1 text-right">Issued</div>
            <div className="w-28 shrink-0 px-1 text-right">Received</div>
          </div>

          {isLoading ? (
            <div className="py-10 text-center text-gray-400">Loading…</div>
          ) : visible.length === 0 ? (
            <div className="py-10 text-center text-gray-400">
              No bank instruments in this period. Instrument numbers are the Reference No. on bank vouchers.
            </div>
          ) : (
            visible.map((r) => (
              <button
                key={r.voucherId}
                type="button"
                onClick={() => onOpenVoucher?.(r.voucherId)}
                className="flex w-full border-b border-dashed border-gray-200 text-left hover:bg-[#fdf6d8]"
              >
                <div className="w-20 shrink-0 px-1">{dayLabel(r.date)}</div>
                <div className="w-24 shrink-0 px-1 italic text-gray-600">{r.voucherType}</div>
                <div className="min-w-0 flex-1 truncate px-1">{r.party}</div>
                <div className="w-32 shrink-0 truncate px-1">{r.bank}</div>
                <div className="w-28 shrink-0 px-1">{r.instrumentNo}</div>
                <div className="w-24 shrink-0 px-1">{r.instrumentDate ? dayLabel(r.instrumentDate) : ''}</div>
                <div className="w-28 shrink-0 px-1 text-right font-mono">{r.amount < 0 ? fmt(-r.amount) : ''}</div>
                <div className="w-28 shrink-0 px-1 text-right font-mono">{r.amount > 0 ? fmt(r.amount) : ''}</div>
              </button>
            ))
          )}

          {!isLoading && visible.length > 0 && (
            <div className="mt-2 flex border-t border-black pt-0.5 font-bold">
              <div className="min-w-0 flex-1 px-1 tracking-[0.2em]">
                Total — {visible.length} instrument{visible.length === 1 ? '' : 's'}
              </div>
              <div className="w-28 shrink-0 px-1 text-right font-mono">{fmt(totalIssued)}</div>
              <div className="w-28 shrink-0 px-1 text-right font-mono">{fmt(totalReceived)}</div>
            </div>
          )}
        </div>
      </TallyScreen>

      {report.popups}
    </>
  );
};

export default ChequeRegister;
