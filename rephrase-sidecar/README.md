# Re-phrase Sidecar (internet-facing, direct-HTTPS)

A standalone Node service that performs the billing-email **Re-phrase** and
**Regenerate** AI calls server-side (via **Claude**, `claude-sonnet-4-6`), so
**no LLM key ships in the frontend bundle**.

The Adamrit app calls it **directly from the browser over HTTPS** when
`VITE_REPHRASE_SIDECAR_URL` is set, sending the shared secret as the
`x-sidecar-key` header (`VITE_REPHRASE_SIDECAR_KEY`). If the sidecar is unset,
unreachable, or rejects the call, the app silently falls back to its free
built-in per-style templates — so this service is an enhancement, never a hard
dependency.

> ⚠️ This is **not** the repo's loopback `sidecar/` service. That one is bound to
> `127.0.0.1` and reached through an authenticated same-origin proxy. This one is
> internet-facing and called directly by the browser. Keep them separate.

## Endpoints

| Method | Path          | Auth            | Body                                                            | Returns    |
|--------|---------------|-----------------|-----------------------------------------------------------------|------------|
| GET    | `/health`     | none            | —                                                               | `{ ok: true }` |
| POST   | `/rephrase`   | `x-sidecar-key` | `{ fromName, subject, category, draft, style }`                 | `{ text }` |
| POST   | `/regenerate` | `x-sidecar-key` | `{ fromName, subject, category, body, previousDraft, feedback }`| `{ text }` |

`style` ∈ `standard | formal | brief | friendly`.

The two AI routes require the header `x-sidecar-key: <SIDECAR_SHARED_SECRET>`
(401 otherwise) and are rate-limited to 30 requests/minute/IP (429 otherwise).

## Local run

```bash
cd rephrase-sidecar
npm install
cp .env.example .env      # then put a real ANTHROPIC_API_KEY and SIDECAR_SHARED_SECRET in .env
npm start                 # listens on :8787 (HTTP)
```

Test it (HTTP is fine for curl; the browser needs HTTPS — see below):

```bash
curl -s http://localhost:8787/health
curl -s -X POST http://localhost:8787/rephrase \
  -H 'Content-Type: application/json' \
  -H 'x-sidecar-key: <your SIDECAR_SHARED_SECRET>' \
  -d '{"fromName":"Test","subject":"Bill query","category":"billing","draft":"Dear Test, your account is under review.","style":"formal"}'
```

## ⚠️ HTTPS is mandatory for browser use

The app runs over HTTPS, and browsers **block `https → http` requests**
(mixed content). A bare `http://vps-ip:8787` will be blocked in the browser even
though `curl` works. Put a TLS-terminating reverse proxy in front:

### Caddy (auto-HTTPS, simplest)

`/etc/caddy/Caddyfile`:

```
sidecar.your-domain.com {
    reverse_proxy 127.0.0.1:8787
}
```

```bash
sudo caddy reload --config /etc/caddy/Caddyfile
```

Caddy obtains and renews a Let's Encrypt cert automatically. Then set
`VITE_REPHRASE_SIDECAR_URL=https://sidecar.your-domain.com` and
`VITE_REPHRASE_SIDECAR_KEY=<same SIDECAR_SHARED_SECRET>` in the app's `.env`
and rebuild/restart Vite.

### nginx + certbot (alternative)

```nginx
server {
    server_name sidecar.your-domain.com;
    location / { proxy_pass http://127.0.0.1:8787; }
}
```

```bash
sudo certbot --nginx -d sidecar.your-domain.com
```

## Keep it running

### pm2

```bash
cd rephrase-sidecar
pm2 start server.js --name rephrase-sidecar
pm2 save && pm2 startup
```

### systemd

`/etc/systemd/system/rephrase-sidecar.service`:

```ini
[Unit]
Description=Adamrit re-phrase sidecar
After=network.target

[Service]
WorkingDirectory=/opt/rephrase-sidecar
EnvironmentFile=/opt/rephrase-sidecar/.env
ExecStart=/usr/bin/node server.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now rephrase-sidecar
```

## Security notes

- The sidecar holds the LLM key — keep `.env` off git and restrict file perms (`chmod 600 .env`).
- Set `CORS_ORIGINS` to your real app origin(s) in production; avoid `*`.
- The two AI routes require the `x-sidecar-key` shared secret and are
  rate-limited (30/min/IP). Generate the secret with `openssl rand -hex 32` and
  set the SAME value as `VITE_REPHRASE_SIDECAR_KEY` in the app.
- It only rephrases text (no PHI lookups, no DB). Keep the Node port (8787)
  bound to localhost; only 80/443 (Caddy/nginx) should be public.
