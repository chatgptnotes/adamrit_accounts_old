# Adamrit Sidecar (loopback-isolated, keyless)

A sidecar that communicates with the Main App **without an API key**. Security is
enforced by **network topology**, not a secret:

- The sidecar binds **strictly to `127.0.0.1`** and only accepts traffic from the
  same pod/host network namespace (the Main App).
- `127.0.0.1` is not routable off the host, so no external process can reach the
  sidecar — there is no network path to authenticate.
- A redundant runtime check rejects any non-loopback `remoteAddress` (belt and
  suspenders against accidental `0.0.0.0` binds).

> Loopback removes **service-to-service** transport auth. It does **not** remove
> HIPAA obligations: the Main App still authenticates the human user and forwards
> their identity (`x-actor-user-id`, `x-actor-role`) so the sidecar can attribute
> PHI access in its audit trail. Data persisted by the sidecar must be encrypted
> at rest, and audit logs shipped to an immutable store (6-year retention).

## Files

| Path | Purpose |
|------|---------|
| `server.js` | The sidecar HTTP server (Node stdlib, no deps) |
| `audit.js` | PHI-free audit logger (field allowlist + security tagging) |
| `audit.test.js` | Unit tests for the audit allowlist (`npm test`) |
| `Dockerfile` | Non-root Alpine image with loopback health check |
| `docker-compose.yml` | Local co-location via shared network namespace |
| `../k8s/main-with-sidecar.yaml` | Production Pod + Service + NetworkPolicy |
| `../src/lib/sidecar-client.ts` | Browser client → calls the proxy (`handshake`, `callSidecar`) |
| `../docker/serve.js` | Main App runtime: static SPA + authenticated `/api/sidecar/*` proxy |
| `../docker/identity.js` | Supabase JWT verification + actor extraction |

## Endpoints (no credentials)

- `GET /healthz` → `{ "status": "ok", "boundTo": "127.0.0.1:8081" }`
- `GET /handshake` → `{ "peer": "sidecar", "nonce": "...", "trust": "loopback-namespace" }`

## Run locally (no Docker)

```bash
cd sidecar
node server.js
# in another shell:
curl http://127.0.0.1:8081/healthz
curl http://127.0.0.1:8081/handshake
```

## Verify isolation

```bash
node sidecar/smoke-test.js
```

This confirms loopback works and that the non-loopback guard returns 403.

## Run with Docker Compose

```bash
cd sidecar
docker compose up --build
```

The sidecar's `8081` is intentionally **not** published — only the Main App's
public port is exposed (declared on the namespace-owning `sidecar` service).

## Use from the Main App

The browser never talks to the sidecar directly (127.0.0.1 in a browser is the
user's own machine). It calls the same-origin proxy `/api/sidecar/*` in
`docker/serve.js`, which verifies the Supabase access token and forwards the
**verified** identity to the sidecar:

```ts
import { handshake, callSidecar } from '@/lib/sidecar-client';

const { data } = await supabase.auth.getSession();
const token = data.session!.access_token;

const result = await handshake(token);            // GET /api/sidecar/handshake
console.log('sidecar trust model:', result.trust);

// Any sidecar route, identity attached automatically by the proxy:
await callSidecar('/deidentify', { accessToken: token, method: 'POST', body: { ref } });
```

### Request flow

```
browser ──Authorization: Bearer <supabase jwt>──▶ serve.js /api/sidecar/*
   serve.js verifies the JWT (HS256), derives x-actor-user-id / x-actor-role,
   strips any client-supplied identity headers, then ──▶ 127.0.0.1:8081 (sidecar)
```

`SUPABASE_JWT_SECRET` must be set at runtime. When unset in production the proxy
**fails closed** (503) rather than forwarding unattributed access.

## HIPAA compliance status

Tracking issue: [#320](https://github.com/chatgptnotes/adamrit/issues/320).

| # | Requirement | Status |
|---|-------------|--------|
| 5 | **PHI-free audit logs** | ✅ Enforced in `audit.js` via a field allowlist — unknown keys (possible PHI) are dropped and flagged in `droppedFields`. Covered by `audit.test.js`. |
| 4 | **Security-event routing** | ✅ `reject_non_loopback` is tagged `category: "security"`, `severity: "warning"`, `outcome: "deny"` so a SIEM can route it into incident review. |
| 1 | **Immutable log shipping (6-yr retention)** | 📄 Ops config, not app code. The sidecar emits one JSON object per line to **stdout**; the platform log pipeline (e.g. Fluent Bit → WORM bucket / append-only store) must ship and retain it for 6 years per §164.316(b)(2). |
| 2 | **Encryption at rest** | 📄 The sidecar currently persists nothing. If it begins caching/buffering PHI to disk, encrypt at rest per §164.312(a)(2)(iv). |
| 3 | **Propagate human identity** | ✅ `docker/serve.js` proxies `/api/sidecar/*`, verifies the Supabase JWT (HS256), and forwards the **verified** `x-actor-user-id` / `x-actor-role` to the sidecar. Client-supplied identity headers are ignored (anti-spoofing); fails closed (503) in prod when `SUPABASE_JWT_SECRET` is unset. Covered by `docker/identity.test.js` + `docker/proxy-smoke.js`. ES256/JWKS verification is a follow-up. |

### Audit field reference

Only these keys are emitted; everything else is dropped. Use `resourceType` +
`resourceId` for record references — **never** put PHI values in a log.

```
ts, component, level, action, category, severity, remote, path, requestId,
actor, actorRole, outcome, status, reason, nonce, bind, resourceType, resourceId
```

## Test

```bash
# sidecar audit + loopback
cd sidecar && npm test          # audit allowlist unit tests + loopback smoke
node smoke-test.js              # loopback handshake only

# proxy + identity (Main App runtime)
cd ../docker && npm test        # Supabase JWT verification unit tests
node proxy-smoke.js             # end-to-end: token → proxy → sidecar + anti-spoofing
```
