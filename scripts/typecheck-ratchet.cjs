#!/usr/bin/env node
// Typecheck ratchet: the codebase has pre-existing tsc errors (baseline),
// so we can't require a clean pass yet. Instead, fail if the error count
// GROWS — new code (e.g. queries against nonexistent tables/columns after
// a types.ts regen) can't ship. Shrink the baseline as errors get fixed.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASELINE_FILE = path.join(__dirname, '..', 'typecheck-baseline.txt');
const baseline = parseInt(fs.readFileSync(BASELINE_FILE, 'utf8').trim(), 10);

let output = '';
try {
  execSync('npx tsc --noEmit -p tsconfig.app.json', { encoding: 'utf8', stdio: 'pipe' });
} catch (e) {
  output = (e.stdout || '') + (e.stderr || '');
}

const errors = output.split('\n').filter((l) => / error TS\d+/.test(l));
console.log(`tsc errors: ${errors.length} (baseline: ${baseline})`);

if (errors.length > baseline) {
  console.error(`\nFAIL: ${errors.length - baseline} new type error(s) introduced.`);
  console.error('Recent errors (fix these or they are yours):\n');
  console.error(errors.slice(-40).join('\n'));
  process.exit(1);
}

if (errors.length < baseline) {
  fs.writeFileSync(BASELINE_FILE, String(errors.length) + '\n');
  console.log(`Baseline improved ${baseline} -> ${errors.length}. Commit the updated typecheck-baseline.txt.`);
}

console.log('OK');
