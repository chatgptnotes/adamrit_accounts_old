'use strict';

/**
 * Main App runtime entrypoint.
 *
 *  1. On startup, performs a KEYLESS handshake to the loopback sidecar to prove
 *     service-to-service trust works with no API key (shared network namespace).
 *  2. Proxies authenticated browser requests under /api/sidecar/* to the loopback
 *     sidecar, attaching the VERIFIED human identity as x-actor-* headers.
 *  3. Serves the built Vite SPA (dist/) on 0.0.0.0:3000 with SPA fallback.
 *
 * Why a proxy: a browser hitting 127.0.0.1:8081 would reach the end-user's own
 * machine, not the pod sidecar. The loopback sidecar is for co-located server
 * processes, so every browser→sidecar call MUST go through this server route,
 * which authenticates the user and forwards their identity for HIPAA audit.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { verifySupabaseJwt, decodeUnverified, extractActor } = require('./identity');

const PORT = Number(process.env.PORT || 3000);
const DIST_DIR = path.join(__dirname, '..', 'dist');
const SIDECAR_URL = process.env.SIDECAR_URL || 'http://127.0.0.1:8081';

// Identity verification for the sidecar proxy.
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
const IS_PROD = process.env.NODE_ENV === 'production';
const SIDECAR_PROXY_PREFIX = '/api/sidecar/';
const MAX_PROXY_BODY_BYTES = 1024 * 1024; // 1 MB

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function log(event) {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), component: 'main-app', ...event }) + '\n'
  );
}

/** Keyless startup handshake to the sidecar (retries until the sidecar is ready). */
async function handshakeWithSidecar(retries = 10, delayMs = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${SIDECAR_URL}/handshake`, {
        headers: { 'x-actor-user-id': 'system', 'x-actor-role': 'main-app' },
      });
      if (res.ok) {
        const body = await res.json();
        log({ level: 'INFO', action: 'sidecar_handshake_ok', trust: body.trust, nonce: body.nonce });
        return true;
      }
      log({ level: 'WARN', action: 'sidecar_handshake_status', status: res.status, attempt });
    } catch (err) {
      log({ level: 'WARN', action: 'sidecar_handshake_retry', attempt, error: String(err) });
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  log({ level: 'ERROR', action: 'sidecar_handshake_failed', message: 'sidecar unreachable' });
  return false;
}

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const stream = fs.createReadStream(filePath);
  stream.on('open', () => res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' }));
  stream.on('error', () => send(res, 500, 'internal error'));
  stream.pipe(res);
}

/** Read a bounded request body; rejects bodies over MAX_PROXY_BODY_BYTES. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_PROXY_BODY_BYTES) {
        reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Authenticate the human from the Supabase access token. Returns the verified
 * actor, or null when the request must be rejected (caller sends 401/503).
 */
function authenticateActor(req, res) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  try {
    if (JWT_SECRET) {
      return extractActor(verifySupabaseJwt(token, JWT_SECRET));
    }
    if (!IS_PROD) {
      // Dev convenience ONLY: decode without verifying. Never reached in prod.
      log({ level: 'WARN', action: 'jwt_unverified_dev', reason: 'SUPABASE_JWT_SECRET unset' });
      return extractActor(decodeUnverified(token));
    }
    // Fail closed: cannot attribute identity → refuse rather than log "unknown".
    log({ level: 'ERROR', action: 'proxy_identity_unavailable', reason: 'SUPABASE_JWT_SECRET unset' });
    sendJson(res, 503, { error: 'identity verification unavailable' });
    return null;
  } catch (err) {
    log({ level: 'WARN', action: 'proxy_auth_rejected', reason: String(err && err.message) });
    sendJson(res, 401, { error: 'unauthorized' });
    return null;
  }
}

/**
 * Proxy an authenticated browser request to the loopback sidecar, attaching the
 * VERIFIED identity. Client-supplied x-actor-* and Authorization are dropped —
 * the sidecar only ever sees identity this server vouches for.
 */
async function proxyToSidecar(req, res) {
  const actor = authenticateActor(req, res);
  if (!actor) return; // response already sent

  const rawUrl = req.url || SIDECAR_PROXY_PREFIX;
  const subPath = rawUrl.slice(SIDECAR_PROXY_PREFIX.length - 1); // keep leading "/"
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();

  let body;
  try {
    body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
  } catch (err) {
    return sendJson(res, err.statusCode || 400, { error: err.message || 'bad request' });
  }

  try {
    const upstream = await fetch(SIDECAR_URL + subPath, {
      method: req.method,
      headers: {
        'content-type': req.headers['content-type'] || 'application/json',
        // Identity is derived from the verified token, NOT the client.
        'x-actor-user-id': actor.userId,
        'x-actor-role': actor.role,
        'x-request-id': requestId,
      },
      body,
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
    });
    res.end(buf);
  } catch (err) {
    log({ level: 'ERROR', action: 'proxy_upstream_error', reason: String(err && err.message) });
    sendJson(res, 502, { error: 'sidecar unreachable' });
  }
}

const server = http.createServer((req, res) => {
  // Authenticated proxy to the loopback sidecar (checked before static serving).
  if ((req.url || '').startsWith(SIDECAR_PROXY_PREFIX)) {
    proxyToSidecar(req, res).catch((err) => {
      log({ level: 'ERROR', action: 'proxy_unhandled', reason: String(err && err.message) });
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    });
    return;
  }

  // Resolve request path safely within DIST_DIR (block path traversal).
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const safePath = path.normalize(path.join(DIST_DIR, urlPath));
  if (!safePath.startsWith(DIST_DIR)) return send(res, 403, 'forbidden');

  fs.stat(safePath, (err, stat) => {
    if (!err && stat.isFile()) return serveFile(res, safePath);
    // SPA fallback → index.html for client-side routes.
    serveFile(res, path.join(DIST_DIR, 'index.html'));
  });
});

(async () => {
  await handshakeWithSidecar();
  server.listen(PORT, '0.0.0.0', () => {
    log({ level: 'INFO', action: 'startup', bind: `0.0.0.0:${PORT}`, dist: DIST_DIR });
  });
})();

process.on('SIGTERM', () => {
  log({ level: 'INFO', action: 'shutdown', reason: 'SIGTERM' });
  server.close(() => process.exit(0));
});
