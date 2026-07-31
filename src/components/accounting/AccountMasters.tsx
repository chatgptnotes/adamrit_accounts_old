import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import GroupCreation from './GroupCreation';
import TallyLedgerCreation from './TallyLedgerCreation';
import VoucherTypeCreation from './VoucherTypeCreation';
import { isTypingTarget, TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';

export interface MasterItem {
  id:
    | 'group'
    | 'ledger'
    | 'currency'
    | 'voucher-type'
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

/** Tally's centered master chooser used by both Create and Alter. */
const AccountMasters: React.FC<AccountMastersProps> = ({ mode = 'alter' }) => {
  const [active, setActive] = useState<MasterItem['id'] | null>(null);
  const [highlight, setHighlight] = useState(0);

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        isTypingTarget(event.target) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlight((current) => {
          const step = event.key === 'ArrowDown' ? 1 : -1;
          return Math.max(0, Math.min(MASTERS.length - 1, current + step));
        });
      } else if (event.key === 'Enter') {
        event.preventDefault();
        setActive(MASTERS[highlight].id);
      } else if (event.key === 'Escape' || event.key.toUpperCase() === 'Q') {
        event.preventDefault();
        if (active) setActive(null);
        else window.dispatchEvent(new CustomEvent('tally-escape'));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, highlight]);

  if (active) {
    const activeTitle = MASTERS.find((m) => m.id === active)?.label ?? '';
    return (
      <>
      <TallyScreen title={`${activeTitle} ${mode === 'create' ? 'Creation' : 'Alteration'}`} onClose={() => setActive(null)} rail={report.rail}>
        <div className="space-y-2 p-2">
          <Button variant="outline" size="sm" className="h-7 rounded-none text-xs" onClick={() => setActive(null)}>
            <span className="mr-1 font-bold">Esc</span>: List of Masters
          </Button>
          {active === 'group' && <GroupCreation />}
          {active === 'ledger' && <TallyLedgerCreation />}
          {active === 'voucher-type' && <VoucherTypeCreation />}
          {!['group', 'ledger', 'voucher-type'].includes(active) && (
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
                  onClick={() => setActive(master.id)}
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
