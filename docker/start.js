'use strict';

/**
 * Single-container supervisor for Render (and any one-container host).
 *
 * Render gives each service its own network namespace, so the loopback sidecar
 * pattern can only be preserved by running BOTH processes in ONE container:
 *
 *   - sidecar/server.js  → binds 127.0.0.1:SIDECAR_PORT (never exposed)
 *   - docker/serve.js    → binds 0.0.0.0:PORT (the only port Render exposes),
 *                          proxies /api/sidecar/* to the loopback sidecar
 *
 * Because both share this container's netns, 127.0.0.1:8081 is reachable only
 * from within the container — exactly the keyless, network-isolated guarantee.
 *
 * If either child exits, we tear down the other and exit non-zero so the host
 * restarts the whole container (no half-running state).
 */

const { spawn } = require('child_process');
const path = require('path');

const SIDECAR_PORT = process.env.SIDECAR_PORT || '8081';
const PORT = process.env.PORT || '10000'; // Render injects $PORT
const children = [];
let shuttingDown = false;

function log(event) {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), component: 'supervisor', ...event }) + '\n'
  );
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(exitCode), 3000).unref();
}

function start(name, file, env) {
  const child = spawn(process.execPath, [file], {
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    log({ level: 'ERROR', action: 'child_exit', child: name, code, signal });
    shutdown(1); // restart the whole container
  });
  children.push({ name, child });
  log({ level: 'INFO', action: 'child_started', child: name, pid: child.pid });
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

// Sidecar first (loopback only). serve.js retries its startup handshake until
// the sidecar is ready, so a small start ordering gap is fine.
start('sidecar', path.join(__dirname, '..', 'sidecar', 'server.js'), { SIDECAR_PORT });
start('main-app', path.join(__dirname, 'serve.js'), {
  SIDECAR_URL: `http://127.0.0.1:${SIDECAR_PORT}`,
  PORT,
});
