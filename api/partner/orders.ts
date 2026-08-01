import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { authenticatePartner, touchLastUsed, text } from './_client.js';

// GET  /api/partner/orders                 list this partner's orders
// GET  /api/partner/orders?order_id=<uuid> one order with its allocated batches
// POST /api/partner/orders                 place an order
//
// POST body:
//   {
//     "partner_ref": "SO-2026-0912",          // your order id — makes retries safe
//     "items": [ { "medicine_id": "<uuid>", "quantity": 30 } ],
//     "notes": "optional"
//   }
//
// The order is all-or-nothing. If any line cannot be filled in full you get 409
// with a per-line shortfall and nothing is reserved. On success the requested
// quantity moves out of available stock immediately and sits in reserve until
// pharmacy staff dispatch or reject the order.
//
// Sending the same partner_ref twice returns the first order untouched
// (`"duplicate": true`) instead of reserving a second time, so a timed-out
// request is always safe to retry.

const orderSchema = z.object({
  partner_ref: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  items: z
    .array(
      z.object({
        medicine_id: z.string().uuid(),
        quantity: z.number().int().positive().max(1_000_000),
      }),
    )
    .min(1)
    .max(200),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Reading orders needs the ordering scope too: a stock:read-only key has no
  // orders of its own to look at.
  const ctx = await authenticatePartner(req, res, 'orders:write');
  if (!ctx) return;

  const { sb, partner } = ctx;
  void touchLastUsed(ctx);

  if (req.method === 'GET') {
    const orderId = text(req.query.order_id);

    if (orderId) {
      // Ownership is checked before the RPC: the RPC itself takes an id and
      // would happily render another partner's order.
      const { data: owned } = await sb
        .from('partner_orders')
        .select('id')
        .eq('id', orderId)
        .eq('partner_id', partner.id)
        .maybeSingle();

      if (!owned) return ctx.fail(404, 'order_not_found');

      const { data, error } = await sb.rpc('partner_order_json', { p_order_id: orderId });
      if (error) {
        console.error('[partner-api] order fetch failed', { requestId: ctx.requestId, code: error.code });
        return ctx.fail(502, 'order_fetch_failed');
      }
      return res.status(200).json(data);
    }

    const status = text(req.query.status).toUpperCase();
    let query = sb
      .from('partner_orders')
      .select('id, order_number, partner_ref, status, total_amount, requested_at, confirmed_at, closed_reason')
      .eq('partner_id', partner.id)
      .order('requested_at', { ascending: false })
      .limit(200);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
      console.error('[partner-api] order list failed', { requestId: ctx.requestId, code: error.code });
      return ctx.fail(502, 'order_list_failed');
    }
    return res.status(200).json({ ok: true, orders: data || [] });
  }

  if (req.method !== 'POST') return ctx.fail(405, 'method_not_allowed');

  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    return ctx.fail(400, 'invalid_request', { details: parsed.error.flatten().fieldErrors });
  }

  const { data, error } = await sb.rpc('partner_reserve_order', {
    p_partner_id: partner.id,
    p_partner_ref: parsed.data.partner_ref || null,
    p_items: parsed.data.items,
    p_notes: parsed.data.notes || null,
  });

  if (error) {
    console.error('[partner-api] reserve failed', { requestId: ctx.requestId, code: error.code, message: error.message });
    return ctx.fail(502, 'order_failed');
  }

  if (!data?.ok) {
    if (data?.reason === 'insufficient_stock') {
      return ctx.fail(409, 'insufficient_stock', { shortfalls: data.shortfalls });
    }
    if (data?.reason === 'unknown_partner') return ctx.fail(401, 'invalid_api_key');
    return ctx.fail(400, data?.reason || 'order_rejected');
  }

  return res.status(data.duplicate ? 200 : 201).json(data);
}
