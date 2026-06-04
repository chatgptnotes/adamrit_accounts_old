'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeAuditEvent, createAudit, AUDIT_ALLOWED_FIELDS } = require('./audit');

const META = { ts: '2026-01-01T00:00:00.000Z', component: 'sidecar' };

test('keeps allowlisted fields', () => {
  const out = sanitizeAuditEvent(
    { level: 'INFO', action: 'handshake', actor: 'u1', actorRole: 'doctor', nonce: 'abc' },
    META
  );
  assert.equal(out.level, 'INFO');
  assert.equal(out.action, 'handshake');
  assert.equal(out.actor, 'u1');
  assert.equal(out.actorRole, 'doctor');
  assert.equal(out.nonce, 'abc');
  assert.equal(out.ts, META.ts);
  assert.equal(out.component, 'sidecar');
  assert.equal(out.droppedFields, undefined);
});

test('drops unknown fields and flags them (PHI guard)', () => {
  const out = sanitizeAuditEvent(
    {
      action: 'read',
      // These simulate accidental PHI leakage into a log call:
      patientName: 'Jane Doe',
      mrn: 'MRN-12345',
      diagnosis: 'hypertension',
    },
    META
  );
  assert.equal(out.action, 'read');
  assert.equal(out.patientName, undefined, 'PHI value must not be emitted');
  assert.equal(out.mrn, undefined, 'PHI value must not be emitted');
  assert.equal(out.diagnosis, undefined, 'PHI value must not be emitted');
  assert.deepEqual(out.droppedFields.sort(), ['diagnosis', 'mrn', 'patientName']);
});

test('allows resource REFERENCE fields but not raw PHI', () => {
  const out = sanitizeAuditEvent(
    { action: 'read', resourceType: 'patient', resourceId: 'hash:9f86d0...', outcome: 'success' },
    META
  );
  assert.equal(out.resourceType, 'patient');
  assert.equal(out.resourceId, 'hash:9f86d0...');
  assert.equal(out.outcome, 'success');
});

test('security event fields pass through (reject_non_loopback)', () => {
  const out = sanitizeAuditEvent(
    {
      level: 'WARN',
      category: 'security',
      severity: 'warning',
      action: 'reject_non_loopback',
      outcome: 'deny',
      remote: '10.0.0.5',
    },
    META
  );
  assert.equal(out.category, 'security');
  assert.equal(out.severity, 'warning');
  assert.equal(out.outcome, 'deny');
});

test('callers cannot override reserved ts/component', () => {
  const out = sanitizeAuditEvent({ ts: 'FAKE', component: 'attacker', action: 'x' }, META);
  assert.equal(out.ts, META.ts);
  assert.equal(out.component, 'sidecar');
  // reserved keys are silently ignored, not reported as dropped PHI
  assert.equal(out.droppedFields, undefined);
});

test('createAudit emits one JSON line per event to the sink', () => {
  const lines = [];
  const audit = createAudit({ sink: (l) => lines.push(l), now: () => META.ts });
  audit({ level: 'INFO', action: 'startup', bind: '127.0.0.1:8081', secretToken: 'leak' });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].endsWith('\n'));
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.action, 'startup');
  assert.equal(parsed.bind, '127.0.0.1:8081');
  assert.equal(parsed.secretToken, undefined);
  assert.deepEqual(parsed.droppedFields, ['secretToken']);
});

test('allowlist does not accidentally include PHI-ish field names', () => {
  for (const banned of ['patientName', 'mrn', 'diagnosis', 'ssn', 'dob', 'address']) {
    assert.equal(AUDIT_ALLOWED_FIELDS.has(banned), false, `${banned} must not be allowlisted`);
  }
});
