import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { fetchActiveAccounts } from '@/lib/fetchAccounts';
import { useAccountingCompany } from './AccountingCompanyContext';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { HEAD_ORDER, headOfType } from './tally/heads';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  opening_balance: number | null;
  opening_balance_type: string | null;
}

interface Row {
  account: Account;
  amount: string;
  drcr: 'DR' | 'CR';
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const fyStartLabel = (): string => {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `1-Apr-${String(y).slice(2)}`;
};

// Natural Dr/Cr side per head, used as the default for new entries
const NATURAL_CR = new Set(['Capital Account', 'Loans (Liability)', 'Current Liabilities', 'Sales Accounts', 'Indirect Incomes']);

/**
 * Opening Balances — Tally keeps opening balances on the ledger masters
 * (as on 1-Apr). This screen edits every account's opening in one place,
 * grouped under the Tally heads, with the live Difference in opening
 * balances that Tally shows until Dr and Cr agree.
 */
const OpeningBalances: React.FC = () => {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const { selectedCompanyId } = useAccountingCompany();

  const report = useTallyReport({
    // An entry grid has one editable column — Tally's column keys do not apply
    supportsColumns: false,
    filterFields: ['Particulars'],
    views: [
      { label: 'Chart of Accounts', target: 'chart-of-accounts' },
      { label: 'Trial Balance', target: 'trial-balance' },
      { label: 'Balance Sheet', target: 'balance-sheet' },
      { label: 'Masters', target: 'masters' },
    ],
    screenKeys: [{ hotkey: 'F4', label: 'Accept', onClick: () => void handleAccept() }],
  });

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['opening_accounts', selectedCompanyId],
    queryFn: () =>
      fetchActiveAccounts<Account>({
        columns: 'id, account_code, account_name, account_type, opening_balance, opening_balance_type',
        companyId: selectedCompanyId,
      }),
  });

  useEffect(() => {
    setRows(
      accounts.map((a) => ({
        account: a,
        amount: Number(a.opening_balance) ? String(Number(a.opening_balance)) : '',
        drcr:
          (a.opening_balance_type?.toUpperCase() as 'DR' | 'CR') ||
          (NATURAL_CR.has(headOfType(a.account_type) ?? '') ? 'CR' : 'DR'),
      })),
    );
  }, [accounts]);

  const update = (id: string, patch: Partial<Row>): void => {
    setRows((prev) => prev.map((r) => (r.account.id === id ? { ...r, ...patch } : r)));
  };

  const { totalDr, totalCr } = useMemo(() => {
    let totalDr = 0;
    let totalCr = 0;
    for (const r of rows) {
      const v = Number(r.amount) || 0;
      if (v <= 0) continue;
      if (r.drcr === 'DR') totalDr += v;
      else totalCr += v;
    }
    return { totalDr, totalCr };
  }, [rows]);
  const difference = totalDr - totalCr;

  const byHead = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const head = headOfType(r.account.account_type);
      if (!head) continue;
      map.set(head, [...(map.get(head) ?? []), r]);
    }
    return map;
  }, [rows]);

  const handleAccept = async (): Promise<void> => {
    setSaving(true);
    try {
      let changed = 0;
      for (const r of rows) {
        const v = Number(r.amount) || 0;
        const prevV = Number(r.account.opening_balance) || 0;
        const prevT = r.account.opening_balance_type?.toUpperCase() || null;
        const nextT = v > 0 ? r.drcr : null;
        if (v === prevV && (v === 0 || nextT === prevT)) continue;
        const { error } = await supabase
          .from('chart_of_accounts')
          .update({ opening_balance: v, opening_balance_type: nextT })
          .eq('id', r.account.id);
        if (error) throw error;
        changed++;
      }
      if (changed === 0) {
        toast.info('Nothing changed');
      } else {
        toast.success(`Opening balances saved for ${changed} account(s)`);
        queryClient.invalidateQueries();
      }
    } catch (err) {
      console.error('Opening balance save failed:', err);
      toast.error('Failed to save — please try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <TallyScreen
      title="Opening Balances"
      rail={report.rail}
      bottomBar={[
        { hotkey: 'A', label: saving ? 'Saving…' : 'Accept', onClick: handleAccept },
      ]}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        <div className="text-center">
          <div className="font-bold">Ledger Opening Balances</div>
          <div className="text-[11px]">as on {fyStartLabel()} — from your last audited Balance Sheet / Tally</div>
        </div>

        <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
          <div className="min-w-0 flex-1 px-1">Particulars</div>
          <div className="w-44 px-1 text-right">Opening Balance</div>
          <div className="w-16 px-1">Dr/Cr</div>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-gray-400">Loading…</div>
        ) : (
          HEAD_ORDER.filter((h) => byHead.has(h)).map((head) => (
            <React.Fragment key={head}>
              <div className="mt-1.5 bg-[#eef3fa] px-1 font-bold">{head}</div>
              {byHead.get(head)!.map((r) => (
                <div key={r.account.id} className="flex items-center border-b border-dashed border-gray-200">
                  <div className="min-w-0 flex-1 truncate px-1 pl-4">
                    {r.account.account_name}
                    <span className="ml-1 text-[11px] text-gray-400">({r.account.account_code})</span>
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={r.amount}
                    onChange={(e) => update(r.account.id, { amount: e.target.value })}
                    placeholder=""
                    className="h-6 w-44 border-0 border-b border-dashed border-gray-300 bg-transparent px-1 text-right font-mono focus:border-solid focus:border-blue-600 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <select
                    value={r.drcr}
                    onChange={(e) => update(r.account.id, { drcr: e.target.value as 'DR' | 'CR' })}
                    className="h-6 w-16 border-0 bg-transparent px-1 font-semibold focus:outline-none"
                  >
                    <option value="DR">Dr</option>
                    <option value="CR">Cr</option>
                  </select>
                </div>
              ))}
            </React.Fragment>
          ))
        )}

        {/* Tally's opening-balance totals + difference */}
        <div className="mt-3 border-t border-black pt-1">
          <div className="flex justify-end gap-6 font-bold">
            <span>
              Total Dr: <span className="font-mono">{fmt(totalDr)}</span>
            </span>
            <span>
              Total Cr: <span className="font-mono">{fmt(totalCr)}</span>
            </span>
          </div>
          <div className="mt-0.5 text-right">
            {Math.abs(difference) < 0.01 ? (
              <span className="font-semibold text-green-700">Opening balances agree</span>
            ) : (
              <span className="font-semibold text-red-600">
                Difference in opening balances: {fmt(Math.abs(difference))} {difference > 0 ? 'Cr' : 'Dr'} required
              </span>
            )}
          </div>
        </div>
      </div>
    </TallyScreen>

    {report.popups}
    </>
  );
};

export default OpeningBalances;
