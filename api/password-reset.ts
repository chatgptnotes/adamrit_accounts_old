// Self-service password reset by emailed one-time code.
//
// This is the only unauthenticated write path in the application, which is why
// the lockout is real and lives in Postgres (20260809130000_password_reset_otp.sql)
// rather than in memory here: Vercel functions are per-instance, so an in-memory
// counter resets whenever a new instance spins up and is no lockout at all.
//
// Two things this endpoint deliberately will not tell you:
//   - whether an email address belongs to a staff member (identical reply either
//     way, so it cannot be used to enumerate who works at the hospital)
//   - whether a failed code was wrong or merely expired, beyond a generic code
//
// Hashing stays here with bcryptjs rather than moving into Postgres, so there is
// exactly one hashing implementation in the system and it is the same one
// api/auth-session.ts compares against at login.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { serviceClient } from './_auth.js';
import { sendMail, gmailConfigured } from './_gmail.js';

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const clientIp = (req: VercelRequest): string | null => {
  const fwd = req.headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return raw ? String(raw).split(',')[0].trim() : null;
};

const codeEmail = (name: string, code: string, ttl: number) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">
  <h2 style="margin:0 0 4px;color:#1e3a8a">Hope Hospital</h2>
  <p style="margin:0 0 24px;color:#6b7280;font-size:13px">Password reset</p>
  <p>Hello ${name},</p>
  <p>Use this code to set a new password for your Adamrit account:</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;background:#eff6ff;border-radius:8px;padding:16px 0;margin:24px 0;color:#1e3a8a">${code}</p>
  <p>The code expires in ${ttl} minutes and can be used once.</p>
  <p style="color:#6b7280;font-size:13px;margin-top:24px">
    If you did not ask to reset your password, you can ignore this email — your
    current password still works. If you get these unexpectedly, tell your
    administrator.
  </p>
</div>`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!serviceKey) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });

  const sb = serviceClient(serviceKey);
  const ip = clientIp(req);
  const action = text(req.body?.action);
  const email = text(req.body?.email).toLowerCase();

  if (!email) return res.status(400).json({ ok: false, error: 'email_required' });

  // ------------------------------------------------------------------ request
  if (action === 'request') {
    if (!gmailConfigured()) {
      // Said plainly rather than pretending to send: otherwise a misconfigured
      // deploy looks identical to a working one, and nobody finds out until a
      // locked-out nurse calls.
      return res.status(503).json({ ok: false, error: 'email_not_configured' });
    }

    const { data, error } = await sb.rpc('request_password_reset', { p_email: email, p_ip: ip });
    if (error) return res.status(500).json({ ok: false, error: 'reset_request_failed' });

    if (data?.sent) {
      try {
        await sendMail(
          String(data.email),
          'Your Adamrit password reset code',
          codeEmail(String(data.name || 'there'), String(data.code), Number(data.ttl_minutes || 10)),
        );
      } catch (err: any) {
        console.error('password reset mail failed:', err?.message);
        return res.status(502).json({ ok: false, error: 'email_send_failed' });
      }
    }

    // Identical reply whether or not that address exists.
    return res.status(200).json({ ok: true });
  }

  // ------------------------------------------------------------------- verify
  if (action === 'verify') {
    const code = text(req.body?.code);
    const newPassword = text(req.body?.newPassword);
    if (!code) return res.status(400).json({ ok: false, error: 'code_required' });
    if (newPassword.length < 8) return res.status(400).json({ ok: false, error: 'password_too_short' });

    const { data, error } = await sb.rpc('verify_password_reset', {
      p_email: email,
      p_code: code,
      p_new_password_hash: await bcrypt.hash(newPassword, 12),
      p_ip: ip,
    });
    if (error) return res.status(500).json({ ok: false, error: 'reset_verify_failed' });
    if (!data?.ok) return res.status(400).json({ ok: false, error: data?.error || 'invalid_code' });

    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ ok: false, error: 'unknown_action' });
}
