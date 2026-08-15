#!/usr/bin/env node
/**
 * Flags the migration patterns that actually broke this hospital.
 *
 * Not a style checker. Every rule below is here because it caused a real,
 * money-losing failure in August 2026, and each one is invisible in review —
 * the SQL reads perfectly sensibly right up until it destroys something.
 *
 *   1. A DEFERRED constraint trigger that RAISES.
 *      The party-mobile rule checked at COMMIT on a rail that writes in two
 *      transactions. It did not refuse entries — it rolled back the posting
 *      while the already-committed header survived. Four payment vouchers
 *      vanished from the books while still appearing on screen.
 *      Enforce at the point of entry, in the transaction the human is in.
 *
 *   2. A BEFORE INSERT trigger that INSERTs into a table referencing the row
 *      being inserted.
 *      The bill snapshot trigger wrote to bill_content, whose foreign key
 *      points at bills, while the bills row did not yet exist. Every bill
 *      insert failed for 18 days and nobody knew.
 *      Write the child AFTER, or defer the reference check.
 *
 *   3. CREATE OR REPLACE FUNCTION with a signature copied from an older
 *      migration.
 *      Cannot be detected reliably from text, so this only warns when a
 *      function is redefined that other migrations also define — the shape
 *      that produced two record_expense_bill_payment overloads and broke
 *      every payment outright. Rebuild from pg_get_functiondef against the
 *      LIVE database, never from the migration that last touched it.
 *
 * Advisory by design. It reports and exits 0 unless --strict is passed, so it
 * cannot block a deploy on a heuristic — a guard that cries wolf gets removed,
 * and then it protects nothing.
 *
 *   npm run check:migrations
 *   node scripts/check-migration-safety.cjs --since 20260815   (today's only)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'supabase', 'migrations');

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const sinceIdx = args.indexOf('--since');
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : null;

/** Strip comments so a rule described in prose is not reported as the rule. */
const stripComments = (sql) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

const findings = [];
const add = (file, rule, detail) => findings.push({ file, rule, detail });

const files = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => !since || f >= since)
  .sort();

/** Which migrations define each function, for rule 3. */
const definedIn = new Map();

for (const file of files) {
  const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
  const sql = stripComments(raw);

  // ---- 1. deferred constraint trigger whose function raises -------------
  const deferred = /CREATE\s+CONSTRAINT\s+TRIGGER\s+(\w+)[\s\S]{0,400}?DEFERRABLE\s+INITIALLY\s+DEFERRED[\s\S]{0,200}?EXECUTE\s+(?:PROCEDURE|FUNCTION)\s+(?:public\.)?(\w+)/gi;
  let m;
  while ((m = deferred.exec(sql)) !== null) {
    const fn = m[2];
    // Does that function raise? Look at its definition in this same file.
    const body = sql.match(
      new RegExp(`FUNCTION\\s+(?:public\\.)?${fn}\\s*\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`, 'i'),
    );
    if (body && /RAISE\s+EXCEPTION/i.test(body[1])) {
      add(file, 'deferred constraint trigger that raises',
        `${m[1]} → ${fn}(). Checked at COMMIT, so it unwinds work instead of refusing it. ` +
        'If the write happens across two transactions, the earlier one survives and the ' +
        'later is destroyed silently. Enforce at entry instead.');
    }
  }

  // ---- 2. BEFORE INSERT trigger writing to a child table ----------------
  const beforeIns = /CREATE\s+TRIGGER\s+(\w+)\s+BEFORE\s+INSERT[\s\S]{0,200}?EXECUTE\s+(?:PROCEDURE|FUNCTION)\s+(?:public\.)?(\w+)/gi;
  while ((m = beforeIns.exec(sql)) !== null) {
    const fn = m[2];
    const body = sql.match(
      new RegExp(`FUNCTION\\s+(?:public\\.)?${fn}\\s*\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`, 'i'),
    );
    if (body && /INSERT\s+INTO/i.test(body[1]) && /NEW\.id/i.test(body[1])) {
      add(file, 'BEFORE INSERT trigger inserting a child row',
        `${m[1]} → ${fn}() inserts using NEW.id while the parent row does not yet exist. ` +
        'If the child has a foreign key to the parent, every insert fails. This is the ' +
        'bug that stopped all bills saving for 18 days.');
    }
  }

  // ---- 3. a function redefined across migrations ------------------------
  const fnDef = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(/gi;
  const seenHere = new Set();
  while ((m = fnDef.exec(sql)) !== null) {
    if (seenHere.has(m[1])) continue;
    seenHere.add(m[1]);
    if (!definedIn.has(m[1])) definedIn.set(m[1], []);
    definedIn.get(m[1]).push(file);
  }
}

// Rule 3 is only actionable about a migration somebody is writing NOW. Listing
// every historically-rewritten function buries rules 1 and 2 under noise, and a
// guard nobody reads protects nothing — so without --since it is one summary
// line, and with --since it names only what that window touched.
const churned = [...definedIn.entries()].filter(([, w]) => w.length >= 4);
if (since) {
  for (const [fn, where] of churned) {
    if (!where.some((f) => f >= since)) continue;
    add(where[where.length - 1], 'much-redefined function',
      `${fn}() is defined in ${where.length} migrations and one of them is in this ` +
      'window. Rebuild it from pg_get_functiondef against the LIVE database — an old ' +
      'file may be missing arguments added since, and a mismatched signature creates a ' +
      'second overload that makes every call ambiguous. That broke every payment on ' +
      '15 August.');
  }
} else if (churned.length) {
  console.log(
    `[migration-safety] ${churned.length} function(s) are defined in 4+ migrations. ` +
    'Run with --since <prefix> before redefining one.',
  );
}

if (findings.length === 0) {
  console.log(`[migration-safety] ${files.length} migration(s) checked, nothing to flag.`);
  process.exit(0);
}

console.log(`\n[migration-safety] ${findings.length} thing(s) worth a second look:\n`);
for (const f of findings) {
  console.log(`  ${f.file}`);
  console.log(`    ${f.rule}`);
  console.log(`    ${f.detail}\n`);
}
console.log(
  'These are patterns that have already cost this hospital money. Advisory —\n' +
  'if a flagged pattern is genuinely correct here, say why in the migration.\n',
);

process.exit(strict ? 1 : 0);
