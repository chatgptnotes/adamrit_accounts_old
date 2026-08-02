import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LedgerAutocomplete, type LedgerAccountOption } from './LedgerAutocomplete';
import { useAccountingCompany } from './AccountingCompanyContext';

interface BudgetRow {
  id: string;
  name: string;
  period_from: string;
  period_to: string;
}

interface LineRow {
  id: string;
  account_id: string;
  amount: number;
  account?: { account_name: string } | null;
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/**
 * Tally's Budget master: a named budget over a period with budgeted amounts
 * per ledger. Used by the Budget Variance report.
 */
const BudgetMaster: React.FC = () => {
  const { selectedCompanyId } = useAccountingCompany();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [lineAccount, setLineAccount] = useState<LedgerAccountOption | null>(null);
  const [lineAmount, setLineAmount] = useState('');

  const { data: budgets = [] } = useQuery({
    queryKey: ['budgets', selectedCompanyId],
    enabled: !!selectedCompanyId,
    queryFn: async (): Promise<BudgetRow[]> => {
      const { data, error } = await (supabase as any)
        .from('budgets')
        .select('id, name, period_from, period_to')
        .eq('company_id', selectedCompanyId)
        .eq('is_active', true)
        .order('period_from', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: lines = [] } = useQuery({
    queryKey: ['budget_lines', editing],
    enabled: !!editing && editing !== 'new',
    queryFn: async (): Promise<LineRow[]> => {
      const { data, error } = await (supabase as any)
        .from('budget_lines')
        .select('id, account_id, amount, account:chart_of_accounts(account_name)')
        .eq('budget_id', editing)
        .order('created_at');
      if (error) throw error;
      return data ?? [];
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['budgets'] });
    queryClient.invalidateQueries({ queryKey: ['budget_lines'] });
  };

  const saveBudget = async () => {
    if (!name.trim() || !from || !to) {
      toast.error('Name, period from and period to are all required.');
      return;
    }
    if (editing === 'new') {
      const { data, error } = await (supabase as any)
        .from('budgets')
        .insert({ company_id: selectedCompanyId, name: name.trim(), period_from: from, period_to: to })
        .select('id')
        .single();
      if (error) { toast.error(error.message); return; }
      setEditing(data.id);
      toast.success('Budget created — now add ledger amounts.');
    } else {
      const { error } = await (supabase as any)
        .from('budgets')
        .update({ name: name.trim(), period_from: from, period_to: to })
        .eq('id', editing);
      if (error) { toast.error(error.message); return; }
      toast.success('Budget updated.');
    }
    refresh();
  };

  const addLine = async () => {
    const amount = Number(lineAmount);
    if (!lineAccount || !Number.isFinite(amount) || amount <= 0) {
      toast.error('Pick a ledger and enter a budget amount.');
      return;
    }
    const { error } = await (supabase as any)
      .from('budget_lines')
      .upsert({ budget_id: editing, account_id: lineAccount.id, amount }, { onConflict: 'budget_id,account_id' });
    if (error) { toast.error(error.message); return; }
    setLineAccount(null);
    setLineAmount('');
    refresh();
  };

  const removeLine = async (id: string) => {
    const { error } = await (supabase as any).from('budget_lines').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    refresh();
  };

  const deleteBudget = async (id: string) => {
    const { error } = await (supabase as any).from('budgets').update({ is_active: false }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    if (editing === id) setEditing(null);
    refresh();
  };

  if (!editing) {
    return (
      <div className="mx-auto max-w-[560px] border border-[#8fb0d4] bg-[#dfeaf7]">
        <div className="bg-[#2a68a8] px-3 py-1.5 text-sm font-semibold text-white">List of Budgets</div>
        <div className="flex justify-end border-b border-[#b8c9dd] bg-[#e9eff7] px-3 py-1 text-sm">
          <button
            type="button"
            className="text-[#1a4d8f] hover:underline"
            onClick={() => { setEditing('new'); setName(''); setFrom(''); setTo(''); }}
          >
            Create
          </button>
        </div>
        {budgets.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-gray-600">No budgets yet — Create one for this company.</p>
        ) : (
          budgets.map((b) => (
            <div key={b.id} className="flex items-center border-b border-white px-3 py-1 text-sm hover:bg-[#fdf6d8]">
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-[#1a4d8f]"
                onClick={() => { setEditing(b.id); setName(b.name); setFrom(b.period_from); setTo(b.period_to); }}
              >
                {b.name}
                <span className="ml-2 text-xs text-gray-500">{b.period_from} → {b.period_to}</span>
              </button>
              <button type="button" className="ml-2 text-xs text-red-700 hover:underline" onClick={() => deleteBudget(b.id)}>
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[640px] border border-[#8fb0d4] bg-[#dfeaf7] p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold">{editing === 'new' ? 'Budget Creation' : 'Budget Alteration'}</div>
        <Button variant="outline" size="sm" className="h-7 rounded-none text-xs" onClick={() => setEditing(null)}>
          List of Budgets
        </Button>
      </div>

      <div className="grid grid-cols-[8rem_1fr] items-center gap-y-2">
        <span>Name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-7 rounded-none bg-[#fdf6d8]" />
        <span>Period from</span>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-7 w-44 rounded-none bg-[#fdf6d8]" />
        <span>Period to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-7 w-44 rounded-none bg-[#fdf6d8]" />
      </div>
      <Button size="sm" className="mt-2 h-7 rounded-none text-xs" onClick={saveBudget}>
        {editing === 'new' ? 'Create Budget' : 'Save Changes'}
      </Button>

      {editing !== 'new' && (
        <div className="mt-4">
          <div className="border-b border-black font-semibold">Budgeted amounts per ledger</div>
          {lines.map((l) => (
            <div key={l.id} className="flex items-center border-b border-dashed border-gray-300 py-0.5">
              <span className="min-w-0 flex-1 truncate">{l.account?.account_name ?? l.account_id}</span>
              <span className="w-32 text-right font-mono">{fmt(Number(l.amount) || 0)}</span>
              <button type="button" className="ml-3 text-xs text-red-700 hover:underline" onClick={() => removeLine(l.id)}>
                Remove
              </button>
            </div>
          ))}
          <div className="mt-2 flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <LedgerAutocomplete value={lineAccount} onChange={setLineAccount} companyId={selectedCompanyId} />
            </div>
            <Input
              value={lineAmount}
              onChange={(e) => setLineAmount(e.target.value)}
              placeholder="Amount"
              inputMode="decimal"
              className="h-9 w-32 rounded-none bg-[#fdf6d8] text-right"
            />
            <Button size="sm" className="h-9 rounded-none text-xs" onClick={addLine}>Add</Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetMaster;
