import type { VercelRequest, VercelResponse } from '@vercel/node';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_MODEL_LITE = 'gemini-2.5-flash-lite';
const FALLBACK_STATUSES = new Set([404, 429, 500, 502, 503]);
const PLACEHOLDER_KEYS = new Set(['', 'your_gemini_api_key_here', 'managed-server-side']);
const ALLOWED_MODELS = new Set([GEMINI_MODEL, GEMINI_MODEL_LITE]);
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGES = 4;
const MAX_OUTPUT_TOKENS = 4096;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;
const requestWindows = new Map<string, number[]>();

const geminiUrl = (model: string, apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

const readText = async (response: Response) => {
  const text = await response.text();
  if (!text) return '{}';
  return text;
};

function requestOriginAllowed(req: VercelRequest): boolean {
  const origin = String(req.headers.origin || '').replace(/\/$/, '');
  const referer = String(req.headers.referer || '');
  const configured = String(process.env.APP_ORIGIN || process.env.VERCEL_PROJECT_PRODUCTION_URL || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  const allowedHosts = new Set([configured, 'www.adamrit.com', 'adamrit.com', 'localhost:5173', 'localhost:4173']);
  if (origin) {
    try { return allowedHosts.has(new URL(origin).host); } catch { return false; }
  }
  if (referer) {
    try { return allowedHosts.has(new URL(referer).host); } catch { return false; }
  }
  return false;
}

function clientKey(req: VercelRequest): string {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown');
}

function withinRateLimit(key: string): boolean {
  const now = Date.now();
  const previous = (requestWindows.get(key) || []).filter((timestamp) => now - timestamp < 60 * 60_000);
  const minuteCount = previous.filter((timestamp) => now - timestamp < WINDOW_MS).length;
  if (minuteCount >= MAX_REQUESTS_PER_WINDOW || previous.length >= 300) return false;
  previous.push(now);
  requestWindows.set(key, previous);
  if (requestWindows.size > 10_000) requestWindows.clear();
  return true;
}

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!requestOriginAllowed(req)) {
    return res.status(403).json({ error: 'forbidden_origin' });
  }
  if (!withinRateLimit(clientKey(req))) {
    return res.status(429).json({ error: 'rate_limited' });
  }

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
}
