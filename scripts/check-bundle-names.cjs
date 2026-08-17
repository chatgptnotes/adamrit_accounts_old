#!/usr/bin/env node
/**
 * After the build, refuse to ship staff names in the file every anonymous
 * visitor downloads.
 *
 * check-public-labels.cjs reads SOURCE files, and in August 2026 that was not
 * enough: the landing page's own source was clean while the built entry chunk
 * still carried nineteen staff-named labels, because the bundler had hoisted a
 * shared config (src/config/tileAccess.ts) into the eager graph. Nobody
 * imported it into the public page — the bundler put it there. A source-level
 * check reports "no staff names published" while the names are published.
 *
 * So this one reads what actually ships: the entry script dist/index.html
 * references. It runs in postbuild, which npm triggers automatically after
 * `npm run build` — locally and on Vercel alike.
 *
 * Scope is the ENTRY chunk only. Lazy chunks also carry staff names (they are
 * the internal screens, where naming tiles after who works them is right), and
 * several chunk FILENAMES do too. That is a wider decision than this check —
 * the line held here is the August one: nothing staff-named in the bundle a
 * visitor gets by simply opening the front page.
 *
 * NOTE: this file must be listed in .vercelignore's allowlist (the `!` lines),
 * or every Vercel deploy dies on "Cannot find module". It reads only dist/,
 * which Vercel creates during the build, so it is safe to run there.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const html = fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8');
const entry = (html.match(/src="\/(assets\/index-[^"]+\.js)"/) || [])[1];
if (!entry) {
  console.error('[bundle-names] ERROR: could not find the entry script in dist/index.html.');
  console.error('If the build output layout changed, update this check rather than deleting it.');
  process.exit(1);
}
const bundle = fs.readFileSync(path.join(ROOT, 'dist', entry), 'utf8');

// Same names as check-public-labels.cjs, minus "rmo" (an acronym here — RMO
// Duty, useRmoData — not a person). Matched case-insensitively, but a match
// joined to a hyphen on either side is skipped: those are id slugs like
// "t-rmo-duty-gaurav", which are database keys and a separate, deliberate
// decision to rename. Display labels put spaces around names.
const NAMES =
  /(?<![a-z0-9-])(diksha|sonali|suraj|arpit|rupali|azhar|azher|gaurav|nisha|chetna|shashank|abhishek|lalit|ruby|viji|tilak|akshay|javed|sarvesh|servesh|sonu|pallavi|reena|avni|rakesh|shoib|siddhanth|farhan|ruchika|snehal|shailesh|lokesh|manthan|mona)(?![a-z0-9-])/gi;

const found = new Map();
const inEmails = new Map();
for (const m of bundle.matchAll(NAMES)) {
  const name = m[0];
  // A name that is the local part of an email address is one of the hardcoded
  // access allowlists (accounting-access, officeTileAccess, referral access).
  // Those are access CONTROL, not display text: removing them changes who can
  // open money screens, which is the owner's decision, not this script's. They
  // are reported every build so they cannot be forgotten, but do not fail it.
  // The real fix is moving those checks server-side; docs/ and the failure-
  // modes notes track this as a standing issue.
  const tail = bundle.slice(m.index + name.length, m.index + name.length + 30);
  const isEmail = /^[a-z0-9._-]{0,20}@[a-z0-9.-]+\./i.test(tail);
  const target = isEmail ? inEmails : found;
  if (!target.has(name)) {
    target.set(name, bundle.slice(Math.max(0, m.index - 40), m.index + name.length + 25));
  }
}

if (inEmails.size) {
  console.warn(
    `[bundle-names] known issue: ${inEmails.size} staff email(s) still ship in the entry chunk` +
      ' (hardcoded access allowlists — needs the server-side move, not a rename).',
  );
}

if (found.size) {
  console.error(`[bundle-names] ERROR: staff names in the public entry chunk (${entry}):\n`);
  for (const [name, ctx] of found) {
    console.error(`  ${name}  …${ctx.replace(/\s+/g, ' ')}…`);
  }
  console.error(
    '\nSomething in the eager import graph carries a staff-named label.' +
      '\nFind the source (grep src/ for the label), give it a neutral name, and rebuild.',
  );
  process.exit(1);
}
console.log(`[bundle-names] OK — entry chunk ${entry} ships no staff names.`);
