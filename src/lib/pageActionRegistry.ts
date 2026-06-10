// Page-action registry ("wires"). Each entry is a place in the app an automation
// can point a user to. Phase 1 is GUIDE-only: a `guide` action deep-links the
// user to the route (a clickable toast / a link in a Slack message). `execute`
// wires (the automation performing the action headlessly) are Phase 2 — the
// `kind` field is here so the catalog is forward-compatible.
//
// Routes MUST match src/components/AppRoutes.tsx (the real route table), NOT
// menuItems.ts (which has route drift). All Phase 1 routes are param-less so an
// event-driven automation can always navigate without a record id. Record-
// specific deep links (e.g. /final-bill/:visitId) are Phase 2, only fillable
// when the triggering event carries that id.
//
// This is also the catalog the chatbot LLM reads (via formatRegistryForPrompt)
// so its suggestions reference REAL pages instead of inventing them.

export interface PageWire {
  id: string; // stable id, e.g. 'lab.orders'
  label: string; // short human label used on the guide button
  page: string; // module/page name for grouping + LLM context
  route: string; // app route to deep-link to (must exist in AppRoutes.tsx)
  kind: 'guide' | 'execute'; // Phase 1 = guide only
  description: string; // one line for the LLM
}

export const PAGE_WIRES: PageWire[] = [
  // ── Pharmacy ──
  { id: 'pharmacy.billing', label: 'Open Pharmacy Billing', page: 'Pharmacy', route: '/pharmacy?tab=billing', kind: 'guide', description: 'Create a pharmacy sale / bill for a patient.' },
  { id: 'pharmacy.direct_sale', label: 'Open Direct Sale', page: 'Pharmacy', route: '/pharmacy?tab=direct-sale', kind: 'guide', description: 'Walk-in direct medicine sale.' },
  { id: 'pharmacy.purchase_orders', label: 'Open Purchase Orders', page: 'Pharmacy', route: '/pharmacy/purchase-orders/list', kind: 'guide', description: 'Review / raise pharmacy purchase orders (restocking).' },

  // ── Lab / Investigations ──
  { id: 'lab.orders', label: 'Open Lab Orders', page: 'Lab', route: '/lab?tab=orders', kind: 'guide', description: 'Place or review lab/investigation orders.' },
  { id: 'lab.results', label: 'Open Lab Results', page: 'Lab', route: '/lab?tab=results', kind: 'guide', description: 'Enter or review lab results.' },
  { id: 'lab.samples', label: 'Open Sample Tracking', page: 'Lab', route: '/lab?tab=samples', kind: 'guide', description: 'Track lab sample collection.' },

  // ── Patient / OPD / Discharge ──
  { id: 'opd.today', label: "Open Today's OPD", page: 'OPD', route: '/todays-opd', kind: 'guide', description: "Today's OPD/IPD patient list — also where a patient's Final Bill is opened from." },
  { id: 'patients.discharged', label: 'Open Discharged Patients', page: 'Patients', route: '/discharged-patients', kind: 'guide', description: 'Discharged-patient list / report.' },
  { id: 'patients.master', label: 'Open Patient List', page: 'Patients', route: '/patients', kind: 'guide', description: 'Master patient list.' },

  // ── Deadlines / Utility bills ──
  { id: 'deadlines.dashboard', label: 'Open Deadline Tracking', page: 'Deadlines', route: '/deadline-tracking', kind: 'guide', description: 'Utility-bill deadline dashboard (scan bills, mark paid).' },
];

// Compact catalog string injected into the chatbot prompts so it can build
// `guide` automations that reference real routes. Grouped by page for brevity.
export function formatRegistryForPrompt(): string {
  const byPage = new Map<string, PageWire[]>();
  for (const w of PAGE_WIRES) {
    const list = byPage.get(w.page) ?? [];
    list.push(w);
    byPage.set(w.page, list);
  }
  const lines: string[] = [
    'Pages you can deep-link a "guide" automation to (use action type "guide" with the route as "url" and a short "label"):',
  ];
  for (const [page, wires] of byPage) {
    lines.push(`${page}:`);
    for (const w of wires) lines.push(`  - ${w.label} → url "${w.route}" — ${w.description}`);
  }
  return lines.join('\n');
}
