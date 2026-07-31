import React, { useMemo, useState } from 'react';
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
  account_group: string | null;
  parent_account_id: string | null;
  is_active: boolean | null;
  opening_balance: number | null;
  opening_balance_type: string | null;
}

const TYPES = [
  'CURRENT_ASSETS',
  'FIXED_ASSETS',
  'CURRENT_LIABILITIES',
  'LONG_TERM_LIABILITIES',
  'EQUITY',
  'DIRECT_INCOME',
  'INDIRECT_INCOME',
  'DIRECT_EXPENSES',
  'INDIRECT_EXPENSES',
];

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));

/**
 * Chart of Accounts — Tally's List of Accounts: every account grouped under
 * the Tally heads with code, type and opening balance; C: Create adds an
 * account, clicking a row opens Alteration, D deletes (guarded by usage).
 */
const ChartOfAccounts: React.FC = () => {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Account | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState('INDIRECT_EXPENSES');
  const [opening, setOpening] = useState('');
  const [openingType, setOpeningType] = useState<'DR' | 'CR'>('DR');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showInactive, setShowInactive] = useState(false);
  const { selectedCompanyId } = useAccountingCompany();

  const report = useTallyReport({
    supportsColumns: false,
    filterFields: ['Particulars'],
    views: [
      { label: 'Trial Balance', target: 'trial-balance' },
      { label: 'Group Summary', target: 'group-summary' },
      { label: 'Masters', target: 'masters' },
      { label: 'Opening Balances', target: 'opening-balances' },
    ],
    screenKeys: [
      { hotkey: 'F4', label: 'Create', onClick: () => openForm(null) },
      {
        hotkey: 'F6',
        label: showInactive ? 'Hide Inactive' : 'Show Inactive',
        active: showInactive,
        onClick: () => setShowInactive((v) => !v),
      },
    ],
  });

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['coa_all', selectedCompanyId],
    // Inactive rows included — this is the master-maintenance screen, and
    // F6 toggles whether they are shown.
    queryFn: () =>
      fetchActiveAccounts<Account>({ columns: '*', companyId: selectedCompanyId, includeInactive: true }),
  });

  const parents = useMemo(
    () => new Set(accounts.map((a) => a.parent_account_id).filter(Boolean)),
    [accounts],
  );

  const openForm = (a: Account | null): void => {
    setEditing(a);
    setCreating(!a);
    setName(a?.account_name ?? '');
    setCode(a?.account_code ?? '');
    setType(a?.account_type ?? 'INDIRECT_EXPENSES');
    const ob = Number(a?.opening_balance) || 0;
    setOpening(ob ? String(ob) : '');
    setOpeningType((a?.opening_balance_type?.toUpperCase() as 'DR' | 'CR') || 'DR');
    setActive(a?.is_active !== false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeForm = (): void => {
    setEditing(null);
    setCreating(false);
  };

  const handleAccept = async (): Promise<void> => {
    const trimmed = name.trim();
    const codeT = code.trim();
    if (!trimmed || !codeT) {
      toast.error('Enter both name and code');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        account_name: trimmed,
        account_code: codeT,
        account_type: type,
        account_group: headOfType(type) ?? type,
        opening_balance: Number(opening) || 0,
        opening_balance_type: Number(opening) ? openingType : null,
        is_active: active,
      };
      if (editing) {
        const { error } = await supabase.from('chart_of_accounts').update(payload).eq('id', editing.id);
        if (error) throw error;
        toast.success(`Account "${trimmed}" altered`);
      } else {
        const { error } = await supabase.from('chart_of_accounts').insert(payload);
        if (error) throw error;
        toast.success(`Account "${trimmed}" created`);
      }
      queryClient.invalidateQueries();
      closeForm();
    } catch (err: any) {
      toast.error(err?.code === '23505' ? 'An account with this code already exists' : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!editing) return;
    if (!window.confirm(`Delete account ${editing.account_code} — ${editing.account_name}?`)) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('chart_of_accounts').delete().eq('id', editing.id);
      if (error) throw error;
      toast.info(`Account "${editing.account_name}" deleted`);
      queryClient.invalidateQueries();
      closeForm();
    } catch {
      toast.error('This account has vouchers against it — deactivate it instead');
    } finally {
      setSaving(false);
    }
  };

  const visible = useMemo(
    () => accounts.filter((a) => showInactive || a.is_active !== false),
    [accounts, showInactive],
  );
  const byHead = useMemo(() => {
    const map = new Map<string, Account[]>();
    for (const a of visible) {
      const head = headOfType(a.account_type) ?? 'Primary';
      map.set(head, [...(map.get(head) ?? []), a]);
    }
    return map;
  }, [visible]);
  const heads = [...HEAD_ORDER.filter((h) => byHead.has(h)), ...(byHead.has('Primary') ? ['Primary'] : [])];

  const formOpen = creating || !!editing;

  return (
    <>
    <TallyScreen
      title="Chart of Accounts"
      onClose={formOpen ? closeForm : undefined}
      rail={report.rail}
    >
      <div className="px-3 pb-4 pt-1 text-[13px]">
        <div className="text-center">
          <div className="font-bold">List of Accounts</div>
          <div className="text-[11px]">
            Groups: {heads.length} · Accounts: {visible.length}
          </div>
        </div>

        {/* Creation / Alteration panel */}
        {formOpen && (
          <div className="mx-auto mb-3 mt-1 max-w-2xl border border-[#9db8d8]">
            <div className="bg-[#16437e] px-2 py-0.5 text-xs font-semibold text-white">
              {editing ? `Account Alteration — ${editing.account_name}` : 'Account Creation'}
            </div>
            <div className="space-y-1 bg-[#fffefb] p-2">
              <div className="flex items-center gap-2">
                <span className="w-36 shrink-0">Name</span>
                <span>:</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full max-w-md border border-gray-400 bg-[#fdf6d8] px-2 py-0.5 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-36 shrink-0">Code</span>
                <span>:</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-32 border-b border-dashed border-gray-400 bg-transparent px-1 font-mono focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-36 shrink-0">Under (type)</span>
                <span>:</span>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="border-b border-dashed border-gray-400 bg-transparent px-1 font-semibold focus:outline-none"
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {headOfType(t)} ({t})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-36 shrink-0">Opening Balance</span>
                <span>:</span>
                <input
                  type="number"
                  value={opening}
                  onChange={(e) => setOpening(e.target.value)}
                  className="w-36 border-b border-dashed border-gray-400 bg-transparent px-1 text-right font-mono focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <select
                  value={openingType}
                  onChange={(e) => setOpeningType(e.target.value as 'DR' | 'CR')}
                  className="border-b border-dashed border-gray-400 bg-transparent px-1 font-semibold focus:outline-none"
                >
                  <option value="DR">Dr</option>
                  <option value="CR">Cr</option>
                </select>
              </div>
              {editing && (
                <div className="flex items-center gap-2">
                  <span className="w-36 shrink-0">Active</span>
                  <span>:</span>
                  <button
                    type="button"
                    onClick={() => setActive((v) => !v)}
                    className="min-w-[44px] border-b border-dashed border-gray-400 px-2 text-left font-semibold hover:bg-[#fdf6d8]"
                  >
                    {active ? 'Yes' : 'No'}
                  </button>
                </div>
              )}
              <div className="flex gap-1 pt-2">
                <button
                  type="button"
                  onClick={handleAccept}
                  disabled={saving}
                  className="border border-[#9db8d8] bg-[#16437e] px-3 py-0.5 text-white hover:bg-[#0f3363]"
                >
                  <span className="underline">A</span>: {saving ? 'Saving…' : 'Accept'}
                </button>
                <button type="button" onClick={closeForm} className="border border-[#9db8d8] bg-white px-3 py-0.5 hover:bg-[#fdf6d8]">
                  <span className="underline">Q</span>: Quit
                </button>
                {editing && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="ml-auto border border-[#9db8d8] bg-white px-3 py-0.5 text-red-700 hover:bg-red-50"
                  >
                    <span className="underline">D</span>: Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Grouped list */}
        <div className="mt-1 flex border-y border-black bg-[#f0f4fa] font-semibold">
          <div className="min-w-0 flex-1 px-1">Name of Account</div>
          <div className="w-36 shrink-0 px-1">Code</div>
          <div className="w-44 shrink-0 px-1">Type</div>
          <div className="w-40 shrink-0 px-1 text-right">Opening Balance</div>
        </div>
        {isLoading ? (
          <div className="py-10 text-center text-gray-400">Loading…</div>
        ) : (
          heads.map((head) => (
            <React.Fragment key={head}>
              <div className="mt-1.5 flex bg-[#eef3fa] font-bold">
                <div className="min-w-0 flex-1 px-1">{head}</div>
                <div className="w-36 shrink-0 px-1" />
                <div className="w-44 shrink-0 px-1" />
                <div className="w-40 shrink-0 px-1 text-right text-[11px] font-normal italic text-gray-600">
                  {byHead.get(head)!.length} account(s)
                </div>
              </div>
              {byHead.get(head)!.map((a) => {
                const ob = Number(a.opening_balance) || 0;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => openForm(a)}
                    title="Alter account"
                    className={`flex w-full border-b border-dashed border-gray-200 text-left hover:bg-[#fdf6d8] ${
                      a.is_active === false ? 'text-gray-400' : ''
                    } ${parents.has(a.id) ? 'italic' : ''}`}
                  >
                    <div className="min-w-0 flex-1 truncate px-1 pl-4">
                      {a.account_name}
                      {a.is_active === false ? ' (inactive)' : ''}
                    </div>
                    <div className="w-36 shrink-0 truncate px-1 font-mono text-[12px]">{a.account_code}</div>
                    <div className="w-44 shrink-0 truncate px-1 text-[11px] text-gray-500">{a.account_type}</div>
                    <div className="w-40 shrink-0 px-1 text-right font-mono">
                      {ob ? `${fmt(ob)} ${a.opening_balance_type?.toUpperCase() === 'CR' ? 'Cr' : 'Dr'}` : ''}
                    </div>
                  </button>
                );
              })}
            </React.Fragment>
          ))
        )}
      </div>
    </TallyScreen>

    {report.popups}
    </>
  );
};

export default ChartOfAccounts;
