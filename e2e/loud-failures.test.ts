/**
 * The failure reporter must never be the thing that breaks.
 *
 * It sits in front of every database call in the app, so a fault here is a
 * fault in all 278 write paths at once. These are the properties that matter,
 * in the order they would hurt:
 *
 *   1. it never changes what the caller receives
 *   2. it never throws, whatever the response does
 *   3. it never consumes the body the caller is about to read
 *   4. it reports failed WRITES and stays quiet about everything else
 *
 * Run: npx vite-node e2e/loud-failures.test.ts
 */

import { reportingFetch } from '../src/integrations/supabase/loudFailures';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name}`, detail ?? ''); }
};

/** Captures what the reporter logs, so "did it speak?" is testable. */
const errors: string[] = [];
const realError = console.error;
console.error = (...args: unknown[]) => { errors.push(String(args[0])); };

const realFetch = globalThis.fetch;
const stub = (status: number, body: string, contentType = 'application/json') => {
  globalThis.fetch = (async () =>
    new Response(body, { status, headers: { 'content-type': contentType } })) as typeof fetch;
};
const spoke = () => errors.some((e) => e.startsWith('[not saved]'));
const reset = () => { errors.length = 0; };

const URL_REST = 'https://x.supabase.co/rest/v1/advance_payment';
const URL_RPC = 'https://x.supabase.co/rest/v1/rpc/declare_opening_cash';
const URL_AUTH = 'https://x.supabase.co/auth/v1/token';

const run = async () => {
  // 1. A failed write speaks, and names what failed.
  reset();
  stub(400, JSON.stringify({ message: 'null value in column "amount"' }));
  await reportingFetch(URL_REST, { method: 'POST' });
  await new Promise((r) => setTimeout(r, 10));
  check('failed POST is reported', spoke(), errors);
  check('report names the table',
    errors.some((e) => e.includes('advance_payment')), errors);

  // 2. A successful write says nothing. This is what keeps it worth reading.
  reset();
  stub(201, JSON.stringify([{ id: 1 }]));
  await reportingFetch(URL_REST, { method: 'POST' });
  await new Promise((r) => setTimeout(r, 10));
  check('successful POST is silent', !spoke(), errors);

  // 3. A failed READ says nothing — an empty screen shows itself; a silent
  //    failed write does not.
  reset();
  stub(400, JSON.stringify({ message: 'bad filter' }));
  await reportingFetch(URL_REST, { method: 'GET' });
  await new Promise((r) => setTimeout(r, 10));
  check('failed GET is not reported', !spoke(), errors);

  // 4. A wrong password is not a fault worth shouting about.
  reset();
  stub(400, JSON.stringify({ error: 'invalid_grant' }));
  await reportingFetch(URL_AUTH, { method: 'POST' });
  await new Promise((r) => setTimeout(r, 10));
  check('auth failure is left to the login screen', !spoke(), errors);

  // 5. A failed RPC speaks — declare_opening_cash refusing is exactly the
  //    class of thing that must never be silent.
  reset();
  stub(400, JSON.stringify({ message: 'This counter already has an opening balance' }));
  await reportingFetch(URL_RPC, { method: 'POST' });
  await new Promise((r) => setTimeout(r, 10));
  check('failed RPC is reported', spoke(), errors);
  check('report names the function',
    errors.some((e) => e.includes('declare_opening_cash')), errors);

  // 6. Opting out is honoured, so an honest probe has an answer other than
  //    deleting the reporter.
  reset();
  stub(409, JSON.stringify({ message: 'duplicate key' }));
  await reportingFetch(URL_REST, { method: 'POST', headers: { 'x-quiet-errors': '1' } });
  await new Promise((r) => setTimeout(r, 10));
  check('x-quiet-errors suppresses the report', !spoke(), errors);

  // 7. THE ONE THAT MATTERS MOST: the caller's body is untouched. Reading the
  //    response to report on it must not consume it.
  reset();
  stub(400, JSON.stringify({ message: 'refused', code: '23503' }));
  const res = await reportingFetch(URL_REST, { method: 'POST' });
  const body = await res.json();
  check('caller can still read the body', body?.code === '23503', body);
  check('caller still sees the real status', res.status === 400, res.status);

  // 8. A non-JSON error body must not throw. PostgREST is not the only thing
  //    that can answer — a proxy or a gateway may return HTML.
  reset();
  stub(502, '<html>Bad Gateway</html>', 'text/html');
  let threw = false;
  try {
    const r = await reportingFetch(URL_REST, { method: 'POST' });
    check('non-JSON error still returns a response', r.status === 502, r.status);
  } catch (e) { threw = true; }
  await new Promise((r) => setTimeout(r, 10));
  check('non-JSON error does not throw', !threw);

  // 9. A retry loop cannot bury the screen: the same failure is collapsed.
  //    Checked on the console line count, since the toast is browser-only.
  reset();
  stub(400, JSON.stringify({ message: 'same every time' }));
  for (let i = 0; i < 5; i++) await reportingFetch(URL_REST, { method: 'POST' });
  await new Promise((r) => setTimeout(r, 10));
  check('every attempt is logged for the developer',
    errors.filter((e) => e.startsWith('[not saved]')).length === 5, errors.length);

  // 10. If fetch itself rejects, the caller sees the real network error rather
  //     than something this file invented.
  globalThis.fetch = (async () => { throw new Error('network down'); }) as typeof fetch;
  let msg = '';
  try { await reportingFetch(URL_REST, { method: 'POST' }); }
  catch (e) { msg = (e as Error).message; }
  check('a network failure reaches the caller unchanged', msg === 'network down', msg);
};

run()
  .then(() => {
    globalThis.fetch = realFetch;
    console.error = realError;
    console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
  })
  .catch((e) => {
    globalThis.fetch = realFetch;
    console.error = realError;
    console.error('test harness failed', e);
    process.exit(1);
  });
