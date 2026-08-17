import React from 'react';
import {
  Activity,
  AlertTriangle,
  Ambulance,
  ArrowLeftRight,
  Award,
  Banknote,
  BarChart3,
  BedDouble,
  BookOpen,
  Briefcase,
  BriefcaseMedical,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  DoorOpen,
  Droplets,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Globe,
  HandCoins,
  HeartPulse,
  Landmark,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageCircle,
  Microscope,
  NotebookPen,
  Package,
  PackageSearch,
  Pill,
  Receipt,
  ReceiptIndianRupee,
  RefreshCw,
  Scan,
  ScanLine,
  ShieldCheck,
  ShieldPlus,
  ShoppingCart,
  Siren,
  Stethoscope,
  Syringe,
  Ticket,
  UserCheck,
  UserPlus,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';

/**
 * What this application actually does, on the front page.
 *
 * SELF-CONTAINED ON PURPOSE. This page is served to anyone on the internet, and
 * it used to build itself from the module registry -- which meant importing
 * that registry, staff names and all, into the bundle every anonymous visitor
 * downloads. The page rendered no names and shipped nineteen of them: "Nisha
 * Cash Handover", "Document azhar", "Register Patient Diksha", readable in
 * devtools by anybody.
 *
 * So the public names live here instead, and the registry is not imported. The
 * cost is that this list no longer follows a rename by itself; that is what
 * scripts/check-public-labels.cjs is for, and it fails the build if an id here
 * stops existing or a staff name reappears.
 */
interface Tile {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

interface Group {
  title: string;
  blurb: string;
  tiles: Tile[];
}

const GROUPS: Group[] = [
  {
    title: 'Patients & Visits',
    blurb: 'From the front desk to the gate pass',
    tiles: [
      { id: 'register', label: 'Register Patient', description: 'New patient & visit', href: '/register', icon: UserPlus },
      { id: 'patient-profile', label: 'Patient Profile', description: 'View patient details', href: '/patient-profile', icon: UserRound },
      { id: 'appointments', label: 'Appointments', description: 'Book and manage consultation slots', href: '/appointments', icon: CalendarDays },
      { id: 'queue-management', label: 'Queue & Tokens', description: 'Call the next patient and drive the waiting-room display', href: '/queue-management', icon: Ticket },
      { id: 'patient-portal', label: 'Patient Portal', description: 'What the patient sees — reports, bills and visit history', href: '/patient-portal', icon: Globe },
      { id: 'incoming-referrals', label: 'Incoming Referrals', description: 'Announce a referred or direct patient before arrival, link on registration', href: '/incoming-referrals', icon: Megaphone },
      { id: 'direct-patients', label: 'Direct Patients', description: 'Announce a patient as DIRECT - referees blocked by the database', href: '/direct-patients', icon: UserCheck },
      { id: 'discharge', label: 'Discharged Patients', description: 'Discharged patient list', href: '/discharge', icon: LogOut },
      { id: 'discharge-summary', label: 'Discharge Summary', description: 'Create, edit & print summary', href: '/discharge-summary', icon: FileText },
      { id: 'documents', label: 'Documents', description: 'Patient documents & downloads', href: '/documents', icon: FileText },
      { id: 'gate-pass', label: 'Gate Pass', description: 'Issue & print gate pass', href: '/gate-pass', icon: DoorOpen },
    ],
  },
  {
    title: 'Clinical Care',
    blurb: 'The ward, the theatre and the bedside',
    tiles: [
      { id: 'doctor-notes', label: 'Doctor Notes', description: 'Bedside clinical notes', href: '/doctor-notes', icon: Stethoscope },
      { id: 'nursing', label: 'Nursing', description: 'Ward nursing station — vitals, care notes and handover', href: '/nursing', icon: Syringe },
      { id: 'casualty-register', label: 'Casualty Register', description: 'Emergency arrivals, MLC entries and the statutory register', href: '/casualty-register', icon: Siren },
      { id: 'medication-round', label: 'Medication Round', description: 'Mark doses given / missed', href: '/medication-round', icon: ClipboardCheck },
      { id: 'icu-admission', label: 'ICU Admission', description: 'Admit / transfer to ICU bed', href: '/icu-admission', icon: HeartPulse },
      { id: 'ot-schedule-gaurav', label: 'OT Schedule', description: 'Schedule surgery date & time', href: '/ot-schedule-gaurav', icon: CalendarClock },
      { id: 'requisition', label: 'Requisition', description: 'Raise lab / radiology / store', href: '/requisition', icon: ClipboardList },
      { id: 'bed-booking', label: 'Bed Booking', description: 'Reserve a bed for an incoming patient', href: '/bed-booking', icon: CalendarCheck },
      { id: 'bed-shifting', label: 'Bed Shifting', description: 'Drag a patient to another bed', href: '/bed-shifting', icon: ArrowLeftRight },
      { id: 'occupancy', label: 'Bed Occupancy', description: 'Live ward & bed status', href: '/occupancy', icon: BedDouble },
      { id: 'dama', label: 'DAMA / LAMA', description: 'Discharge against medical advice', href: '/dama', icon: AlertTriangle },
      { id: 'stores-inventory', label: 'Stores & Inventory', description: 'Stock levels, movements in and out, and reorder alerts', href: '/stores-inventory', icon: Package },
      { id: 'cath-lab', label: 'Cath Lab', description: 'Catheterisation lab schedule, inventory and technicians', href: '/cath-lab', icon: HeartPulse },
    ],
  },
  {
    title: 'Diagnostics',
    blurb: 'Laboratory, imaging and dialysis',
    tiles: [
      { id: 'lab', label: 'Laboratory', description: 'Test orders, sample collection and result entry', href: '/lab', icon: Microscope },
      { id: 'radiology', label: 'Radiology', description: 'Imaging worklist, reporting and PACS image viewing', href: '/radiology', icon: Scan },
      { id: 'diagnostics-hope', label: 'Diagnostics (Hope)', description: 'Send patient to outside CT/MRI/lab — posts on DRM Hope', href: '/diagnostics-hope', icon: ScanLine },
      { id: 'diagnostics-ayushman', label: 'Diagnostics (Ayushman)', description: 'Send patient to outside CT/MRI/lab — posts on Ayushman', href: '/diagnostics-ayushman', icon: ScanLine },
      { id: 'dialysis', label: 'Dialysis', description: 'Cycle billing & 30-day lab reports', href: '/dialysis', icon: Droplets },
      { id: 'dialysis-billing', label: 'Dialysis Billing', description: 'Patients whose block is complete and ready to claim', href: '/dialysis-billing', icon: Receipt },
      { id: 'report', label: 'Reports', description: 'Occupancy, collections, census', href: '/report', icon: BarChart3 },
    ],
  },
  {
    title: 'Pharmacy',
    blurb: 'Dispensing, billing and suppliers',
    tiles: [
      { id: 'pharmacy-dispense', label: 'Pharmacy', description: 'Dispense / substitute approved meds', href: '/pharmacy-dispense', icon: Pill },
      { id: 'pharmacy-billing-abhishek', label: 'Pharmacy Billing', description: 'Bill the patient, generate the invoice, take payment by QR', href: '/pharmacy-billing-abhishek', icon: ShoppingCart },
      { id: 'pharmacy-dues-abhishek', label: 'Supplier Dues', description: 'Outstanding supplier invoices, pay full or part in cash', href: '/pharmacy-dues-abhishek', icon: ReceiptIndianRupee },
      { id: 'pharmacy-vendor-lalit', label: 'Pharmacy Vendors', description: 'Vendor bills from GRNs — scan the QR, pay, attach the proof', href: '/pharmacy-vendor-lalit', icon: Package },
      { id: 'purchase-orders', label: 'Purchase Orders', description: 'Raise orders to suppliers and receive stock against them', href: '/pharmacy/purchase-orders/list', icon: FileSpreadsheet },
      { id: 'inventory-tracking', label: 'Stock & Expiry', description: 'Batch-wise stock with expiry tracking and reorder alerts', href: '/pharmacy/inventory-tracking', icon: PackageSearch },
    ],
  },
  {
    title: 'Billing & Panels',
    blurb: 'Bills, implants and government schemes',
    tiles: [
      { id: 'billing', label: 'Billing', description: 'View bill & collect payment', href: '/billing', icon: Receipt },
      { id: 'implant-bill', label: 'Implant Bill', description: 'Create implant vendor invoice', href: '/implant-bill', icon: Receipt },
      { id: 'implant-calculation', label: 'Implant Calculation', description: 'Settle each discharged patient: direct or referred cut', href: '/implant-calculation', icon: ClipboardCheck },
      { id: 'implant-sticker', label: 'Implant Sticker', description: 'Create implant pouch cover sheet', href: '/implant-sticker', icon: ScanLine },
      { id: 'tpa-claims', label: 'TPA & Insurance Claims', description: 'Raise, track and settle third-party insurance claims', href: '/tpa-claims', icon: ShieldCheck },
      { id: 'pmjay-mjpjay-master', label: 'Government Schemes', description: 'PMJAY and MJPJAY packages, rates and eligibility', href: '/pmjay-mjpjay-master', icon: Building2 },
      { id: 'corporate-claim-tracking', label: 'Corporate Claims', description: 'Chase corporate and panel money owed, stage by stage', href: '/corporate-claim-tracking', icon: Briefcase },
      { id: 'panel-documents', label: 'Panel Documents', description: 'Panel-wise mandatory docs', href: '/panel-documents', icon: ClipboardCheck },
      { id: 'panel-payment-received', label: 'Panel Payment Received', description: 'Record corporate / panel / Yojana payments as they arrive', href: '/panel-payment-received', icon: ReceiptIndianRupee },
      { id: 'payments-due', label: 'Payments Due', description: 'Pay today\'s salary, rent and vendor obligations', href: '/payments-due', icon: CalendarClock },
    ],
  },
  {
    title: 'Cash & Accounts',
    blurb: 'Every rupee traceable to a person',
    tiles: [
      { id: 'opening-cash', label: 'Opening Cash', description: 'Count cash in hand and in the locker before your shift', href: '/opening-cash', icon: Banknote },
      { id: 'cash-handover', label: 'Cash Handover', description: 'Count the drawer and hand it over', href: '/cash-handover', icon: HandCoins },
      { id: 'bank-deposit', label: 'Bank Deposit', description: 'Pay cash into the bank, with the slip — directors are told', href: '/bank-deposit', icon: Landmark },
      { id: 'cash-shift-report', label: 'Cash Shift Report', description: 'Opening counts, handovers and the receipts in between', href: '/cash-shift-report', icon: NotebookPen },
      { id: 'expense-bills', label: 'Expense Bills', description: 'Record supplier and utility invoices', href: '/expense-bills', icon: ReceiptIndianRupee },
      { id: 'payment-voucher', label: 'Payment Voucher', description: 'Create payment voucher with invoice proof', href: '/payment-voucher', icon: Banknote },
      { id: 'receipt-voucher', label: 'Receipt Voucher', description: 'Create receipt voucher with invoice proof', href: '/receipt-voucher', icon: Receipt },
      { id: 'bank-cash', label: 'Bank & Cash', description: 'Deposits, withdrawals, bank charges & interest', href: '/bank-cash', icon: ArrowLeftRight },
      { id: 'accounting', label: 'Accounting', description: 'Day book, ledgers, trial balance and the full Tally-style books', href: '/accounting', icon: BookOpen },
      { id: 'tally', label: 'Tally Sync', description: 'Push vouchers to Tally and reconcile what came back', href: '/tally', icon: RefreshCw },
    ],
  },
  {
    title: 'Management',
    blurb: 'Oversight, people and referrals',
    tiles: [
      { id: 'director', label: 'Director Dashboard', description: 'KPIs & payment deadlines', href: '/director', icon: LayoutDashboard },
      { id: 'hr-pulse', label: 'HR Pulse', description: 'Attendance, leave & HR alerts', href: '/hr-pulse', icon: HeartPulse },
      { id: 'referral-register', label: 'Referral Register', description: 'Complete referral entries', href: '/referral-register', icon: Users },
      { id: 'referee-ruby', label: 'Referee Register', description: 'OPDs & admissions · how patients found us', href: '/referee-ruby', icon: Megaphone },
      { id: 'patient-feedback', label: 'Patient Feedback', description: 'Photo & video feedback from patients', href: '/patient-feedback', icon: MessageCircle },
    ],
  },
  {
    title: 'Connected Products',
    blurb: 'Sister systems that open on their own site',
    tiles: [
      { id: 'hrpulse-site', label: 'HR Pulse', description: 'Staff records, payroll and statutory returns — the full product', href: 'https://www.hrpulse.site/', icon: Users },
      { id: 'nabh-online', label: 'NABH Online', description: 'Accreditation evidence, incident reporting, audits and quality reviews', href: 'https://nabh.online', icon: Award },
      { id: 'emergency-seva', label: 'Emergency Seva', description: 'Ambulance dispatch and emergency response — Raftaar Help', href: 'https://emergencyseva.in', icon: Ambulance },
      { id: 'zerorisk-agent', label: 'Zero Risk Agent', description: 'AI-powered platform recovering millions in denied claims from ESIC, CGHS and ECHS', href: 'https://zeroriskagent.com', icon: ShieldPlus },
      { id: 'ddo-center', label: 'DDO Center', description: "Doctor's Digital Office — AI practice management that cuts clinical documentation time for physicians and clinics", href: 'https://www.ddo.center/', icon: BriefcaseMedical },
    ],
  },
];

/**
 * A visitor who is not signed in has not "visited" yet, so App would show them
 * this page again at whatever route they clicked — the link would look broken.
 * Marking the visit first sends them on to sign in instead, which is where an
 * internal system should send a stranger.
 */
const enter = (href: string) => (event: React.MouseEvent) => {
  event.preventDefault();
  try {
    localStorage.setItem('hmis_visited', 'true');
  } catch {
    // Private browsing: the link still works, the landing page just returns.
  }
  window.location.href = href;
};

/** A separate product on its own domain, not a route inside this app. */
const isExternal = (href: string) => /^https?:\/\//.test(href);

const TileCard = ({
  label,
  description,
  href,
  Icon,
}: {
  label: string;
  description: string;
  href: string;
  Icon: LucideIcon;
}) => {
  const external = isExternal(href);

  return (
    <a
      href={href}
      // The sign-in redirect is for routes in this app. A sister product has its
      // own login, so sending the visitor through ours would be a detour to the
      // wrong door — external tiles open directly, in their own tab.
      onClick={external ? undefined : enter(href)}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="group flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <span className="mt-0.5 inline-flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-semibold text-gray-900">
          {label}
          {external && (
            <ExternalLink className="h-3.5 w-3.5 flex-none text-gray-400" aria-label="opens in a new tab" />
          )}
        </span>
        <span className="mt-0.5 block text-sm leading-snug text-gray-600 line-clamp-2">
          {description}
        </span>
      </span>
    </a>
  );
};

const LandingModules = () => {
  const groups = GROUPS.filter((g) => g.tiles.length > 0);

  const total = groups.reduce((n, g) => n + g.tiles.length, 0);

  return (
    <section id="modules" className="bg-white py-20">
      <div className="container mx-auto px-6">
        <div className="mb-14 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
            <Activity className="h-4 w-4" />
            {total} modules
          </span>
          <h2 className="mt-4 text-4xl font-bold text-gray-900">Everything the hospital runs on</h2>
          <p className="mx-auto mt-3 max-w-2xl text-lg text-gray-600">
            One system from registration to the ledger. Choose a module to open it — you will
            be asked to sign in first.
          </p>
        </div>

        <div className="space-y-12">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-gray-200 pb-2">
                <h3 className="text-xl font-semibold text-gray-900">{g.title}</h3>
                <p className="text-sm text-gray-500">{g.blurb}</p>
                <span className="ml-auto text-sm text-gray-400">{g.tiles.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {g.tiles.map((t) => (
                  <TileCard
                    key={t.id}
                    label={t.label}
                    description={t.description}
                    href={t.href}
                    Icon={t.icon}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default LandingModules;
