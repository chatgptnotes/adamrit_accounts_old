// Registers (POST) or removes (DELETE) a phone's Web Push subscription.
//
// The browser calls this right after PushManager.subscribe() succeeds. The
// user identity comes from the signed hmis_session cookie ONLY — never from
// the request body — the same rule auth-session.ts enforces for password
// changes. Every login path (password, Google, PIN) goes through
// /api/auth-session and therefore has the cookie.
//
// push_subscriptions has RLS with no policies, so this service-role route is
// the only way rows are ever written or read.

import type { VercelRequest, VercelResponse } from '@vercel/node';
// .js extension required — see the note in push-send.ts. Extensionless
// relative imports throw at load under "type": "module".
import { getSessionUser, serviceClient } from './_auth.js';

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!serviceKey) return res.status(500).json({ error: 'supabase_not_configured' });

  const user = getSessionUser(req, serviceKey);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });

  const sb = serviceClient(serviceKey);
  const endpoint = text(req.body?.endpoint);
  if (!endpoint.startsWith('https://')) return res.status(400).json({ error: 'invalid_endpoint' });

  if (req.method === 'DELETE') {
    const { error } = await sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
    if (error) return res.status(500).json({ error: 'delete_failed' });
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const p256dh = text(req.body?.keys?.p256dh);
  const auth = text(req.body?.keys?.auth);
  if (!p256dh || !auth) return res.status(400).json({ error: 'invalid_keys' });

  const { error } = await sb.from('push_subscriptions').upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: text(req.headers['user-agent']).slice(0, 500) || null,
      last_seen_at: new Date().toISOString(),
      failed_at: null,
      failure_count: 0,
    },
    { onConflict: 'endpoint' },
  );
  if (error) return res.status(500).json({ error: 'subscribe_failed' });

  return res.status(200).json({ ok: true });
}
