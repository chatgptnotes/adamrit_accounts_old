#!/usr/bin/env node
/**
 * Enforces the No-Harm Safety Rule #3: no automation may mutate tables outside
 * the whitelist. Greps src/lib/runTaskFlows.ts for .from('TABLE').{update,
 * insert, delete} calls and fails CI if any TABLE outside the allowlist
 * appears. Lets a future contributor add a new action type only if they
 * deliberately update this whitelist — which forces a second pair of eyes.
 *
 * Usage:
 *   node scripts/check-automation-table-access.cjs
 *   npm run check:automation-tables
 *
 * Exits 0 if clean, 1 if a non-whitelisted mutation is found.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'src/lib/runTaskFlows.ts');

// Tables runtime actions are allowed to mutate. Match the plan exactly:
//   - task_optimizer_actions (the `tag` + `set_status` row update)
//   - user_activity_log      (append-only audit trail)
// Any other table mutation must be intentional + reviewed.
const ALLOWED_TABLES = new Set([
  'task_optimizer_actions',
  'user_activity_log',
]);

// Forbidden verbs anywhere in the file (defense in depth — no automation may
// delete or truncate ever, regardless of table).
const HARD_FORBIDDEN_VERBS = ['delete', 'truncate'];

function fail(message) {
  console.error('');
  console.error('✗ Automation table-access lint failed.');
  console.error('  ' + message);
  console.error('');
  console.error('If you genuinely need this change, update ALLOWED_TABLES in this script');
  console.error('AND add an entry to the No-Harm Safety Ruleset (Rule 3) in the plan.');
  process.exit(1);
}

if (!fs.existsSync(TARGET)) {
  fail(`Target file not found: ${TARGET}`);
}

const src = fs.readFileSync(TARGET, 'utf8');

// Match: .from('something').<verb>(   OR   .from("something").<verb>(
const callRe = /\.from\(\s*['"]([^'"]+)['"]\s*\)\s*\.(insert|update|delete|upsert|select)\s*\(/g;

const violations = [];
let m;
while ((m = callRe.exec(src)) !== null) {
  const table = m[1];
  const verb = m[2].toLowerCase();
  // .select() is read-only — always fine.
  if (verb === 'select') continue;
  // Defense in depth: hard ban delete/truncate even on whitelisted tables.
  if (HARD_FORBIDDEN_VERBS.includes(verb)) {
    violations.push(
      `Forbidden verb .${verb}() on "${table}" — automations must never destroy data. ` +
      `Use 'tag' or 'set_status' instead.`,
    );
    continue;
  }
  if (!ALLOWED_TABLES.has(table)) {
    violations.push(
      `Non-whitelisted .${verb}() on "${table}". ` +
      `Allowed tables: ${[...ALLOWED_TABLES].join(', ')}.`,
    );
  }
}

if (violations.length > 0) {
  fail(
    `${violations.length} violation${violations.length === 1 ? '' : 's'} in ${path.relative(ROOT, TARGET)}:\n  ` +
      violations.join('\n  '),
  );
}

console.log(`✓ Automation table-access lint passed (${ALLOWED_TABLES.size} table${ALLOWED_TABLES.size === 1 ? '' : 's'} whitelisted, no forbidden verbs).`);
process.exit(0);
