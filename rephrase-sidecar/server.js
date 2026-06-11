// Billing-email AI re-phrase sidecar (internet-facing, direct-HTTPS).
//
// Deployed standalone on a VPS. Holds the LLM key server-side and is called
// DIRECTLY by the browser over HTTPS (set VITE_REPHRASE_SIDECAR_URL in the app).
// This is separate from the repo's loopback `sidecar/` service — do not confuse
// the two. Endpoints:
//
//   GET  /health     -> { ok: true }                                    (open)
//   POST /rephrase   { fromName, subject, category, draft, style }  -> { text }
//   POST /regenerate { fromName, subject, category, body, previousDraft, feedback } -> { text }
//
// The key (ANTHROPIC_API_KEY) lives only here, never in the browser bundle. If a
// request fails, the frontend silently falls back to its local templates, so a
// 4xx/5xx here is safe.
//
// Since it is internet-facing it is protected by a shared-secret header
// (x-sidecar-key == SIDECAR_SHARED_SECRET) and per-IP rate limiting.
//
// Run:  node server.js   (Node 18+)
// MUST be fronted by Caddy/nginx for HTTPS — browsers block https->http.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import Anthropic from '@anthropic-ai/sdk';

const PORT = process.env.PORT || 8787;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

// Shared secret the frontend must send as the `x-sidecar-key` header. Required
// in production; if unset the AI routes refuse to start handling requests.
const SIDECAR_SHARED_SECRET = process.env.SIDECAR_SHARED_SECRET;

// Comma-separated allowed origins, e.g. "https://localhost:8080,https://app.example.com".
// "*" allows any origin (handy for testing; tighten in production).
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!ANTHROPIC_API_KEY) {
  console.error('FATAL: ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (!SIDECAR_SHARED_SECRET) {
  console.error('FATAL: SIDECAR_SHARED_SECRET is not set. Generate one and set it in .env (and VITE_REPHRASE_SIDECAR_KEY in the app).');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const app = express();
app.set('trust proxy', 1); // behind Caddy/nginx — needed for correct client IPs in rate limiting
app.use(express.json({ limit: '256kb' }));
app.use(
  cors({
    origin: CORS_ORIGINS.includes('*') ? true : CORS_ORIGINS,
    methods: ['POST', 'GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-sidecar-key'],
  }),
);

// Require the shared-secret header on protected routes. Constant-ish comparison
// is fine here — the secret is long and random, and a failed call just falls
// back to local templates on the client.
function requireSecret(req, res, next) {
  if (req.get('x-sidecar-key') !== SIDECAR_SHARED_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// Per-IP rate limit for the AI routes (LLM calls cost money).
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30, // 30 requests / minute / IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate limit exceeded' },
});

const STYLE_INSTRUCTIONS = {
  standard: 'professional and balanced tone',
  formal: 'very formal official language, no contractions, use proper salutations',
  brief: 'extremely short — 2 to 3 sentences maximum',
  friendly: 'warm, empathetic and approachable tone with a personal touch',
};

// Call Claude and return the plain-text completion. Throws on any failure.
async function callClaude(prompt, { maxTokens, temperature }) {
  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: 'user', content: prompt }],
  });
  return (response?.content?.[0]?.text ?? '').trim();
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/rephrase', aiLimiter, requireSecret, async (req, res) => {
  const { fromName, subject, category, draft, style } = req.body ?? {};
  if (!draft || !style || !STYLE_INSTRUCTIONS[style]) {
    return res.status(400).json({ error: 'draft and a valid style are required' });
  }
  const instruction = STYLE_INSTRUCTIONS[style];
  const prompt = `You are a professional email assistant for Hope Hospital Billing Department.
Rephrase the following draft reply in a ${instruction} style.
Return ONLY the rephrased reply text — no subject line, no explanations, no extra commentary.

Original email subject: ${subject ?? ''}
From: ${fromName ?? ''}
Category: ${category ?? 'general'}

Current draft reply:
${draft}

Rephrased reply (${instruction}):`;

  try {
    const text = await callClaude(prompt, { maxTokens: 400, temperature: 0.7 });
    if (!text) return res.status(502).json({ error: 'Empty response from LLM' });
    return res.json({ text });
  } catch (e) {
    console.error('rephrase failed:', e.message);
    return res.status(502).json({ error: 'LLM request failed' });
  }
});

app.post('/regenerate', aiLimiter, requireSecret, async (req, res) => {
  const { fromName, subject, category, body, previousDraft, feedback } = req.body ?? {};
  if (!previousDraft && !subject) {
    return res.status(400).json({ error: 'subject or previousDraft is required' });
  }
  const prompt = `You are a professional email assistant for Hope Hospital Billing Department.
Write a fresh reply to the email below. Keep it professional, on-topic and concise.
${feedback?.trim()
  ? `Apply this instruction from the staff member: ${feedback.trim()}`
  : 'Use different wording from the previous draft while keeping the same meaning and intent.'}
Always end with this exact sign-off:
Warm regards,
Hope Hospital Billing Team
info@hopehospital.com

Return ONLY the reply text — no subject line, no explanations, no extra commentary.

Email subject: ${subject ?? ''}
From: ${fromName ?? ''}
Category: ${category ?? 'general'}
Email body:
${body ?? ''}

Previous draft reply:
${previousDraft ?? ''}

New reply:`;

  try {
    const text = await callClaude(prompt, { maxTokens: 500, temperature: 0.9 });
    if (!text) return res.status(502).json({ error: 'Empty response from LLM' });
    return res.json({ text });
  } catch (e) {
    console.error('regenerate failed:', e.message);
    return res.status(502).json({ error: 'LLM request failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Re-phrase sidecar listening on :${PORT} (model: ${ANTHROPIC_MODEL})`);
  console.log(`CORS origins: ${CORS_ORIGINS.join(', ')}`);
});
