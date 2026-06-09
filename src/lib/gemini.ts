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
// The flash -> flash-lite fallback now lives server-side in ai-proxy.
import { supabase } from '@/integrations/supabase/client';

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

// Drop-in replacement for the old fetch wrapper. Instead of calling Google
// directly, it forwards the request body to the `ai-proxy` Edge Function and
// wraps the result back into a `Response` so existing `res.ok` / `await
// res.json()` callers are unaffected. Throws with the API error body on failure,
// matching the previous behaviour.
export async function geminiFetch(url: string, init: RequestInit): Promise<Response> {
  const model = modelFromUrl(url);
  const payload = typeof init.body === 'string' ? JSON.parse(init.body) : init.body ?? {};

  const invoke = supabase.functions.invoke('ai-proxy', {
    body: { provider: 'gemini', model, payload },
  });

  // Honor a caller-supplied AbortSignal (e.g. drug-interactions' 30s timeout).
  // supabase.functions.invoke can't be cancelled mid-flight, so we race it
  // against the abort and surface the same error a fetch would throw.
  const { data, error } = init.signal
    ? await Promise.race([
        invoke,
        new Promise<never>((_, reject) => {
          const sig = init.signal as AbortSignal;
          if (sig.aborted) reject(new DOMException('Aborted', 'AbortError'));
          sig.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        }),
      ])
    : await invoke;

  if (error) {
    // supabase-js surfaces non-2xx from the function as `error`; the function's
    // JSON body (when present) carries the real provider message.
    const detail = (error as { message?: string })?.message || String(error);
    throw new Error(`Gemini API error (proxy): ${detail}`);
  }

  // The proxy returns the provider's raw JSON, which supabase-js parses into
  // `data`. Re-serialize so callers can keep using `await res.json()`.
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
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
