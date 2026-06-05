/**
 * Browser client for the loopback-isolated sidecar.
 *
 * A browser CANNOT reach the sidecar directly: 127.0.0.1:8081 from a browser is
 * the end-user's own machine, not the pod. All calls go through the same-origin
 * server proxy (`/api/sidecar/*` in docker/serve.js), which authenticates the
 * Supabase session and forwards the VERIFIED identity to the sidecar for audit.
 *
 * Pass the user's Supabase access token; the proxy derives `x-actor-*` from it.
 * Client-supplied identity headers are ignored by the proxy (anti-spoofing).
 */

const PROXY_BASE = '/api/sidecar';

export interface HandshakeResult {
  peer: string;
  nonce: string;
  trust: string;
}

interface CallOptions {
  /** Supabase access token (e.g. from `supabase.auth.getSession()`). Required. */
  accessToken: string;
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Call a sidecar route through the authenticated proxy.
 * @param path sidecar path, e.g. "/handshake" or "/deidentify"
 */
export async function callSidecar<T = unknown>(path: string, opts: CallOptions): Promise<T> {
  if (!opts.accessToken) {
    throw new Error('callSidecar: accessToken is required');
  }
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const res = await fetch(`${PROXY_BASE}${normalized}`, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(`sidecar call failed: ${res.status} ${normalized}`);
  }
  return (await res.json()) as T;
}

/** Keyless (to the sidecar) handshake through the authenticated proxy. */
export async function handshake(accessToken: string): Promise<HandshakeResult> {
  return callSidecar<HandshakeResult>('/handshake', { accessToken });
}

export { PROXY_BASE };
