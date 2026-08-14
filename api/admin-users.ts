// Every privileged read and write of public."User".
//
// WHY THIS ROUTE EXISTS
// The browser talks to Supabase with the anon key, which is hardcoded in the JS
// bundle. So anything the UserManagement page could do with that key, a stranger
// with devtools could do too — including reading all 91 bcrypt hashes and the
// 4-digit staff PINs, and PATCHing their own role to superadmin. Routing admin
// work through here means the secret columns never leave the server, and the
// anon key can be stripped of write access on "User" entirely (see the lockdown
// migration). This is the same shape as api/hr-pulse.ts.
//
// WHY THE ROLE IS RE-READ FROM THE DATABASE ON EVERY REQUEST
// The hmis_session cookie carries a `role` claim and lives for 8 hours. Trusting
// it would let an admin who was demoted five minutes ago keep full powers for
// the rest of the day. The claim is only ever used to identify *who* is calling;
// what they may do is answered by the database, every time.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { getSessionUser, serviceClient } from './_auth.js';

const SUPER_ADMIN_ROLES = new Set(['superadmin', 'super_admin', 'ca']);
const isSuperAdminRole = (role?: string | null) =>
  SUPER_ADMIN_ROLES.has(String(role || '').toLowerCase().trim());

// The columns that may ever be sent to a browser. `password` and `staff_pin` are
// deliberately absent and must stay absent — this list is the reason the page can
// no longer leak them. The lockdown migration grants anon SELECT on the same set.
const SAFE_COLUMNS = [
  'id', 'full_name', 'employee_id', 'email', 'phone', 'role', 'hospital_type',
  'company_id', 'department', 'designation', 'is_active', 'must_change_password',
  'hr_pulse_can_view_all', 'last_login_at', 'created_at',
  // The address Google sign-in accepts, alongside the primary email. Not a
  // secret -- it is the person's own Gmail -- and the page cannot collect it
  // without being able to read it back.
  'google_email',
].join(',');

// Columns an `update` may touch. Passwords go through reset_password and PINs
// through set_staff_pin, both of which hash or validate; letting them ride along
// in a generic patch would bypass that.
const EDITABLE_COLUMNS = new Set([
  'full_name', 'employee_id', 'email', 'phone', 'role', 'hospital_type',
  'company_id', 'department', 'designation', 'is_active', 'must_change_password',
  'google_email',
]);

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const sendError = (res: VercelResponse, status: number, error: string) =>
  res.status(status).json({ ok: false, error });

const clientIp = (req: VercelRequest): string | null => {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return raw ? String(raw).split(',')[0].trim() : null;
};

// Audit rows are written here rather than through src/lib/activity-logger.ts,
// which runs in the browser and always records ip_address: null. For a log of
// who changed whose role, that is not good enough.
type Actor = { id: string; email: string; role: string };

const audit = async (
  sb: any,
  actor: Actor,
  action: string,
  details: Record<string, unknown>,
  ip: string | null,
) => {
  try {
    await sb.from('user_activity_log').insert({
      user_id: actor.id || null,
      user_email: actor.email || null,
      user_role: actor.role || null,
      action,
      details,
      page: '/api/admin-users',
      ip_address: ip,
      user_agent: 'server',
    });
  } catch {
    // Logging must never change the outcome of an administrative action.
  }
};

// Ambiguous characters (O/0, l/1/I) are excluded: these passwords get read off a
// screen and typed by hand, or dictated over the phone.
const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#$%&*';

const generatePassword = (length = 12): string => {
  let out = '';
  for (let i = 0; i < length; i += 1) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  return out;
};

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/**
 * Refuse to leave the hospital with no one who can administer it.
 *
 * is_active is nullable and every screen in the app reads NULL as active, so the
 * count has to as well — otherwise a superadmin whose flag was never set looks
 * inactive here and the guard waves through the removal of the real last one.
 */
const wouldStrandSuperAdmins = async (sb: any, targetId: string): Promise<boolean> => {
  const { data } = await sb
    .from('User')
    .select('id,role,is_active');
  const actives = (data || []).filter((u: any) => u.is_active !== false && isSuperAdminRole(u.role));
  return actives.length <= 1 && actives.some((u: any) => String(u.id) === targetId);
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!serviceKey) return sendError(res, 500, 'supabase_not_configured');

  const sessionUser = getSessionUser(req, serviceKey);
  if (!sessionUser) return sendError(res, 401, 'not_authenticated');

  const sb = serviceClient(serviceKey);
  const ip = clientIp(req);

  const { data: actor, error: actorError } = await sb
    .from('User')
    .select('id,email,role,is_active')
    .eq('id', sessionUser.id)
    .maybeSingle();
  if (actorError) return sendError(res, 500, actorError.message || 'identity_lookup_failed');
  if (!actor || actor.is_active === false) return sendError(res, 403, 'account_inactive');
  if (!isSuperAdminRole(actor.role)) return sendError(res, 403, 'super_admin_required');

  const actorId = String(actor.id);
  const auditActor: Actor = {
    id: actorId,
    email: String(actor.email || sessionUser.email),
    role: String(actor.role || ''),
  };

  // ---------------------------------------------------------------- list
  if (req.method === 'GET') {
    const { data, error } = await sb
      .from('User')
      .select(`${SAFE_COLUMNS},staff_pin`)
      .order('created_at', { ascending: false });
    if (error) return sendError(res, 500, error.message || 'user_list_failed');

    // staff_pin is fetched only to answer "is one set?" — the value itself never
    // goes to the browser, the same way the password hash never does.
    const users = (data || []).map(({ staff_pin, ...rest }: any) => ({
      ...rest,
      has_staff_pin: Boolean(staff_pin),
    }));
    return res.status(200).json({ ok: true, users });
  }

  if (req.method !== 'POST') return sendError(res, 405, 'method_not_allowed');

  const action = text(req.body?.action);
  const targetId = text(req.body?.id);

  try {
    switch (action) {
      // -------------------------------------------------------------- create
      case 'create': {
        const patch = req.body?.patch || {};
        const email = text(patch.email).toLowerCase();
        const fullName = text(patch.full_name);
        const password = text(patch.password);
        if (!fullName) return sendError(res, 400, 'full_name_required');
        if (!isEmail(email)) return sendError(res, 400, 'valid_email_required');
        if (!password) return sendError(res, 400, 'password_required');

        const { data: existing } = await sb.from('User').select('id').ilike('email', email).maybeSingle();
        if (existing) return sendError(res, 409, 'email_already_exists');

        const record: Record<string, unknown> = { email };
        for (const [key, value] of Object.entries(patch)) {
          if (EDITABLE_COLUMNS.has(key) && key !== 'email') record[key] = value === '' ? null : value;
        }
        record.password = await bcrypt.hash(password, 12);
        record.hr_pulse_can_view_all = isSuperAdminRole(text(patch.role));

        const { data, error } = await sb.from('User').insert([record]).select(SAFE_COLUMNS).single();
        if (error) return sendError(res, 400, error.message);
        await audit(sb, auditActor, 'user_create', { user_id: data.id, email }, ip);
        return res.status(201).json({ ok: true, user: data });
      }

      // -------------------------------------------------------------- update
      case 'update': {
        if (!targetId) return sendError(res, 400, 'id_required');
        const patch = req.body?.patch || {};

        const record: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(patch)) {
          if (EDITABLE_COLUMNS.has(key)) record[key] = value === '' ? null : value;
        }
        if (typeof record.email === 'string') record.email = record.email.toLowerCase();
        if (!Object.keys(record).length) return sendError(res, 400, 'nothing_to_update');

        // Self-demotion and self-deactivation are how an admin accidentally locks
        // themselves out of the only screen that could undo it.
        if (targetId === actorId && 'role' in record && !isSuperAdminRole(String(record.role))) {
          return sendError(res, 400, 'cannot_demote_yourself');
        }
        if (targetId === actorId && record.is_active === false) {
          return sendError(res, 400, 'cannot_deactivate_yourself');
        }
        const losingAdmin = ('role' in record && !isSuperAdminRole(String(record.role))) || record.is_active === false;
        if (losingAdmin && await wouldStrandSuperAdmins(sb, targetId)) {
          return sendError(res, 400, 'last_super_admin');
        }

        if (typeof record.email === 'string') {
          const { data: clash } = await sb.from('User').select('id').ilike('email', record.email).neq('id', targetId).maybeSingle();
          if (clash) return sendError(res, 409, 'email_already_exists');
        }
        // A Google address decides who you are logged in as, so it has to be
        // one person's alone — against both columns, since sign-in matches
        // either. Two accounts claiming one Google identity would hand the
        // session to whichever row sorted first.
        if (typeof record.google_email === 'string') {
          const googleEmail = record.google_email.trim().toLowerCase();
          if (googleEmail && !isEmail(googleEmail)) return sendError(res, 400, 'valid_google_email_required');
          record.google_email = googleEmail || null;
          if (googleEmail) {
            const { data: clash } = await sb
              .from('User')
              .select('id')
              .or(`email.ilike.${googleEmail},google_email.ilike.${googleEmail}`)
              .neq('id', targetId)
              .maybeSingle();
            if (clash) return sendError(res, 409, 'google_email_already_used');
          }
        }
        if ('role' in record) record.hr_pulse_can_view_all = isSuperAdminRole(String(record.role));

        const { data, error } = await sb.from('User').update(record).eq('id', targetId).select(SAFE_COLUMNS).single();
        if (error) return sendError(res, 400, error.message);
        await audit(sb, auditActor, 'user_update', { user_id: targetId, fields: Object.keys(record) }, ip);
        return res.status(200).json({ ok: true, user: data });
      }

      // ------------------------------------------------------ reset_password
      case 'reset_password': {
        if (!targetId) return sendError(res, 400, 'id_required');
        const supplied = text(req.body?.password);
        if (supplied && supplied.length < 8) return sendError(res, 400, 'password_too_short');
        const password = supplied || generatePassword();
        const mustChange = req.body?.mustChange !== false;

        const { data, error } = await sb.from('User').update({
          password: await bcrypt.hash(password, 12),
          must_change_password: mustChange,
          password_changed_at: new Date().toISOString(),
        }).eq('id', targetId).select(SAFE_COLUMNS).single();
        if (error) return sendError(res, 400, error.message);

        await audit(sb, auditActor, 'user_password_reset', { user_id: targetId, generated: !supplied }, ip);
        // The only time this plaintext exists anywhere. It is not stored, and the
        // client is expected to show it once and then drop it.
        return res.status(200).json({ ok: true, user: data, password });
      }

      // ---------------------------------------------------------------- bulk
      case 'bulk': {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
        const op = text(req.body?.op);
        if (!ids.length) return sendError(res, 400, 'ids_required');

        const record: Record<string, unknown> = {};
        if (op === 'role') {
          const value = text(req.body?.value);
          if (!value) return sendError(res, 400, 'value_required');
          record.role = value;
          record.hr_pulse_can_view_all = isSuperAdminRole(value);
        } else if (op === 'hospital') {
          const value = text(req.body?.value);
          if (!value) return sendError(res, 400, 'value_required');
          record.hospital_type = value;
        } else if (op === 'active') {
          record.is_active = req.body?.value === true;
        } else if (op === 'force_reset') {
          // Deliberately does not mint passwords: 40 generated passwords that
          // nobody can hand out is not a useful outcome. It forces each user
          // through ChangePasswordModal at their next login instead.
          record.must_change_password = true;
        } else {
          return sendError(res, 400, 'unknown_bulk_op');
        }

        const demoting = (op === 'role' && !isSuperAdminRole(String(record.role))) ||
          (op === 'active' && record.is_active === false);
        if (demoting) {
          if (ids.includes(actorId)) return sendError(res, 400, 'cannot_include_yourself');
          for (const id of ids) {
            if (await wouldStrandSuperAdmins(sb, id)) return sendError(res, 400, 'last_super_admin');
          }
        }

        const { data, error } = await sb.from('User').update(record).in('id', ids).select(SAFE_COLUMNS);
        if (error) return sendError(res, 400, error.message);
        await audit(sb, auditActor, 'user_bulk_update', { op, count: ids.length, ids }, ip);
        return res.status(200).json({ ok: true, users: data || [] });
      }

      // -------------------------------------------------------------- import
      case 'import': {
        const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
        if (!rows.length) return sendError(res, 400, 'rows_required');
        if (rows.length > 500) return sendError(res, 400, 'too_many_rows');

        const { data: existingRows } = await sb.from('User').select('email');
        const taken = new Set((existingRows || []).map((u: any) => String(u.email || '').toLowerCase()));

        const prepared: any[] = [];
        const credentials: { email: string; full_name: string; phone: string | null; password: string }[] = [];
        const failures: { row: number; email: string; reason: string }[] = [];

        for (let i = 0; i < rows.length; i += 1) {
          const row = rows[i] || {};
          const email = text(row.email).toLowerCase();
          const fullName = text(row.full_name);
          if (!fullName) { failures.push({ row: i, email, reason: 'full_name_required' }); continue; }
          if (!isEmail(email)) { failures.push({ row: i, email, reason: 'invalid_email' }); continue; }
          if (taken.has(email)) { failures.push({ row: i, email, reason: 'duplicate_email' }); continue; }
          taken.add(email);

          // A distinct password per user. The previous implementation gave every
          // imported account the same one, which meant knowing any one of them
          // was knowing all of them.
          const password = generatePassword();
          prepared.push({
            full_name: fullName,
            email,
            phone: text(row.phone) || null,
            role: text(row.role) || 'receptionist',
            hospital_type: text(row.hospital_type) || 'hope',
            department: text(row.department) || null,
            is_active: true,
            must_change_password: true,
            password: await bcrypt.hash(password, 12),
          });
          credentials.push({ email, full_name: fullName, phone: text(row.phone) || null, password });
        }

        const imported: any[] = [];
        // Chunked so one bad row cannot abort the whole import, and so a large
        // paste does not hit the statement limit.
        for (let start = 0; start < prepared.length; start += 25) {
          const chunk = prepared.slice(start, start + 25);
          const { data, error } = await sb.from('User').insert(chunk).select(SAFE_COLUMNS);
          if (error) {
            for (const record of chunk) {
              failures.push({ row: -1, email: String(record.email), reason: error.message });
            }
            continue;
          }
          imported.push(...(data || []));
        }

        const importedEmails = new Set(imported.map((u: any) => String(u.email).toLowerCase()));
        await audit(sb, auditActor, 'user_bulk_import', { imported: imported.length, failed: failures.length }, ip);
        return res.status(200).json({
          ok: true,
          users: imported,
          failures,
          credentials: credentials.filter((c) => importedEmails.has(c.email)),
        });
      }

      // -------------------------------------------------------------- delete
      case 'delete': {
        if (!targetId) return sendError(res, 400, 'id_required');
        if (targetId === actorId) return sendError(res, 400, 'cannot_delete_yourself');
        if (await wouldStrandSuperAdmins(sb, targetId)) return sendError(res, 400, 'last_super_admin');

        const { data, error } = await sb.from('User').delete().eq('id', targetId).select('id,email');
        if (error) {
          // Preserved from the page this replaced: these three codes are the ones
          // that actually come back, and each needs a different answer.
          if (error.code === '42501') return sendError(res, 403, 'delete_not_permitted');
          if (error.code === '23503') return sendError(res, 409, 'user_referenced_elsewhere');
          if (error.code === '23505') return sendError(res, 409, 'conflicting_record');
          return sendError(res, 400, error.message);
        }
        if (!data?.length) return sendError(res, 404, 'user_not_found');
        await audit(sb, auditActor, 'user_delete', { user_id: targetId, email: data[0].email }, ip);
        return res.status(200).json({ ok: true, id: targetId });
      }

      // ------------------------------------------------------- set_hr_pulse
      case 'set_hr_pulse': {
        if (!targetId) return sendError(res, 400, 'id_required');
        const { data, error } = await sb.from('User')
          .update({ hr_pulse_can_view_all: req.body?.value === true })
          .eq('id', targetId).select(SAFE_COLUMNS).single();
        if (error) return sendError(res, 400, error.message);
        await audit(sb, auditActor, 'user_hr_pulse_toggle', { user_id: targetId, value: req.body?.value === true }, ip);
        return res.status(200).json({ ok: true, user: data });
      }

      // ------------------------------------------------------- set_staff_pin
      case 'set_staff_pin': {
        if (!targetId) return sendError(res, 400, 'id_required');
        const pin = text(req.body?.pin);
        if (pin && !/^\d{4}$/.test(pin)) return sendError(res, 400, 'pin_must_be_four_digits');

        const { data, error } = await sb.from('User')
          .update({ staff_pin: pin || null })
          .eq('id', targetId).select(SAFE_COLUMNS).single();
        if (error) {
          if (error.code === '23505') return sendError(res, 409, 'pin_already_in_use');
          return sendError(res, 400, error.message);
        }
        await audit(sb, auditActor, pin ? 'user_staff_pin_set' : 'user_staff_pin_cleared', { user_id: targetId }, ip);
        return res.status(200).json({ ok: true, user: { ...data, has_staff_pin: Boolean(pin) } });
      }

      default:
        return sendError(res, 400, 'unknown_action');
    }
  } catch (error: any) {
    return sendError(res, 500, error?.message || 'admin_users_failed');
  }
}
