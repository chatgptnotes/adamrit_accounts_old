#!/usr/bin/env node
/**
 * Does every query the ACCOUNTING module makes still match the live database?
 *
 * WHY THIS EXISTS. On 16-Aug-2026 the Account Logs screen was found to be
 * silently dropping 1,158 pharmacy sales, 245 final payments and every Tally
 * sync over a 30-day window. Nothing was broken in an obvious way: the columns
 * had been renamed under the code (`total` -> `total_amount`,
 * `payment_mode` -> `mode_of_payment`, `created_at` -> `started_at`), PostgREST
 * rejected the queries with HTTP 400, and the screens threw the error away with
 * `(res.data ?? [])`. A rejected read became an empty list, and an empty list
 * looks exactly like a quiet day.
 *
 * A type checker cannot catch this: the column names live in strings, and the
 * database is the only authority on whether they exist. So we ask it.
 *
 * Every `.from('table').select('...')` in the accounting module is extracted and
 * replayed against the real schema with `limit=0` — no rows are read, only the
 * shape is validated. Anything the database rejects is a screen that is lying.
 *
 * Run: npm run check:accounting-schema
 * Needs SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_URL (from .env or the env).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** Files whose queries are covered, mirroring scripts/check-accounting-locked.cjs. */
const TREES = ['src/components/accounting'];
const FILES = [
  'src/pages/Accounting.tsx',
  'src/lib/accounting-voucher-service.ts',
  'src/lib/approval-queue-service.ts',
  'src/lib/rm-cut-payment-service.ts',
];

const readEnv = () => {
  const env = { ...process.env };
  const file = path.join(ROOT, '.env');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const i = trimmed.indexOf('=');
      const key = trimmed.slice(0, i).trim();
      if (!env[key]) env[key] = trimmed.slice(i + 1).trim();
    }
  }
  return env;
};

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
};

/** Selects this script cannot replay, reported rather than silently skipped. */
const unverifiable = [];

/**
 * Pull out `.from('t').select( '...' )` honouring nested parentheses, so an
 * embedded resource like `voucher:vouchers(voucher_type:voucher_types(name))`
 * is captured whole instead of being cut at the first bracket.
 */
const extract = (text) => {
  const found = [];
  // Storage buckets are also addressed with .from(); they are not tables.
  const src = text.replace(/supabase\.storage\.from\([^)]*\)/g, 'STORAGE');
  const re = /\.from\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)\s*\.select\(\s*(['"`])/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const table = m[1];
    const quote = m[2];
    let i = m.index + m[0].length;
    let depth = 0;
    let buf = '';
    while (i < src.length) {
      const c = src[i];
      if (c === quote && depth === 0) break;
      if (c === '(') depth++;
      if (c === ')') depth--;
      buf += c;
      i++;
    }
    // Interpolated selects cannot be replayed literally; skip them.
    if (buf.includes('${')) continue;
    // A select built by concatenation ('a,' + 'b') would be truncated at the
    // first closing quote and checked as a half-query, which fails for the
    // wrong reason. Report it as unverifiable rather than pretend to know.
    const after = src.slice(i + 1, i + 40);
    if (/^\s*\+/.test(after)) {
      unverifiable.push({ table, reason: 'select is built by string concatenation' });
      continue;
    }
    // supabase-js strips whitespace before sending; match that exactly.
    const select = buf.replace(/\s+/g, '');
    if (select) found.push({ table, select });
  }
  return found;
};

const main = async () => {
  const env = readEnv();
  const url = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    console.error('[accounting-schema] SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_URL missing — cannot verify.');
    process.exit(2);
  }

  const files = [...TREES.flatMap((t) => walk(path.join(ROOT, t))), ...FILES.map((f) => path.join(ROOT, f))];
  const seen = new Set();
  const queries = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const q of extract(fs.readFileSync(file, 'utf8'))) {
      const id = `${q.table}|${q.select}`;
      if (seen.has(id)) continue;
      seen.add(id);
      queries.push({ ...q, file: path.relative(ROOT, file) });
    }
  }

  const failures = [];
  for (const q of queries) {
    const target = `${url}/rest/v1/${q.table}?select=${encodeURIComponent(q.select)}&limit=0`;
    let res;
    try {
      res = await fetch(target, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    } catch (err) {
      // A network problem is not a schema problem; say so rather than failing
      // the build on someone's flaky connection.
      console.error(`[accounting-schema] could not reach the database: ${err.message}`);
      process.exit(2);
    }
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        message = (JSON.parse(await res.text()).message || message).replace(/\s+/g, ' ');
      } catch { /* keep the status */ }
      failures.push({ ...q, message });
    }
  }

  // Never let a bounded check read as full coverage.
  if (unverifiable.length > 0) {
    console.warn(`[accounting-schema] ${unverifiable.length} select(s) could NOT be checked:`);
    for (const u of unverifiable) console.warn(`    [${u.table}] ${u.reason}`);
    console.warn('    Rewrite these as a single string literal to bring them under the check.\n');
  }

  if (failures.length === 0) {
    console.log(`[accounting-schema] ${queries.length} queries checked — all match the live schema.`);
    return;
  }

  console.error(`\n[accounting-schema] ${failures.length} of ${queries.length} queries are REJECTED by the database.`);
  console.error('Each one returns no rows in the app, which looks like "no data" rather than a fault.\n');
  for (const f of failures) {
    console.error(`  ${f.file}  [${f.table}]`);
    console.error(`    ${f.message}`);
    console.error(`    select: ${f.select.slice(0, 120)}${f.select.length > 120 ? '…' : ''}\n`);
  }
  process.exit(1);
};

main();
