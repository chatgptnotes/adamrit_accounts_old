import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import {
  LayoutDashboard, Calendar, ClipboardList, Wallet, FileText, BookOpen, Clock,
  Receipt, ScrollText, TrendingUp, Award, Activity, Cross, ScanLine, Navigation,
  Phone, MessageCircle, Users, FileSpreadsheet, Files, Package, FileCheck2,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { canAccessReferralRegister } from '@/lib/referralRegisterAccess';

/**
 * Reports Center — one place that lists every standalone system report, ordered
 * most-used at the top. Per-patient documents (invoices, discharge summaries)
 * are intentionally excluded: those are opened from a specific patient/visit.
 */
interface ReportLink {
  title: string;
  route: string;
  description: string;
  icon: typeof FileText;
}

interface ReportSection {
  heading: string;
  items: ReportLink[];
}

// Sections are ordered by how frequently the team uses them; items within each
// section are likewise ordered most-used first.
const SECTIONS: ReportSection[] = [
  {
    heading: 'Workflow Reports',
    items: [
      { title: 'Approval Report', route: '/workflow-status-report/approval', description: 'Patients with approval pending or received', icon: FileCheck2 },
      { title: 'Extension Report', route: '/workflow-status-report/extension', description: 'Patients with extension pending or received', icon: Clock },
      { title: 'Discharge Report', route: '/workflow-status-report/discharge', description: 'Patients with discharge pending or done', icon: ClipboardList },
      { title: 'Bill Report', route: '/workflow-status-report/bill', description: 'Patients with bill pending or done', icon: Receipt },
      { title: 'Submission Report', route: '/workflow-status-report/submission', description: 'Patients with submission pending or done', icon: FileText },
      { title: 'Payment Report', route: '/workflow-status-report/payment', description: 'Patients with payment pending or received', icon: Wallet },
    ],
  },
  {
    heading: 'Dashboards & KPIs',
    items: [
      { title: 'Director Dashboard', route: '/director-dashboard', description: 'Hospital KPIs, collections, department activity', icon: LayoutDashboard },
      { title: 'Department Activity (Monthly)', route: '/department-activity-report', description: 'Day-wise entry counts per department — spot the dips', icon: LayoutDashboard },
      { title: "Today's IPD", route: '/todays-ipd', description: 'Current IPD census and discharge status', icon: Calendar },
      { title: "Today's OPD", route: '/todays-opd', description: 'Today’s OPD visits and walk-ins', icon: ClipboardList },
      { title: 'OPD Summary', route: '/opd-summary', description: 'Searchable OPD visit summaries', icon: ClipboardList },
      { title: 'Patient Documents', route: '/patient-documents-report', description: 'Track completed and pending patient documents', icon: Files },
      { title: 'Yojana Billing To-do', route: '/yojana-billing-todo-documents-report', description: "Today's pending documents for recent Yojana billing work", icon: FileCheck2 },
    ],
  },
  {
    heading: 'Financial',
    items: [
      { title: 'Bill Aging Statement', route: '/bill-aging-statement', description: 'Corporate bills aged by days outstanding', icon: Clock },
      { title: 'TPA / Insurance Claims', route: '/tpa-claims', description: 'Pre-auth to settlement tracker for private insurers and TPAs', icon: FileCheck2 },
      { title: 'Ledger Statement', route: '/ledger-statement', description: 'Account ledger by date range and narration', icon: FileText },
      { title: 'Cash Book', route: '/cash-book', description: 'Daily cash receipts and payments', icon: BookOpen },
      { title: 'Day Book', route: '/day-book', description: 'Daily journal of all transactions by mode', icon: BookOpen },
      { title: 'Financial Summary', route: '/financial-summary', description: 'Charges broken down by service category', icon: Wallet },
      { title: 'Expected Payment Date', route: '/expected-payment-date-report', description: 'Corporate bills by expected payment window', icon: Clock },
      { title: 'Advance Statement', route: '/advance-statement-report', description: 'Patient advances and adjustments', icon: Receipt },
      { title: 'PMJAY / MJPJAY Package Usage', route: '/pmjay-mjpjay-package-usage-report', description: 'Package-wise Yojana usage counts with patient details', icon: FileSpreadsheet },
      { title: 'Patient Ledger', route: '/patient-ledger', description: 'Per-patient transactions and running balance', icon: FileText },
      { title: 'IT Transaction Register', route: '/it-transaction-register', description: 'Transactions synced to Tally', icon: ScrollText },
    ],
  },
  {
    heading: 'Pharmacy',
    items: [
      { title: 'Inventory Report', route: '/pharmacy?tab=reports', description: 'Live stock, batch expiry, valuation, and low-stock alerts', icon: Package },
      { title: 'Monthly Purchase & Sales', route: '/pharmacy-monthly-purchase-sales-report', description: 'Monthly posted purchases and completed pharmacy sales', icon: TrendingUp },
    ],
  },
  {
    heading: 'Operational Registers',
    items: [
      { title: 'Casualty Register', route: '/casualty-register', description: 'Emergency/casualty admissions and status', icon: Cross },
      { title: 'Radiology Worklist', route: '/radiology-worklist', description: 'Radiology orders by workflow status', icon: ScanLine },
      { title: 'Phlebotomist', route: '/phlebotomist', description: 'Home collection assignments and status', icon: Navigation },
      { title: 'Telephony Dashboard', route: '/telephony', description: 'Call logs with patient lookup and actions', icon: Phone },
    ],
  },
  {
    heading: 'Marketing',
    items: [
      { title: 'Marketing Dashboard', route: '/marketing-dashboard', description: 'Daily marketing stats and chat notes', icon: TrendingUp },
      { title: 'Referral Register', route: '/referral-register', description: 'Admissions by panel, marketing executive, and referral doctor', icon: Users },
      { title: 'Marketing Incentives', route: '/marketing-incentives', description: 'Staff incentive achievement tracking', icon: Award },
    ],
  },
  {
    heading: 'Audit & Logs',
    items: [
      { title: 'Activity Log', route: '/activity-log', description: 'User system activity audit trail', icon: Activity },
      { title: 'Patient Journey Logs', route: '/patient-journey-logs', description: 'Patient movement from registration to discharge', icon: ScrollText },
      { title: 'Report Delivery', route: '/report-delivery', description: 'Lab report delivery and WhatsApp status', icon: MessageCircle },
    ],
  },
  {
    heading: 'Exports',
    items: [
      { title: 'Government Portal Import', route: '/government-portal-report-import', description: 'MJPJY/PMJAY caret-delimited report review', icon: FileSpreadsheet },
      { title: 'Patient Data Export', route: '/reports', description: 'Export admission/discharge data to Excel', icon: FileSpreadsheet },
    ],
  },
];

export default function ReportsCenter() {
  const { user } = useAuth();
  const visibleSections = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter(
          (item) => item.route !== '/referral-register' || canAccessReferralRegister(user),
        ),
      })).filter((section) => section.items.length > 0),
    [user],
  );

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-xl bg-primary/10 p-2 text-primary">
          <FileText className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Reports Center</h1>
          <p className="text-sm text-gray-500">All system reports in one place — most used at the top.</p>
        </div>
      </div>

      <div className="space-y-8">
        {visibleSections.map((section) => (
          <section key={section.heading}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
              {section.heading}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {section.items.map((item) => (
                <Link
                  key={item.route}
                  to={item.route}
                  className="group flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md active:scale-[0.99]"
                >
                  <div className="rounded-lg bg-primary/10 p-2 text-primary group-hover:bg-primary/20">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-800">{item.title}</div>
                    <div className="text-xs text-gray-500">{item.description}</div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
