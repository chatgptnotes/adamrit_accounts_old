# sidecar-claude

Localhost HTTP front for the Claude CLI on the VPS. Lives alongside the existing
`aiass` service and is published to the internet through `aiass`'s reverse-proxy
under the path `/claude`.

The browser never talks to this directly; only the Vercel function
`api/skill-factory-claude.ts` in the main repo does, with a bearer token.

## VPS setup (one-time)

```bash
# 1. Copy this folder onto the VPS, next to the existing aiass service
scp -r scripts/vps-sidecar-claude your-vps:/opt/aiass/sidecar-claude
ssh your-vps

cd /opt/aiass/sidecar-claude
npm i

# 2. Generate a long random bearer token (used by Vercel side too)
openssl rand -hex 32 > .token && chmod 600 .token

# 3. Run under the same process manager aiass uses (pm2 example)
VPS_CLAUDE_TOKEN=$(cat .token) pm2 start server.js --name sidecar-claude
pm2 save

# 4. Sanity — must respond only on localhost
curl -s http://127.0.0.1:8787/health      # → {"ok":true}
```

## Expose /claude through the existing aiass reverse-proxy

**Caddy** — append inside the existing site block for `aiass`:

```caddy
aiass.yourdomain.tld {
  # ... existing aiass routes ...
  handle_path /claude* {
    reverse_proxy 127.0.0.1:8787
  }
}
```
then `sudo systemctl reload caddy`.

**Nginx** — inside the existing `server { … }` for aiass:

```nginx
location /claude {
  proxy_pass http://127.0.0.1:8787/claude;
  proxy_set_header Host $host;
  proxy_set_header Authorization $http_authorization;
}
```
then `sudo nginx -t && sudo systemctl reload nginx`.

## Smoke test from your laptop

```bash
TOKEN=$(ssh your-vps 'cat /opt/aiass/sidecar-claude/.token')
curl -s https://aiass.yourdomain.tld/claude \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"return JSON {\"ok\":true}"}'
```

- 200 + Claude JSON → success.
- 401 → token mismatch.
- 502 with `claude_cli_failed` → the `claude` CLI on the VPS errored; check
  whether the CLI session is still authenticated (`claude -p hi` in that shell).

## Token-spend tracking (GET /usage)

Every `claude -p --output-format=json` reply carries this call's real token
counts + notional cost. The sidecar now appends one JSONL line per call to
`usage.jsonl` (override with `USAGE_LOG`), stamped with the sidecar name, model,
and the calling feature/page. `GET /usage` (bearer-protected) aggregates it:
all-time / today / this-month, per-model, per-feature.

Run each sidecar with a name so the report can tell them apart:

```bash
SIDECAR_NAME=adamrit-sidecar VPS_CLAUDE_TOKEN=$(cat .token) \
  pm2 restart adamrit-sidecar --update-env
```

Check it locally:

```bash
curl -s http://127.0.0.1:8791/usage -H "Authorization: Bearer $(cat .token)" | jq .
```

Publish `/usage` through nginx (add a sibling location to the existing
`/adamrit-claude` one — note the trailing `/usage`):

```nginx
location /adamrit-usage {
  proxy_pass http://127.0.0.1:8791/usage;
  proxy_set_header Host $host;
  proxy_set_header Authorization $http_authorization;
}
```

then `sudo nginx -t && sudo systemctl reload nginx`. Set the resulting public
URL as `VPS_CLAUDE_USAGE_URL` in Vercel (comma-separate if you add the second
sidecar). The browser reads it via `/api/vps-claude-usage` → the `/vps-claude-usage`
page.

To also track the *other* sidecar (`sidecar-claude`, 8788) — which the app does
NOT call but shares your Claude subscription — deploy this same `server.js` to
it with `SIDECAR_NAME=sidecar-claude`, add an `/…-usage` nginx location for
8788, and append that URL to `VPS_CLAUDE_USAGE_URL`.

## Configure the main repo

After the VPS side is up, set these env vars locally and in Vercel:

```
VITE_LLM_BACKEND=vps
VPS_CLAUDE_URL=https://aiass.yourdomain.tld/claude
VPS_CLAUDE_TOKEN=<paste from VPS .token>
```
