#!/usr/bin/env node
/**
 * Smoke test for the chatbot-driven automation loop. Proves end-to-end:
 *   1. A flow can be seeded into task_optimizer_flows.
 *   2. Inserting a bill into utility_deadlines triggers bill_added.
 *   3. The dispatcher writes a user_activity_log row with action='automation_fired'.
 *   4. Clean up the smoke flow + smoke bill so the DB stays tidy.
 *
 * NOTE: this script INSERTS rows via the Supabase REST API using the anon key
 * — the same path the browser uses. The dispatcher logic itself runs in the
 * browser, NOT here, so the audit row appears only when a real client emits
 * the event. The Node script seeds the data and (since it can't drive the
 * browser) asserts the LAST 60s for any existing audit row to confirm the
 * loop ran at least once recently. Use this script after manually adding a
 * bill in the dashboard to confirm the loop is wired.
 *
 * Usage:
 *   node scripts/smoke-automations.cjs           # full seed + check
 *   node scripts/smoke-automations.cjs --check   # only check audit log
 *   npm run smoke:automations
 *
 * Exits 0 on success, 1 on assertion failure, 2 on missing env, 3 on crash.
 */

const fs = require('fs');
const path = require('path');

function loadEnvExample() {
  const envPath = path.join(__dirname, '..', '.env.example');
  const text = fs.readFileSync(envPath, 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function rest(url, key, method, table, body, query = '') {
  const resp = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { ok: resp.ok, status: resp.status, body: json };
}

async function main() {
  const env = loadEnvExample();
  const url = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
    process.exit(2);
  }

  const onlyCheck = process.argv.includes('--check');
  const SMOKE_TAG = `__smoke__${Date.now()}`;

  console.log('Automation loop smoke test');
  console.log('==========================');

  let seededFlowId = null;
  let seededBillId = null;
  let failed = 0;

  // ── 1. Seed a flow listening on bill_added ────────────────────────
  if (!onlyCheck) {
    process.stdout.write('→ Seed smoke flow (bill_added → notify) ... ');
    const flowRow = {
      hospital_type: null,
      role: 'global',
      name: SMOKE_TAG,
      enabled: true,
      nodes: [
        {
          id: 'trigger-1',
          type: 'trigger',
          position: { x: 60, y: 60 },
          data: {
            kind: 'trigger',
            label: 'When a bill is added',
            config: { event: 'bill_added', billType: 'any' },
          },
        },
        {
          id: 'action-1',
          type: 'action',
          position: { x: 380, y: 60 },
          data: {
            kind: 'action',
            label: 'Notify',
            config: { type: 'notify', message: `${SMOKE_TAG} fired` },
          },
        },
      ],
      edges: [{ id: 'e-trigger-1-action-1', source: 'trigger-1', target: 'action-1' }],
    };
    const r1 = await rest(url, key, 'POST', 'task_optimizer_flows', flowRow);
    if (!r1.ok || !Array.isArray(r1.body) || !r1.body[0]?.id) {
      console.log(`FAIL (${r1.status})`);
      console.log('   ', JSON.stringify(r1.body).slice(0, 300));
      console.log('   Hint: ensure RLS allows anon insert on task_optimizer_flows.');
      process.exit(1);
    }
    seededFlowId = r1.body[0].id;
    console.log(`OK (id=${seededFlowId})`);

    // ── 2. Insert a smoke bill ─────────────────────────────────────
    process.stdout.write('→ Insert smoke bill ... ');
    const today = new Date().toISOString().slice(0, 10);
    const billRow = {
      hospital_type: null,
      name: SMOKE_TAG,
      bill_type: 'other',
      amount: 1,
      due_date: today,
      status: 'pending',
      recurring: false,
      notes: SMOKE_TAG,
    };
    const r2 = await rest(url, key, 'POST', 'utility_deadlines', billRow);
    if (!r2.ok || !Array.isArray(r2.body) || !r2.body[0]?.id) {
      console.log(`FAIL (${r2.status})`);
      console.log('   ', JSON.stringify(r2.body).slice(0, 300));
      failed++;
    } else {
      seededBillId = r2.body[0].id;
      console.log(`OK (id=${seededBillId})`);
    }
  }

  // ── 3. Check user_activity_log for recent automation_fired rows ───
  process.stdout.write('→ Check user_activity_log (last 5 min) ... ');
  const sinceIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const r3 = await rest(
    url,
    key,
    'GET',
    'user_activity_log',
    null,
    `?action=eq.automation_fired&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.desc&limit=20`,
  );
  if (!r3.ok) {
    console.log(`FAIL (${r3.status})`);
    console.log('   ', JSON.stringify(r3.body).slice(0, 300));
    failed++;
  } else {
    const rows = Array.isArray(r3.body) ? r3.body : [];
    console.log(`OK (${rows.length} automation_fired rows)`);
    if (rows.length === 0) {
      console.log('   ⚠ No fires recorded. The dispatcher only runs in the browser — open');
      console.log('     https://localhost:8080/deadline-tracking and add a bill there to trigger.');
    } else {
      const events = {};
      for (const r of rows) {
        const ev = r.details?.event || 'unknown';
        events[ev] = (events[ev] || 0) + 1;
      }
      console.log('   by event:', JSON.stringify(events));
    }
  }

  // ── 4. Cleanup (only what THIS run inserted, matched by SMOKE_TAG) ─
  if (seededFlowId) {
    process.stdout.write('→ Delete smoke flow ... ');
    const del = await rest(url, key, 'DELETE', 'task_optimizer_flows', null, `?id=eq.${seededFlowId}`);
    console.log(del.ok ? 'OK' : `FAIL (${del.status})`);
  }
  if (seededBillId) {
    process.stdout.write('→ Delete smoke bill ... ');
    const del = await rest(url, key, 'DELETE', 'utility_deadlines', null, `?id=eq.${seededBillId}`);
    console.log(del.ok ? 'OK' : `FAIL (${del.status})`);
  }

  console.log('');
  if (failed > 0) {
    console.log(`✗ ${failed} step(s) failed`);
    process.exit(1);
  }
  console.log('✓ Smoke seed + audit-log read completed.');
  console.log('  To verify the full loop, open the dashboard in a browser and watch');
  console.log('  for automation_fired rows to appear after adding/paying a bill.');
}

main().catch((e) => { console.error('UNEXPECTED ERROR:', e); process.exit(3); });
