import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticatePartner, touchLastUsed, text, medicineNames, shapeBatch, TODAY } from './_client.js';

// GET /api/partner/stock
//
// Two modes, decided by whether ?since= is supplied.
//
// WITHOUT ?since= — the CATALOGUE. Only stock that can actually be ordered right
// now: active, unexpired, quantity above zero.
//
// WITH ?since= — the CHANGE FEED. Every batch whose `updated_at` moved after
// that moment, INCLUDING ones that no longer qualify for the catalogue. A batch
// that sold out, expired or was withdrawn comes back with
// `available_quantity: 0` and a `status` saying which.
//
// That last part matters more than it looks. The catalogue filters are right for
// browsing and wrong for a feed: if a sold-out batch simply stopped appearing,
// the partner would never hear that it emptied and would keep the last non-zero
// figure they saw forever — so "one strip left" stays on their screen after we
// sold it. The tombstone is the only thing that tells them to remove the row.
//
// Query parameters
//   since    ISO timestamp. Send back the `watermark` from the previous
//            response; the steady-state answer is an empty list.
//   medicine UUID — one medicine only.
//   search   substring of the medicine name.
//   page     1-based, default 1.
//   limit    default 200, maximum 500.
//
// Quantities are in PIECES (individual tablets/units), not packs.

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
  // query. Every field is mapped explicitly by shapeBatch, so nothing leaks.
  const baseQuery = () =>
    sb.from('medicine_batch_inventory').select('*').eq('hospital_name', partner.hospital_name);

  const applyFilters = (query: any) => {
    if (since) query = query.gt('updated_at', since);
    if (medicineId) query = query.eq('medicine_id', medicineId);
    return query;
  };

  let rows: any[];

  if (!since) {
    // Catalogue: orderable stock only, paginated in the database.
    const { data, error } = await applyFilters(
      baseQuery()
        .eq('is_active', true)
        .gt('current_stock', 0)
        .gt('expiry_date', TODAY())
        .order('updated_at', { ascending: true })
        .range(from, from + limit - 1),
    );

    if (error) {
      console.error('[partner-api] stock query failed', { requestId: ctx.requestId, code: error.code });
      return ctx.fail(502, 'stock_query_failed');
    }
    rows = data || [];
  } else {
    // Change feed: everything that moved, qualifying or not. PostgREST cannot
    // express "in stock OR any of three tombstone conditions" as one filter
    // chain, so this is two queries merged and re-sorted by updated_at. The
    // window is bounded by `since`, so both are small in the steady state.
    const available = applyFilters(
      baseQuery()
        .eq('is_active', true)
        .gt('current_stock', 0)
        .gt('expiry_date', TODAY())
        .order('updated_at', { ascending: true })
        .limit(from + limit),
    );

    // Anything that changed and is NOT orderable: withdrawn, expired, or empty.
    const gone = applyFilters(
      baseQuery()
        .or(`is_active.eq.false,current_stock.lte.0,expiry_date.lte.${TODAY()}`)
        .order('updated_at', { ascending: true })
        .limit(from + limit),
    );

    const [availableResult, goneResult] = await Promise.all([available, gone]);

    if (availableResult.error || goneResult.error) {
      const error = availableResult.error || goneResult.error;
      console.error('[partner-api] stock delta query failed', { requestId: ctx.requestId, code: error?.code });
      return ctx.fail(502, 'stock_query_failed');
    }

    // Merge, then sort by updated_at. The sort is what keeps the watermark
    // honest: paging a merged list on any other order would let a tombstone sit
    // past the cut and be skipped forever on the next poll.
    rows = [...(availableResult.data || []), ...(goneResult.data || [])].sort((a, b) =>
      String(a.updated_at).localeCompare(String(b.updated_at)),
    );
    rows = rows.slice(from, from + limit);
  }

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
      unit: 'pieces',
    });
  }

  const names = await medicineNames(sb, rows);
  let items = rows.map((row) => shapeBatch(row, names));

  // Name search is applied after the name lookup because the name lives in a
  // different table. It therefore filters the current page rather than the whole
  // result set — use ?medicine= for an exact, paginated filter.
  if (search) {
    const needle = search.toLowerCase();
    items = items.filter((item) => (item.medicine_name || '').toLowerCase().includes(needle));
  }

  // Taken from `rows`, not from the search-filtered `items`: a row dropped by
  // the name filter has still been accounted for, and holding the watermark back
  // for it would replay the same page forever.
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
