import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticatePartner, touchLastUsed, text } from './_client.js';

// GET /api/partner/medicines
//
// The medicine catalogue. The partner maps their own item codes to our
// medicine_id once, then only ever sends medicine_id when ordering.
//
// Query parameters: search, page (default 1), limit (default 200, max 500).

const MAX_LIMIT = 500;

const intParam = (value: unknown, fallback: number): number => {
  const parsed = Number.parseInt(text(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await authenticatePartner(req, res, 'stock:read');
  if (!ctx) return;

  if (req.method !== 'GET') return ctx.fail(405, 'method_not_allowed');

  const { sb, partner } = ctx;
  const search = text(req.query.search);
  const page = intParam(req.query.page, 1);
  const limit = Math.min(intParam(req.query.limit, 200), MAX_LIMIT);
  const from = (page - 1) * limit;

  let query = sb
    .from('medicine_master')
    .select('id, medicine_name, generic_name, type, mrp_price, selling_price')
    .eq('hospital_name', partner.hospital_name)
    .order('medicine_name', { ascending: true })
    .range(from, from + limit - 1);

  // medicine_master rows are soft-deleted rather than removed.
  query = query.or('is_deleted.is.null,is_deleted.eq.false');

  if (search) query = query.ilike('medicine_name', `%${search}%`);

  const { data, error } = await query;
  if (error) {
    console.error('[partner-api] medicines query failed', { requestId: ctx.requestId, code: error.code });
    return ctx.fail(502, 'medicines_query_failed');
  }

  void touchLastUsed(ctx);

  return res.status(200).json({
    ok: true,
    items: (data || []).map((row) => ({
      medicine_id: row.id,
      medicine_name: row.medicine_name,
      generic_name: row.generic_name,
      type: row.type,
      mrp: row.mrp_price,
      selling_price: row.selling_price,
    })),
    page,
    limit,
    has_more: (data || []).length === limit,
    hospital: partner.hospital_name,
  });
}
