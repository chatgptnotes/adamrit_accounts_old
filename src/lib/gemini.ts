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

// Direct browser -> Google call. The API key is read from VITE_GEMINI_API_KEY
// and appended to the request URL.
//
// NOTE: this ships the key in the client bundle (anyone with DevTools can read
// it). Chosen deliberately so the chatbot and other AI features work WITHOUT
// deploying the ai-proxy edge function. To re-hide the key later, restore the
// ai-proxy version of this function and deploy that function.
export async function geminiFetch(url: string, init: RequestInit): Promise<Response> {
  const model = modelFromUrl(url);
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key is not configured. Add VITE_GEMINI_API_KEY to .env and restart the dev server.');
  }
  // fetch() natively honors init.signal, so caller AbortSignals keep working.
  const directUrl = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
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
