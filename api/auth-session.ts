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

const issueSession = async (row: any, res: VercelResponse, secret: string, sb: any) => {
  const token = signToken({
    type: 'hmis-session',
    sub: String(row.id),
    email: String(row.email),
    role: String(row.role || 'user'),
    hospitalType: String(row.hospital_type || 'hope'),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }, secret);
  res.setHeader('Set-Cookie', sessionCookie(token));

  // Stamped here rather than from the browser, which used to do it with the anon
  // key after every login. One place covers password, staff-PIN and Google
  // sign-in alike, and it keeps working once anon loses write access to "User".
  // A failed stamp must never cost someone their login, so it is not awaited.
  sb.from('User').update({ last_login_at: new Date().toISOString() }).eq('id', row.id).then(
    () => {},
    () => {},
  );

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

  // Change your own password. Previously this was an anon-key UPDATE straight
  // from ChangePasswordModal, which could set ANY row's password — it filtered on
  // an id the browser supplied. Here the id comes from the signed cookie only.
  if (req.method === 'PUT') {
    const user = getSessionUser(req, serviceKey);
    if (!user) return res.status(401).json({ error: 'not_authenticated' });

    const newPassword = text(req.body?.newPassword);
    if (newPassword.length < 8) return res.status(400).json({ error: 'password_too_short' });

    const { data: row, error } = await sb
      .from('User')
      .select('id,password,must_change_password')
      .eq('id', user.id)
      .maybeSingle();
    if (error || !row) return res.status(404).json({ error: 'account_not_found' });

    // The current password is required for a voluntary change, so that an
    // unattended logged-in machine cannot be used to lock the owner out. It is
    // not required when the account is already flagged must_change_password:
    // there the user proved possession of the temporary password moments ago at
    // login, and a staff-PIN or Google user may have no password to recite.
    if (row.must_change_password !== true) {
      const currentPassword = text(req.body?.currentPassword);
      const stored = String(row.password || '');
      const valid = stored.startsWith('$2')
        ? await bcrypt.compare(currentPassword, stored)
        : stored === currentPassword;
      if (!valid) return res.status(401).json({ error: 'current_password_incorrect' });
    }

    const { error: updateError } = await sb.from('User').update({
      password: await bcrypt.hash(newPassword, 12),
      must_change_password: false,
      password_changed_at: new Date().toISOString(),
    }).eq('id', user.id);
    if (updateError) return res.status(400).json({ error: updateError.message });

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
    const result = await sb.from('User').select('id,email,role,hospital_type,employee_id,is_active').ilike('email', auth.data.user.email).maybeSingle();
    row = result.data;
  } else {
    const email = text(req.body?.email);
    const password = text(req.body?.password);
    const hospitalType = text(req.body?.hospitalType);
    const isStaffPin = !email && password.startsWith('@') && password.length === 5;
    const buildQuery = (scopeHospitalType?: string | null) => {
      let query = sb.from('User').select('id,email,role,hospital_type,password,employee_id,is_active');
      if (isStaffPin) {
        query = query.eq('staff_pin', password.slice(1));
        if (scopeHospitalType) query = query.eq('hospital_type', scopeHospitalType);
      } else {
        query = email.includes('@')
          ? query.ilike('email', email)
          : query.ilike('email', `${email}@%`);
        if (scopeHospitalType) query = query.eq('hospital_type', scopeHospitalType);
      }
      return query.order('created_at', { ascending: false }).limit(1);
    };

    const scopedResult = await buildQuery(hospitalType);
    row = scopedResult.data?.[0] || null;
    if (!row && hospitalType) {
      const fallbackResult = await buildQuery(null);
      row = fallbackResult.data?.[0] || null;
    }
    if (!row) return res.status(401).json({ error: 'invalid_credentials' });
    // A leaver keeps their password; deactivating the account was the only
    // thing standing between them and the hospital's data, and nothing was
    // checking it. is_active is nullable and every screen reads NULL as
    // active, so only an explicit false is refused.
    if (row.is_active === false) return res.status(403).json({ error: 'account_deactivated' });
    if (!isStaffPin) {
      const stored = String(row.password || '');
      const valid = stored.startsWith('$2') ? await bcrypt.compare(password, stored) : stored === password;
      if (!valid) return res.status(401).json({ error: 'invalid_credentials' });
    }
  }

  if (!row) return res.status(401).json({ error: 'account_not_found' });
  // Covers Google as well as password and staff PIN: whichever door a leaver
  // tries, a deactivated account issues no session.
  if (row.is_active === false) return res.status(403).json({ error: 'account_deactivated' });
  return issueSession(row, res, serviceKey, sb);
}
