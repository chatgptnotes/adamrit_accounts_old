import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { fetchActiveAccounts } from '@/lib/fetchAccounts';
import GroupCreation from './GroupCreation';
import TallyLedgerCreation from './TallyLedgerCreation';
import VoucherTypeCreation from './VoucherTypeCreation';
import CostCentreMasters from './CostCentreMasters';
import BudgetMaster from './BudgetMaster';
import { useAccountingCompany } from './AccountingCompanyContext';
import { TallyScreen } from './tally/TallyChrome';
import { useShortcuts } from './tally/keyboard';
import { useTallyReport } from './tally/useTallyReport';

export interface MasterItem {
  id:
    | 'group'
    | 'ledger'
    | 'currency'
    | 'voucher-type'
    | 'cost-category'
    | 'cost-centre'
    | 'budget'
    | 'stock-group'
    | 'stock-category'
    | 'stock-item'
    | 'unit'
    | 'godown'
    | 'pan-cin';
  label: string;
  section: 'Accounting Masters' | 'Inventory Masters' | 'Statutory Details';
}

// Keep the complete Tally master list visible. Screens that are supported by
// Adamrit open normally; the remaining entries open an explanatory screen.
const MASTERS: MasterItem[] = [
  { id: 'group', label: 'Group', section: 'Accounting Masters' },
  { id: 'ledger', label: 'Ledger', section: 'Accounting Masters' },
  { id: 'currency', label: 'Currency', section: 'Accounting Masters' },
  { id: 'voucher-type', label: 'Voucher Type', section: 'Accounting Masters' },
  { id: 'cost-category', label: 'Cost Category', section: 'Accounting Masters' },
  { id: 'cost-centre', label: 'Cost Centre', section: 'Accounting Masters' },
  { id: 'budget', label: 'Budget', section: 'Accounting Masters' },
  { id: 'stock-group', label: 'Stock Group', section: 'Inventory Masters' },
  { id: 'stock-category', label: 'Stock Category', section: 'Inventory Masters' },
  { id: 'stock-item', label: 'Stock Item', section: 'Inventory Masters' },
  { id: 'unit', label: 'Unit', section: 'Inventory Masters' },
  { id: 'godown', label: 'Godown', section: 'Inventory Masters' },
  { id: 'pan-cin', label: 'PAN/CIN Details', section: 'Statutory Details' },
];

interface AccountMastersProps {
  mode?: 'create' | 'alter';
}

/**
 * Tally's "List of Ledgers" picker — the screen between Alter → Ledger and
 * the alteration form. Type to filter, arrows to move, Enter to open;
 * "Create" at the top starts a fresh ledger instead.
 */
const LedgerPickList: React.FC<{
  onPick: (id: string) => void;
  onCreate: () => void;
  onBack: () => void;
}> = ({ onPick, onCreate, onBack }) => {
  const { selectedCompanyId } = useAccountingCompany();
  const [filter, setFilter] = useState('');
  const [cursor, setCursor] = useState(0);

  const { data: ledgers = [], isLoading } = useQuery({
    queryKey: ['ledger-pick-list', selectedCompanyId],
    enabled: !!selectedCompanyId,
    staleTime: 60_000,
    queryFn: () =>
      fetchActiveAccounts<{ id: string; account_name: string; account_code: string | null; account_group: string | null }>({
        columns: 'id, account_name, account_code, account_group',
        companyId: selectedCompanyId,
      }),
  });

  const sorted = useMemo(
    () => [...ledgers].sort((a, b) => a.account_name.localeCompare(b.account_name)),
    [ledgers],
  );
  const q = filter.trim().toLowerCase();
  const visible = q
    ? sorted.filter(
        (l) => l.account_name.toLowerCase().includes(q) || (l.account_code || '').toLowerCase().includes(q),
      )
    : sorted;
  const clampedCursor = Math.min(cursor, Math.max(0, visible.length - 1));

  return (
    <div className="flex min-h-[70vh] items-start justify-center pt-5 sm:pt-10">
      <div className="w-full max-w-[460px] overflow-hidden border border-[#8fb0d4] bg-[#dfeaf7] shadow-sm">
        <div className="bg-white px-3 py-2 text-center">
          <div className="text-sm font-semibold">Master Alteration</div>
          <input
            autoFocus
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(visible.length - 1, c + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); const hit = visible[clampedCursor]; if (hit) onPick(hit.id); }
              else if (e.key === 'Escape') { e.preventDefault(); onBack(); }
            }}
            placeholder="Type the ledger name…"
            className="mt-1 w-full border border-[#b8c9dd] bg-[#fdf6d8] px-2 py-1 text-sm outline-none focus:border-blue-600"
          />
        </div>
        <div className="bg-[#2a68a8] px-3 py-1.5 text-sm font-semibold text-white">List of Ledgers</div>
        <div className="flex justify-end gap-4 border-b border-[#b8c9dd] bg-[#e9eff7] px-3 py-1 text-sm">
          <button type="button" className="text-[#1a4d8f] hover:underline" onClick={onCreate}>Create</button>
          <button type="button" className="text-[#1a4d8f] hover:underline" onClick={onBack}>Back</button>
        </div>
        <div className="max-h-[52vh] overflow-y-auto">
          {isLoading ? (
            <p className="px-3 py-6 text-center text-sm text-gray-600">Loading ledgers…</p>
          ) : visible.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-gray-600">
              {q ? 'No ledger matches that name.' : 'No ledgers in this company yet.'}
            </p>
          ) : (
            visible.slice(0, 400).map((ledger, index) => (
              <button
                key={ledger.id}
                type="button"
                onClick={() => onPick(ledger.id)}
                onMouseEnter={() => setCursor(index)}
                className={`block w-full border-b border-white px-3 py-1 text-left text-sm ${
                  index === clampedCursor ? 'bg-[#ffc423] font-semibold text-black' : 'text-[#1a4d8f] hover:bg-[#fdf6d8]'
                }`}
              >
                {ledger.account_name}
                {ledger.account_code ? (
                  <span className="ml-2 text-xs text-gray-500">{ledger.account_code}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
        <div className="border-t border-[#b8c9dd] bg-[#dce6f2] px-3 py-1 text-right text-xs text-gray-700">
          {visible.length.toLocaleString('en-IN')}{visible.length > 400 ? ' — showing 400, type to narrow' : ''} ▼
        </div>
      </div>
    </div>
  );
};

/** Tally's centered master chooser used by both Create and Alter. */
const AccountMasters: React.FC<AccountMastersProps> = ({ mode = 'alter' }) => {
  const [active, setActive] = useState<MasterItem['id'] | null>(null);
  const [highlight, setHighlight] = useState(0);
  // Alter → Ledger goes through Tally's List of Ledgers picker first:
  // null = picker showing, 'new' = create fresh, else the ledger id to alter.
  const [pickedLedger, setPickedLedger] = useState<string | null>(null);

  const report = useTallyReport({
    // Master creation screens have no report columns to compare
    supportsColumns: false,
    filterFields: ['Master'],
    views: [
      { label: 'Chart of Accounts', target: 'chart-of-accounts' },
      { label: 'Opening Balances', target: 'opening-balances' },
      { label: 'Trial Balance', target: 'trial-balance' },
      { label: 'Voucher Entry', target: 'voucher-entry' },
    ],
    screenKeys: [{ hotkey: 'F10', label: 'Other Masters', onClick: () => setActive(null) }],
  });

  const quit = (): void => {
    if (active) {
      setActive(null);
      setPickedLedger(null);
    } else window.dispatchEvent(new CustomEvent('tally-escape'));
  };

  useShortcuts([
    {
      combo: 'ArrowDown',
      layer: 'screen',
      label: 'Move the master cursor',
      run: () => setHighlight((c) => Math.min(MASTERS.length - 1, c + 1)),
    },
    { combo: 'ArrowUp', layer: 'screen', run: () => setHighlight((c) => Math.max(0, c - 1)) },
    { combo: 'Enter', layer: 'screen', label: 'Open the highlighted master', run: () => { setPickedLedger(null); setActive(MASTERS[highlight].id); } },
    { combo: 'Esc', layer: 'screen', run: quit },
    { combo: 'Q', layer: 'screen', label: 'Quit', run: quit },
  ]);

  // Alter → Ledger: Tally goes through the List of Ledgers before the form.
  if (active === 'ledger' && mode === 'alter' && pickedLedger === null) {
    return (
      <>
      <TallyScreen title="Ledger Alteration" onClose={() => setActive(null)} rail={report.rail}>
        <LedgerPickList
          onPick={(id) => setPickedLedger(id)}
          onCreate={() => setPickedLedger('new')}
          onBack={() => setActive(null)}
        />
      </TallyScreen>
      {report.popups}
      </>
    );
  }

  if (active) {
    const activeTitle = MASTERS.find((m) => m.id === active)?.label ?? '';
    return (
      <>
      <TallyScreen title={`${activeTitle} ${mode === 'create' ? 'Creation' : 'Alteration'}`} onClose={() => setActive(null)} rail={report.rail}>
        <div className="space-y-2 p-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 rounded-none text-xs"
            onClick={() => {
              if (active === 'ledger' && mode === 'alter') setPickedLedger(null);
              else setActive(null);
            }}
          >
            <span className="mr-1 font-bold">Esc</span>: {active === 'ledger' && mode === 'alter' ? 'List of Ledgers' : 'List of Masters'}
          </Button>
          {active === 'group' && <GroupCreation />}
          {active === 'ledger' && (
            <TallyLedgerCreation
              key={pickedLedger || 'create'}
              initialAccountId={pickedLedger && pickedLedger !== 'new' ? pickedLedger : null}
            />
          )}
          {active === 'voucher-type' && <VoucherTypeCreation />}
          {active === 'cost-category' && <CostCentreMasters kind="category" />}
          {active === 'cost-centre' && <CostCentreMasters kind="centre" />}
          {active === 'budget' && <BudgetMaster />}
          {!['group', 'ledger', 'voucher-type', 'cost-category', 'cost-centre', 'budget'].includes(active) && (
            <div className="border border-[#b8c9dd] bg-[#e2e7ee] p-8 text-center">
              <div className="text-base font-semibold text-[#1a4d8f]">
                {activeTitle} Master
              </div>
              <p className="mt-2 text-sm text-gray-600">
                This Tally master is listed here for navigation consistency. Its creation screen is not available in Adamrit yet.
              </p>
            </div>
          )}
        </div>
      </TallyScreen>

      {report.popups}
      </>
    );
  }

  return (
    <>
    <TallyScreen title={mode === 'create' ? 'Master Creation' : 'Master Alteration'} rail={report.rail}>
    <div className="flex min-h-[70vh] items-start justify-center pt-5 sm:pt-10">
      <div className="w-full max-w-[430px] overflow-hidden border border-[#8fb0d4] bg-[#dfeaf7] shadow-sm">
        <div className="bg-[#2a68a8] px-3 py-1.5 text-center text-sm font-semibold text-white">
          List of Masters
        </div>
        <div className="px-0 py-1">
          {(['Accounting Masters', 'Inventory Masters', 'Statutory Details'] as const).map((section) => (
            <React.Fragment key={section}>
              <div className="border-b border-[#b8c9dd] bg-[#e2e7ee] px-3 py-1.5 text-sm font-bold text-black">
                {section}
              </div>
              {MASTERS.map((master, index) => master.section === section && (
                <button
                  key={master.id}
                  type="button"
                  onClick={() => { setPickedLedger(null); setActive(master.id); }}
                  onMouseEnter={() => setHighlight(index)}
                  className={`block w-full border-b border-white px-4 py-2 text-left text-sm ${
                    index === highlight ? 'bg-[#ffc423] font-semibold text-black' : 'text-[#1a4d8f] hover:bg-[#fdf6d8]'
                  }`}
                >
                  {master.label}
                </button>
              ))}
            </React.Fragment>
          ))}
        </div>
        <div className="border-t border-[#b8c9dd] bg-[#dce6f2] px-3 py-1.5 text-xs text-gray-600">
          ↑/↓ Select · Enter Open · Esc Back
        </div>
      </div>
    </div>
    </TallyScreen>

    {report.popups}
    </>
  );
};

export default AccountMasters;
