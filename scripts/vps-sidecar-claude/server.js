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

// ── Token-usage tracking ────────────────────────────────────────────────────
// Every `claude -p --output-format=json` reply already carries this call's real
// token counts + notional cost. We append one JSONL line per call so spend can
// be attributed per-sidecar / per-model / per-feature / per-day. On a Max
// subscription you aren't billed per token; total_cost_usd is the what-it-would-
// cost-on-the-API figure, the token counts are what burn the rate limit.
//
// SIDECAR_NAME stamps each record so a shared log (or the /usage aggregator)
// can tell adamrit-sidecar apart from any other sidecar running this code.
const SIDECAR_NAME = process.env.SIDECAR_NAME || 'adamrit-sidecar';
const USAGE_LOG = process.env.USAGE_LOG || path.join(__dirname, 'usage.jsonl');

function recordUsage({ model, feature, rawJson }) {
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return; // not JSON (shouldn't happen with --output-format=json) — skip
  }
  const u = parsed && parsed.usage ? parsed.usage : {};
  const rec = {
    ts: new Date().toISOString(),
    sidecar: SIDECAR_NAME,
    model,
    feature: feature || 'unknown',
    input_tokens: Number(u.input_tokens) || 0,
    output_tokens: Number(u.output_tokens) || 0,
    cache_creation_input_tokens: Number(u.cache_creation_input_tokens) || 0,
    cache_read_input_tokens: Number(u.cache_read_input_tokens) || 0,
    total_cost_usd: Number(parsed.total_cost_usd) || 0,
  };
  try {
    fs.appendFileSync(USAGE_LOG, JSON.stringify(rec) + '\n');
  } catch (e) {
    console.error('usage log write failed:', e.message); // never fail the request over logging
  }
}

// Empty token accumulator with every breakdown bucket the dashboard needs.
function emptyTotals() {
  return {
    calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    total_tokens: 0,
    total_cost_usd: 0,
  };
}
function addInto(acc, rec) {
  acc.calls += 1;
  acc.input_tokens += rec.input_tokens;
  acc.output_tokens += rec.output_tokens;
  acc.cache_creation_input_tokens += rec.cache_creation_input_tokens;
  acc.cache_read_input_tokens += rec.cache_read_input_tokens;
  acc.total_tokens +=
    rec.input_tokens + rec.output_tokens +
    rec.cache_creation_input_tokens + rec.cache_read_input_tokens;
  acc.total_cost_usd += rec.total_cost_usd;
}
function bucket(map, key, rec) {
  if (!map[key]) map[key] = emptyTotals();
  addInto(map[key], rec);
}

app.get('/health', (_req, res) => res.json({ ok: true }));

// Detailed token-spend status for this sidecar. Bearer-protected like /claude.
app.get('/usage', (req, res) => {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  let lines = [];
  try {
    lines = fs.readFileSync(USAGE_LOG, 'utf8').split('\n').filter(Boolean);
  } catch {
    // no log yet — return a zeroed but well-formed status
  }

  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);   // YYYY-MM-DD (UTC)
  const monthKey = now.toISOString().slice(0, 7);    // YYYY-MM   (UTC)

  const allTime = emptyTotals();
  const today = emptyTotals();
  const month = emptyTotals();
  const byModel = {};
  const byFeature = {};
  let firstTs = null;
  let lastTs = null;

  for (const line of lines) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    // tolerate older/partial records
    rec.input_tokens = Number(rec.input_tokens) || 0;
    rec.output_tokens = Number(rec.output_tokens) || 0;
    rec.cache_creation_input_tokens = Number(rec.cache_creation_input_tokens) || 0;
    rec.cache_read_input_tokens = Number(rec.cache_read_input_tokens) || 0;
    rec.total_cost_usd = Number(rec.total_cost_usd) || 0;

    addInto(allTime, rec);
    if (typeof rec.ts === 'string') {
      if (!firstTs || rec.ts < firstTs) firstTs = rec.ts;
      if (!lastTs || rec.ts > lastTs) lastTs = rec.ts;
      if (rec.ts.slice(0, 10) === todayKey) addInto(today, rec);
      if (rec.ts.slice(0, 7) === monthKey) addInto(month, rec);
    }
    bucket(byModel, rec.model || 'unknown', rec);
    bucket(byFeature, rec.feature || 'unknown', rec);
  }

  res.json({
    sidecar: SIDECAR_NAME,
    log_path: USAGE_LOG,
    generated_at: now.toISOString(),
    window: { today: todayKey, month: monthKey, timezone: 'UTC' },
    first_call: firstTs,
    last_call: lastTs,
    all_time: allTime,
    today,
    this_month: month,
    by_model: byModel,
    by_feature: byFeature,
  });
});

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

  // Optional feature/page tag for usage attribution. The relay derives it from
  // the browser's Referer path so no app call-site has to pass it. Sanitised to
  // a short safe string; defaults to 'unknown'.
  const feature = (typeof req.body?.feature === 'string' ? req.body.feature : '')
    .slice(0, 80)
    .replace(/[^\w\-./:]/g, '') || 'unknown';

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
    recordUsage({ model, feature, rawJson: out });
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
