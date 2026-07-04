import React, { useState } from 'react';
import {
  LayoutDashboard,
  BookOpen,
  FileText,
  Calendar,
  BookMarked,
  Scale,
  Landmark,
  TrendingUp,
  ArrowLeftRight,
  Building2,
  Calculator,
  Loader2,
  FolderCog,
  ArrowDownUp,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import Dashboard from './Dashboard';
import ChartOfAccounts from './ChartOfAccounts';
import AccountMasters from './AccountMasters';
import TallyImportExport from './TallyImportExport';
import VoucherEntry from './VoucherEntry';
import DayBook from './DayBook';
import LedgerView from './LedgerView';
import TrialBalance from './TrialBalance';
import BalanceSheet from './BalanceSheet';
import ProfitLoss from './ProfitLoss';
import CashFlow from './CashFlow';
import BankReconciliation from './BankReconciliation';

/** Navigation item definition for the accounting sidebar. */
interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
}

/** All available navigation items in the sidebar. */
const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'chart-of-accounts', label: 'Chart of Accounts', icon: BookOpen },
  { id: 'masters', label: 'Masters', icon: FolderCog },
  { id: 'voucher-entry', label: 'Voucher Entry', icon: FileText },
  { id: 'day-book', label: 'Day Book', icon: Calendar },
  { id: 'ledger-view', label: 'Ledger View', icon: BookMarked },
  { id: 'trial-balance', label: 'Trial Balance', icon: Scale },
  { id: 'balance-sheet', label: 'Balance Sheet', icon: Landmark },
  { id: 'profit-loss', label: 'Profit & Loss', icon: TrendingUp },
  { id: 'cash-flow', label: 'Cash Flow', icon: ArrowLeftRight },
  { id: 'bank-reconciliation', label: 'Bank Reconciliation', icon: Building2 },
  { id: 'tally-import-export', label: 'Tally Import/Export', icon: ArrowDownUp },
];

/** Renders the active section component based on the current tab selection. */
const renderContent = (activeTab: string): React.ReactNode => {
  switch (activeTab) {
    case 'dashboard':
      return <Dashboard />;
    case 'chart-of-accounts':
      return <ChartOfAccounts />;
    case 'masters':
      return <AccountMasters />;
    case 'voucher-entry':
      return <VoucherEntry />;
    case 'day-book':
      return <DayBook />;
    case 'ledger-view':
      return <LedgerView />;
    case 'trial-balance':
      return <TrialBalance />;
    case 'balance-sheet':
      return <BalanceSheet />;
    case 'profit-loss':
      return <ProfitLoss />;
    case 'cash-flow':
      return <CashFlow />;
    case 'bank-reconciliation':
      return <BankReconciliation />;
    case 'tally-import-export':
      return <TallyImportExport />;
    default:
      return <Dashboard />;
  }
};

/**
 * AccountingPage -- main layout for the accounting module.
 * Uses a fixed left sidebar for navigation and a scrollable content area
 * that renders the selected section.
 */
const AccountingPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('dashboard');

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* ---- Left Sidebar ---- */}
      <aside className="w-56 bg-white border-r shadow-sm flex flex-col flex-shrink-0">
        {/* Sidebar header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b">
          <Calculator className="h-5 w-5 text-blue-600" />
          <h1 className="text-lg font-semibold text-blue-600">Accounting</h1>
        </div>

        {/* Navigation list */}
        <ScrollArea className="flex-1">
          <nav className="py-2">
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              const Icon = item.icon;

              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`
                    w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors
                    ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-50'
                    }
                  `}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </ScrollArea>
      </aside>

      {/* ---- Content Area ---- */}
      <main className="flex-1 p-6 overflow-y-auto">
        {renderContent(activeTab)}
      </main>
    </div>
  );
};

export default AccountingPage;
