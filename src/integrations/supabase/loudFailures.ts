/**
 * Every failed write says so, on screen.
 *
 * WHY THIS EXISTS
 *
 * On 28 July a trigger started rejecting every insert into `bills`. Nobody
 * knew until 15 August — eighteen days, 31,306 bills and not one saved —
 * because FinalBill creates the bill in a useEffect whose only failure path is
 * console.error. The screen looked completely normal the entire time.
 *
 * That is not one careless catch block. 278 files in this app write straight
 * to the database, and any of them can swallow a failure the same way. Fixing
 * them one at a time means fixing 278 places and missing the 279th.
 *
 * So the report happens at the single point every call passes through: the
 * fetch the Supabase client uses. Nothing in the 278 files changes, and a
 * write that fails cannot be silent again.
 *
 * WHAT IT REPORTS, AND WHAT IT DELIBERATELY IGNORES
 *
 * Writes only — POST, PATCH, PUT, DELETE. A failed read usually shows itself:
 * the list is empty, the screen spins, somebody complains within the hour. A
 * failed write looks exactly like a successful one, which is the whole problem.
 *
 * Auth is excluded: a wrong password is not a fault, and it already has its
 * own message.
 *
 * It never throws and never alters the response. A reporter that breaks the
 * app it is watching would be worse than the silence it replaces — so the
 * whole thing is wrapped, and any failure inside it is swallowed rather than
 * raised.
 *
 * DUPLICATES. A screen that already shows its own error will now show two.
 * That is the intended trade: one redundant toast is cheaper than eighteen
 * days of silence. Identical failures are collapsed for a few seconds so a
 * retry loop cannot bury the screen.
 *
 * OPTING OUT. A caller that genuinely expects failure — a probe, a
 * check-then-insert — can send the header `x-quiet-errors: 1` and this stays
 * quiet. Nothing in the app does yet; it exists so the honest cases have an
 * answer other than deleting this file.
 */

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * The signed-in staff member's database pass, if the server issued one.
 *
 * Staff authenticate against our own "User" table, so without this the browser
 * presents only the anon key and the database sees `anon` — which is why 19
 * tables carry `auth.role() = 'authenticated'` policies that have never matched
 * anything. api/auth-session mints a Supabase-signed token at login;
 * AuthContext hands it here, and every database call below swaps it in.
 *
 * Null until the server sends one, and null whenever SUPABASE_USER_JWT is off,
 * so the app behaves exactly as before until the switch is thrown.
 */
let dbAccessToken: string | null = null;

export const setDbAccessToken = (token: string | null): void => {
  dbAccessToken = token || null;
};

/** Recently reported failures, so a retry loop cannot bury the screen. */
const recent = new Map<string, number>();
const QUIET_WINDOW_MS = 5000;

const seenRecently = (key: string): boolean => {
  const now = Date.now();
  for (const [k, at] of recent) if (now - at > QUIET_WINDOW_MS) recent.delete(k);
  if (recent.has(key)) return true;
  recent.set(key, now);
  return false;
};

/** "advance_payment" from a REST path, "declare_opening_cash" from an RPC. */
const describeTarget = (url: string): string => {
  try {
    const path = new URL(url, 'http://x').pathname;
    const rpc = path.match(/\/rest\/v1\/rpc\/([^/?]+)/);
    if (rpc) return rpc[1];
    const rest = path.match(/\/rest\/v1\/([^/?]+)/);
    if (rest) return rest[1];
    if (path.startsWith('/storage/')) return 'file upload';
    return path;
  } catch {
    return 'the database';
  }
};

/** PostgREST puts the useful sentence in `message`; the rest is for the log. */
const readError = async (response: Response): Promise<{ message: string; detail: unknown }> => {
  try {
    const text = await response.clone().text();
    if (!text) return { message: `${response.status} ${response.statusText}`, detail: null };
    try {
      const body = JSON.parse(text);
      const message =
        (typeof body?.message === 'string' && body.message) ||
        (typeof body?.error === 'string' && body.error) ||
        (typeof body?.error_description === 'string' && body.error_description) ||
        `${response.status} ${response.statusText}`;
      return { message, detail: body };
    } catch {
      return { message: text.slice(0, 300), detail: text };
    }
  } catch {
    return { message: `${response.status} ${response.statusText}`, detail: null };
  }
};

/**
 * "Not saved" is a promise about what happened, and it must be true.
 *
 * Every RPC is a POST, but plenty of them only READ —
 * get_panel_document_status is a query, and telling a cashier their work was
 * not saved because a list failed to load sends them to check a payment that
 * was never in danger. A test that lied about its own failure caused exactly
 * that confusion earlier today; this is the same mistake in the UI.
 *
 * A write to a table is a save. Anything through /rpc/ might be either, so it
 * gets wording that is true in both cases.
 */
const titleFor = (url: string): string =>
  url.includes('/rest/v1/rpc/') ? "That didn't go through" : 'Not saved';

const report = async (method: string, url: string, response: Response): Promise<void> => {
  const target = describeTarget(url);
  const { message, detail } = await readError(response);

  // The log always happens, toast or no toast — it is what a developer needs
  // and it costs nothing.
  console.error(`[failed ${method}] ${target} → ${response.status}`, { message, detail, url });

  if (typeof window === 'undefined') return;
  if (seenRecently(`${method}|${target}|${message}`)) return;

  const { toast } = await import('sonner');
  toast.error(titleFor(url), {
    description: message,
    duration: 10_000,
  });
};

/**
 * A fetch that behaves exactly like the real one, and says so when a write is
 * refused. The response is returned untouched either way.
 */
/**
 * Present the signed-in person's token instead of the bare anon key.
 *
 * Only swaps a header that currently carries the anon key: supabase-js sets its
 * own Authorization for /auth/v1/ (Google sign-in) and for a genuine Supabase
 * session, and neither must be overwritten. The apikey header stays as-is —
 * PostgREST still wants it.
 */
const withUserToken = (init: RequestInit | undefined, url: string): RequestInit | undefined => {
  if (!dbAccessToken) return init;
  if (url.includes('/auth/v1/')) return init;

  const headers = new Headers(init?.headers as HeadersInit | undefined);
  const current = headers.get('Authorization');
  const anonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;
  // Fail closed. If we cannot tell what the anon key is, leave an existing
  // header alone: overwriting a real Google/Supabase session would sign the
  // request as the wrong identity, which is worse than not swapping at all.
  if (current && current !== `Bearer ${anonKey}`) return init;

  headers.set('Authorization', `Bearer ${dbAccessToken}`);
  return { ...init, headers };
};

export const reportingFetch: typeof fetch = async (input, init) => {
  const requestUrl =
    typeof input === 'string' ? input
      : input instanceof URL ? input.toString()
        : (input as Request)?.url || '';

  // Wrapped: a fault in header-swapping must not take down every database call.
  let effectiveInit = init;
  try {
    effectiveInit = withUserToken(init, requestUrl);
  } catch {
    effectiveInit = init;
  }

  const response = await fetch(input as RequestInfo, effectiveInit);
  init = effectiveInit;

  try {
    const method = (init?.method || (input as Request)?.method || 'GET').toUpperCase();
    if (!WRITE_METHODS.has(method) || response.ok) return response;

    const url =
      typeof input === 'string' ? input
        : input instanceof URL ? input.toString()
          : (input as Request).url;

    if (url.includes('/auth/v1/')) return response;

    const quiet =
      new Headers(init?.headers as HeadersInit | undefined).get('x-quiet-errors') === '1';
    if (quiet) return response;

    // Not awaited: reporting must never delay the caller, and the response is
    // cloned inside, so reading it here cannot consume the caller's body.
    void report(method, url, response);
  } catch {
    // A reporter that throws would break every write in the app. Never.
  }

  return response;
};
