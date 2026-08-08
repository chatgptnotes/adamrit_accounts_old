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
