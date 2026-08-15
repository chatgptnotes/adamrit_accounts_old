// Tests for api/_middleware.ts — the shared caller check every route now runs.
//
// These are the cases that were actually wrong in production before it existed:
// a route that spent money with no session, a cron guard that waved everyone
// through when its secret was unset, a handler that returned its stack trace.
//
// No network and no database: the PostgREST call that re-reads the caller's
// role is intercepted by stubbing fetch, the same way e2e/jotform-webhook.test.ts
// does it.
//
// Run:  npx vite-node e2e/api-middleware.test.ts

process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.APP_ORIGIN = 'https://www.adamrit.com';
delete process.env.CRON_SECRET;

// --- stub the database ------------------------------------------------------
// One row stands in for public."User". Tests mutate it to describe the caller.
let userRow: Record<string, unknown> | null = null;

const origFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any) => {
  const u = String(url);
  if (u.includes('/rest/v1/User')) {
    return new Response(JSON.stringify(userRow ? [userRow] : []), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return origFetch(url, init);
}) as typeof fetch;

const { withRoute } = await import('../api/_middleware.ts');
const { signToken, SESSION_COOKIE } = await import('../api/_auth.ts');

// --- harness ----------------------------------------------------------------

function mockRes() {
  const res: any = { statusCode: 200, body: null, headers: {}, headersSent: false, ended: false };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; res.headersSent = true; return res; };
  res.send = (b: any) => { res.body = b; res.headersSent = true; return res; };
  res.end = () => { res.ended = true; res.headersSent = true; return res; };
  res.setHeader = (k: string, v: any) => { res.headers[String(k).toLowerCase()] = v; return res; };
  return res;
}

const sessionCookieFor = (user: { id: string; email: string; role: string }) => {
  const token = signToken({
    type: 'hmis-session',
    sub: user.id,
    email: user.email,
    role: user.role,
    hospitalType: 'hope',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
};

const mockReq = (over: Record<string, any> = {}) => ({
  method: 'POST',
  url: '/api/test-route',
  headers: { origin: 'https://www.adamrit.com', ...(over.headers || {}) },
  query: {},
  body: {},
  ...over,
});

async function call(handler: any, req: any) {
  const res = mockRes();
  await handler(req, res);
  return res;
}

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

// Each test gets its own route path so the per-IP rate-limit buckets, which are
// keyed by route, cannot bleed from one test into the next.
let n = 0;
const uniqueUrl = () => `/api/test-route-${++n}`;

// --- method and preflight ---------------------------------------------------

console.log('\nmethod and preflight');
{
  const h = withRoute({ auth: 'public', why: 'test', methods: ['POST'] }, async (_r, res) => res.status(200).json({ ok: true }));

  const wrong = await call(h, mockReq({ method: 'GET', url: uniqueUrl() }));
  check('rejects a method the route does not answer', wrong.statusCode === 405 && wrong.body?.error === 'method_not_allowed', wrong.body);

  const pre = await call(h, mockReq({ method: 'OPTIONS', url: uniqueUrl() }));
  check('answers CORS preflight with 204', pre.statusCode === 204);
  check('preflight reflects our origin, never *', pre.headers['access-control-allow-origin'] === 'https://www.adamrit.com', pre.headers);
}

// --- origin -----------------------------------------------------------------

console.log('\norigin');
{
  const h = withRoute({ auth: 'session' }, async (_r, res) => res.status(200).json({ ok: true }));
  const res = await call(h, mockReq({ url: uniqueUrl(), headers: { origin: 'https://evil.example.com' } }));
  check('refuses a request from another site', res.statusCode === 403 && res.body?.error === 'forbidden_origin', res.body);
  check('does not reflect a foreign origin back', res.headers['access-control-allow-origin'] === undefined, res.headers);
}

// --- session ----------------------------------------------------------------

console.log('\nsession');
{
  const h = withRoute({ auth: 'session' }, async (_r, res, ctx) => res.status(200).json({ ok: true, who: ctx.user?.email }));

  userRow = null;
  const anon = await call(h, mockReq({ url: uniqueUrl() }));
  check('no cookie is 401, not a pass', anon.statusCode === 401 && anon.body?.error === 'not_authenticated', anon.body);

  userRow = { id: 'u1', email: 'nurse@hope.test', role: 'receptionist', is_active: true };
  const ok = await call(h, mockReq({ url: uniqueUrl(), headers: { origin: 'https://www.adamrit.com', cookie: sessionCookieFor({ id: 'u1', email: 'nurse@hope.test', role: 'receptionist' }) } }));
  check('a signed-in staff member gets through', ok.statusCode === 200 && ok.body?.who === 'nurse@hope.test', ok.body);

  // The reason the role is re-read from the database on every request.
  userRow = { id: 'u1', email: 'nurse@hope.test', role: 'receptionist', is_active: false };
  const off = await call(h, mockReq({ url: uniqueUrl(), headers: { origin: 'https://www.adamrit.com', cookie: sessionCookieFor({ id: 'u1', email: 'nurse@hope.test', role: 'receptionist' }) } }));
  check('a deactivated account is refused even with a valid cookie', off.statusCode === 403 && off.body?.error === 'account_inactive', off.body);
}

// --- admin ------------------------------------------------------------------

console.log('\nadmin');
{
  const h = withRoute({ auth: 'admin' }, async (_r, res) => res.status(200).json({ ok: true }));
  const cookie = sessionCookieFor({ id: 'u2', email: 'clerk@hope.test', role: 'superadmin' });

  // The cookie claims superadmin; the database says otherwise, and the database wins.
  userRow = { id: 'u2', email: 'clerk@hope.test', role: 'receptionist', is_active: true };
  const demoted = await call(h, mockReq({ url: uniqueUrl(), headers: { origin: 'https://www.adamrit.com', cookie } }));
  check('a demoted admin cannot ride an old cookie', demoted.statusCode === 403 && demoted.body?.error === 'super_admin_required', demoted.body);

  userRow = { id: 'u2', email: 'clerk@hope.test', role: 'superadmin', is_active: true };
  const admin = await call(h, mockReq({ url: uniqueUrl(), headers: { origin: 'https://www.adamrit.com', cookie } }));
  check('a real superadmin gets through', admin.statusCode === 200, admin.body);
}

// --- cron -------------------------------------------------------------------

console.log('\ncron');
{
  const h = withRoute({ auth: 'cron', methods: ['GET'], rateLimit: false }, async (_r, res) => res.status(200).json({ ok: true }));

  // The bug this replaced: `if (cronSecret && ...)` let everyone through when
  // the secret was unset.
  delete process.env.CRON_SECRET;
  const unset = await call(h, mockReq({ method: 'GET', url: uniqueUrl(), headers: {} }));
  check('fails closed when CRON_SECRET is unset', unset.statusCode === 401, unset.body);

  process.env.CRON_SECRET = 'cron-abc';
  const wrong = await call(h, mockReq({ method: 'GET', url: uniqueUrl(), headers: { authorization: 'Bearer nope' } }));
  check('rejects a wrong secret', wrong.statusCode === 401, wrong.body);

  const right = await call(h, mockReq({ method: 'GET', url: uniqueUrl(), headers: { authorization: 'Bearer cron-abc' } }));
  check('accepts the scheduler', right.statusCode === 200, right.body);
  delete process.env.CRON_SECRET;
}

// --- rate limit -------------------------------------------------------------

console.log('\nrate limit');
{
  const url = uniqueUrl();
  const h = withRoute({ auth: 'public', why: 'test', rateLimit: { perMinute: 3 } }, async (_r, res) => res.status(200).json({ ok: true }));
  const req = () => mockReq({ url, headers: { 'x-forwarded-for': '203.0.113.9' } });

  const codes: number[] = [];
  for (let i = 0; i < 5; i++) codes.push((await call(h, req())).statusCode);
  check('lets the first three through and then throttles', codes.slice(0, 3).every((c) => c === 200) && codes[3] === 429 && codes[4] === 429, codes);

  const other = await call(h, mockReq({ url, headers: { 'x-forwarded-for': '198.51.100.4' } }));
  check('throttles per caller, not globally', other.statusCode === 200, other.body);
}

// --- failures ---------------------------------------------------------------

console.log('\nfailures');
{
  const h = withRoute({ auth: 'public', why: 'test' }, async () => {
    throw new Error('connect ECONNREFUSED 10.0.0.5:5432 as user svc_admin');
  });
  const res = await call(h, mockReq({ url: uniqueUrl() }));
  check('a thrown handler becomes a 500, not a crash', res.statusCode === 500 && res.body?.error === 'internal_error', res.body);
  check('the internal message is not handed to the caller', !JSON.stringify(res.body).includes('ECONNREFUSED'), res.body);
  check('a request id is returned so the log can be found', typeof res.body?.requestId === 'string' && res.body.requestId.length > 0, res.body);
}

// --- misconfiguration -------------------------------------------------------

console.log('\nmisconfiguration');
{
  let threw = false;
  try {
    withRoute({ auth: 'public' } as any, async (_r, res) => res.status(200).json({ ok: true }));
  } catch {
    threw = true;
  }
  check('a public route without a written reason fails the build', threw);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
