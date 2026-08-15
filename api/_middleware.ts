// The one place every API route decides who is allowed to call it.
//
// WHY THIS EXISTS
// Until now each of the 33 functions under api/ made that decision on its own,
// and eight of them never made it at all. Three of those eight spend real money
// on behalf of the hospital:
//
//   api/twilio-call.ts                  places a phone call, billed to Twilio
//   api/send-discharge-pdf-whatsapp.ts  sends a WhatsApp document from the
//                                       hospital's business number
//   api/skill-factory-claude.ts         runs an arbitrary prompt through the
//                                       VPS Claude sidecar
//
// Each was reachable by anyone on the internet who knew the URL. twilio-call.ts
// additionally sent Access-Control-Allow-Origin: * so a stranger's web page
// could drive it from a browser. Writing the check once, here, is the only way
// to stop that recurring the next time a route is added in a hurry.
//
// WHY A WRAPPER AND NOT A SINGLE SERVER
// Vercel routes by filename, and the browser calls these paths from 2,945 call
// sites. Moving the files would mean touching all of them and rewriting
// vercel.json's cron paths. Each handler keeps its path and its file; only the
// preamble moves in here. This is the shape api/partner/_client.ts already
// proved works in this repo.
//
// WHAT THIS DELIBERATELY DOES NOT DO
// It does not rate-limit reliably. The counter below lives in one serverless
// instance's memory, and Vercel runs many, so a determined caller spreads
// across instances. It raises the cost of casual abuse and nothing more. Where
// a limit has to actually hold — password reset — it lives in Postgres
// (20260809130000_password_reset_otp.sql) and stays there.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSessionUser, serviceClient, type AppSessionUser } from './_auth.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * How a route establishes that its caller is allowed to be there.
 *
 * 'session'  a logged-in staff member (the hmis_session cookie)
 * 'admin'    a logged-in staff member whose role is superadmin *in the database
 *            right now* — not merely according to their 8-hour-old cookie
 * 'cron'     Vercel's scheduler, proved by CRON_SECRET
 * 'webhook'  an outside system (Twilio, JotForm) that authenticates itself in a
 *            way only the handler understands — the handler MUST verify it
 * 'public'   genuinely open to the world; requires `why` to be filled in
 */
export type AuthMode = 'session' | 'admin' | 'cron' | 'webhook' | 'public';

export type RouteContext = {
  /** Correlates every log line for one request. Returned to the caller on 500. */
  requestId: string;
  /** Caller's real IP, as far as Vercel can tell. Null when it cannot. */
  ip: string | null;
  /** The signed-in staff member. Null for cron, webhook and public routes. */
  user: AppSessionUser | null;
  /** Supabase with the service role. Bypasses RLS — the route is the guard. */
  sb: SupabaseClient;
  serviceKey: string;
};

export type RouteOptions = {
  auth: AuthMode;
  /** Methods the handler answers. Anything else gets 405. Defaults to POST. */
  methods?: string[];
  /**
   * Per-IP ceiling. Defaults to 60/minute for session routes and 20/minute for
   * anything unauthenticated. `false` opts out — only correct for routes an
   * external system calls at its own cadence.
   */
  rateLimit?: { perMinute: number; perHour?: number } | false;
  /**
   * Reject browser requests that did not come from our own pages. Defaults on
   * for session and admin routes, off for cron and webhook (which have no
   * Origin header at all).
   */
  requireOrigin?: boolean;
  /** Mandatory when auth is 'public'. Explains, in the code, why that is safe. */
  why?: string;
};

export type RouteHandler = (
  req: VercelRequest,
  res: VercelResponse,
  ctx: RouteContext,
) => unknown | Promise<unknown>;

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

export const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const clientIp = (req: VercelRequest): string | null => {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  const first = raw ? String(raw).split(',')[0].trim() : '';
  return first || (req.headers['x-real-ip'] ? String(req.headers['x-real-ip']) : null);
};

/**
 * Every route in this codebase answers failures the same way: a JSON body with
 * ok:false and a stable machine-readable code. The frontend switches on those
 * codes, so they are part of the contract — change one and something breaks.
 */
export const sendError = (res: VercelResponse, status: number, error: string, extra: Record<string, unknown> = {}) =>
  res.status(status).json({ ok: false, error, ...extra });

// ---------------------------------------------------------------------------
// Origin allowlist
// ---------------------------------------------------------------------------

// Lifted from api/ai-proxy.ts, which had the only correct version of this.
const allowedHosts = (): Set<string> => {
  const configured = String(process.env.APP_ORIGIN || process.env.VERCEL_PROJECT_PRODUCTION_URL || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  return new Set([
    configured,
    'www.adamrit.com',
    'adamrit.com',
    'localhost:5173',
    'localhost:4173',
  ].filter(Boolean));
};

const hostOf = (value: string): string | null => {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
};

/**
 * True when the request plausibly came from one of our own pages.
 *
 * This is a second lock, not the only one: hmis_session is SameSite=Lax, so a
 * browser will not attach it to a cross-site POST in the first place. This
 * catches the cases Lax does not, and costs nothing.
 */
export const originAllowed = (req: VercelRequest): boolean => {
  const hosts = allowedHosts();
  const origin = text(req.headers.origin);
  if (origin) {
    const host = hostOf(origin);
    return host ? hosts.has(host) : false;
  }
  const referer = text(req.headers.referer);
  if (referer) {
    const host = hostOf(referer);
    return host ? hosts.has(host) : false;
  }
  // No Origin and no Referer. Browsers send at least one on a cross-origin
  // POST, so this is a server-to-server or same-origin GET; let the auth check
  // be the thing that decides.
  return true;
};

// ---------------------------------------------------------------------------
// Rate limiting (best-effort — see the header note)
// ---------------------------------------------------------------------------

type Hit = number[];
const windows = new Map<string, Hit>();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const withinRateLimit = (key: string, perMinute: number, perHour: number): boolean => {
  const now = Date.now();
  const recent = (windows.get(key) || []).filter((at) => now - at < HOUR);
  const lastMinute = recent.filter((at) => now - at < MINUTE).length;
  if (lastMinute >= perMinute || recent.length >= perHour) {
    windows.set(key, recent);
    return false;
  }
  recent.push(now);
  windows.set(key, recent);
  // An unbounded Map in a long-lived instance is a slow leak; this is the same
  // crude release valve api/ai-proxy.ts used.
  if (windows.size > 10_000) windows.clear();
  return true;
};

// ---------------------------------------------------------------------------
// Authorisation
// ---------------------------------------------------------------------------

const SUPER_ADMIN_ROLES = new Set(['superadmin', 'super_admin', 'ca']);
export const isSuperAdminRole = (role?: string | null) =>
  SUPER_ADMIN_ROLES.has(String(role || '').toLowerCase().trim());

/**
 * Prove the caller is Vercel's scheduler.
 *
 * Vercel attaches `Authorization: Bearer $CRON_SECRET` to scheduled
 * invocations. When CRON_SECRET is unset the route is open, which is how
 * deadline-reminders and fire-due-reminders behaved — so an unset secret is
 * treated as a misconfiguration and refused rather than waved through. A cron
 * that stops running is visible; a cron anyone can trigger is not.
 */
const cronAuthorised = (req: VercelRequest): boolean => {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return false;
  return text(req.headers.authorization) === `Bearer ${secret}`;
};

// ---------------------------------------------------------------------------
// The wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap a handler so the caller is checked before it runs.
 *
 * The handler receives a ready-made context: request id, IP, the signed-in
 * user, and a service-role Supabase client. It should return nothing and write
 * its own response, exactly as before.
 */
export function withRoute(options: RouteOptions, handler: RouteHandler) {
  const methods = options.methods ?? ['POST'];
  const browserFacing = options.auth === 'session' || options.auth === 'admin';
  const requireOrigin = options.requireOrigin ?? browserFacing;
  const limit = options.rateLimit === false
    ? null
    : options.rateLimit ?? (browserFacing ? { perMinute: 60 } : { perMinute: 20 });

  if (options.auth === 'public' && !text(options.why)) {
    // Thrown at module load, so it fails the build rather than a request.
    throw new Error('withRoute: auth "public" requires `why` explaining what makes that safe');
  }

  return async function wrapped(req: VercelRequest, res: VercelResponse) {
    const requestId = randomUUID();
    const ip = clientIp(req);
    const started = Date.now();
    const route = String(req.url || '').split('?')[0];

    res.setHeader('x-request-id', requestId);

    const done = (status: number, note?: string) => {
      // One line per request, greppable in the Vercel log drain. No bodies: they
      // carry patient names, phone numbers and one-time codes.
      console.log(JSON.stringify({
        at: 'api', route, method: req.method, status, ms: Date.now() - started,
        requestId, auth: options.auth, ...(note ? { note } : {}),
      }));
    };

    // -- CORS ---------------------------------------------------------------
    // Same-origin only. The previous `*` on the Twilio routes meant any page on
    // the internet could call them from a logged-in staff member's browser.
    const origin = text(req.headers.origin);
    if (origin && allowedHosts().has(hostOf(origin) || '')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      done(204, 'preflight');
      return res.status(204).end();
    }

    // -- Method -------------------------------------------------------------
    if (!methods.includes(String(req.method))) {
      done(405);
      return sendError(res, 405, 'method_not_allowed');
    }

    // -- Origin -------------------------------------------------------------
    if (requireOrigin && !originAllowed(req)) {
      done(403, 'origin');
      return sendError(res, 403, 'forbidden_origin');
    }

    // -- Rate limit ---------------------------------------------------------
    if (limit && !withinRateLimit(`${route}|${ip || 'unknown'}`, limit.perMinute, limit.perHour ?? limit.perMinute * 20)) {
      done(429);
      return sendError(res, 429, 'rate_limited');
    }

    // -- Service key --------------------------------------------------------
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!serviceKey) {
      done(500, 'no_service_key');
      return sendError(res, 500, 'supabase_not_configured');
    }
    const sb = serviceClient(serviceKey);

    // -- Who is calling -----------------------------------------------------
    let user: AppSessionUser | null = null;

    if (options.auth === 'session' || options.auth === 'admin') {
      user = getSessionUser(req, serviceKey);
      if (!user) {
        done(401);
        return sendError(res, 401, 'not_authenticated');
      }

      // The cookie says who you are. The database says what you may do — asked
      // fresh every time, so revoking an account takes effect at once instead of
      // whenever their 8-hour session happens to lapse.
      const { data: actor, error } = await sb
        .from('User')
        .select('id,email,role,is_active')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        done(500, 'identity_lookup');
        return sendError(res, 500, 'identity_lookup_failed', { requestId });
      }
      if (!actor || actor.is_active === false) {
        done(403, 'inactive');
        return sendError(res, 403, 'account_inactive');
      }

      user = {
        ...user,
        email: String(actor.email || user.email),
        role: String(actor.role || user.role),
      };

      if (options.auth === 'admin' && !isSuperAdminRole(actor.role)) {
        done(403, 'not_admin');
        return sendError(res, 403, 'super_admin_required');
      }
    }

    if (options.auth === 'cron' && !cronAuthorised(req)) {
      done(401, 'cron');
      return sendError(res, 401, 'not_authorised');
    }

    // 'webhook' and 'public' fall through by design. A webhook handler is
    // responsible for verifying its own caller's signature; that is the only
    // thing it can do, since the signing scheme is the sender's.

    // -- Run it -------------------------------------------------------------
    try {
      await handler(req, res, { requestId, ip, user, sb, serviceKey });
      done(res.statusCode);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown';
      // Logged in full, returned as a request id. An internal message can name
      // tables, columns and env vars.
      console.error(JSON.stringify({ at: 'api', route, requestId, error: message }));
      done(500, 'threw');
      if (!res.headersSent) sendError(res, 500, 'internal_error', { requestId });
    }
  };
}
