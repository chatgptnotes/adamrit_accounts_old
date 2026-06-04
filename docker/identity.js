'use strict';

/**
 * Supabase JWT verification + actor extraction for the sidecar proxy.
 *
 * The loopback sidecar is keyless, so the PROXY is where the human user is
 * authenticated. Identity MUST be derived from the cryptographically verified
 * token — never from client-supplied x-actor-* headers, which are trivially
 * spoofable. The verified `sub`/`role` are then forwarded to the sidecar for
 * HIPAA audit attribution.
 *
 * Scope: classic Supabase projects sign access tokens with HS256 using the
 * project JWT secret. ES256 / JWKS (newer asymmetric signing keys) verification
 * is a follow-up — see issue #320.
 */

const crypto = require('crypto');

function b64urlToBuffer(str) {
  return Buffer.from(str, 'base64url');
}

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Decode a JWT payload WITHOUT verifying the signature. Dev convenience only.
 * @param {string} token
 */
function decodeUnverified(token) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  return JSON.parse(b64urlToBuffer(parts[1]).toString('utf8'));
}

/**
 * Verify an HS256 Supabase access token and return its payload.
 * Throws on any failure (bad alg, bad signature, expired, malformed).
 *
 * @param {string} token
 * @param {string} secret  the Supabase project JWT secret
 * @param {{ now?: number }} [opts]  inject `now` (epoch seconds) for tests
 */
function verifySupabaseJwt(token, secret, opts = {}) {
  if (!secret) throw new Error('jwt secret not configured');
  if (!token || typeof token !== 'string') throw new Error('missing token');

  const now = typeof opts.now === 'number' ? opts.now : Math.floor(Date.now() / 1000);
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');

  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(b64urlToBuffer(headerB64).toString('utf8'));
  // Reject alg confusion ("none", RS/ES when we only trust HS256).
  if (header.alg !== 'HS256') throw new Error(`unsupported alg: ${header.alg}`);

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  if (!timingSafeEqualStr(sigB64, expectedSig)) throw new Error('bad signature');

  const payload = JSON.parse(b64urlToBuffer(payloadB64).toString('utf8'));
  if (typeof payload.exp === 'number' && now >= payload.exp) throw new Error('token expired');
  if (typeof payload.nbf === 'number' && now < payload.nbf) throw new Error('token not yet valid');
  return payload;
}

/**
 * Map a verified JWT payload to the audit actor forwarded to the sidecar.
 * @param {Record<string, unknown>} payload
 * @returns {{ userId: string, role: string }}
 */
function extractActor(payload) {
  const userId = (payload && payload.sub) || 'unknown';
  const appMeta = (payload && payload.app_metadata) || {};
  const role = appMeta.role || (payload && payload.role) || 'authenticated';
  return { userId: String(userId), role: String(role) };
}

module.exports = { verifySupabaseJwt, decodeUnverified, extractActor };
