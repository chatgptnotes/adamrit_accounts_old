import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { getSessionUser, parseCookies, serviceClient, sessionCookie, signToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from './_auth.js';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const userResponse = (row: any) => ({
  id: String(row.id),
  email: String(row.email),
  username: String(row.email).split('@')[0],
  role: String(row.role || 'user'),
  hospitalType: String(row.hospital_type || 'hope'),
  employeeId: row.employee_id ? String(row.employee_id) : null,
});

const issueSession = async (row: any, res: VercelResponse, secret: string) => {
  const token = signToken({
    type: 'hmis-session',
    sub: String(row.id),
    email: String(row.email),
    role: String(row.role || 'user'),
    hospitalType: String(row.hospital_type || 'hope'),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }, secret);
  res.setHeader('Set-Cookie', sessionCookie(token));
  return res.status(200).json({ ok: true, user: userResponse(row) });
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!serviceKey) return res.status(500).json({ error: 'supabase_not_configured' });
  const sb = serviceClient(serviceKey);

  if (req.method === 'GET') {
    const user = getSessionUser(req, serviceKey);
    return user ? res.status(200).json({ ok: true, user }) : res.status(401).json({ error: 'not_authenticated' });
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const mode = text(req.body?.mode || 'password');
  let row: any = null;

  if (mode === 'google') {
    const accessToken = text(req.body?.accessToken);
    if (!accessToken) return res.status(400).json({ error: 'access_token_required' });
    const auth = await sb.auth.getUser(accessToken);
    if (auth.error || !auth.data.user?.email) return res.status(401).json({ error: 'invalid_google_session' });
    const result = await sb.from('User').select('id,email,role,hospital_type,employee_id').ilike('email', auth.data.user.email).maybeSingle();
    row = result.data;
  } else {
    const email = text(req.body?.email);
    const password = text(req.body?.password);
    const hospitalType = text(req.body?.hospitalType) || 'ayushman';
    const isStaffPin = !email && password.startsWith('@') && password.length === 5;
    const query = isStaffPin
      ? sb.from('User').select('id,email,role,hospital_type,password,employee_id').eq('staff_pin', password.slice(1)).eq('hospital_type', hospitalType).maybeSingle()
      : sb.from('User').select('id,email,role,hospital_type,password,employee_id').ilike('email', email).maybeSingle();
    const result = await query;
    row = result.data;
    if (!row) return res.status(401).json({ error: 'invalid_credentials' });
    if (!isStaffPin) {
      const stored = String(row.password || '');
      const valid = stored.startsWith('$2') ? await bcrypt.compare(password, stored) : stored === password;
      if (!valid) return res.status(401).json({ error: 'invalid_credentials' });
    }
  }

  if (!row) return res.status(401).json({ error: 'account_not_found' });
  return issueSession(row, res, serviceKey);
}
