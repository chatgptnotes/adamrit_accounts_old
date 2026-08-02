// Auto-recover from stale code chunks after a deploy. When a new build replaces
// the hashed JS/CSS chunk filenames, a tab still running the old index.html
// fails to import a lazily-loaded route and would otherwise land on the error
// boundary ("Something went wrong"). We reload once to pull the fresh
// index.html and its new chunk hashes — guarded so a genuinely missing chunk
// can't loop forever.
const CHUNK_RELOAD_KEY = 'app:chunk-reload-at';

export const isChunkLoadError = (error: unknown): boolean => {
  const msg = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  return (
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('importing a module script failed') ||
    msg.includes('loading chunk') ||
    msg.includes('loading css chunk')
  );
};

// Reload once for a chunk error. Returns true if a reload was triggered, so the
// caller can suppress the error UI while the page is on its way out.
export const reloadOnceForChunkError = (error: unknown): boolean => {
  if (!isChunkLoadError(error)) return false;
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    // If we already reloaded for a chunk error in the last 20s, the chunk is
    // genuinely gone — stop, and let the normal error UI show instead of looping.
    if (Date.now() - last < 20_000) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    /* sessionStorage blocked (private mode) — fall through and reload anyway */
  }
  // A plain reload re-serves the SAME stale index.html from the outgoing
  // service worker's precache, hits the same missing chunk, and lands right
  // back here — which is exactly what kept happening on deploy days. Evict
  // the worker and its caches FIRST, so the reload fetches fresh from the
  // network; the new worker reinstalls itself on the clean load.
  const evict = async () => {
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
      await Promise.all(regs.map((r) => r.unregister()));
    } catch { /* no SW — nothing to evict */ }
    try {
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch { /* cache API blocked — reload anyway */ }
  };
  void evict().finally(() => window.location.reload());
  return true;
};
