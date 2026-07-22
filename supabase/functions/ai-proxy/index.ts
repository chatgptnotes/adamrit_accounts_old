// =============================================================================
// ai-proxy — keyless server-side proxy for all frontend AI calls.
//
// Why this exists:
//   The frontend used to call Gemini/OpenAI directly with VITE_GEMINI_API_KEY /
//   VITE_OPENAI_API_KEY, which Vite inlines into the browser bundle — exposing
//   the keys to anyone who opens DevTools. This function keeps the keys in Deno
//   server env and forwards the request, so no key ever ships to the client.
//
// Contract (pass-through by design):
//   POST { provider: 'gemini' | 'openai', model: string, payload: <raw body> }
//   `payload` is the EXACT provider request body the frontend already builds
//   (Gemini: { contents, systemInstruction, generationConfig }; OpenAI:
//   { messages, max_tokens, temperature }). Passing it verbatim means vision
//   (inline_data), responseMimeType, thinkingConfig, and multi-turn history all
//   work with zero per-field modeling here. The provider's raw JSON (and status)
//   is returned untouched so existing frontend response-parsing is unchanged.
//
// Auth: the Supabase gateway verifies the caller's JWT before we run (same model
//   as the agent-* functions). We don't re-verify in code.
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

// Mirrors src/lib/gemini.ts: flash for vision/clinical/long-form, flash-lite for
// plain text->JSON. Kept in sync here so the fallback below targets the right model.
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_MODEL_LITE = 'gemini-2.5-flash-lite';
const ALLOWED_MODELS = new Set([GEMINI_MODEL, GEMINI_MODEL_LITE]);
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGES = 4;
const MAX_OUTPUT_TOKENS = 4096;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;
const requestWindows = new Map<string, number[]>();

// Statuses where retrying on the lighter model can succeed: quota (429), model
// unavailability/retirement (404), transient server errors (500/502/503). Auth
// (401/403) and malformed-request (400) are not retried — lite fails identically.
const FALLBACK_STATUSES = new Set([404, 429, 500, 502, 503]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

function originAllowed(req: Request): boolean {
  const origin = (req.headers.get('origin') || '').replace(/\/$/, '');
  const referer = req.headers.get('referer') || '';
  const configured = (Deno.env.get('APP_ORIGIN') || '').replace(/\/$/, '');
  const allowed = new Set([configured, 'https://adamrit.com', 'https://www.adamrit.com', 'http://localhost:5173', 'http://localhost:4173']);
  if (origin) {
    try { return allowed.has(new URL(origin).origin); } catch { return false; }
  }
  if (referer) {
    try { return allowed.has(new URL(referer).origin); } catch { return false; }
  }
  return false;
}

function rateKey(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
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
  return new TextEncoder().encode(value).byteLength;
}

function validatePayload(payload: any): string | null {
  if (byteLength(JSON.stringify(payload ?? {})) > MAX_BODY_BYTES) return 'request payload too large';
  let imageCount = 0;
  for (const content of Array.isArray(payload?.contents) ? payload.contents : []) {
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

function geminiUrl(model: string, apiKey: string): string {
  // encodeURIComponent so an untrusted model string can't inject extra path
  // segments or query params into the (otherwise fixed-host) URL.
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
}

async function callGemini(model: string, payload: unknown): Promise<Response> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return json({ error: 'GEMINI_API_KEY is not configured on the server' }, 500);

  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };

  let res = await fetch(geminiUrl(model, apiKey), init);
  // Seamless flash -> flash-lite degradation (separate quota, stays available).
  if (!res.ok && model === GEMINI_MODEL && FALLBACK_STATUSES.has(res.status)) {
    const liteRes = await fetch(geminiUrl(GEMINI_MODEL_LITE, apiKey), init);
    if (liteRes.ok) res = liteRes;
  }
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function callOpenai(payload: Record<string, unknown>): Promise<Response> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return json({ error: 'OPENAI_API_KEY is not configured on the server' }, 500);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface ProxyBody {
  provider?: 'gemini' | 'openai';
  model?: string;
  payload?: unknown;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!originAllowed(req)) return json({ error: 'forbidden_origin' }, 403);
  if (!withinRateLimit(rateKey(req))) return json({ error: 'rate_limited' }, 429);

  try {
    const body = (await req.json()) as ProxyBody;
    const provider = body.provider ?? 'gemini';

    if (provider === 'gemini') {
      const model = body.model || GEMINI_MODEL;
      if (!ALLOWED_MODELS.has(model)) return json({ error: 'unsupported_model' }, 400);
      const payload = (body.payload ?? {}) as Record<string, any>;
      const payloadError = validatePayload(payload);
      if (payloadError) return json({ error: payloadError }, 413);
      if (payload.generationConfig && typeof payload.generationConfig === 'object') {
        payload.generationConfig.maxOutputTokens = Math.min(
          Number(payload.generationConfig.maxOutputTokens) || MAX_OUTPUT_TOKENS,
          MAX_OUTPUT_TOKENS,
        );
        payload.generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }
      return await callGemini(model, payload);
    }
    if (provider === 'openai') {
      // OpenAI carries the model inside the payload; respect body.model if set.
      const payload = { ...(body.payload as Record<string, unknown> ?? {}) };
      if (body.model) payload.model = body.model;
      return await callOpenai(payload);
    }
    return json({ error: `Unknown provider: ${provider}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: `ai-proxy failed: ${msg}` }, 500);
  }
});
