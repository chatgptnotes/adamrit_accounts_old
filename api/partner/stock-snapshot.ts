import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { authenticatePartner, touchLastUsed, text, snapshotPage } from './_client.js';

// GET /api/partner/stock-snapshot?page=&limit=
//
// The complete stock list, for a HARD REFRESH: the partner buffers the pages,
// and when `is_last` arrives replaces their whole stock table with what they
// received. Anything not in the snapshot no longer exists.
//
// This is the same content the nightly push sends — it exists so a partner can
// re-sync on demand after a failed night, or run their own schedule instead of
// receiving ours.
//
// `snapshot_at` is captured before the first page and is the timestamp to resume
// daytime polling from (GET /stock?since=<snapshot_at>), so there is no gap
// between the refresh and the next delta. Pass it back on later pages so every
// page of one snapshot carries the same value.

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 500;

const intParam = (value: unknown, fallback: number): number => {
  const parsed = Number.parseInt(text(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await authenticatePartner(req, res, 'stock:read');
  if (!ctx) return;

  if (req.method !== 'GET') return ctx.fail(405, 'method_not_allowed');

  const { sb, partner } = ctx;
  const page = intParam(req.query.page, 1);
  const limit = Math.min(intParam(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
  const snapshotId = text(req.query.snapshot_id) || randomUUID();
  const snapshotAt = text(req.query.snapshot_at) || new Date().toISOString();

  try {
    const { items, total } = await snapshotPage(sb, partner.hospital_name, page, limit);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    void touchLastUsed(ctx);

    return res.status(200).json({
      ok: true,
      snapshot_id: snapshotId,
      snapshot_at: snapshotAt,
      page,
      limit,
      total_items: total,
      total_pages: totalPages,
      is_last: page >= totalPages,
      items,
      hospital: partner.hospital_name,
      unit: 'pieces',
    });
  } catch (error) {
    console.error('[partner-api] snapshot failed', {
      requestId: ctx.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
    return ctx.fail(502, 'snapshot_failed');
  }
}
