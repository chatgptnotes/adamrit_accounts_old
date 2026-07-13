#!/usr/bin/env node
/**
 * Pre-deployment guard: src/pages/FinalBill.tsx is feature-frozen.
 *
 * Computes the SHA256 of the file at deploy time and compares it against the
 * baseline recorded in scripts/finalbill-baseline.sha256. If the hashes do not
 * match, the build is aborted with a non-zero exit so Vercel's `npm run build`
 * fails before producing a bundle.
 *
 * Bypass (only when an authorised change to FinalBill is being deployed):
 *   FINALBILL_UNLOCK=1 npm run build
 *   ...then update the baseline with:
 *   node scripts/check-finalbill-locked.cjs --update-baseline
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'src/pages/FinalBill.tsx');
const BASELINE = path.join(__dirname, 'finalbill-baseline.sha256');

function sha256OfFile(p) {
  const content = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(content).digest('hex');
}

const args = process.argv.slice(2);

if (args.includes('--update-baseline')) {
  const hash = sha256OfFile(TARGET);
  fs.writeFileSync(BASELINE, hash + '\n');
  console.log('[finalbill-lock] Baseline updated to ' + hash);
  process.exit(0);
}

if (process.env.FINALBILL_UNLOCK === '1') {
  console.warn('[finalbill-lock] FINALBILL_UNLOCK=1 — bypass acknowledged. Update the baseline after this deploy.');
  process.exit(0);
}

if (!fs.existsSync(TARGET)) {
  console.error('[finalbill-lock] ERROR: ' + TARGET + ' is missing. Did you rename or delete FinalBill.tsx?');
  process.exit(1);
}

if (!fs.existsSync(BASELINE)) {
  console.error('[finalbill-lock] ERROR: baseline file missing at ' + BASELINE);
  console.error('[finalbill-lock] Initialise it once with:  node scripts/check-finalbill-locked.cjs --update-baseline');
  process.exit(1);
}

const expected = fs.readFileSync(BASELINE, 'utf8').trim();
const actual = sha256OfFile(TARGET);

if (expected === actual) {
  console.log('[finalbill-lock] OK — FinalBill.tsx unchanged (' + actual.slice(0, 12) + '…)');
  process.exit(0);
}

console.error('');
console.error('========================================================================');
console.error(' DEPLOYMENT BLOCKED — src/pages/FinalBill.tsx has changed.');
console.error('========================================================================');
console.error(' Expected SHA256: ' + expected);
console.error(' Actual   SHA256: ' + actual);
console.error('');
console.error(' This file is feature-frozen per the project-local skill at');
console.error('   .claude/skills/finalbill-locked/SKILL.md');
console.error('');
console.error(' If the change was deliberate and approved:');
console.error('   1) Confirm with the project owner that FinalBill.tsx should be edited.');
console.error('   2) Bypass once:    FINALBILL_UNLOCK=1 npm run build');
console.error('   3) Update baseline: node scripts/check-finalbill-locked.cjs --update-baseline');
console.error('   4) Commit scripts/finalbill-baseline.sha256 alongside the FinalBill change.');
console.error('========================================================================');
console.error('');
process.exit(1);
