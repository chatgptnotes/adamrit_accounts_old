#!/usr/bin/env node
/**
 * Apply a SQL migration file to the linked Supabase project.
 *
 * Node port of scripts/apply-migration.py for machines without Python.
 * Usage: node scripts/apply-migration.cjs supabase/migrations/<file>.sql
 * Reads SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_URL from .env and calls
 * the service-role-only apply_migration() function (created 2026-08-06).
 * Each file name applies exactly once; re-running returns ALREADY_APPLIED.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
  const i = trimmed.indexOf('=');
  env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/apply-migration.cjs supabase/migrations/<file>.sql');
  process.exit(1);
}

fetch(env.VITE_SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/apply_migration', {
  method: 'POST',
  headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ p_name: path.basename(file), p_sql: fs.readFileSync(file, 'utf8') }),
}).then(async (res) => {
  const body = await res.text();
  if (!res.ok) {
    console.error('ERROR', res.status, body.slice(0, 500));
    process.exit(1);
  }
  console.log(body);
});
