// Gemini access for the browser — routed through the keyless `ai-proxy` Edge
// Function so no API key ever ships in the client bundle.
//
// History: callers used to hit https://generativelanguage.googleapis.com
// directly with a browser-exposed API key, which Vite inlines into the bundle —
// exposing the key to anyone with DevTools. Now `geminiFetch` forwards the same
// request body to `ai-proxy`, which holds the key in server env. The public
// signatures below are unchanged so existing call sites keep working untouched:
// they still build a URL with `geminiGenerateContentUrl(...)` (the apiKey arg is
// now vestigial — pass '' ) and read the response with `await res.json()`.
//
// Models, tiered by capability/cost. Route each call to the cheapest model that
// can do the job — this is the single biggest token-cost lever.
//
//  - GEMINI_MODEL       (flash):      vision/OCR, clinical, long-form generation
//  - GEMINI_MODEL_LITE  (flash-lite): plain text -> JSON extraction, low-stakes
//
export const GEMINI_MODEL = 'gemini-2.5-flash';
export const GEMINI_MODEL_LITE = 'gemini-2.5-flash-lite';

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// True only when a real-looking key is configured. Guards against the empty
// string and the `.env.example` placeholder (`your_gemini_api_key_here`), both
// of which are truthy and would otherwise be sent to Google and rejected with a
// 400 "API key not valid". Callers use this to fall back to free local
// templates instead of surfacing a hard API error.
export function hasValidGeminiKey(key?: string): boolean {
  const k = key?.trim() ?? '';
  return k.length > 10 && !k.toLowerCase().startsWith('your_');
}

// Builds the same URL shape as before so `geminiFetch` can parse the model out
// of it. The key is no longer embedded — callers may pass '' for `apiKey`.
export function geminiGenerateContentUrl(
  apiKey: string,
  model: string = GEMINI_MODEL,
): string {
  void apiKey; // retained for call-site compatibility; key now lives server-side
  return `${GEMINI_API_BASE}/models/${model}:generateContent`;
}

function modelFromUrl(url: string): string {
  const m = url.match(/\/models\/([^:/]+):generateContent/);
  return m?.[1] ?? GEMINI_MODEL;
}

// Gemini's own errors arrive as { error: { message } }, but ai-proxy reports its
// own faults - missing GEMINI_API_KEY, rate_limited, forbidden_origin, the 413
// image cap - as { error: "<string>" }. Callers that read only .error.message
// therefore saw nothing and blamed the model for what was a config or quota
// problem. Read both shapes, and keep the status: it is usually the diagnosis.
export function describeGeminiError(data: unknown, status: number): string {
  const error = (data as { error?: unknown } | null)?.error;
  const detail =
    typeof error === 'string'
      ? error
      : (error as { message?: string } | null)?.message || '';

  // Naming Gemini for a refusal that never reached Gemini sends people to look
  // at the wrong thing. ai-proxy is staff-only (auth: 'session'), so the door
  // closes before the model is ever contacted. Azhar's phone read "Gemini
  // request failed (401): not_authenticated" while photographing a PhonePe
  // screen; the AI was fine, his login had run out overnight.
  //
  // Matched on the code rather than the status: 403 covers three unrelated
  // refusals, and telling someone whose account was deactivated to sign in
  // again would send them round a loop they cannot escape.
  if (status === 401 || detail === 'not_authenticated') {
    return 'Your session has expired — sign out and sign in again, then try once more.';
  }
  if (detail === 'account_inactive') {
    return 'This account has been deactivated. Ask an administrator to re-enable it.';
  }
  if (detail === 'rate_limited') {
    return 'Too many AI requests just now — wait a minute and try again.';
  }

  return detail
    ? `Gemini request failed (${status}): ${detail}`
    : `Gemini request failed (HTTP ${status}).`;
}

// Route all Gemini requests through the same-origin serverless API.
// The Gemini key belongs only in the server-side GEMINI_API_KEY secret.
//
// Throws on a non-ok response. Most call sites never checked `res.ok` and read
// `data.candidates?.[0]...` straight off an error body, turning every proxy
// failure into an empty string and then a downstream "the AI returned nothing".
// Throwing here gives all of them the real reason without touching each one;
// every caller already runs inside a try/catch that surfaces `error.message`.
export async function geminiFetch(url: string, init: RequestInit): Promise<Response> {
  let payload: unknown = {};
  if (typeof init.body === 'string') {
    payload = init.body ? JSON.parse(init.body) : {};
  } else if (init.body && typeof init.body === 'object' && !(init.body instanceof FormData)) {
    payload = init.body;
  }

  const model = modelFromUrl(url);
  const response = await fetch('/api/ai-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'gemini', model, payload }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(describeGeminiError(data, response.status));
  }
  return response;
}

// Kept as an alias for any caller importing the lower-level name; the proxy now
// owns the flash -> flash-lite degradation. This one does NOT throw - callers of
// this name check `res.ok` themselves - so it converts geminiFetch's throw back
// into a Response. The body uses the { error: { message } } shape those callers
// already read, so the real reason reaches them instead of a bare statusText.
export async function geminiGenerateContent(url: string, init: RequestInit): Promise<Response> {
  try {
    return await geminiFetch(url, init);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: { message } }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
