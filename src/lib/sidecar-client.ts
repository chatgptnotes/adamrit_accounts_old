/**
 * Client for the loopback-isolated sidecar.
 *
 * No API key is sent: the sidecar binds to 127.0.0.1 and only accepts traffic
 * from the same pod/host network namespace. We DO forward the authenticated
 * human identity so the sidecar can attribute PHI access in its audit trail.
 */

const SIDECAR_BASE = (import.meta.env?.VITE_SIDECAR_URL as string) || 'http://127.0.0.1:8081';

export interface SidecarActor {
  /** Authenticated user id from the Main App session (NOT a credential the sidecar checks). */
  userId: string;
  /** User role for audit attribution. */
  role: string;
}

export interface HandshakeResult {
  peer: string;
  nonce: string;
  trust: string;
}

function actorHeaders(actor?: SidecarActor, requestId?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (actor) {
    headers['x-actor-user-id'] = actor.userId;
    headers['x-actor-role'] = actor.role;
  }
  if (requestId) headers['x-request-id'] = requestId;
  return headers;
}

/** Liveness check — used by the Main App on startup / readiness probes. */
export async function checkSidecarHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${SIDECAR_BASE}/healthz`);
    return res.ok;
  } catch {
    return false;
  }
}

/** Keyless handshake — verifies the Main App can talk to the sidecar with no credentials. */
export async function handshake(actor?: SidecarActor): Promise<HandshakeResult> {
  const res = await fetch(`${SIDECAR_BASE}/handshake`, { headers: actorHeaders(actor) });
  if (!res.ok) {
    throw new Error(`sidecar handshake failed: ${res.status}`);
  }
  return (await res.json()) as HandshakeResult;
}

export { SIDECAR_BASE };
