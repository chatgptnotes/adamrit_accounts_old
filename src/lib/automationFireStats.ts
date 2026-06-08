// Rule 14 surface — counts how many times a saved automation has fired in the
// past 7 days, so the chatbot UI can quietly show "Fired N times this week."
// Cached in memory (per-tab) for 60 s to avoid hammering Supabase on every
// re-render. Returns 0 for unknown flows or transient errors — never throws,
// since this is a non-essential surface and must never block the chatbot.
import { supabase } from '@/integrations/supabase/client';

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { count: number; at: number }>();
// Track in-flight fetches so concurrent React effects don't race-fire.
const inflight = new Map<string, Promise<number>>();

function sevenDaysAgoIso(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

export function getCachedFireCount(flowName: string): number | null {
  const key = flowName.toLowerCase();
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.count;
}

export async function fetchFireCountThisWeek(flowName: string): Promise<number> {
  const key = flowName.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at <= CACHE_TTL_MS) return cached.count;
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const since = sevenDaysAgoIso();
      // PostgREST JSONB path filter — `details->>flowName=eq.<name>` matches
      // the JSON shape our dispatcher writes in flowDispatcher.ts.
      const { count, error } = await supabase
        .from('user_activity_log')
        .select('id', { count: 'exact', head: true })
        .eq('action', 'automation_fired')
        .eq('details->>flowName', flowName)
        .gte('created_at', since);
      if (error) return 0;
      const n = typeof count === 'number' ? count : 0;
      cache.set(key, { count: n, at: Date.now() });
      return n;
    } catch {
      return 0;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}
