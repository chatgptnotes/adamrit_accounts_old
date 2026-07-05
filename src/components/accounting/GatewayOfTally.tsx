import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { TallyScreen } from './tally/TallyChrome';

const tallyDateLabel = (d: Date): string => {
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${d.getDate()}-${month}-${String(d.getFullYear()).slice(2)}`;
};

const fyRange = (): string => {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `1-Apr-${String(y).slice(2)} to 31-Mar-${String(y + 1).slice(2)}`;
};

interface MenuItem {
  label: string;
  /** Accounting tab id to open; 'more' opens the submenu */
  target: string;
  /** Which letter is Tally's hot-capital in the label */
  hotIndex?: number;
}

interface MenuSection {
  heading: string | null;
  items: MenuItem[];
}

// Tally's Gateway menu, mapped onto this module's screens.
const MAIN_MENU: MenuSection[] = [
  {
    heading: 'MASTERS',
    items: [
      { label: 'Create', target: 'masters' },
      { label: 'Alter', target: 'masters' },
      { label: 'Chart of Accounts', target: 'chart-of-accounts', hotIndex: 1 },
      { label: 'Opening Balances', target: 'opening-balances', hotIndex: 8 },
    ],
  },
  {
    heading: 'TRANSACTIONS',
    items: [
      { label: 'Vouchers', target: 'voucher-entry' },
      { label: 'Day Book', target: 'day-book', hotIndex: 7 },
    ],
  },
  {
    heading: 'UTILITIES',
    items: [
      { label: 'Banking', target: 'bank-reconciliation', hotIndex: 2 },
      { label: 'Import/Export', target: 'tally-import-export' },
    ],
  },
  {
    heading: 'REPORTS',
    items: [
      { label: 'Balance Sheet', target: 'balance-sheet' },
      { label: 'Profit & Loss A/c', target: 'profit-loss' },
      { label: 'Trial Balance', target: 'trial-balance' },
      { label: 'Ratio Analysis', target: 'ratio-analysis' },
      { label: 'Display More Reports', target: 'more', hotIndex: 8 },
      { label: 'Dashboard', target: 'dashboard', hotIndex: 5 },
    ],
  },
];

const MORE_REPORTS: MenuSection[] = [
  {
    heading: 'ACCOUNT BOOKS',
    items: [
      { label: 'Cash/Bank Book', target: 'cash-bank-book' },
      { label: 'Cash/Bank Summary', target: 'cash-bank-summary' },
      { label: 'Ledger Vouchers', target: 'ledger-view' },
      { label: 'Group Summary', target: 'group-summary' },
      { label: 'Registers', target: 'voucher-register' },
    ],
  },
  {
    heading: 'STATEMENTS OF ACCOUNTS',
    items: [
      { label: 'Bills Receivable', target: 'bills-receivable' },
      { label: 'Bills Payable', target: 'bills-payable' },
      { label: 'Cost Centres', target: 'cost-centres' },
      { label: 'Cash Flow', target: 'cash-flow' },
      { label: 'Funds Flow', target: 'funds-flow' },
      { label: 'Statistics', target: 'statistics' },
      { label: 'Receipts & Payments', target: 'receipts-payments' },
      { label: 'Edit Log', target: 'edit-log' },
    ],
  },
];

/**
 * Gateway of Tally — the iconic home screen: current period/date and company
 * panel on the left, the Masters / Transactions / Utilities / Reports menu
 * on the right, with "Display More Reports" opening the deeper report list.
 */
const GatewayOfTally: React.FC<{ onNavigate: (tab: string) => void }> = ({ onNavigate }) => {
  const { hospitalConfig } = useAuth();
  const [more, setMore] = useState(false);
  const sections = more ? MORE_REPORTS : MAIN_MENU;
  const today = new Date();

  const hotLabel = (item: MenuItem) => {
    const i = item.hotIndex ?? 0;
    return (
      <>
        {item.label.slice(0, i)}
        <span className="font-semibold text-[#a00]">{item.label[i]}</span>
        {item.label.slice(i + 1)}
      </>
    );
  };

  return (
    <TallyScreen title={more ? 'Display More Reports' : 'Gateway of Tally'} onClose={more ? () => setMore(false) : undefined}>
      <div className="flex min-h-[70vh] text-[13px]">
        {/* Left: period / date / company panel */}
        <div className="w-2/5 border-r border-[#9db8d8] bg-[#f4f8fc] p-3">
          <div className="border-b border-gray-300 pb-1">
            <div className="text-[10px] font-semibold tracking-wider text-gray-500">CURRENT PERIOD</div>
            <div className="mt-0.5">{fyRange()}</div>
          </div>
          <div className="mt-2 border-b border-gray-300 pb-1">
            <div className="text-[10px] font-semibold tracking-wider text-gray-500">CURRENT DATE</div>
            <div className="mt-0.5">
              {today.toLocaleDateString('en-GB', { weekday: 'long' })}, {tallyDateLabel(today)}
            </div>
          </div>
          <div className="mt-4">
            <div className="text-[10px] font-semibold tracking-wider text-gray-500">NAME OF COMPANY</div>
            <div className="mt-1 font-bold text-[#16437e]">{hospitalConfig.name} Hospital</div>
          </div>
        </div>

        {/* Right: Gateway menu */}
        <div className="flex flex-1 items-start justify-center pt-6">
          <div className="w-72 border border-[#9db8d8] bg-white shadow">
            <div className="bg-[#7a97b8] px-3 py-1 text-center text-[13px] font-semibold text-white">
              {more ? 'Display More Reports' : 'Gateway of Tally'}
            </div>
            <div className="py-1">
              {sections.map((sec) => (
                <React.Fragment key={sec.heading ?? 'x'}>
                  {sec.heading && (
                    <div className="px-3 pb-0.5 pt-2 text-center text-[10px] font-semibold tracking-wider text-gray-400">
                      {sec.heading}
                    </div>
                  )}
                  {sec.items.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => (item.target === 'more' ? setMore(true) : onNavigate(item.target))}
                      className="block w-full px-3 py-0.5 text-center text-[#16437e] hover:bg-[#fdd835] hover:font-semibold"
                    >
                      {hotLabel(item)}
                    </button>
                  ))}
                </React.Fragment>
              ))}
              <div className="px-3 pb-1 pt-3 text-center">
                <button
                  type="button"
                  onClick={() => (more ? setMore(false) : window.history.back())}
                  className="w-full py-0.5 text-center text-[#16437e] hover:bg-[#fdd835] hover:font-semibold"
                >
                  <span className="font-semibold text-[#a00]">Q</span>uit
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TallyScreen>
  );
};

export default GatewayOfTally;
