#!/usr/bin/env node
/**
 * Pre-deployment guard: the ACCOUNTING module is frozen.
 *
 * This is the hospital's book of record. Every screen here reads or writes
 * the ledgers the owner reconciles against Tally, and the posting services
 * write vouchers directly. A quiet change can mis-state a balance sheet or
 * post a wrong journal, and nobody notices until month end.
 *
 * Unlike the other locks this one walks a whole TREE rather than a fixed
 * list, so a NEW screen dropped into src/components/accounting — or a
 * deleted one — also trips the guard. That matters here: the module is 50+
 * files and a fixed list would quietly stop covering it.
 *
 * Bypass (only for an authorised accounting change):
 *   ACCOUNTING_UNLOCK=1 npm run build
 *   ...then re-record the baselines with:
 *   node scripts/check-accounting-locked.cjs --update-baseline
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(__dirname, 'accounting-baseline.json');

/** Whole trees that are guarded, walked recursively. */
const TREES = ['src/components/accounting'];

/** Individual files outside those trees that post to the ledgers. */
const FILES = [
  'src/pages/Accounting.tsx',
  'src/lib/accounting-voucher-service.ts',
  'src/lib/approval-queue-service.ts',
  'src/lib/rm-cut-payment-service.ts',
];

const CODE = /\.(ts|tsx)$/;

function walk(rel, out) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const childRel = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) walk(childRel, out);
    else if (CODE.test(entry.name)) out.push(childRel);
  }
  return out;
}

function collect() {
  const found = [];
  for (const tree of TREES) walk(tree, found);
  for (const f of FILES) if (fs.existsSync(path.join(ROOT, f))) found.push(f);
  return found.sort();
}

function sha256OfFile(rel) {
  const content = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(content).digest('hex');
}

const args = process.argv.slice(2);

if (args.includes('--update-baseline')) {
  const next = {};
  for (const rel of collect()) next[rel] = sha256OfFile(rel);
  fs.writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
  console.log('[accounting-lock] Baseline updated for ' + Object.keys(next).length + ' file(s).');
  process.exit(0);
}

if (process.env.ACCOUNTING_UNLOCK === '1') {
  console.warn('[accounting-lock] ACCOUNTING_UNLOCK=1 — bypass acknowledged. Update the baseline after this deploy.');
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error('[accounting-lock] ERROR: baseline file missing at ' + BASELINE);
  console.error('[accounting-lock] Initialise it once with:  node scripts/check-accounting-locked.cjs --update-baseline');
  process.exit(1);
}

const expected = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const present = collect();

const changed = [];
const added = [];
for (const rel of present) {
  if (!(rel in expected)) { added.push(rel); continue; }
  const actual = sha256OfFile(rel);
  if (expected[rel] !== actual) changed.push({ rel, expected: expected[rel], actual });
}
const removed = Object.keys(expected).filter((rel) => !present.includes(rel));

if (!changed.length && !added.length && !removed.length) {
  console.log('[accounting-lock] OK — ' + present.length + ' accounting file(s) unchanged.');
  process.exit(0);
}

console.error('');
console.error('========================================================================');
console.error(' DEPLOYMENT BLOCKED — the accounting module has changed.');
console.error('========================================================================');
for (const rel of added) console.error(' ADDED:   ' + rel);
for (const rel of removed) console.error(' REMOVED: ' + rel);
for (const c of changed) {
  console.error(' CHANGED: ' + c.rel);
  console.error('   expected ' + c.expected);
  console.error('   actual   ' + c.actual);
}
console.error('');
console.error(' This is the book of record. These screens read and write the ledgers');
console.error(' reconciled against Tally, and the posting services write vouchers');
console.error(' directly — a wrong journal here is invisible until month end.');
console.error('');
console.error(' Before deploying a change here, confirm with the project owner, and');
console.error(' re-check: every company still nets to zero on openings; no voucher is');
console.error(' left unbalanced; the Day Book, Trial Balance and Ledger views agree');
console.error(' on the same figures; and run_books_health_checks() still returns zero');
console.error(' rows. See docs/operations-notes.md.');
console.error('');
console.error(' If the change was deliberate and approved:');
console.error('   1) Confirm with the project owner.');
console.error('   2) Bypass once:     ACCOUNTING_UNLOCK=1 npm run build');
console.error('   3) Update baseline: node scripts/check-accounting-locked.cjs --update-baseline');
console.error('   4) Commit scripts/accounting-baseline.json with the change.');
console.error('========================================================================');
console.error('');
process.exit(1);
