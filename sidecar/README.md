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
| `Dockerfile` | Non-root Alpine image with loopback health check |
| `docker-compose.yml` | Local co-location via shared network namespace |
| `../k8s/main-with-sidecar.yaml` | Production Pod + Service + NetworkPolicy |
| `../src/lib/sidecar-client.ts` | Main App client (`checkSidecarHealth`, `handshake`) |

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

```ts
import { checkSidecarHealth, handshake } from '@/lib/sidecar-client';

if (await checkSidecarHealth()) {
  const result = await handshake({ userId: session.userId, role: session.role });
  console.log('sidecar trust model:', result.trust);
}
```
