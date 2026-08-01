import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from '../_auth.js';

// Shared plumbing for the partner-facing pharmacy API: key authentication,
// scope check, rate limiting, request logging, and one error shape.
//
// Files starting with an underscore are not routed by Vercel, so this is a
// module rather than an endpoint.
//
// This surface is server-to-server. The key is a bearer credential with no
// user behind it, so there is deliberately no CORS header anywhere here — a
// partner that put this key in browser JavaScript would be publishing it.

export type PartnerContext = {
  partner: {
    id: string;
    partner_name: string;
    key_prefix: string;
    hospital_name: string;
    scopes: string[];
    rate_limit_per_min: number;
  };
  sb: SupabaseClient;
  requestId: string;
  fail: (status: number, error: string, extra?: Record<string, unknown>) => void;
};

export const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const bearerToken = (req: VercelRequest): string => {
  const header = text(req.headers.authorization);
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return text(req.headers['x-api-key']);
};

const callerIp = (req: VercelRequest): string =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  String(req.headers['x-real-ip'] || req.socket?.remoteAddress || '');

/**
 * Authenticate a partner request and enforce its scope and rate limit.
 *
 * Returns null when the request has already been answered with an error — the
 * caller should simply return.
 *
 * The rate limit is counted in the database rather than in memory. Vercel gives
 * each invocation its own process, so an in-memory window would frequently
 * start empty and let a hot loop straight through; this is the same reasoning
 * that put the OTP rate limits in Postgres (20260726100000_invoice_otp_gate.sql).
 * It costs one indexed COUNT over a 60-second window per request.
 */
export async function authenticatePartner(
  req: VercelRequest,
  res: VercelResponse,
  requiredScope: string,
): Promise<PartnerContext | null> {
  const requestId = text(req.headers['x-request-id']) || randomUUID();
  const startedAt = Date.now();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Request-Id', requestId);

  const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => {
    res.status(status).json({ ok: false, error, requestId, ...extra });
  };

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!serviceKey) {
    fail(500, 'supabase_not_configured');
    return null;
  }

  const key = bearerToken(req);
  if (!key) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    fail(401, 'api_key_required');
    return null;
  }

  const sb = serviceClient(serviceKey);
  const keyHash = createHash('sha256').update(key).digest('hex');

  const { data: partner, error } = await sb
    .from('partner_api_clients')
    .select('id, partner_name, key_prefix, hospital_name, scopes, rate_limit_per_min, is_active, revoked_at')
    .eq('api_key_hash', keyHash)
    .maybeSingle();

  if (error) {
    console.error('[partner-api] key lookup failed', { requestId, code: error.code });
    fail(502, 'auth_lookup_failed');
    return null;
  }

  // A revoked or unknown key gets the same answer, so probing tells nothing.
  if (!partner || !partner.is_active || partner.revoked_at) {
    fail(401, 'invalid_api_key');
    return null;
  }

  const scopes: string[] = Array.isArray(partner.scopes) ? partner.scopes : [];
  if (!scopes.includes(requiredScope)) {
    fail(403, 'scope_not_granted', { required_scope: requiredScope });
    return null;
  }

  const windowStart = new Date(Date.now() - 60_000).toISOString();
  const { count } = await sb
    .from('partner_api_log')
    .select('id', { count: 'exact', head: true })
    .eq('partner_id', partner.id)
    .gte('created_at', windowStart);

  const limit = partner.rate_limit_per_min || 60;
  if ((count ?? 0) >= limit) {
    res.setHeader('Retry-After', '60');
    fail(429, 'rate_limited', { limit_per_minute: limit });
    void logRequest(sb, partner.id, partner.key_prefix, req, 429, requestId, startedAt);
    return null;
  }

  // Wrap the response so every outcome is logged exactly once, without each
  // endpoint having to remember to do it.
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    void logRequest(sb, partner.id, partner.key_prefix, req, res.statusCode, requestId, startedAt);
    return originalJson(body);
  }) as typeof res.json;

  return {
    partner: {
      id: partner.id,
      partner_name: partner.partner_name,
      key_prefix: partner.key_prefix,
      hospital_name: partner.hospital_name,
      scopes,
      rate_limit_per_min: limit,
    },
    sb,
    requestId,
    fail,
  };
}

async function logRequest(
  sb: SupabaseClient,
  partnerId: string,
  keyPrefix: string,
  req: VercelRequest,
  statusCode: number,
  requestId: string,
  startedAt: number,
): Promise<void> {
  try {
    await sb.from('partner_api_log').insert({
      partner_id: partnerId,
      key_prefix: keyPrefix,
      endpoint: String(req.url || '').split('?')[0],
      method: req.method,
      status_code: statusCode,
      request_id: requestId,
      ip: callerIp(req) || null,
      duration_ms: Date.now() - startedAt,
    });
  } catch (error) {
    // Losing a log line must never fail the partner's request.
    console.error('[partner-api] log insert failed', {
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Stock row shaping, shared by /stock, /stock-snapshot and the nightly push
// ---------------------------------------------------------------------------

export const TODAY = () => new Date().toISOString().slice(0, 10);

/** What a batch row means to the partner right now. */
export type BatchStatus = 'available' | 'out_of_stock' | 'expired' | 'withdrawn';

export function batchStatus(row: any): BatchStatus {
  if (row.is_active === false) return 'withdrawn';
  if (row.expiry_date && row.expiry_date <= TODAY()) return 'expired';
  if (!(row.current_stock > 0)) return 'out_of_stock';
  return 'available';
}

/**
 * medicine_batch_inventory.medicine_id has no declared foreign key, so PostgREST
 * cannot embed the medicine name — fetch it in one extra round trip.
 */
export async function medicineNames(
  sb: SupabaseClient,
  rows: any[],
): Promise<Map<string, { name: string; generic: string | null }>> {
  const names = new Map<string, { name: string; generic: string | null }>();
  const ids = [...new Set(rows.map((row) => row.medicine_id).filter(Boolean))];
  if (ids.length === 0) return names;

  const { data } = await sb.from('medicine_master').select('id, medicine_name, generic_name').in('id', ids);
  for (const medicine of data || []) {
    names.set(medicine.id, { name: medicine.medicine_name, generic: medicine.generic_name });
  }
  return names;
}

/**
 * One row shape for every stock response.
 *
 * `status` and `available_quantity` together are the partner's whole rule:
 * upsert on batch_id, and anything with available_quantity 0 is gone. A batch
 * that has sold out, expired or been withdrawn reports 0 rather than vanishing
 * from the feed — see the tombstone note in stock.ts.
 */
export const shapeBatch = (
  row: any,
  names: Map<string, { name: string; generic: string | null }>,
) => {
  const status = batchStatus(row);
  return {
    batch_id: row.id,
    medicine_id: row.medicine_id,
    medicine_name: names.get(row.medicine_id)?.name ?? null,
    generic_name: names.get(row.medicine_id)?.generic ?? null,
    batch_number: row.batch_number,
    expiry_date: row.expiry_date,
    status,
    available_quantity: status === 'available' ? row.current_stock : 0,
    reserved_quantity: row.reserved_stock,
    pieces_per_pack: row.pieces_per_pack ?? null,
    selling_price: row.selling_price,
    mrp: row.mrp,
    gst: row.gst,
    updated_at: row.updated_at,
  };
};

/**
 * One page of a full-stock snapshot: currently orderable stock only.
 *
 * No tombstones here, unlike the change feed — the partner is replacing their
 * whole table with this, so a batch that is absent is a batch they drop.
 *
 * Shared by GET /stock-snapshot (they pull) and the nightly push (we send), so
 * the two can never drift apart in shape or filtering.
 */
export async function snapshotPage(
  sb: SupabaseClient,
  hospitalName: string,
  page: number,
  limit: number,
): Promise<{ items: ReturnType<typeof shapeBatch>[]; total: number }> {
  const from = (page - 1) * limit;

  const { data, error, count } = await sb
    .from('medicine_batch_inventory')
    .select('*', { count: 'exact' })
    .eq('hospital_name', hospitalName)
    .eq('is_active', true)
    .gt('current_stock', 0)
    .gt('expiry_date', TODAY())
    // Ordered by id, not updated_at: a snapshot spans several requests and rows
    // keep changing underneath it. An ordering that a concurrent sale can move a
    // row within would let that row be skipped or repeated across page bounds.
    .order('id', { ascending: true })
    .range(from, from + limit - 1);

  if (error) throw new Error(`snapshot page ${page} failed: ${error.message}`);

  const rows = data || [];
  const names = await medicineNames(sb, rows);
  return { items: rows.map((row) => shapeBatch(row, names)), total: count ?? rows.length };
}

/** Refresh last_used_at at most once an hour, so it costs ~nothing to keep. */
export async function touchLastUsed(ctx: PartnerContext): Promise<void> {
  try {
    await ctx.sb
      .from('partner_api_clients')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', ctx.partner.id)
      .or(`last_used_at.is.null,last_used_at.lt.${new Date(Date.now() - 3_600_000).toISOString()}`);
  } catch {
    // Best effort only.
  }
}
