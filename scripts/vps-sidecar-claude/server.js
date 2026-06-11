// Sidecar that fronts the Claude CLI over HTTP. Runs on the VPS, bound to
// 127.0.0.1 only. The existing `aiass` reverse-proxy (Caddy/Nginx) is what
// publishes /claude to the public internet over HTTPS — see README.md.
//
// Auth: single bearer token, supplied via VPS_CLAUDE_TOKEN env. The Vercel
// relay (api/skill-factory-claude.ts in the main repo) sends it; the browser
// never sees it.

const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = express();
// Vision requests carry a base64 image, so the body can be a few MB. Text-only
// requests are tiny; this just raises the ceiling.
app.use(express.json({ limit: '12mb' }));

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

  // Per-request model, allowlisted so a caller can never inject arbitrary CLI
  // args. Default sonnet (Skill Factory chatbot — faster + cheaper for
  // flow-gen); the discharge-summary generation sends 'opus' for quality.
  const ALLOWED_MODELS = ['sonnet', 'opus', 'haiku'];
  const model = ALLOWED_MODELS.includes(req.body?.model) ? req.body.model : 'sonnet';

  // Optional vision images: [{ base64, mimeType }]. The headless CLI has no
  // base64/stdin image input, so we write each to a temp file and tell the Read
  // tool to load them (Read returns images as visual content). --allowedTools
  // "Read" pre-approves the read so headless mode never hangs on a prompt.
  const tmpFiles = [];
  let cliPrompt = prompt;
  const cliArgs = ['-p', '', '--model', model, '--output-format=json'];
  const images = Array.isArray(req.body?.images)
    ? req.body.images.filter((i) => i && typeof i.base64 === 'string' && typeof i.mimeType === 'string')
    : [];
  if (images.length > 0) {
    try {
      images.forEach((img, idx) => {
        const ext = (img.mimeType.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
        const tmpFile = path.join(os.tmpdir(), `adamrit-vision-${process.pid}-${Date.now()}-${idx}.${ext}`);
        fs.writeFileSync(tmpFile, Buffer.from(img.base64, 'base64'));
        tmpFiles.push(tmpFile);
      });
    } catch (e) {
      tmpFiles.forEach((f) => { try { fs.unlinkSync(f); } catch { /* best effort */ } });
      return res.status(500).json({ error: 'image_write_failed', message: e.message });
    }
    const paths = tmpFiles.map((f) => `"${f}"`).join(' and ');
    cliPrompt = `Read the image${tmpFiles.length > 1 ? 's' : ''} at ${paths} and use ${tmpFiles.length > 1 ? 'them' : 'it'} to answer the following. Reply with only the requested output.\n\n${prompt}`;
    cliArgs.push('--allowedTools', 'Read');
  }
  cliArgs[1] = cliPrompt;

  const cleanup = () => {
    while (tmpFiles.length) { try { fs.unlinkSync(tmpFiles.pop()); } catch { /* best effort */ } }
  };

  const cp = spawn('claude', cliArgs, { timeout: 120_000 });
  let out = '';
  let err = '';
  cp.stdout.on('data', (d) => { out += d; });
  cp.stderr.on('data', (d) => { err += d; });
  cp.on('close', (code) => {
    cleanup();
    if (code !== 0) {
      return res.status(502).json({ error: 'claude_cli_failed', code, stderr: err.slice(0, 2000) });
    }
    res.type('application/json').send(out);
  });
  cp.on('error', (e) => {
    cleanup();
    res.status(500).json({ error: 'spawn_failed', message: e.message });
  });
});

const PORT = Number(process.env.PORT) || 8787;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`sidecar-claude listening on 127.0.0.1:${PORT}`);
});
