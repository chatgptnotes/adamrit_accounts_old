'use strict';

/**
 * Main App runtime entrypoint for the sidecar demo.
 *
 *  1. On startup, performs a KEYLESS handshake to the loopback sidecar to prove
 *     service-to-service trust works with no API key (shared network namespace).
 *  2. Serves the built Vite SPA (dist/) on 0.0.0.0:3000 with SPA fallback.
 *
 * The handshake runs server-side (here), NOT in the browser — a browser hitting
 * 127.0.0.1:8081 would reach the end-user's own machine, not the pod sidecar.
 * The loopback sidecar pattern is for co-located server processes.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const DIST_DIR = path.join(__dirname, '..', 'dist');
const SIDECAR_URL = process.env.SIDECAR_URL || 'http://127.0.0.1:8081';

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

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const stream = fs.createReadStream(filePath);
  stream.on('open', () => res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' }));
  stream.on('error', () => send(res, 500, 'internal error'));
  stream.pipe(res);
}

const server = http.createServer((req, res) => {
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
