#!/usr/bin/env node
/**
 * Pre-deployment guard: the EXPENSE BILL pages are frozen.
 *
 * These screens move real money out of the hospital — they record supplier
 * invoices, post the accounting entries, raise the M.L. Enterprises referral
 * invoices and settle bills against cash or bank. A quiet change here can pay
 * a vendor twice or mis-post a journal, and neither is visible until someone
 * reconciles. They therefore change only deliberately, with the owner's
 * say-so.
 *
 * Computes the SHA256 of each guarded file and compares it against the
 * baselines in scripts/expensebill-baseline.json. Any mismatch aborts the
 * build with a non-zero exit, so `npm run build` fails before a bundle exists.
 *
 * Bypass (only for an authorised registration change):
 *   EXPENSEBILL_UNLOCK=1 npm run build
 *   ...then re-record the baselines with:
 *   node scripts/check-expensebill-locked.cjs --update-baseline
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(__dirname, 'expensebill-baseline.json');

/** Every file that records an expense bill or pays one. */
const TARGETS = [
  'src/pages/ExpenseBills.tsx',
  'src/tablet/modules/expense-bills/ExpenseBillsFlow.tsx',
  'src/tablet/modules/expense-bills/useExpenseBills.ts',
  'src/tablet/modules/expense-bills/BillPaymentSheet.tsx',
  'src/tablet/modules/expense-bills/ImplantReferralApproval.tsx',
  'src/tablet/modules/expense-bills/useImplantReferral.ts',
  'src/lib/referral-invoice-service.ts',
];

function sha256OfFile(rel) {
  const p = path.join(ROOT, rel);
  const content = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(content).digest('hex');
}

const args = process.argv.slice(2);

if (args.includes('--update-baseline')) {
  const next = {};
  for (const rel of TARGETS) {
    if (!fs.existsSync(path.join(ROOT, rel))) {
      console.error('[expensebill-lock] ERROR: cannot baseline missing file ' + rel);
      process.exit(1);
    }
    next[rel] = sha256OfFile(rel);
  }
  fs.writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
  console.log('[expensebill-lock] Baseline updated for ' + TARGETS.length + ' file(s).');
  process.exit(0);
}

if (process.env.EXPENSEBILL_UNLOCK === '1') {
  console.warn('[expensebill-lock] EXPENSEBILL_UNLOCK=1 — bypass acknowledged. Update the baseline after this deploy.');
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error('[expensebill-lock] ERROR: baseline file missing at ' + BASELINE);
  console.error('[expensebill-lock] Initialise it once with:  node scripts/check-expensebill-locked.cjs --update-baseline');
  process.exit(1);
}

const expected = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const changed = [];
const missing = [];

for (const rel of TARGETS) {
  if (!fs.existsSync(path.join(ROOT, rel))) {
    missing.push(rel);
    continue;
  }
  const actual = sha256OfFile(rel);
  if (expected[rel] !== actual) {
    changed.push({ rel, expected: expected[rel] || '(not baselined)', actual });
  }
}

if (!changed.length && !missing.length) {
  console.log('[expensebill-lock] OK — ' + TARGETS.length + ' expense bill file(s) unchanged.');
  process.exit(0);
}

console.error('');
console.error('========================================================================');
console.error(' DEPLOYMENT BLOCKED — the expense bill pages have changed.');
console.error('========================================================================');
for (const rel of missing) {
  console.error(' MISSING: ' + rel + ' — was it renamed or deleted?');
}
for (const c of changed) {
  console.error(' CHANGED: ' + c.rel);
  console.error('   expected ' + c.expected);
  console.error('   actual   ' + c.actual);
}
console.error('');
console.error(' These pages move real money: they post accounting entries, raise the');
console.error(' M.L. Enterprises referral invoices, and settle bills against cash or');
console.error(' bank. A mistake here pays a vendor twice or mis-posts a journal, and');
console.error(' nobody sees it until the books are reconciled.');
console.error('');
console.error(' Before deploying a change here, confirm with the project owner, and');
console.error(' re-check: the Pay dialog cannot overpay a bill; a part payment');
console.error(' reopens with the correct balance; the desktop and tablet payment');
console.error(' paths still agree; and record_expense_bill_payment is still called');
console.error(' with the arguments the deployed database function expects.');
console.error('');
console.error(' If the change was deliberate and approved:');
console.error('   1) Confirm with the project owner.');
console.error('   2) Bypass once:     EXPENSEBILL_UNLOCK=1 npm run build');
console.error('   3) Update baseline: node scripts/check-expensebill-locked.cjs --update-baseline');
console.error('   4) Commit scripts/expensebill-baseline.json with the change.');
console.error('========================================================================');
console.error('');
process.exit(1);
