'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifySupabaseJwt, decodeUnverified, extractActor } = require('./identity');

const SECRET = 'test-jwt-secret';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** Mint a JWT for tests. alg defaults to HS256; pass a wrong secret to forge. */
function mintJwt(payload, { alg = 'HS256', secret = SECRET } = {}) {
  const header = b64url({ alg, typ: 'JWT' });
  const body = b64url(payload);
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const NOW = 1_900_000_000; // fixed epoch for deterministic exp checks

test('verifies a valid HS256 token and returns payload', () => {
  const token = mintJwt({ sub: 'user-1', role: 'authenticated', exp: NOW + 3600 });
  const payload = verifySupabaseJwt(token, SECRET, { now: NOW });
  assert.equal(payload.sub, 'user-1');
});

test('rejects a token signed with the wrong secret', () => {
  const token = mintJwt({ sub: 'user-1', exp: NOW + 3600 }, { secret: 'attacker-secret' });
  assert.throws(() => verifySupabaseJwt(token, SECRET, { now: NOW }), /bad signature/);
});

test('rejects alg confusion (non-HS256)', () => {
  const token = mintJwt({ sub: 'user-1', exp: NOW + 3600 }, { alg: 'none' });
  assert.throws(() => verifySupabaseJwt(token, SECRET, { now: NOW }), /unsupported alg/);
});

test('rejects an expired token', () => {
  const token = mintJwt({ sub: 'user-1', exp: NOW - 1 });
  assert.throws(() => verifySupabaseJwt(token, SECRET, { now: NOW }), /expired/);
});

test('rejects a not-yet-valid token (nbf)', () => {
  const token = mintJwt({ sub: 'user-1', nbf: NOW + 100, exp: NOW + 3600 });
  assert.throws(() => verifySupabaseJwt(token, SECRET, { now: NOW }), /not yet valid/);
});

test('rejects malformed token and missing secret', () => {
  assert.throws(() => verifySupabaseJwt('not.a.jwt.x', SECRET, { now: NOW }), /malformed token/);
  assert.throws(() => verifySupabaseJwt('a.b.c', '', { now: NOW }), /secret not configured/);
  assert.throws(() => verifySupabaseJwt('', SECRET, { now: NOW }), /missing token/);
});

test('extractActor prefers app_metadata.role, falls back to role', () => {
  assert.deepEqual(extractActor({ sub: 'u1', app_metadata: { role: 'doctor' }, role: 'authenticated' }), {
    userId: 'u1',
    role: 'doctor',
  });
  assert.deepEqual(extractActor({ sub: 'u2', role: 'authenticated' }), {
    userId: 'u2',
    role: 'authenticated',
  });
  assert.deepEqual(extractActor({}), { userId: 'unknown', role: 'authenticated' });
});

test('decodeUnverified returns payload without checking signature', () => {
  const token = mintJwt({ sub: 'u9', role: 'nurse' }, { secret: 'whatever' });
  const payload = decodeUnverified(token);
  assert.equal(payload.sub, 'u9');
  assert.equal(payload.role, 'nurse');
});
