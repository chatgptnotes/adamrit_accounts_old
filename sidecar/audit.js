'use strict';

/**
 * Audit logging for the sidecar — PHI-free by construction.
 *
 * HIPAA requires an audit trail (45 CFR §164.312(b)) but logs are frequently
 * shipped to systems with weaker controls, so they must NEVER contain PHI.
 * Rather than trusting every call site to remember that, this module enforces
 * a strict field ALLOWLIST: only known-safe keys are emitted. Any unexpected
 * key (which could carry PHI) is dropped and flagged in `droppedFields`.
 *
 * Log resource REFERENCES (record ids, hashes), never PHI values. To attach a
 * record reference, use the explicit `resourceType` / `resourceId` fields.
 */

// Keys permitted in an audit line. Everything else is dropped.
const AUDIT_ALLOWED_FIELDS = new Set([
  'level', // INFO | WARN | ERROR
  'action', // machine-readable event name, e.g. "handshake"
  'category', // optional grouping, e.g. "security"
  'severity', // optional, e.g. "warning" | "critical"
  'remote', // source ip (loopback only by design)
  'path', // request path (route, never a PHI query string value)
  'requestId', // correlation id
  'actor', // authenticated user id forwarded by the Main App
  'actorRole', // authenticated role
  'outcome', // success | deny | error
  'status', // numeric/string status code
  'reason', // short machine reason, e.g. "SIGTERM"
  'nonce', // handshake nonce
  'bind', // listen address
  'resourceType', // e.g. "patient" — a TYPE, not a value
  'resourceId', // an opaque id/hash REFERENCE, never PHI
]);

// Always present, set by the logger itself (not accepted from callers).
const RESERVED_FIELDS = new Set(['ts', 'component', 'droppedFields']);

/**
 * Returns a sanitized copy of `event` containing only allowlisted fields.
 * Pure and side-effect free so it can be unit tested.
 *
 * @param {Record<string, unknown>} event
 * @param {{ ts: string, component: string }} meta
 */
function sanitizeAuditEvent(event, meta) {
  const safe = { ts: meta.ts, component: meta.component };
  const dropped = [];
  for (const key of Object.keys(event || {})) {
    if (AUDIT_ALLOWED_FIELDS.has(key)) {
      safe[key] = event[key];
    } else if (!RESERVED_FIELDS.has(key)) {
      // Unknown key — could carry PHI. Drop the VALUE, keep only the key name.
      dropped.push(key);
    }
  }
  if (dropped.length > 0) safe.droppedFields = dropped;
  return safe;
}

/**
 * Creates an audit() function bound to a sink.
 * @param {{ sink?: (line: string) => void, now?: () => string, component?: string }} [opts]
 */
function createAudit(opts = {}) {
  const sink = opts.sink || ((line) => process.stdout.write(line));
  const now = opts.now || (() => new Date().toISOString());
  const component = opts.component || 'sidecar';
  return function audit(event) {
    const safe = sanitizeAuditEvent(event, { ts: now(), component });
    sink(JSON.stringify(safe) + '\n');
  };
}

module.exports = { AUDIT_ALLOWED_FIELDS, sanitizeAuditEvent, createAudit };
