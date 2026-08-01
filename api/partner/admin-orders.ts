import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getSessionUser, serviceClient } from '../_auth.js';

// The staff side of partner orders, for the Partner Orders tab in the pharmacy
// dashboard. Authenticated by the ordinary hmis_session cookie, NOT by a
// partner API key.
//
// GET  /api/partner/admin-orders?status=PENDING   list orders for the user's hospital
// POST /api/partner/admin-orders                  { order_id, action: 'confirm' | 'reject', reason? }
//
// This lives behind the API rather than calling the RPCs from the browser
// because they are granted to service_role only — the browser talks to Postgres
// as anon, which cannot execute them.

const actionSchema = z.object({
  order_id: z.string().uuid(),
  action: z.enum(['confirm', 'reject']),
  reason: z.string().trim().max(500).optional().nullable(),
});

// The session carries a hospital key ('hope' / 'ayushman'); pharmacy rows are
// scoped by the full name. These must stay in step with HOSPITAL_CONFIGS in
// src/types/hospital.ts, which is what StockManagement.tsx writes.
const HOSPITAL_NAMES: Record<string, string> = {
  hope: 'Hope Multi-Specialty Hospital',
  ayushman: 'Ayushman Hospital',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = randomUUID();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Request-Id', requestId);

  const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
    res.status(status).json({ ok: false, error, requestId, ...extra });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!serviceKey) return fail(500, 'supabase_not_configured');

  const user = getSessionUser(req, serviceKey);
  if (!user) return fail(401, 'not_authenticated');

  const sb = serviceClient(serviceKey);
  const hospitalName = HOSPITAL_NAMES[user.hospitalType] || user.hospitalType;

  if (req.method === 'GET') {
    const status = String(req.query.status || '').toUpperCase();

    let query = sb
      .from('partner_orders')
      .select(
        'id, order_number, partner_ref, status, total_amount, notes, requested_at, confirmed_by, confirmed_at, closed_reason, ' +
          'partner_api_clients(partner_name), ' +
          'partner_order_items(medicine_name, batch_number, expiry_date, quantity, unit_price, line_amount)',
      )
      .eq('hospital_name', hospitalName)
      .order('requested_at', { ascending: false })
      .limit(200);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
      console.error('[partner-api] admin list failed', { requestId, code: error.code });
      return fail(502, 'order_list_failed');
    }
    return res.status(200).json({ ok: true, orders: data || [] });
  }

  if (req.method !== 'POST') return fail(405, 'method_not_allowed');

  const parsed = actionSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(400, 'invalid_request', { details: parsed.error.flatten().fieldErrors });
  }

  // Scope the action to the acting user's hospital, so a Hope login cannot
  // dispatch an Ayushman order.
  const { data: order } = await sb
    .from('partner_orders')
    .select('id')
    .eq('id', parsed.data.order_id)
    .eq('hospital_name', hospitalName)
    .maybeSingle();

  if (!order) return fail(404, 'order_not_found');

  const { data, error } =
    parsed.data.action === 'confirm'
      ? await sb.rpc('partner_confirm_order', {
          p_order_id: parsed.data.order_id,
          p_user: user.email,
        })
      : await sb.rpc('partner_cancel_order', {
          p_order_id: parsed.data.order_id,
          p_reason: parsed.data.reason || 'Rejected by pharmacy',
          p_status: 'REJECTED',
          p_user: user.email,
        });

  if (error) {
    console.error('[partner-api] admin action failed', { requestId, code: error.code });
    return fail(502, 'action_failed');
  }

  if (!data?.ok) {
    if (data?.reason === 'not_pending') return fail(409, 'not_pending', { status: data.status });
    return fail(400, data?.reason || 'action_rejected');
  }

  return res.status(200).json(data);
}
