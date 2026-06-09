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

// Statuses where retrying on the lighter model can succeed: quota (429), model
// unavailability/retirement (404), transient server errors (500/502/503). Auth
// (401/403) and malformed-request (400) are not retried — lite fails identically.
const FALLBACK_STATUSES = new Set([404, 429, 500, 502, 503]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

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

  try {
    const body = (await req.json()) as ProxyBody;
    const provider = body.provider ?? 'gemini';

    if (provider === 'gemini') {
      const model = body.model || GEMINI_MODEL;
      return await callGemini(model, body.payload ?? {});
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
