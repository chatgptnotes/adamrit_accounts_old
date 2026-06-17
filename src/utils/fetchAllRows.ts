// PostgREST / Supabase returns at most ~1000 rows per request. These helpers page through
// the full result set so large tables (e.g. 21k+ visit_labs) are never silently truncated.
//
// fetchAllRows: pass a function that returns a FRESH query builder each call (Supabase query
// builders are single-use), it keeps requesting .range() pages until a short page comes back.
//
// fetchAllByIn: like .in('col', values) but also splits the value list into chunks so a very
// long IN list cannot blow the URL length limit, and pages each chunk fully.

const PAGE_SIZE = 1000;
const MAX_PAGES = 500; // safety backstop (= up to 500k rows) so a bug can't loop forever

export async function fetchAllRows<T = any>(
  buildQuery: () => any,
  pageSize = PAGE_SIZE
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// Fetch every row whose `column` is in `values`, chunking the IN list and paging each chunk.
// buildQuery receives the chunk and must return a fresh query builder with .in() applied.
export async function fetchAllByIn<T = any>(
  values: (string | number)[],
  buildQuery: (chunk: (string | number)[]) => any,
  chunkSize = 200
): Promise<T[]> {
  const unique = Array.from(new Set(values.filter(v => v !== null && v !== undefined)));
  if (unique.length === 0) return [];
  const all: T[] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const rows = await fetchAllRows<T>(() => buildQuery(chunk));
    all.push(...rows);
  }
  return all;
}
