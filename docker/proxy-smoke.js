'use strict';

/**
 * Integration smoke test for the sidecar proxy:
 *   browser request → serve.js (/api/sidecar/*) → loopback sidecar
 *
 *   1. spawns the real sidecar (../sidecar/server.js)
 *   2. spawns serve.js with a known SUPABASE_JWT_SECRET (prod mode)
 *   3. asserts: valid token → 200 and the sidecar logs the VERIFIED user id;
 *               no token → 401; spoofed x-actor header is ignored.
 *
 * Run: node docker/proxy-smoke.js
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const SIDECAR_PORT = 8091;
const APP_PORT = 3091;
const SECRET = 'integration-test-secret';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function mintJwt(payload) {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url(payload);
  const sig = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function request(pathname, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: APP_PORT, path: pathname, method: 'GET', headers },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const sidecarLog = [];
const sidecar = spawn('node', [path.join(__dirname, '..', 'sidecar', 'server.js')], {
  env: { ...process.env, SIDECAR_PORT: String(SIDECAR_PORT) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
sidecar.stdout.on('data', (d) => sidecarLog.push(d.toString()));

const app = spawn('node', [path.join(__dirname, 'serve.js')], {
  env: {
    ...process.env,
    PORT: String(APP_PORT),
    SIDECAR_URL: `http://127.0.0.1:${SIDECAR_PORT}`,
    SUPABASE_JWT_SECRET: SECRET,
    NODE_ENV: 'production',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});

function cleanup() {
  app.kill('SIGTERM');
  sidecar.kill('SIGTERM');
}

async function run() {
  let failures = 0;
  const assert = (cond, msg) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`);
    if (!cond) failures++;
  };

  await new Promise((r) => setTimeout(r, 1500)); // let both servers boot

  const validToken = mintJwt({ sub: 'real-user-42', app_metadata: { role: 'doctor' }, exp: 9_999_999_999 });

  // 1. valid token → 200
  const ok = await request('/api/sidecar/handshake', { authorization: `Bearer ${validToken}` });
  assert(ok.status === 200, 'valid token proxies to sidecar (200)');
  assert(/loopback-namespace/.test(ok.body), 'handshake body returned through proxy');

  // 2. sidecar logged the VERIFIED user id, not "unknown"
  const sidecarOut = sidecarLog.join('');
  assert(/"actor":"real-user-42"/.test(sidecarOut), 'sidecar audit logged verified user id');
  assert(/"actorRole":"doctor"/.test(sidecarOut), 'sidecar audit logged verified role');

  // 3. no token → 401
  const noTok = await request('/api/sidecar/handshake', {});
  assert(noTok.status === 401, 'missing token rejected (401)');

  // 4. spoofed identity header WITHOUT a valid token → 401 (header is ignored)
  const spoof = await request('/api/sidecar/handshake', { 'x-actor-user-id': 'attacker' });
  assert(spoof.status === 401, 'spoofed x-actor header without token rejected (401)');
  assert(!/"actor":"attacker"/.test(sidecarLog.join('')), 'spoofed identity never reached sidecar');

  cleanup();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
