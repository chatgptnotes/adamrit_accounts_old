import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { getSessionUser, serviceClient, verifyToken } from './_auth.js';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = text(req.headers['x-request-id']) || randomUUID();
  const startedAt = Date.now();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Request-Id', requestId);

  const fail = (
    status: number,
    error: string,
    stage: string,
    retryable: boolean,
    extra: Record<string, unknown> = {},
  ) => res.status(status).json({ ok: false, error, stage, retryable, requestId, ...extra });

  try {
    if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'request', false);

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!serviceKey) return fail(500, 'supabase_not_configured', 'configuration', false);

    const billId = text(req.body?.billId);
    const accessToken = text(req.body?.grantToken);
    if (!billId) return fail(400, 'bill_id_required', 'request', false);

    // The protected-content RPC performs the authoritative lock check itself.
    // Validate an optional browser grant here, then make exactly one RPC instead
    // of calling invoice_lock_state first and repeating that work inside the RPC.
    let innerGrant: string | null = null;
    let grantFailure: 'not_authenticated' | 'invoice_access_denied' | null = null;
    if (accessToken) {
      const user = getSessionUser(req, serviceKey);
      if (!user) {
        grantFailure = 'not_authenticated';
      } else {
        const grant = verifyToken<{
          type: string;
          sub: string;
          billId: string;
          innerGrant: string;
          exp: number;
        }>(accessToken, serviceKey);
        if (!grant || grant.type !== 'invoice-grant' || grant.sub !== user.id || grant.billId !== billId) {
          grantFailure = 'invoice_access_denied';
        } else {
          innerGrant = grant.innerGrant;
        }
      }
    }

    const sb = serviceClient(serviceKey);
    const rpcStartedAt = Date.now();
    const { data, error } = await sb.rpc('get_invoice_content', {
      p_bill_id: billId,
      p_grant_token: innerGrant,
    });
    res.setHeader('Server-Timing', `invoice-content;dur=${Date.now() - rpcStartedAt}`);

    if (error) {
      console.error('[invoice-content] RPC failed', {
        requestId,
        stage: 'invoice_content',
        code: error.code,
        durationMs: Date.now() - startedAt,
      });
      // A database/application error should be diagnosed, not multiplied by an
      // automatic client retry. Gateway responses that never reach this handler
      // are still eligible for one bounded retry in the browser.
      return fail(502, 'invoice_content_failed', 'invoice_content', false);
    }

    if (!data?.ok && data?.reason === 'locked') {
      const errorCode = grantFailure || 'invoice_access_denied';
      return fail(errorCode === 'not_authenticated' ? 401 : 403, errorCode, 'authorization', false, {
        reason: 'locked',
        bill_no: data?.bill_no,
      });
    }

    if (!data?.ok) {
      return fail(data?.reason === 'bill_not_found' ? 404 : 422, data?.reason || 'invoice_content_unavailable', 'invoice_content', false, {
        reason: data?.reason,
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('[invoice-content] Unexpected failure', {
      requestId,
      stage: 'handler',
      message: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    });
    return fail(500, 'invoice_content_handler_failed', 'handler', true);
  }
}
