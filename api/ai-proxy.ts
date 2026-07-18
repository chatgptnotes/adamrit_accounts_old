import type { VercelRequest, VercelResponse } from '@vercel/node';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_MODEL_LITE = 'gemini-2.5-flash-lite';
const FALLBACK_STATUSES = new Set([404, 429, 500, 502, 503]);

const geminiUrl = (model: string, apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

const readText = async (response: Response) => {
  const text = await response.text();
  if (!text) return '{}';
  return text;
};

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

  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server' });
  }

  const provider = req.body?.provider || 'gemini';
  if (provider !== 'gemini') {
    return res.status(400).json({ error: `Unsupported provider: ${provider}` });
  }

  const model = typeof req.body?.model === 'string' ? req.body.model : GEMINI_MODEL;

  try {
    const upstream = await callGemini(model, req.body?.payload ?? {}, apiKey);
    const text = await readText(upstream);
    res.status(upstream.status);
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    res.status(502).json({ error: 'gemini_unreachable', detail: message });
  }
}
