import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  Banknote,
  BarChart3,
  BedDouble,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Coins,
  DoorOpen,
  Droplets,
  FileText,
  HandCoins,
  HeartPulse,
  Landmark,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageCircle,
  Mic,
  NotebookPen,
  Package,
  Pill,
  Receipt,
  ReceiptIndianRupee,
  ScanLine,
  Scissors,
  Search,
  ShoppingCart,
  Stethoscope,
  UserCheck,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * What this application actually does, on the front page.
 *
 * SELF-CONTAINED ON PURPOSE. This page is served to anyone on the internet, and
 * it used to build itself from the module registry -- which meant importing
 * that registry, staff names and all, into the bundle every anonymous visitor
 * downloads. The page rendered no names and shipped nineteen of them, readable
 * in devtools by anybody.
 *
 * So the public names live here instead, and the registry is not imported. The
 * cost is that this list no longer follows a rename by itself; that is what
 * scripts/check-public-labels.cjs is for, and it fails the build if an id here
 * stops existing or a staff name reappears.
 *
 * WHY THIS IS NOT ALL 76 MODULES. Roughly two dozen tiles are one person's work
 * queue and are named for them -- and so are their routes. Listing them here
 * would publish the staff list through the URLs even with the label cleaned up,
 * which is the whole thing the guard exists to prevent. Their CAPABILITY is
 * covered by the neutral tile beside them wherever one exists. The rest need
 * their routes renamed before they can appear, which is a bigger change than a
 * landing page.
 *
 * Keep each tile on ONE line in the form `id: '...', label: '...'` -- the guard
 * reads this file with a regex and cannot see a tile split across lines.
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
  /** Tailwind classes, written out in full because the compiler cannot see
   *  class names built by string concatenation. */
  accent: { chip: string; ring: string; text: string; glow: string };
  tiles: Tile[];
}

const GROUPS: Group[] = [
  {
    title: 'Patients & Visits',
    blurb: 'From the front desk to the gate pass',
    accent: {
      chip: 'bg-sky-50 text-sky-700 group-hover:bg-sky-600 group-hover:text-white',
      ring: 'hover:ring-sky-500/60',
      text: 'text-sky-700',
      glow: 'from-sky-500/10',
    },
    tiles: [
      { id: 'register', label: 'Register Patient', description: 'New patient & visit', href: '/register', icon: UserPlus },
      { id: 'patient-profile', label: 'Patient Profile', description: 'View patient details', href: '/patient-profile', icon: UserRound },
      { id: 'incoming-referrals', label: 'Incoming Referrals', description: 'Announce a referred or direct patient before arrival', href: '/incoming-referrals', icon: Megaphone },
      { id: 'direct-patients', label: 'Direct Patients', description: 'Announce a patient as DIRECT - no referees', href: '/direct-patients', icon: UserCheck },
      { id: 'discharge', label: 'Discharged Patients', description: 'Discharged patient list', href: '/discharge', icon: LogOut },
      { id: 'discharge-summary', label: 'Discharge Summary', description: 'Create, edit & print summary', href: '/discharge-summary', icon: FileText },
      { id: 'documents', label: 'Documents', description: 'Patient documents & downloads', href: '/documents', icon: FileText },
      { id: 'gate-pass', label: 'Gate Pass', description: 'Issue & print gate pass', href: '/gate-pass', icon: DoorOpen },
    ],
  },
  {
    title: 'Clinical Care',
    blurb: 'The ward, the theatre and the bedside',
    accent: {
      chip: 'bg-rose-50 text-rose-700 group-hover:bg-rose-600 group-hover:text-white',
      ring: 'hover:ring-rose-500/60',
      text: 'text-rose-700',
      glow: 'from-rose-500/10',
    },
    tiles: [
      { id: 'doctor-notes', label: 'Doctor Notes', description: 'Bedside clinical notes', href: '/doctor-notes', icon: Stethoscope },
      { id: 'medication-round', label: 'Medication Round', description: 'Mark doses given / missed', href: '/medication-round', icon: ClipboardCheck },
      { id: 'icu-admission', label: 'ICU Admission', description: 'Admit / transfer to ICU bed', href: '/icu-admission', icon: HeartPulse },
      { id: 'requisition', label: 'Requisition', description: 'Raise lab / radiology / store', href: '/requisition', icon: ClipboardList },
      { id: 'bed-booking', label: 'Bed Booking', description: 'Reserve a bed for an incoming patient', href: '/bed-booking', icon: CalendarCheck },
      { id: 'bed-shifting', label: 'Bed Shifting', description: 'Drag a patient to another bed', href: '/bed-shifting', icon: ArrowLeftRight },
      { id: 'occupancy', label: 'Bed Occupancy', description: 'Live ward & bed status', href: '/occupancy', icon: BedDouble },
      { id: 'dama', label: 'DAMA / LAMA', description: 'Discharge against medical advice', href: '/dama', icon: AlertTriangle },
      { id: 'stores-inventory', label: 'Stores & Inventory', description: 'Stock levels, movements, and reorder alerts', href: '/stores-inventory', icon: Package },
      { id: 'cath-lab', label: 'Cath Lab', description: 'Schedule, inventory and technicians', href: '/cath-lab', icon: HeartPulse },
    ],
  },
  {
    title: 'Diagnostics',
    blurb: 'Laboratory, imaging and dialysis',
    accent: {
      chip: 'bg-violet-50 text-violet-700 group-hover:bg-violet-600 group-hover:text-white',
      ring: 'hover:ring-violet-500/60',
      text: 'text-violet-700',
      glow: 'from-violet-500/10',
    },
    tiles: [
      { id: 'diagnostics-hope', label: 'Diagnostics (Hope)', description: 'Send patient to outside CT/MRI/lab', href: '/diagnostics-hope', icon: ScanLine },
      { id: 'diagnostics-ayushman', label: 'Diagnostics (Ayushman)', description: 'Send patient to outside CT/MRI/lab', href: '/diagnostics-ayushman', icon: ScanLine },
      { id: 'dialysis', label: 'Dialysis', description: 'Cycle billing & 30-day lab reports', href: '/dialysis', icon: Droplets },
      { id: 'dialysis-front-office', label: 'Dialysis Front Office', description: 'Book and track dialysis sessions at the desk', href: '/dialysis-front-office', icon: Activity },
      { id: 'dialysis-billing', label: 'Dialysis Billing', description: 'Patients ready to claim', href: '/dialysis-billing', icon: Receipt },
      { id: 'report', label: 'Reports', description: 'Occupancy, collections, census', href: '/report', icon: BarChart3 },
    ],
  },
  {
    title: 'Pharmacy',
    blurb: 'Dispensing, billing and suppliers',
    accent: {
      chip: 'bg-emerald-50 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white',
      ring: 'hover:ring-emerald-500/60',
      text: 'text-emerald-700',
      glow: 'from-emerald-500/10',
    },
    tiles: [
      { id: 'pharmacy-dispense', label: 'Pharmacy', description: 'Dispense / substitute approved meds', href: '/pharmacy-dispense', icon: Pill },
    ],
  },
  {
    title: 'Billing & Panels',
    blurb: 'Bills, implants and government schemes',
    accent: {
      chip: 'bg-amber-50 text-amber-700 group-hover:bg-amber-600 group-hover:text-white',
      ring: 'hover:ring-amber-500/60',
      text: 'text-amber-700',
      glow: 'from-amber-500/10',
    },
    tiles: [
      { id: 'billing', label: 'Billing', description: 'View bill & collect payment', href: '/billing', icon: Receipt },
      { id: 'advance', label: 'Advance Statement', description: 'Advances taken and what remains', href: '/advance', icon: Wallet },
      { id: 'implant-bill', label: 'Implant Bill', description: 'Create implant vendor invoice', href: '/implant-bill', icon: Receipt },
      { id: 'implant-calculation', label: 'Implant Calculation', description: 'Settle each discharged patient', href: '/implant-calculation', icon: ClipboardCheck },
      { id: 'implant-sticker', label: 'Implant Sticker', description: 'Create implant pouch cover sheet', href: '/implant-sticker', icon: ScanLine },
      { id: 'panel-documents', label: 'Panel Documents', description: 'Panel-wise mandatory docs', href: '/panel-documents', icon: ClipboardCheck },
      { id: 'panel-payment-received', label: 'Panel Payment Received', description: 'Record corporate / panel / Yojana payments', href: '/panel-payment-received', icon: ReceiptIndianRupee },
      { id: 'payments-due', label: 'Payments Due', description: 'Pay today\'s salary, rent and vendor obligations', href: '/payments-due', icon: CalendarClock },
      { id: 'spot-approval', label: 'Spot Approval', description: 'Approve an on-the-spot spend before it is made', href: '/spot-approval', icon: ClipboardCheck },
      { id: 'discharged-rm-cuts', label: 'Discharged RM Cuts', description: 'Referral commission due on discharged patients', href: '/discharged-rm-cuts', icon: Scissors },
    ],
  },
  {
    title: 'Cash & Accounts',
    blurb: 'Every rupee traceable to a person',
    accent: {
      chip: 'bg-teal-50 text-teal-700 group-hover:bg-teal-600 group-hover:text-white',
      ring: 'hover:ring-teal-500/60',
      text: 'text-teal-700',
      glow: 'from-teal-500/10',
    },
    tiles: [
      { id: 'opening-cash', label: 'Opening Cash', description: 'Count cash in hand and in the locker', href: '/opening-cash', icon: Banknote },
      { id: 'cash-handover', label: 'Cash Handover', description: 'Count the drawer and hand it over', href: '/cash-handover', icon: HandCoins },
      { id: 'cash-in-hand', label: 'Cash in Hand', description: 'What each counter is holding right now', href: '/cash-in-hand', icon: Coins },
      { id: 'daily-collection', label: 'Daily Collection', description: 'The day\'s takings, counter by counter', href: '/daily-collection', icon: BarChart3 },
      { id: 'bank-deposit', label: 'Bank Deposit', description: 'Pay cash into the bank, with the slip', href: '/bank-deposit', icon: Landmark },
      { id: 'cash-shift-report', label: 'Cash Shift Report', description: 'Opening counts, handovers and receipts', href: '/cash-shift-report', icon: NotebookPen },
      { id: 'expense-bills', label: 'Expense Bills', description: 'Record supplier and utility invoices', href: '/expense-bills', icon: ReceiptIndianRupee },
      { id: 'payment-voucher', label: 'Payment Voucher', description: 'Create payment voucher with invoice proof', href: '/payment-voucher', icon: Banknote },
      { id: 'receipt-voucher', label: 'Receipt Voucher', description: 'Create receipt voucher with invoice proof', href: '/receipt-voucher', icon: Receipt },
      { id: 'contra-voucher', label: 'Contra Voucher', description: 'Move money between cash and bank', href: '/contra-voucher', icon: ArrowLeftRight },
      { id: 'journal-voucher', label: 'Journal Voucher', description: 'Adjustments that move no cash', href: '/journal-voucher', icon: BookOpen },
      { id: 'bank-cash', label: 'Bank & Cash', description: 'Deposits, withdrawals, bank charges & interest', href: '/bank-cash', icon: ArrowLeftRight },
      { id: 'accounting', label: 'Accounting', description: 'Day book, ledgers, and the full Tally-style books', href: '/accounting', icon: BookOpen },
      { id: 'ask-books-voice', label: 'Ask the Books', description: 'Ask a question about the accounts out loud', href: '/ask-books-voice', icon: Mic },
    ],
  },
  {
    title: 'Management',
    blurb: 'Oversight, people and referrals',
    accent: {
      chip: 'bg-indigo-50 text-indigo-700 group-hover:bg-indigo-600 group-hover:text-white',
      ring: 'hover:ring-indigo-500/60',
      text: 'text-indigo-700',
      glow: 'from-indigo-500/10',
    },
    tiles: [
      { id: 'director', label: 'Director Dashboard', description: 'KPIs & payment deadlines', href: '/director', icon: LayoutDashboard },
      { id: 'hr-pulse', label: 'HR Pulse', description: 'Attendance, leave & HR alerts', href: '/hr-pulse', icon: HeartPulse },
      { id: 'referral-register', label: 'Referral Register', description: 'Complete referral entries', href: '/referral-register', icon: Users },
      { id: 'patient-feedback', label: 'Patient Feedback', description: 'Photo & video feedback from patients', href: '/patient-feedback', icon: MessageCircle },
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

const TileCard = ({
  label,
  description,
  href,
  Icon,
  accent,
}: {
  label: string;
  description: string;
  href: string;
  Icon: LucideIcon;
  accent: Group['accent'];
}) => (
  <a
    href={href}
    onClick={enter(href)}
    className={`group relative flex items-start gap-4 overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm ring-1 ring-transparent transition-all duration-200 hover:z-10 hover:-translate-y-1 hover:border-transparent hover:shadow-xl hover:ring-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${accent.ring}`}
  >
    {/* A wash of the group's colour, invisible until hover. Cheaper to read
        than a border change and it ties the card to its section. */}
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${accent.glow}`}
    />
    <span
      className={`relative mt-0.5 flex h-11 w-11 flex-none items-center justify-center rounded-xl transition-colors duration-200 ${accent.chip}`}
    >
      <Icon className="h-5 w-5" />
    </span>
    <div className="relative min-w-0 flex-1">
      <p className="font-semibold text-gray-900">{label}</p>
      <p className="mt-0.5 text-sm leading-snug text-gray-600">{description}</p>
    </div>
    <ArrowRight
      aria-hidden
      className="relative mt-1 h-4 w-4 flex-none -translate-x-1 text-gray-400 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100"
    />
  </a>
);

const LandingModules = () => {
  const [query, setQuery] = useState('');

  // Sixty-odd tiles is too many to scan. Filtering on label, description and
  // section means "cash", "bed" or "voucher" all land somewhere sensible.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GROUPS.map((g) => {
      if (!q) return g;
      if (g.title.toLowerCase().includes(q)) return g;
      return {
        ...g,
        tiles: g.tiles.filter(
          (t) =>
            t.label.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q),
        ),
      };
    }).filter((g) => g.tiles.length > 0);
  }, [query]);

  const total = GROUPS.reduce((n, g) => n + g.tiles.length, 0);
  const shown = groups.reduce((n, g) => n + g.tiles.length, 0);

  return (
    <section id="modules" className="relative bg-gradient-to-b from-gray-50 via-white to-white py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-base font-semibold leading-7 text-primary">Powerful Modules</h2>
          <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            The Complete Hospital Toolkit
          </p>
          <p className="mt-6 text-lg leading-8 text-gray-600">
            {total} modules, one system — from registration to the final ledger.
            Choose one to explore; you will be asked to sign in first.
          </p>
        </div>

        {/* Jump links and search. Sticky, because the list is long enough that
            the section headings scroll away before you have chosen. */}
        <div className="sticky top-0 z-20 -mx-6 mt-10 border-b border-gray-200/70 bg-white/85 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/70 lg:mx-0 lg:rounded-2xl lg:border">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <nav className="flex flex-wrap gap-2" aria-label="Module sections">
              {GROUPS.map((g) => (
                <a
                  key={g.title}
                  href={`#group-${g.title.toLowerCase().replace(/[^a-z]+/g, '-')}`}
                  className={`rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold transition-colors hover:border-current ${g.accent.text}`}
                >
                  {g.title}
                  <span className="ml-1.5 font-normal text-gray-400">{g.tiles.length}</span>
                </a>
              ))}
            </nav>
            <label className="relative lg:w-72">
              <span className="sr-only">Search modules</span>
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search modules…"
                className="w-full rounded-full border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </label>
          </div>
        </div>

        {groups.length === 0 ? (
          <p className="mt-16 text-center text-gray-500">
            Nothing matches “{query}”. Try “cash”, “bed”, “pharmacy” or “voucher”.
          </p>
        ) : (
          <div className="mt-12 space-y-16">
            {groups.map((g) => (
              <div key={g.title} id={`group-${g.title.toLowerCase().replace(/[^a-z]+/g, '-')}`} className="scroll-mt-28">
                <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <h3 className="text-2xl font-semibold tracking-tight text-gray-900">{g.title}</h3>
                  <p className="text-base text-gray-500">{g.blurb}</p>
                  <span className={`ml-auto text-sm font-semibold ${g.accent.text}`}>
                    {g.tiles.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {g.tiles.map((t) => (
                    <TileCard
                      key={t.id}
                      label={t.label}
                      description={t.description}
                      href={t.href}
                      Icon={t.icon}
                      accent={g.accent}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {query.trim() !== '' && groups.length > 0 && (
          <p className="mt-10 text-center text-sm text-gray-500">
            Showing {shown} of {total} modules.
          </p>
        )}
      </div>
    </section>
  );
};

export default LandingModules;
