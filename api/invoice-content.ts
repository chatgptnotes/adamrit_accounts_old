import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSessionUser, serviceClient, verifyToken } from './_auth.js';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!serviceKey) return res.status(500).json({ error: 'supabase_not_configured' });
  const sb = serviceClient(serviceKey);
  const user = getSessionUser(req, serviceKey);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  const billId = text(req.body?.billId);
  const accessToken = text(req.body?.grantToken);
  if (!billId) return res.status(400).json({ error: 'bill_id_required' });
  const { data: lockState, error: lockError } = await sb.rpc('invoice_lock_state', { p_bill_id: billId });
  if (lockError) return res.status(502).json({ error: 'invoice_lock_state_failed', detail: lockError.message });

  let innerGrant: string | null = null;
  if (lockState?.is_locked) {
    const grant = verifyToken<{ type: string; sub: string; billId: string; innerGrant: string; exp: number }>(accessToken, serviceKey);
    if (!grant || grant.type !== 'invoice-grant' || grant.sub !== user.id || grant.billId !== billId) {
      return res.status(403).json({ error: 'invoice_access_denied', reason: 'locked' });
    }
    innerGrant = grant.innerGrant;
  }

  const { data, error } = await sb.rpc('get_invoice_content', {
    p_bill_id: billId,
    p_grant_token: innerGrant,
  });
  if (error) return res.status(502).json({ error: 'invoice_content_failed', detail: error.message });
  if (!data?.ok && data?.reason === 'locked') return res.status(403).json(data);
  return res.status(200).json(data);
}
