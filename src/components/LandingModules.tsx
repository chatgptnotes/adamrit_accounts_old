import React from 'react';
import {
  Activity,
  BookOpen,
  HeartPulse,
  type LucideIcon,
} from 'lucide-react';
import { getModule } from '@/tablet/config/modules';

/**
 * What this application actually does, on the front page.
 *
 * Labels, descriptions and icons are read from the module registry rather than
 * copied here, so a tile renamed in modules.ts is renamed here too. A
 * hand-written list of seventy modules would be wrong within a fortnight —
 * "Advance Statement" became "Advance Statement Arshiya" without anybody
 * updating a second list, and that is the normal case, not the exception.
 *
 * A few entries are full-site pages with no tablet tile (Accounting, Cath Lab),
 * so they carry their own label and route.
 */

interface Extra {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

interface Group {
  title: string;
  blurb: string;
  /** Module ids, resolved against the registry. Unknown ids are skipped. */
  ids: string[];
  extras?: Extra[];
}

const GROUPS: Group[] = [
  {
    title: 'Patients & Visits',
    blurb: 'From the front desk to the gate pass',
    ids: ['register', 'patient-profile', 'incoming-referrals', 'direct-patients',
      'discharge', 'discharge-summary', 'documents', 'gate-pass'],
  },
  {
    title: 'Clinical Care',
    blurb: 'The ward, the theatre and the bedside',
    ids: ['doctor-notes', 'medication-round', 'icu-admission', 'ot-schedule-gaurav',
      'requisition', 'bed-booking', 'bed-shifting', 'occupancy', 'dama'],
    extras: [
      {
        id: 'cath-lab',
        label: 'Cath Lab',
        description: 'Catheterisation lab schedule, inventory and technicians',
        href: '/cath-lab',
        icon: HeartPulse,
      },
    ],
  },
  {
    title: 'Diagnostics',
    blurb: 'Laboratory, imaging and dialysis',
    ids: ['diagnostics-hope', 'diagnostics-ayushman', 'dialysis', 'dialysis-billing',
      'dialysis-front-office', 'report'],
  },
  {
    title: 'Pharmacy',
    blurb: 'Dispensing, billing and suppliers',
    ids: ['pharmacy-dispense', 'pharmacy-billing-abhishek', 'pharmacy-dues-abhishek',
      'pharmacy-vendor-lalit'],
  },
  {
    title: 'Billing & Panels',
    blurb: 'Bills, implants and government schemes',
    ids: ['billing', 'implant-bill', 'implant-calculation', 'implant-sticker',
      'panel-documents', 'panel-payment-received', 'payments-due'],
  },
  {
    title: 'Cash & Accounts',
    blurb: 'Every rupee traceable to a person',
    ids: ['opening-cash', 'cash-handover', 'bank-deposit', 'cash-shift-report',
      'expense-bills', 'payment-voucher', 'receipt-voucher', 'bank-cash'],
    extras: [
      {
        id: 'accounting',
        label: 'Accounting',
        description: 'Day book, ledgers, trial balance and the full Tally-style books',
        href: '/accounting',
        icon: BookOpen,
      },
    ],
  },
  {
    title: 'Management',
    blurb: 'Oversight, people and referrals',
    ids: ['director', 'hr-pulse', 'referral-register', 'referee-ruby', 'patient-feedback'],
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

const Tile = ({
  label,
  description,
  href,
  Icon,
}: {
  label: string;
  description: string;
  href: string;
  Icon: LucideIcon;
}) => (
  <a
    href={href}
    onClick={enter(href)}
    className="group flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
  >
    <span className="mt-0.5 inline-flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
      <Icon className="h-5 w-5" />
    </span>
    <span className="min-w-0">
      <span className="block font-semibold text-gray-900">{label}</span>
      <span className="mt-0.5 block text-sm leading-snug text-gray-600 line-clamp-2">
        {description}
      </span>
    </span>
  </a>
);

const LandingModules = () => {
  const groups = GROUPS.map((g) => {
    const fromRegistry = g.ids
      .map((id) => {
        const m = getModule(id);
        return m
          ? { id, label: m.label, description: m.description, href: `/${id}`, icon: m.icon as LucideIcon }
          : null;
      })
      .filter(Boolean) as Extra[];
    return { ...g, tiles: [...fromRegistry, ...(g.extras ?? [])] };
  }).filter((g) => g.tiles.length > 0);

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
                  <Tile
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
