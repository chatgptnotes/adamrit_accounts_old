import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticatePartner, touchLastUsed, text } from './_client.js';

// GET /api/partner/stock
//
// Batch-wise available stock for the hospital this API key belongs to.
//
// Query parameters
//   since    ISO timestamp — return only batches changed after it. Send back the
//            `watermark` from the previous response and the steady-state answer
//            is an empty list, which is what keeps polling cheap.
//   medicine UUID — one medicine only.
//   search   substring of the medicine name.
//   page     1-based, default 1.
//   limit    default 200, maximum 500.
//
// Quantities are in PIECES (individual tablets/units), not packs — that is what
// GRN posting writes into the batch table. pieces_per_pack is returned where the
// batch carries it so the partner can convert.

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 200;

const intParam = (value: unknown, fallback: number): number => {
  const parsed = Number.parseInt(text(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await authenticatePartner(req, res, 'stock:read');
  if (!ctx) return;

  if (req.method !== 'GET') return ctx.fail(405, 'method_not_allowed');

  const { sb, partner } = ctx;
  const since = text(req.query.since);
  const medicineId = text(req.query.medicine);
  const search = text(req.query.search);
  const page = intParam(req.query.page, 1);
  const limit = Math.min(intParam(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
  const from = (page - 1) * limit;

  if (since && Number.isNaN(Date.parse(since))) {
    return ctx.fail(400, 'invalid_since', { hint: 'Use the `watermark` value from a previous response.' });
  }

  // select('*') rather than a column list on purpose: this table has columns in
  // the live database that exist in no migration file (pieces_per_pack,
  // adjustment_quantity), and naming a column that is absent fails the whole
  // query. Everything is mapped explicitly below, so nothing leaks.
  let query = sb
    .from('medicine_batch_inventory')
    .select('*')
    .eq('hospital_name', partner.hospital_name)
    .eq('is_active', true)
    .gt('current_stock', 0)
    .gt('expiry_date', new Date().toISOString().slice(0, 10))
    .order('updated_at', { ascending: true })
    .range(from, from + limit - 1);

  if (since) query = query.gt('updated_at', since);
  if (medicineId) query = query.eq('medicine_id', medicineId);

  const { data: batches, error } = await query;
  if (error) {
    console.error('[partner-api] stock query failed', { requestId: ctx.requestId, code: error.code });
    return ctx.fail(502, 'stock_query_failed');
  }

  const rows = batches || [];

  // Nothing changed since the partner's last poll. Their watermark stays valid.
  if (since && rows.length === 0) {
    return res.status(200).json({
      ok: true,
      items: [],
      page,
      limit,
      has_more: false,
      watermark: since,
      hospital: partner.hospital_name,
    });
  }

  // medicine_batch_inventory.medicine_id has no declared foreign key, so
  // PostgREST cannot embed the name — fetch it in one extra round trip.
  const medicineIds = [...new Set(rows.map((row: any) => row.medicine_id).filter(Boolean))];
  const names = new Map<string, { name: string; generic: string | null }>();
  if (medicineIds.length > 0) {
    const { data: medicines } = await sb
      .from('medicine_master')
      .select('id, medicine_name, generic_name')
      .in('id', medicineIds);
    for (const medicine of medicines || []) {
      names.set(medicine.id, { name: medicine.medicine_name, generic: medicine.generic_name });
    }
  }

  let items = rows.map((row: any) => ({
    batch_id: row.id,
    medicine_id: row.medicine_id,
    medicine_name: names.get(row.medicine_id)?.name ?? null,
    generic_name: names.get(row.medicine_id)?.generic ?? null,
    batch_number: row.batch_number,
    expiry_date: row.expiry_date,
    available_quantity: row.current_stock,
    reserved_quantity: row.reserved_stock,
    pieces_per_pack: row.pieces_per_pack ?? null,
    selling_price: row.selling_price,
    mrp: row.mrp,
    gst: row.gst,
    updated_at: row.updated_at,
  }));

  // Name search is applied after the name lookup because the name lives in a
  // different table. It therefore filters the current page rather than the whole
  // result set — use ?medicine= for an exact, paginated filter.
  if (search) {
    const needle = search.toLowerCase();
    items = items.filter((item) => (item.medicine_name || '').toLowerCase().includes(needle));
  }

  const watermark = rows.length > 0 ? rows[rows.length - 1].updated_at : since || null;

  void touchLastUsed(ctx);

  return res.status(200).json({
    ok: true,
    items,
    page,
    limit,
    has_more: rows.length === limit,
    watermark,
    hospital: partner.hospital_name,
    unit: 'pieces',
  });
}
