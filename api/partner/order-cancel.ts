import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { authenticatePartner } from './_client.js';

// POST /api/partner/order-cancel
//   { "order_id": "<uuid>", "reason": "optional" }
//
// Withdraws an order the partner placed. Only possible while it is still
// PENDING — once pharmacy staff have dispatched it, the medicine has left the
// building and cancelling is a conversation, not an API call.
//
// The reserved quantity goes straight back into available stock.

const cancelSchema = z.object({
  order_id: z.string().uuid(),
  reason: z.string().trim().max(500).optional().nullable(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await authenticatePartner(req, res, 'orders:write');
  if (!ctx) return;

  if (req.method !== 'POST') return ctx.fail(405, 'method_not_allowed');

  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) {
    return ctx.fail(400, 'invalid_request', { details: parsed.error.flatten().fieldErrors });
  }

  const { sb, partner } = ctx;

  const { data: owned } = await sb
    .from('partner_orders')
    .select('id')
    .eq('id', parsed.data.order_id)
    .eq('partner_id', partner.id)
    .maybeSingle();

  if (!owned) return ctx.fail(404, 'order_not_found');

  const { data, error } = await sb.rpc('partner_cancel_order', {
    p_order_id: parsed.data.order_id,
    p_reason: parsed.data.reason || 'Cancelled by partner',
    p_status: 'CANCELLED',
    p_user: partner.partner_name,
  });

  if (error) {
    console.error('[partner-api] cancel failed', { requestId: ctx.requestId, code: error.code });
    return ctx.fail(502, 'cancel_failed');
  }

  if (!data?.ok) {
    if (data?.reason === 'not_pending') {
      return ctx.fail(409, 'not_pending', { status: data.status });
    }
    return ctx.fail(400, data?.reason || 'cancel_rejected');
  }

  return res.status(200).json(data);
}
