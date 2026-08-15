#!/usr/bin/env node
/**
 * Refuse to build if an API route does not say who may call it.
 *
 * WHY THIS EXISTS
 * Eight of the 33 serverless functions shipped with no caller check at all.
 * Three of them spent real money — a phone call, a WhatsApp message, an LLM
 * prompt — and one of them (tally-proxy) could write to the accounting books.
 * None of that was deliberate; each route was written in a hurry and nothing
 * ever asked the question. This asks it, every build.
 *
 * A route passes if it does any one of:
 *   - exports through withRoute(...)          (api/_middleware.ts)
 *   - calls authenticatePartner(...)          (api/partner/_client.ts)
 *   - is named in EXEMPT below, with a reason
 *
 * Adding a route to EXEMPT is a deliberate act that leaves a written reason in
 * the diff. That is the point: the check is not there to be silenced quietly.
 *
 * Same shape as scripts/check-finalbill-locked.cjs and friends.
 */

const fs = require('fs');
const path = require('path');

const API_DIR = path.join(__dirname, '..', 'api');

/**
 * Routes that guard themselves, and why. Each was read and confirmed before
 * being listed. Most are queued to move onto withRoute; the first three never
 * will, because they must answer a caller who is not yet signed in.
 */
const EXEMPT = {
  'auth-session.ts': 'The login endpoint itself — it is what creates a session, so it cannot require one.',
  'password-reset.ts': 'Unauthenticated by design; the lockout that protects it lives in Postgres (20260809130000_password_reset_otp.sql), not here.',
  'health.ts': 'Returns a fixed liveness string. No data, no secret, no cost.',
  'push-send.ts': 'Requires the service-role key as a bearer token.',
  'jotform-webhook.ts': 'External webhook; verifies JOTFORM_WEBHOOK_SECRET from the query string or x-webhook-secret header.',
  'hr-pulse.ts': 'Calls getSessionUser and resolves identity from the database.',
  'push-subscribe.ts': 'Calls getSessionUser.',
  'invoice-content.ts': 'Calls getSessionUser, plus a signed grant token for the OTP flow.',
  'invoice-otp-verify.ts': 'Calls getSessionUser.',
  'partner/nightly-sync.ts': 'Mixed auth the wrapper does not model: POST is session, GET is CRON_SECRET (fail-closed).',
  'partner/admin-orders.ts': 'Calls getSessionUser.',
};

const listRoutes = (dir, prefix = '') => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...listRoutes(path.join(dir, entry.name), rel));
      continue;
    }
    if (!/\.(ts|js)$/.test(entry.name)) continue;
    // Vercel does not route files whose name starts with an underscore; those
    // are the shared helpers, not endpoints.
    if (entry.name.startsWith('_')) continue;
    out.push(rel);
  }
  return out;
};

const routes = listRoutes(API_DIR).sort();
const unguarded = [];
const exemptSeen = new Set();

for (const rel of routes) {
  const source = fs.readFileSync(path.join(API_DIR, rel), 'utf8');
  if (/withRoute\s*\(/.test(source)) continue;
  if (/authenticatePartner\s*\(/.test(source)) continue;
  if (EXEMPT[rel]) { exemptSeen.add(rel); continue; }
  unguarded.push(rel);
}

// An exemption for a route that no longer exists is stale, and a stale
// exemption is how a name gets reused later and silently inherits a pass.
const stale = Object.keys(EXEMPT).filter((name) => !routes.includes(name));

if (unguarded.length || stale.length) {
  console.error('\napi route check FAILED\n');
  for (const rel of unguarded) {
    console.error(`  api/${rel}`);
    console.error('      No caller check. Wrap it: export default withRoute({ auth: ... }, handler)');
    console.error("      Auth modes: 'session' | 'admin' | 'cron' | 'webhook' | 'public'.");
    console.error('      If it genuinely must be open, add it to EXEMPT in this file with a reason.\n');
  }
  for (const name of stale) {
    console.error(`  EXEMPT lists api/${name}, which does not exist. Remove the entry.\n`);
  }
  process.exit(1);
}

console.log(`api route check passed — ${routes.length} routes, ${exemptSeen.size} exempt with reasons`);
