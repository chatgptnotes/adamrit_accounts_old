// Sidecar that fronts the Claude CLI over HTTP. Runs on the VPS, bound to
// 127.0.0.1 only. The existing `aiass` reverse-proxy (Caddy/Nginx) is what
// publishes /claude to the public internet over HTTPS — see README.md.
//
// Auth: single bearer token, supplied via VPS_CLAUDE_TOKEN env. The Vercel
// relay (api/skill-factory-claude.ts in the main repo) sends it; the browser
// never sees it.

const express = require('express');
const { spawn } = require('child_process');

const app = express();
app.use(express.json({ limit: '256kb' }));

const TOKEN = process.env.VPS_CLAUDE_TOKEN;
if (!TOKEN) {
  console.error('VPS_CLAUDE_TOKEN missing — refusing to start.');
  process.exit(1);
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/claude', (req, res) => {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const prompt = String(req.body?.prompt || '');
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const cp = spawn('claude', ['-p', prompt, '--output-format=json'], { timeout: 120_000 });
  let out = '';
  let err = '';
  cp.stdout.on('data', (d) => { out += d; });
  cp.stderr.on('data', (d) => { err += d; });
  cp.on('close', (code) => {
    if (code !== 0) {
      return res.status(502).json({ error: 'claude_cli_failed', code, stderr: err.slice(0, 2000) });
    }
    res.type('application/json').send(out);
  });
  cp.on('error', (e) => {
    res.status(500).json({ error: 'spawn_failed', message: e.message });
  });
});

const PORT = Number(process.env.PORT) || 8787;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`sidecar-claude listening on 127.0.0.1:${PORT}`);
});
