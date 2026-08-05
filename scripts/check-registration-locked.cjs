#!/usr/bin/env node
/**
 * Pre-deployment guard: the patient/visit REGISTRATION forms are frozen.
 *
 * Registration is the front door of the hospital. A change here that looks
 * harmless can stop patients being registered at all — on 2026-08-04 a newly
 * required field (a Yojana ID that only exists for IPD cases) blocked OPD
 * registration in production for a day. These files therefore change only
 * deliberately, with the owner's say-so.
 *
 * Computes the SHA256 of each guarded file and compares it against the
 * baselines in scripts/registration-baseline.json. Any mismatch aborts the
 * build with a non-zero exit, so `npm run build` fails before a bundle exists.
 *
 * Bypass (only for an authorised registration change):
 *   REGISTRATION_UNLOCK=1 npm run build
 *   ...then re-record the baselines with:
 *   node scripts/check-registration-locked.cjs --update-baseline
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(__dirname, 'registration-baseline.json');

/** Every file that decides whether a patient or visit can be registered. */
const TARGETS = [
  'src/components/VisitRegistrationForm.tsx',
  'src/components/visit/VisitDetailsSection.tsx',
  'src/components/visit/VisitFormActions.tsx',
  'src/components/PatientRegistrationForm/usePatientRegistration.ts',
  'src/components/PatientRegistrationForm/PatientInfoSection.tsx',
  'src/tablet/modules/register/RegisterPatientFlow.tsx',
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
      console.error('[registration-lock] ERROR: cannot baseline missing file ' + rel);
      process.exit(1);
    }
    next[rel] = sha256OfFile(rel);
  }
  fs.writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
  console.log('[registration-lock] Baseline updated for ' + TARGETS.length + ' file(s).');
  process.exit(0);
}

if (process.env.REGISTRATION_UNLOCK === '1') {
  console.warn('[registration-lock] REGISTRATION_UNLOCK=1 — bypass acknowledged. Update the baseline after this deploy.');
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error('[registration-lock] ERROR: baseline file missing at ' + BASELINE);
  console.error('[registration-lock] Initialise it once with:  node scripts/check-registration-locked.cjs --update-baseline');
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
  console.log('[registration-lock] OK — ' + TARGETS.length + ' registration file(s) unchanged.');
  process.exit(0);
}

console.error('');
console.error('========================================================================');
console.error(' DEPLOYMENT BLOCKED — the registration forms have changed.');
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
console.error(' Registration is the front door of the hospital: a validation that');
console.error(' cannot be satisfied stops patients being registered at all.');
console.error('');
console.error(' Before deploying a change here, confirm with the project owner, and');
console.error(' check the change against EVERY entry point into the form — Patient');
console.error(' Dashboard, Today\'s IPD, the OPD patient table, Casualty and Dialysis');
console.error(' all render VisitRegistrationForm — and every visit type (OPD, IPD,');
console.error(' Emergency, Dialysis). A required field must be visible wherever it is');
console.error(' required, and never required where the data cannot exist yet.');
console.error('');
console.error(' If the change was deliberate and approved:');
console.error('   1) Confirm with the project owner.');
console.error('   2) Bypass once:     REGISTRATION_UNLOCK=1 npm run build');
console.error('   3) Update baseline: node scripts/check-registration-locked.cjs --update-baseline');
console.error('   4) Commit scripts/registration-baseline.json with the change.');
console.error('========================================================================');
console.error('');
process.exit(1);
