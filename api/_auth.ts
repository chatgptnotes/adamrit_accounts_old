import type { VercelRequest } from '@vercel/node';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://xvkxccqaopbnkvwgyfjv.supabase.co';
export const SESSION_COOKIE = 'hmis_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export type AppSessionUser = {
  id: string;
  email: string;
  role: string;
  hospitalType: string;
};

export const serviceClient = (serviceKey: string): SupabaseClient =>
  createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const encodePart = (value: string) => Buffer.from(value).toString('base64url');
const decodePart = (value: string) => Buffer.from(value, 'base64url').toString('utf8');

export const signToken = (payload: Record<string, unknown>, secret: string) => {
  const body = encodePart(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
};

/**
 * A Supabase-recognised access token for a staff member who has just signed in.
 *
 * WHY THIS EXISTS. Staff sign in against our own "User" table, so the browser
 * talks to PostgREST with the ANON key and the database sees `anon`. Every
 * policy written `USING (auth.role() = 'authenticated')` therefore matches
 * nothing we send — 19 tables carry rules the database has been ignoring, and
 * turning RLS on without this would lock out 85 of 109 active staff.
 *
 * This mints a token the database accepts, signed with the project's own JWT
 * secret, so `auth.role()` becomes 'authenticated' for a real signed-in person
 * whichever way they logged in. Nobody's login changes.
 *
 * NOTE the shape: this is a standard three-part JWT (header.payload.signature).
 * signToken() above is our own two-part app token and is NOT interchangeable.
 *
 * OFF BY DEFAULT. Returns null unless SUPABASE_USER_JWT=1 and the secret is
 * present, so installing it cannot change behaviour — a rule that can stop the
 * hospital gets a switch (docs/money-path-rules.md, rule 5).
 *
 * This is authentication, not authorisation: it proves somebody is staff, not
 * which records they should see. Tightening individual policies to roles is a
 * later pass that only becomes possible once this is in place.
 */
export const supabaseAccessToken = (user: { id: string; email?: string | null }): string | null => {
  const secret = process.env.SUPABASE_JWT_SECRET || '';
  if (process.env.SUPABASE_USER_JWT !== '1' || !secret) return null;

  // The project ref is the subdomain of the Supabase URL; deriving it means a
  // project move cannot leave a stale hard-coded ref behind.
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const ref = url.replace(/^https?:\/\//, '').split('.')[0];
  if (!ref) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = encodePart(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = encodePart(JSON.stringify({
    iss: 'supabase',
    ref,
    aud: 'authenticated',
    role: 'authenticated',
    sub: user.id,
    email: user.email || undefined,
    iat: now,
    // Matches the app session, so the database pass never expires mid-shift
    // while the person is still logged in.
    exp: now + SESSION_TTL_SECONDS,
  }));
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
};

export const verifyToken = <T extends Record<string, any>>(token: string, secret: string): T | null => {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(decodePart(body)) as T;
    return Number(payload.exp) > Math.floor(Date.now() / 1000) ? payload : null;
  } catch {
    return null;
  }
};

export const parseCookies = (req: VercelRequest): Record<string, string> => {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(raw.split(';').map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [part.trim(), ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }).filter(([key]) => key));
};

export const sessionCookie = (token: string, maxAge = SESSION_TTL_SECONDS) =>
  `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;

export const getSessionUser = (req: VercelRequest, secret: string): AppSessionUser | null => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;

  const data = verifyToken<{ type?: string; sub: string; email: string; role: string; hospitalType: string; exp: number }>(token, secret);
  if (data?.type !== 'hmis-session' || !data.sub || !data.email) return null;
  return {
    id: String(data.sub),
    email: String(data.email),
    role: String(data.role || 'user'),
    hospitalType: String(data.hospitalType || 'hope'),
  };
};
