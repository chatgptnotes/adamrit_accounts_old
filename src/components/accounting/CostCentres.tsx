import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';

export interface CostCentre {
  id: string;
  name: string;
  alias: string | null;
  is_active: boolean;
  category_id?: string | null;
}

export interface CostCategory {
  id: string;
  name: string;
}

interface CentreEntry {
  id: string;
  debit_amount: number | null;
  credit_amount: number | null;
  cost_centre_id: string | null;
  voucher: {
    id: string;
    voucher_number: string;
    voucher_date: string;
    narration: string | null;
    status: string;
  } | null;
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const tallyDateLabel = (iso: string): string => {
  const d = new Date(iso + 'T00:00:00');
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

/** Active cost centres; empty (not an error) until the migration is run. */
export const useCostCentres = () =>
  useQuery({
    queryKey: ['cost_centres'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('cost_centres')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) return [] as CostCentre[]; // table not created yet
      return (data ?? []) as CostCentre[];
    },
  });

/**
 * Cost Centres — Tally-style master + Cost Centre Summary. Departments
 * (Pharmacy, Lab, OT, ...) are created here; voucher entry lines can be
 * allocated to a centre, and the summary shows Dr/Cr totals per centre
 * with drill-down to the allocated vouchers.
 */
const CostCentres: React.FC<{ onOpenVoucher?: (id: string) => void }> = ({ onOpenVoucher }) => {
  const queryClient = useQueryClient();
  const report = useTallyReport({
    filterFields: ['Particulars', 'Vch No.'],
    views: [
      { label: 'Ledger Vouchers', target: 'ledger-view' },
      { label: 'Day Book', target: 'day-book' },
      { label: 'Profit & Loss A/c', target: 'profit-loss' },
      { label: 'Trial Balance', target: 'trial-balance' },
    ],
  });
  const { from: fromDate, to: toDate } = report;
  const [openCentre, setOpenCentre] = useState<CostCentre | null>(null);
  const [newName, setNewName] = useState('');
  const [newCategoryId, setNewCategoryId] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ['cost_categories'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('cost_categories')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (error) return [] as CostCategory[];
      return (data ?? []) as CostCategory[];
    },
  });

  const { data: centres = [], isLoading: centresLoading } = useCostCentres();

  const { data: entries = [], isLoading: entriesLoading } = useQuery({
    queryKey: ['cost_centre_entries', fromDate, toDate],
    enabled: centres.length > 0,
    queryFn: async () => {
      try {
        const data = await fetchAllRows((from, to) =>
          (supabase as any)
            .from('voucher_entries')
            .select(
              'id, debit_amount, credit_amount, cost_centre_id, voucher:vouchers!inner(id, voucher_number, voucher_date, narration, status)',
            )
            .not('cost_centre_id', 'is', null)
            .eq('voucher.status', 'AUTHORISED')
            .gte('voucher.voucher_date', fromDate)
            .lte('voucher.voucher_date', toDate)
            .range(from, to),
        );
        return data as unknown as CentreEntry[];
      } catch {
        return [] as CentreEntry[]; // column not created yet
      }
    },
  });

  const summary = useMemo(() => {
    const byCentre = new Map<string, { dr: number; cr: number; count: number }>();
    for (const e of entries) {
      if (!e.cost_centre_id) continue;
      const s = byCentre.get(e.cost_centre_id) ?? { dr: 0, cr: 0, count: 0 };
      s.dr += Number(e.debit_amount) || 0;
      s.cr += Number(e.credit_amount) || 0;
      s.count += 1;
      byCentre.set(e.cost_centre_id, s);
    }
    return byCentre;
  }, [entries]);

  const centreEntries = useMemo(
    () => (openCentre ? entries.filter((e) => e.cost_centre_id === openCentre.id) : []),
    [entries, openCentre],
  );

  const addCentre = async (): Promise<void> => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from('cost_centres')
        .insert({ name, category_id: newCategoryId || null });
      if (error) throw error;
      toast.success(`Cost centre "${name}" created`);
      setNewName('');
      queryClient.invalidateQueries({ queryKey: ['cost_centres'] });
    } catch (err: any) {
      toast.error(
        err?.code === '23505'
          ? 'A cost centre with this name already exists'
          : 'Failed — run the cost centres migration first',
      );
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (c: CostCentre): Promise<void> => {
    try {
      const { error } = await (supabase as any).from('cost_centres').update({ is_active: false }).eq('id', c.id);
      if (error) throw error;
      toast.info(`"${c.name}" deactivated`);
      queryClient.invalidateQueries({ queryKey: ['cost_centres'] });
    } catch {
      toast.error('Failed to deactivate');
    }
  };

  const isLoading = centresLoading || entriesLoading;

  return (
    <>
    <TallyScreen
      title={openCentre ? `Cost Centre — ${openCentre.name}` : 'Cost Centre Summary'}
      onClose={openCentre ? () => setOpenCentre(null) : undefined}
      rail={report.rail}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        {openCentre ? (
          <>
            <div className="text-center">
              <div className="font-bold">{openCentre.name}</div>
              <div className="text-[11px]">
                {tallyDateLabel(fromDate)} to {tallyDateLabel(toDate)}
              </div>
            </div>
            <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
              <div className="w-20 px-1">Date</div>
              <div className="min-w-0 flex-1 px-1">Particulars</div>
              <div className="w-28 px-1">Vch No.</div>
              <div className="w-32 px-1 text-right">Debit</div>
              <div className="w-32 px-1 text-right">Credit</div>
            </div>
            {centreEntries.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => e.voucher?.id && onOpenVoucher?.(e.voucher.id)}
                title="Open voucher (alter)"
                className="flex w-full border-b border-dashed border-gray-200 text-left hover:bg-[#fdf6d8]"
              >
                <div className="w-20 px-1">{tallyDateLabel(e.voucher?.voucher_date || '')}</div>
                <div className="min-w-0 flex-1 truncate px-1">{e.voucher?.narration || ''}</div>
                <div className="w-28 px-1 font-mono text-[12px]">{e.voucher?.voucher_number || ''}</div>
                <div className="w-32 px-1 text-right font-mono">
                  {Number(e.debit_amount) > 0 ? fmt(Number(e.debit_amount)) : ''}
                </div>
                <div className="w-32 px-1 text-right font-mono">
                  {Number(e.credit_amount) > 0 ? fmt(Number(e.credit_amount)) : ''}
                </div>
              </button>
            ))}
          </>
        ) : (
          <>
            <div className="text-center text-[11px]">
              {tallyDateLabel(fromDate)} to {tallyDateLabel(toDate)}
            </div>
            <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
              <div className="min-w-0 flex-1 px-1">Cost Centre</div>
              <div className="w-24 px-1 text-right">Entries</div>
              <div className="w-36 px-1 text-right">Debit</div>
              <div className="w-36 px-1 text-right">Credit</div>
              <div className="w-16 px-1" />
            </div>

            {isLoading ? (
              <div className="py-10 text-center text-gray-400">Loading…</div>
            ) : centres.length === 0 ? (
              <div className="py-10 text-center text-gray-400">
                No cost centres yet — run the cost centres migration, then add departments below.
              </div>
            ) : (
              [...categories, { id: '__none__', name: 'Uncategorised' } as CostCategory]
                .map((cat) => ({
                  cat,
                  list: centres.filter((c) =>
                    cat.id === '__none__'
                      ? !c.category_id || !categories.some((k) => k.id === c.category_id)
                      : c.category_id === cat.id,
                  ),
                }))
                .filter(({ list }) => list.length > 0)
                .map(({ cat, list }) => (
                  <React.Fragment key={cat.id}>
                    {categories.length > 0 && (
                      <div className="mt-1.5 bg-[#eef3fa] px-1 font-bold">{cat.name}</div>
                    )}
                    {list.map((c) => {
                      const s = summary.get(c.id);
                      return (
                  <div key={c.id} className="flex border-b border-dashed border-gray-200 hover:bg-[#fdf6d8]">
                    <button
                      type="button"
                      onClick={() => s && setOpenCentre(c)}
                      className={`flex min-w-0 flex-1 text-left ${s ? '' : 'cursor-default text-gray-500'}`}
                      title={s ? 'Open centre entries' : 'No allocations in period'}
                    >
                      <div className="min-w-0 flex-1 truncate px-1 font-semibold">{c.name}</div>
                      <div className="w-24 px-1 text-right font-mono">{s?.count ?? ''}</div>
                      <div className="w-36 px-1 text-right font-mono">{s && s.dr > 0 ? fmt(s.dr) : ''}</div>
                      <div className="w-36 px-1 text-right font-mono">{s && s.cr > 0 ? fmt(s.cr) : ''}</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => deactivate(c)}
                      className="w-16 px-1 text-right text-[11px] text-gray-400 hover:text-red-600"
                      title="Deactivate cost centre"
                    >
                      hide
                    </button>
                  </div>
                      );
                    })}
                  </React.Fragment>
                ))
            )}

            {/* Tally-style quick creation */}
            <div className="mt-6 max-w-md border border-[#9db8d8]">
              <div className="bg-[#16437e] px-2 py-0.5 text-xs font-semibold text-white">Cost Centre Creation</div>
              <div className="flex items-center gap-2 bg-[#fffefb] p-2">
                <span className="shrink-0">Name</span>
                <span>:</span>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCentre()}
                  className="w-full border border-gray-400 bg-[#fdf6d8] px-2 py-0.5 focus:outline-none"
                  placeholder="e.g. Physiotherapy"
                />
                {categories.length > 0 && (
                  <select
                    value={newCategoryId}
                    onChange={(e) => setNewCategoryId(e.target.value)}
                    title="Cost category"
                    className="shrink-0 border border-gray-400 bg-white px-1 py-0.5 focus:outline-none"
                  >
                    <option value="">— Category —</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={addCentre}
                  disabled={saving || !newName.trim()}
                  className="shrink-0 border border-[#9db8d8] bg-white px-3 py-0.5 hover:bg-[#fdf6d8] disabled:text-gray-400"
                >
                  <span className="font-semibold text-[#1d5aa8]">
                    <span className="underline">A</span>:
                  </span>{' '}
                  Accept
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </TallyScreen>

    {report.popups}
    </>
  );
};

export default CostCentres;
