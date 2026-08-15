import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withRoute } from './_middleware.js';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_MODEL_LITE = 'gemini-2.5-flash-lite';
const FALLBACK_STATUSES = new Set([404, 429, 500, 502, 503]);
const PLACEHOLDER_KEYS = new Set(['', 'your_gemini_api_key_here', 'managed-server-side']);
const ALLOWED_MODELS = new Set([GEMINI_MODEL, GEMINI_MODEL_LITE]);
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGES = 4;
const MAX_OUTPUT_TOKENS = 4096;
const MAX_REQUESTS_PER_WINDOW = 30;

const geminiUrl = (model: string, apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

const readText = async (response: Response) => {
  const text = await response.text();
  if (!text) return '{}';
  return text;
};

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function validatePayload(payload: any): string | null {
  const serialized = JSON.stringify(payload ?? {});
  if (byteLength(serialized) > MAX_BODY_BYTES) return 'request payload too large';
  const contents = Array.isArray(payload?.contents) ? payload.contents : [];
  let imageCount = 0;
  for (const content of contents) {
    for (const part of Array.isArray(content?.parts) ? content.parts : []) {
      const data = part?.inline_data?.data;
      if (typeof data !== 'string') continue;
      imageCount += 1;
      if (imageCount > MAX_IMAGES) return `maximum ${MAX_IMAGES} images per request`;
      if (byteLength(data) > MAX_IMAGE_BYTES) return 'image payload too large';
    }
  }
  return null;
}

async function callGemini(model: string, payload: unknown, apiKey: string) {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  };

  let upstream = await fetch(geminiUrl(model, apiKey), init);
  if (!upstream.ok && model === GEMINI_MODEL && FALLBACK_STATUSES.has(upstream.status)) {
    const lite = await fetch(geminiUrl(GEMINI_MODEL_LITE, apiKey), init);
    if (lite.ok) upstream = lite;
  }

  return upstream;
}

// Staff-only. The origin allowlist below was the only guard, and an Origin
// header costs nothing to forge from outside a browser — so this was in
// practice an open Gemini endpoint on the hospital's key. The origin check is
// kept (withRoute applies it) but it is no longer the thing holding the door.
export default withRoute(
  { auth: 'session', methods: ['POST'], rateLimit: { perMinute: MAX_REQUESTS_PER_WINDOW, perHour: 300 } },
  async (req: VercelRequest, res: VercelResponse) => {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (PLACEHOLDER_KEYS.has(apiKey)) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server' });
  }

  const provider = req.body?.provider || 'gemini';
  if (provider !== 'gemini') {
    return res.status(400).json({ error: `Unsupported provider: ${provider}` });
  }

  const model = typeof req.body?.model === 'string' ? req.body.model : GEMINI_MODEL;
  if (!ALLOWED_MODELS.has(model)) {
    return res.status(400).json({ error: 'unsupported_model' });
  }

  const payload = req.body?.payload ?? {};
  const payloadError = validatePayload(payload);
  if (payloadError) return res.status(413).json({ error: payloadError });
  if (payload?.generationConfig && typeof payload.generationConfig === 'object') {
    payload.generationConfig.maxOutputTokens = Math.min(
      Number(payload.generationConfig.maxOutputTokens) || MAX_OUTPUT_TOKENS,
      MAX_OUTPUT_TOKENS,
    );
    payload.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  try {
    const upstream = await callGemini(model, payload, apiKey);
    const text = await readText(upstream);
    res.status(upstream.status);
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    res.status(502).json({ error: 'gemini_unreachable', detail: message });
  }
});
