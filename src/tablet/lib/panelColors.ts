/**
 * Panel (scheme / corporate) colours for bed tiles.
 *
 * The panel a patient belongs to lives in `patients.corporate` — free text from
 * the `corporate` master, so the same scheme appears under several spellings
 * ("ECHS" vs "Ex Serviceman Contributory Health Scheme (ECHS)"). Matching is by
 * substring, and the palette is seeded from the desktop bill board
 * (src/components/bill-workflow/BillWorkflowCard.tsx) so a scheme keeps the same
 * colour across the app.
 */

export interface Panel {
  key: string;
  /** Short label for the bed tile. */
  short: string;
  /** Tailwind classes for a filled bed tile. */
  fill: string;
  /** Tailwind classes for a small pill / legend swatch. */
  badge: string;
}

const PANELS: (Panel & { match: string[] })[] = [
  {
    key: "pmjay",
    short: "PM-JAY",
    match: ["pm-jay", "pmjay", "pradhan mantri jan arogya"],
    fill: "bg-blue-500 text-white",
    badge: "bg-blue-100 text-blue-700",
  },
  {
    key: "mjpjay",
    short: "MJPJAY",
    match: ["mjpjay", "mahatma jyotirao phule"],
    fill: "bg-emerald-600 text-white",
    badge: "bg-emerald-100 text-emerald-700",
  },
  {
    key: "echs",
    short: "ECHS",
    match: ["echs", "ex serviceman"],
    fill: "bg-orange-500 text-white",
    badge: "bg-orange-100 text-orange-700",
  },
  {
    key: "cghs",
    short: "CGHS",
    match: ["cghs", "central government health"],
    fill: "bg-purple-600 text-white",
    badge: "bg-purple-100 text-purple-700",
  },
  {
    key: "esic",
    short: "ESIC",
    match: ["esic"],
    fill: "bg-cyan-600 text-white",
    badge: "bg-cyan-100 text-cyan-700",
  },
  {
    key: "mpkay",
    short: "MPKAY",
    match: ["mpkay", "police kutumb"],
    fill: "bg-indigo-600 text-white",
    badge: "bg-indigo-100 text-indigo-700",
  },
  {
    key: "railway",
    short: "Railway",
    match: ["railway", "c.rly", "secr"],
    fill: "bg-teal-600 text-white",
    badge: "bg-teal-100 text-teal-700",
  },
  {
    key: "insurance",
    short: "Insurance",
    match: ["insurance", "tpa", "assurance"],
    fill: "bg-sky-600 text-white",
    badge: "bg-sky-100 text-sky-700",
  },
  {
    key: "private",
    short: "Private",
    match: ["private"],
    fill: "bg-slate-600 text-white",
    badge: "bg-slate-200 text-slate-700",
  },
];

const OTHER: Panel = {
  key: "other",
  short: "Other",
  fill: "bg-fuchsia-600 text-white",
  badge: "bg-fuchsia-100 text-fuchsia-700",
};

const UNKNOWN: Panel = {
  key: "unknown",
  short: "No panel",
  fill: "bg-slate-400 text-white",
  badge: "bg-muted text-muted-foreground",
};

/** Resolves a `patients.corporate` value to its panel colour. */
export function panelFor(corporate: string | null | undefined): Panel {
  if (!corporate || !corporate.trim()) return UNKNOWN;
  const lower = corporate.toLowerCase();
  const hit = PANELS.find((p) => p.match.some((m) => lower.includes(m)));
  if (!hit) return OTHER;
  const { match, ...panel } = hit;
  void match;
  return panel;
}

/** Legend entries, in the order shown under the board. */
export const PANEL_LEGEND: Panel[] = [
  ...PANELS.map(({ match, ...panel }) => {
    void match;
    return panel;
  }),
  OTHER,
  UNKNOWN,
];
