// Unlock a locked private-patient invoice with the access password.
//
// The password is never compared here and never reaches the browser bundle. It
// is checked inside Postgres (verify_invoice_otp) against a stored hash, and on
// success that function mints a grant token — 32 random bytes, returned once,
// stored server-side only as a hash. The token is the browser's proof for
// get_invoice_content().
//
// WHY THIS HOP EXISTS AT ALL, rather than the browser calling the RPC directly:
// verify_invoice_otp is granted to service_role only. Routing through here keeps
// the brute-force lockout honest, because this is the only layer that can see
// the caller's real IP.
//
// The SMS/OTP delivery path is deliberately not wired up yet — Twilio still
// needs an Account SID, a sender, and Indian DLT clearance. The database side
// already supports it; only this file and the gate UI need extending when those
// land.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xvkxccqaopbnkvwgyfjv.supabase.co';

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const clientIp = (req: VercelRequest): string | null => {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return raw ? String(raw).split(',')[0].trim() : null;
};

// Audit rows are written server-side rather than through src/lib/activity-logger.ts,
// which runs in the browser, always writes ip_address: null, and silently no-ops
// without a session — none of which is acceptable for a security log.
const audit = async (
  sb: any,
  action: string,
  email: string,
  details: Record<string, unknown>,
  ip: string | null,
) => {
  try {
    await sb.from('user_activity_log').insert({
      user_email: email || null,
      action,
      details,
      page: '/api/invoice-otp-verify',
      ip_address: ip,
      user_agent: 'server',
    });
  } catch {
    // Logging must never change the outcome of a verification.
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!serviceKey) {
    return res.status(500).json({ error: 'supabase_not_configured' });
  }

  const billId = text(req.body?.billId);
  const code = text(req.body?.code);
  const userEmail = text(req.body?.userEmail);
  const ip = clientIp(req);

  if (!billId) return res.status(400).json({ error: 'billId required' });
  if (!code) return res.status(400).json({ error: 'code required' });
  if (!userEmail) return res.status(400).json({ error: 'userEmail required' });

  const sb = createClient(SUPABASE_URL, serviceKey);

  const { data, error } = await sb.rpc('verify_invoice_otp', {
    p_bill_id: billId,
    p_code: code,
    p_user_email: userEmail,
    p_challenge_id: null,
    p_ip: ip,
  });

  if (error) {
    return res.status(502).json({ error: 'verify_failed', detail: error.message });
  }

  if (!data?.ok) {
    const action = data?.reason === 'locked_out' ? 'invoice_unlock_locked_out' : 'invoice_unlock_failed';
    await audit(sb, action, userEmail, { bill_id: billId, reason: data?.reason }, ip);
    return res.status(200).json({
      ok: false,
      reason: data?.reason || 'unknown',
      retryAfterMinutes: data?.retry_after_minutes,
    });
  }

  await audit(
    sb,
    data.via === 'master_key' ? 'invoice_master_key_used' : 'invoice_otp_verified',
    userEmail,
    { bill_id: billId, bill_no: data.bill_no, via: data.via },
    ip,
  );

  return res.status(200).json({
    ok: true,
    grantToken: data.grant_token,
    expiresAt: data.expires_at,
    via: data.via,
  });
}
