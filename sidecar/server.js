'use strict';

/**
 * Loopback-isolated, keyless sidecar for the Adamrit HMS.
 *
 * Security model: this process binds STRICTLY to 127.0.0.1, so the only
 * callers that can reach it are processes in the same pod/host network
 * namespace (i.e. the Main App). Trust is topological — proven by
 * co-location — so no API key is required for service-to-service calls.
 *
 * HIPAA note: human identity is NOT proven by the loopback boundary. The
 * Main App must forward the authenticated user/role context so the sidecar
 * can attribute PHI access to a person in its audit trail.
 */

const http = require('http');
const crypto = require('crypto');

// ── Configuration ──────────────────────────────────────────────────────────
const BIND_HOST = '127.0.0.1'; // NEVER 0.0.0.0 — this binding IS the security boundary
const BIND_PORT = Number(process.env.SIDECAR_PORT || 8081);
const ALLOWED_REMOTES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// ── Audit logging (structured, PHI-free) ───────────────────────────────────
// One JSON object per line → ships cleanly to a SIEM / immutable log store.
// NEVER log PHI payloads here — log references (record IDs, hashes) only.
function audit(event) {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), component: 'sidecar', ...event }) + '\n'
  );
}

const server = http.createServer((req, res) => {
  const remote = req.socket.remoteAddress;
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  // Human identity forwarded by the Main App (loopback authenticates the
  // service boundary; the Main App still authenticates the actual user).
  const actor = req.headers['x-actor-user-id'] || 'unknown';
  const actorRole = req.headers['x-actor-role'] || 'unknown';

  // ── Defense in depth: reject anything not from loopback ──────────────────
  // The bind already prevents external connections; this also catches
  // accidental misconfiguration (e.g. a future 0.0.0.0 bind).
  if (!ALLOWED_REMOTES.has(remote)) {
    audit({ level: 'WARN', action: 'reject_non_loopback', remote, path: req.url, requestId });
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'forbidden: loopback only' }));
    req.socket.destroy();
    return;
  }

  // ── Health check (no credentials needed) ─────────────────────────────────
  if (req.method === 'GET' && req.url === '/healthz') {
    audit({ level: 'INFO', action: 'health_check', remote, requestId });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', boundTo: `${BIND_HOST}:${BIND_PORT}` }));
    return;
  }

  // ── Handshake: proves keyless connectivity from the Main App ──────────────
  if (req.method === 'GET' && req.url === '/handshake') {
    const nonce = crypto.randomBytes(16).toString('hex');
    audit({ level: 'INFO', action: 'handshake', remote, requestId, actor, actorRole, nonce });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ peer: 'sidecar', nonce, trust: 'loopback-namespace' }));
    return;
  }

  // ── Add real sidecar work below (e.g. PHI de-identification, tokenization).
  //    Audit every PHI-touching op with actor + resource REFERENCE, never PHI.
  audit({ level: 'INFO', action: 'not_found', remote, path: req.url, requestId });
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

// Bind ONLY to loopback. The host (2nd) argument is what makes this safe;
// omitting it would default to 0.0.0.0 and break the entire security model.
server.listen(BIND_PORT, BIND_HOST, () => {
  audit({ level: 'INFO', action: 'startup', bind: `${BIND_HOST}:${BIND_PORT}` });
});

// Graceful shutdown → clean audit trail on pod termination.
process.on('SIGTERM', () => {
  audit({ level: 'INFO', action: 'shutdown', reason: 'SIGTERM' });
  server.close(() => process.exit(0));
});
