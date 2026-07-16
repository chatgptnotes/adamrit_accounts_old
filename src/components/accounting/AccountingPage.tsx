import React, { Suspense, lazy, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  PanelLeftOpen,
  PanelLeftClose,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import Dashboard from './Dashboard';
import { useTileAccess } from '@/hooks/useTileAccess';
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
import CashBankSummary from './CashBankSummary';
import CashBankBook from './CashBankBook';
import BillsReceivable from './BillsReceivable';
import BillsPayable from './BillsPayable';
import GroupSummary from './GroupSummary';
import VoucherRegister from './VoucherRegister';
import RatioAnalysis from './RatioAnalysis';
import ReceiptsPayments from './ReceiptsPayments';
import CostCentres from './CostCentres';
import GatewayOfTally from './GatewayOfTally';
import EditLog from './EditLog';
import FundsFlow from './FundsFlow';
import StatisticsScreen from './StatisticsScreen';
import OpeningBalances from './OpeningBalances';
import ExceptionReports from './ExceptionReports';
import BillwiseOutstanding from './BillwiseOutstanding';
import Banking from './Banking';

// Live Tally-gateway suite is heavy (12 sub-screens) — load on demand
const TallyLivePage = lazy(() => import('@/components/tally/TallyPage'));
import { TallyTopBar } from './tally/TallyChrome';

/** Navigation item definition for the accounting sidebar. */
interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  /** When set, the item opens this app route instead of an accounting tab */
  route?: string;
}

/** All available navigation items in the sidebar. */
const NAV_ITEMS: NavItem[] = [
  { id: 'gateway', label: 'Gateway of Tally', icon: LayoutDashboard },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'chart-of-accounts', label: 'Chart of Accounts', icon: BookOpen },
  { id: 'masters', label: 'Masters', icon: FolderCog },
  { id: 'opening-balances', label: 'Opening Balances', icon: Scale },
  { id: 'voucher-entry', label: 'Voucher Entry', icon: FileText },
  { id: 'day-book', label: 'Day Book', icon: Calendar },
  { id: 'cash-bank-book', label: 'Cash/Bank Book', icon: BookOpen },
  { id: 'cash-bank-summary', label: 'Cash/Bank Summary', icon: Landmark },
  { id: 'ledger-view', label: 'Ledger View', icon: BookMarked },
  { id: 'group-summary', label: 'Group Summary', icon: FolderCog },
  { id: 'voucher-register', label: 'Registers', icon: BookMarked },
  { id: 'ratio-analysis', label: 'Ratio Analysis', icon: Scale },
  { id: 'receipts-payments', label: 'Receipts & Payments', icon: ArrowLeftRight },
  { id: 'cost-centres', label: 'Cost Centres', icon: Building2 },
  { id: 'edit-log', label: 'Edit Log', icon: FileText },
  { id: 'exception-reports', label: 'Exception Reports', icon: Scale },
  { id: 'billwise', label: 'Bill-wise Outstandings', icon: Landmark },
  { id: 'banking', label: 'Banking', icon: Building2 },
  { id: 'trial-balance', label: 'Trial Balance', icon: Scale },
  { id: 'balance-sheet', label: 'Balance Sheet', icon: Landmark },
  { id: 'profit-loss', label: 'Profit & Loss', icon: TrendingUp },
  { id: 'cash-flow', label: 'Cash Flow', icon: ArrowLeftRight },
  { id: 'funds-flow', label: 'Funds Flow', icon: ArrowLeftRight },
  { id: 'statistics', label: 'Statistics', icon: Scale },
  { id: 'bank-reconciliation', label: 'Bank Reconciliation', icon: Building2 },
  { id: 'bills-receivable', label: 'Bills Receivable', icon: Landmark },
  { id: 'bills-payable', label: 'Bills Payable', icon: Landmark },
  { id: 'bill-aging', label: 'Bill Aging Statement', icon: Calendar, route: '/bill-aging-statement' },
  { id: 'expected-payments', label: 'Expected Payments', icon: Calendar, route: '/expected-payment-date-report' },
  { id: 'director-receivables', label: 'Receivables Matrix', icon: TrendingUp, route: '/director-dashboard' },
  { id: 'tally-live', label: 'Tally Live (Gateway)', icon: ArrowLeftRight },
  { id: 'tally-import-export', label: 'Tally Import/Export', icon: ArrowDownUp },
];

/** Renders the active section component based on the current tab selection. */
const renderContent = (
  activeTab: string,
  goTo: (id: string) => void,
  openVoucher: (id: string) => void,
  openGroup: (head: string) => void,
  openLedger: (accountId: string) => void,
): React.ReactNode => {
  switch (activeTab) {
    case 'gateway':
      return <GatewayOfTally onNavigate={goTo} />;
    case 'dashboard':
      return <Dashboard onOpenVoucher={openVoucher} canSeeTile={canSeeTile} />;
    case 'chart-of-accounts':
      return <ChartOfAccounts />;
    case 'masters':
      return <AccountMasters />;
    case 'opening-balances':
      return <OpeningBalances />;
    case 'voucher-entry':
      return <VoucherEntry />;
    case 'day-book':
      return <DayBook onOpenVoucher={openVoucher} />;
    case 'cash-bank-book':
      return <CashBankBook onOpenVoucher={openVoucher} />;
    case 'cash-bank-summary':
      return <CashBankSummary onClose={() => goTo('dashboard')} />;
    case 'ledger-view':
      return <LedgerView onOpenVoucher={openVoucher} />;
    case 'group-summary':
      return <GroupSummary onOpenLedger={openLedger} />;
    case 'voucher-register':
      return <VoucherRegister onOpenVoucher={openVoucher} />;
    case 'ratio-analysis':
      return <RatioAnalysis />;
    case 'receipts-payments':
      return <ReceiptsPayments />;
    case 'cost-centres':
      return <CostCentres onOpenVoucher={openVoucher} />;
    case 'edit-log':
      return <EditLog onOpenVoucher={openVoucher} />;
    case 'exception-reports':
      return <ExceptionReports onOpenVoucher={openVoucher} />;
    case 'billwise':
      return <BillwiseOutstanding onOpenVoucher={openVoucher} />;
    case 'banking':
      return <Banking />;
    case 'tally-live':
      return (
        <Suspense fallback={<div className="py-16 text-center text-sm text-gray-400">Loading Tally Live…</div>}>
          <TallyLivePage />
        </Suspense>
      );
    case 'trial-balance':
      return <TrialBalance onOpenGroup={openGroup} />;
    case 'balance-sheet':
      return <BalanceSheet />;
    case 'profit-loss':
      return <ProfitLoss />;
    case 'cash-flow':
      return <CashFlow />;
    case 'funds-flow':
      return <FundsFlow />;
    case 'statistics':
      return <StatisticsScreen />;
    case 'bank-reconciliation':
      return <BankReconciliation />;
    case 'bills-receivable':
      return <BillsReceivable />;
    case 'bills-payable':
      return <BillsPayable />;
    case 'tally-import-export':
      return <TallyImportExport />;
    default:
      return <GatewayOfTally onNavigate={goTo} />;
  }
};

/**
 * AccountingPage -- main layout for the accounting module.
 * Uses a fixed left sidebar for navigation and a scrollable content area
 * that renders the selected section.
 */
const AccountingPage: React.FC<{ initialTab?: string }> = ({ initialTab }) => {
  const navigate = useNavigate();
  const { canSeeTile } = useTileAccess();
  const [activeTab, setActiveTab] = useState<string>(
    () => initialTab ?? localStorage.getItem('accounting-default-tab') ?? 'gateway',
  );
  const [initialVoucherCategory, setInitialVoucherCategory] = useState<string | undefined>();
  const activeTabRef = React.useRef(activeTab);
  activeTabRef.current = activeTab;

  // Rail buttons broadcast navigation / save-view requests
  React.useEffect(() => {
    const onGoto = (e: Event) => {
      setInitialVoucherCategory(undefined);
      setActiveTab((e as CustomEvent).detail as string);
    };
    const onOpenVoucher = (e: Event) => {
      setInitialVoucherCategory((e as CustomEvent).detail as string);
      setActiveTab('voucher-entry');
    };
    const onSave = () => {
      localStorage.setItem('accounting-default-tab', activeTabRef.current);
      import('sonner').then(({ toast }) =>
        toast.success('View saved — the accounting module will open here from now on'),
      );
    };
    window.addEventListener('tally-goto', onGoto);
    window.addEventListener('tally-open-voucher', onOpenVoucher);
    window.addEventListener('tally-save-view', onSave);
    return () => {
      window.removeEventListener('tally-goto', onGoto);
      window.removeEventListener('tally-open-voucher', onOpenVoucher);
      window.removeEventListener('tally-save-view', onSave);
    };
  }, []);
  // Tally's Esc from a screen with nothing to close returns to the Gateway
  React.useEffect(() => {
    const back = () => setActiveTab((t) => (t === 'gateway' ? t : 'gateway'));
    // Fallback for content not wrapped in TallyScreen (e.g. the Tally Live
    // suite): TallyScreen preventDefaults its own Esc handling, so only
    // unhandled Esc presses land here.
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (e.key === 'Escape' && !typing && !e.defaultPrevented) back();
    };
    window.addEventListener('tally-escape', back);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('tally-escape', back);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Drill-down stack: group -> ledger -> voucher, each layer closable back
  const [alterVoucherId, setAlterVoucherId] = useState<string | null>(null);
  const [drillLedgerId, setDrillLedgerId] = useState<string | null>(null);
  const [drillGroup, setDrillGroup] = useState<string | null>(null);
  // Collapsed icon rail by default — Tally-style full-width canvas.
  const [navExpanded, setNavExpanded] = useState(false);

  return (
    <div className="tally-skin min-h-screen flex bg-[#d5e3f0]">
      {/* ---- Left Sidebar (icon rail when collapsed) ---- */}
      <aside
        className={`${navExpanded ? 'w-56' : 'w-12'} bg-white border-r shadow-sm flex flex-col flex-shrink-0 transition-all print:hidden`}
      >
        {/* Sidebar header / collapse toggle */}
        <div className={`flex items-center gap-2 border-b py-4 ${navExpanded ? 'px-5' : 'justify-center px-0'}`}>
          {navExpanded && (
            <>
              <Calculator className="h-5 w-5 text-blue-600" />
              <h1 className="flex-1 text-lg font-semibold text-blue-600">Accounting</h1>
            </>
          )}
          <button
            onClick={() => setNavExpanded((v) => !v)}
            title={navExpanded ? 'Collapse menu' : 'Expand menu'}
            aria-label={navExpanded ? 'Collapse menu' : 'Expand menu'}
            className="text-gray-500 hover:text-blue-600"
          >
            {navExpanded ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </button>
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
                  onClick={() => (item.route ? navigate(item.route) : setActiveTab(item.id))}
                  title={item.label}
                  className={`
                    w-full flex items-center gap-3 py-2.5 text-sm transition-colors
                    ${navExpanded ? 'px-5' : 'justify-center px-0'}
                    ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-50'
                    }
                  `}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {navExpanded && <span>{item.label}</span>}
                </button>
              );
            })}
          </nav>
        </ScrollArea>
      </aside>

      {/* ---- Content Area with Tally chrome ---- */}
      <main className="flex-1 flex flex-col overflow-y-auto">
        <TallyTopBar
          sections={NAV_ITEMS.map(({ id, label }) => ({ id, label }))}
          onGoTo={(id) => {
            const item = NAV_ITEMS.find((n) => n.id === id);
            if (item?.route) navigate(item.route);
            else setActiveTab(id);
          }}
        />
        <div className="flex-1">
          {alterVoucherId ? (
            <VoucherEntry voucherId={alterVoucherId} onDone={() => setAlterVoucherId(null)} />
          ) : drillLedgerId ? (
            <LedgerView
              key={drillLedgerId}
              initialAccountId={drillLedgerId}
              onOpenVoucher={setAlterVoucherId}
              onClose={() => setDrillLedgerId(null)}
            />
          ) : drillGroup ? (
            <GroupSummary head={drillGroup} onOpenLedger={setDrillLedgerId} onClose={() => setDrillGroup(null)} />
          ) : (
            activeTab === 'voucher-entry'
              ? <VoucherEntry initialVoucherCategory={initialVoucherCategory} />
              : renderContent(activeTab, setActiveTab, setAlterVoucherId, setDrillGroup, setDrillLedgerId)
          )}
        </div>
      </main>
    </div>
  );
};

export default AccountingPage;
