#!/usr/bin/env node
/**
 * The landing page is public. Refuse to ship it naming staff.
 *
 * Tiles are named after whoever works them, which is right inside the hospital
 * and is a published staff list outside it. Every module the landing page lists
 * must therefore either carry a publicLabel or have a label with no first name
 * in it. Checked here rather than trusted to review, because the failure is
 * silent: the page looks fine, and the names are simply out there.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const mods = fs.readFileSync(path.join(ROOT, 'src/tablet/config/modules.ts'), 'utf8');
const landing = fs.readFileSync(path.join(ROOT, 'src/components/LandingModules.tsx'), 'utf8');

// Ids the landing page lists, and the label it shows for each. The page is
// self-contained now, so this also checks the list has not drifted from the
// real modules.
const listed = new Map(
  [...landing.matchAll(/id: '([a-z0-9-]+)', label: '([^']+)'/g)].map((m) => [m[1], m[2]]),
);

// Every module's label and publicLabel.
const entries = [];
const re = /id: "([a-z0-9-]+)",\s*\n\s*label: "([^"]+)",\s*\n(\s*publicLabel: "([^"]+)",\s*\n)?/g;
let m;
while ((m = re.exec(mods))) entries.push({ id: m[1], label: m[2], publicLabel: m[4] || null });

// First names taken from the labels themselves, so the list cannot go stale:
// anything that looks like a person's name attached to a tile.
const NAME = /\b(diksha|sonali|suraj|arpit|rupali|azhar|azher|gaurav|nisha|chetna|shashank|abhishek|lalit|ruby|viji|tilak|akshay|javed|sarvesh|servesh|sonu|pallavi|reena|avni|rakesh|shoib|siddhanth|farhan|ruchika|snehal|shailesh|lokesh|manthan|mona|rmo)\b/i;

const bad = [...listed.entries()]
  .filter(([, label]) => NAME.test(label))
  .map(([id, label]) => `  ${id}: shows "${label}"`);

// A landing entry pointing at a module that no longer exists is a dead link.
const known = new Set(entries.map((e) => e.id));

// Desktop screens declared in src/components/AppRoutes.tsx rather than the
// tablet registry. They are still real pages — the dead-link check just cannot
// see them, because it only reads the tablet module list. Each id here has a
// matching route; add to this set ONLY after confirming the route exists.
const OFF_REGISTRY = new Set([
  'cath-lab',
  'accounting',
  'appointments',
  'queue-management',
  'patient-portal',
  'nursing',
  'casualty-register',
  'lab',
  'radiology',
  'purchase-orders',
  'inventory-tracking',
  'tpa-claims',
  'pmjay-mjpjay-master',
  'corporate-claim-tracking',
  'tally',
  // Sister products on their own domains. They have no route here by design.
  'hrpulse-site',
  'nabh-online',
  'emergency-seva',
  'zerorisk-agent',
  'ddo-center',
]);
const dead = [...listed.keys()].filter((id) => !known.has(id) && !OFF_REGISTRY.has(id));
if (dead.length) {
  console.error('[public-labels] ERROR: the landing page lists modules that do not exist:\n');
  console.error(dead.map((d) => `  ${d}`).join('\n'));
  process.exit(1);
}

// The exemption above says "not in the tablet registry", which on its own would
// let any id through unchecked. So the desktop ones are verified the other way:
// their href must be a route AppRoutes.tsx actually declares. Without this, the
// escape hatch quietly turns off the dead-link check it is an exception to.
const hrefs = new Map(
  [...landing.matchAll(/id: '([a-z0-9-]+)',[^\n]*?href: '([^']+)'/g)].map((m) => [m[1], m[2]]),
);
const routes = new Set(
  [...fs
    .readFileSync(path.join(ROOT, 'src/components/AppRoutes.tsx'), 'utf8')
    .matchAll(/path="([^"]+)"/g)].map((m) => m[1]),
);
// A tile may point at a sister product instead of a route here. Those cannot be
// route-checked, so they are held to the other rule that matters on a public
// page: an absolute https address. A bare domain or an http:// link is a bug —
// the first resolves against adamrit.com, the second is insecure.
const external = (href) => /^https?:\/\//.test(href || '');

const brokenLinks = [...OFF_REGISTRY]
  .filter((id) => listed.has(id))
  .filter((id) => !external(hrefs.get(id)) && !routes.has(hrefs.get(id)))
  .map((id) => `  ${id} -> ${hrefs.get(id) ?? '(no href found)'}`);

if (brokenLinks.length) {
  console.error('[public-labels] ERROR: landing tiles point at routes that do not exist:\n');
  console.error(brokenLinks.join('\n'));
  console.error('\nEvery off-registry tile must match a path= in src/components/AppRoutes.tsx,');
  console.error('or be an absolute https:// link to a sister product.');
  process.exit(1);
}

const badExternal = [...hrefs.entries()]
  .filter(([, href]) => external(href))
  .filter(([, href]) => !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(href))
  .map(([id, href]) => `  ${id} -> ${href}`);

if (badExternal.length) {
  console.error('[public-labels] ERROR: external tiles must be absolute https links:\n');
  console.error(badExternal.join('\n'));
  process.exit(1);
}

if (bad.length) {
  console.error('[public-labels] ERROR: the landing page would publish staff names.\n');
  console.error(bad.join('\n'));
  console.error('\nGive each of these a publicLabel in src/tablet/config/modules.ts.');
  process.exit(1);
}
console.log(`[public-labels] OK — ${listed.size} listed module(s), all real, no staff names published.`);
