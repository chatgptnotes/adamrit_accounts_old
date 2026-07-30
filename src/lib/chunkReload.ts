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
    // If we already reloaded for a chunk error in the last 10s, the chunk is
    // genuinely gone — stop, and let the normal error UI show instead of looping.
    if (Date.now() - last < 10_000) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    /* sessionStorage blocked (private mode) — fall through and reload anyway */
  }
  window.location.reload();
  return true;
};
