// Gemini access for the browser — routed through the keyless `ai-proxy` Edge
// Function so no API key ever ships in the client bundle.
//
// History: callers used to hit https://generativelanguage.googleapis.com
// directly with `?key=VITE_GEMINI_API_KEY`, which Vite inlines into the bundle —
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

// Route all Gemini requests through the authenticated Supabase Edge Function.
// VITE_GEMINI_API_KEY is deliberately only a non-secret sentinel in this app;
// the real Gemini key belongs in the server-side GEMINI_API_KEY secret.
export async function geminiFetch(url: string, init: RequestInit): Promise<Response> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'your_gemini_api_key_here' || apiKey === 'managed-server-side') {
    throw new Error('Gemini API key is not configured. Set VITE_GEMINI_API_KEY to a valid Gemini API key and restart the app.');
  }
  const model = modelFromUrl(url);
  const directUrl = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  return fetch(directUrl, init);
}

// Kept as an alias for any caller importing the lower-level name; the proxy now
// owns the flash -> flash-lite degradation, so this is identical to geminiFetch
// minus the throw-on-error (callers of this name handled `res.ok` themselves).
export async function geminiGenerateContent(url: string, init: RequestInit): Promise<Response> {
  try {
    return await geminiFetch(url, init);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
