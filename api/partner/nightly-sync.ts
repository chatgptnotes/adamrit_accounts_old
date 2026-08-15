import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, randomUUID } from 'node:crypto';
import { getSessionUser, serviceClient } from '../_auth.js';
import { snapshotPage } from './_client.js';

// Nightly full-stock push to partner systems.
//
// Runs from Vercel Cron at 20:30 UTC = 02:00 IST (see vercel.json). Sends every
// partner with a sync_url the complete stock list in pages, which they apply as
// a hard refresh: buffer until `is_last`, then replace their whole table.
//
// WHY THIS EXISTS ALONGSIDE THE CHANGE FEED
// The change feed (GET /stock?since=) is the accurate, low-cost path and is what
// keeps the partner right during trading hours. But a feed is only as good as
// its worst missed message: if their process is down for an hour, or a poll
// fails and they advance their watermark anyway, they drift and nothing tells
// them. This bounds that drift to one day whatever went wrong.
//
// GET  — cron invocation, guarded by CRON_SECRET (Vercel sends it automatically)
// POST — manual re-run by a logged-in staff member after a failed night
//
// Auth note: CRON_SECRET must be set in Vercel or the GET path refuses every
// caller, the scheduler included. It fails closed rather than open.

const PAGE_SIZE = 1000;
const MAX_PAGES = 200; // 200k rows; a runaway backstop, not an expected bound
const ATTEMPTS_PER_PAGE = 3;

type PartnerRow = {
  id: string;
  partner_name: string;
  hospital_name: string;
  sync_url: string | null;
  sync_secret: string | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST one page, retrying transient failures.
 *
 * 4xx other than 408/429 is not retried: the partner is rejecting the payload,
 * and sending it twice more only wastes time and fills their error log.
 */
async function postPage(url: string, secret: string, body: unknown): Promise<{ status: number; error?: string }> {
  const payload = JSON.stringify(body);
  const signature = createHmac('sha256', secret).update(payload).digest('hex');

  let last: { status: number; error?: string } = { status: 0, error: 'not attempted' };

  for (let attempt = 1; attempt <= ATTEMPTS_PER_PAGE; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Adamrit-Signature': `sha256=${signature}`,
          'X-Adamrit-Snapshot-Id': String((body as any).snapshot_id || ''),
          'User-Agent': 'Adamrit-Partner-Sync/1',
        },
        body: payload,
      });

      if (response.ok) return { status: response.status };

      last = { status: response.status, error: (await response.text()).slice(0, 500) };
      const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
      if (!retryable) return last;
    } catch (error) {
      last = { status: 0, error: error instanceof Error ? error.message : String(error) };
    }

    if (attempt < ATTEMPTS_PER_PAGE) await sleep(1000 * attempt);
  }

  return last;
}

async function syncPartner(
  sb: ReturnType<typeof serviceClient>,
  partner: PartnerRow,
  trigger: 'cron' | 'manual',
): Promise<Record<string, unknown>> {
  const snapshotId = randomUUID();
  const snapshotAt = new Date().toISOString();

  const { data: run } = await sb
    .from('partner_sync_runs')
    .insert({ partner_id: partner.id, snapshot_id: snapshotId, status: 'RUNNING', trigger })
    .select('id')
    .single();

  const finish = async (fields: Record<string, unknown>) => {
    if (run?.id) {
      await sb.from('partner_sync_runs').update({ ...fields, finished_at: new Date().toISOString() }).eq('id', run.id);
    }
  };

  let page = 1;
  let itemsSent = 0;

  try {
    while (page <= MAX_PAGES) {
      const { items, total } = await snapshotPage(sb, partner.hospital_name, page, PAGE_SIZE);
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const isLast = page >= totalPages;

      const result = await postPage(partner.sync_url!, partner.sync_secret!, {
        snapshot_id: snapshotId,
        snapshot_at: snapshotAt,
        hospital: partner.hospital_name,
        page,
        total_pages: totalPages,
        total_items: total,
        is_last: isLast,
        unit: 'pieces',
        items,
      });

      if (result.status < 200 || result.status >= 300) {
        // Stop this partner here. A half-delivered snapshot must never be
        // applied — that is exactly what `is_last` protects against, and the
        // partner will simply never see it, so they keep yesterday's data
        // rather than a truncated table.
        await finish({
          status: 'FAILED',
          pages_sent: page - 1,
          items_sent: itemsSent,
          http_status: result.status || null,
          error: `page ${page}/${totalPages}: ${result.error || 'unknown'}`.slice(0, 1000),
        });
        return { partner: partner.partner_name, status: 'FAILED', page, http_status: result.status };
      }

      itemsSent += items.length;
      if (isLast) {
        await finish({ status: 'SUCCESS', pages_sent: page, items_sent: itemsSent, http_status: result.status });
        return { partner: partner.partner_name, status: 'SUCCESS', pages: page, items: itemsSent };
      }
      page++;
    }

    await finish({
      status: 'FAILED',
      pages_sent: page - 1,
      items_sent: itemsSent,
      error: `aborted after ${MAX_PAGES} pages — snapshot larger than expected`,
    });
    return { partner: partner.partner_name, status: 'FAILED', reason: 'too_many_pages' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finish({ status: 'FAILED', pages_sent: page - 1, items_sent: itemsSent, error: message.slice(0, 1000) });
    return { partner: partner.partner_name, status: 'FAILED', error: message };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!serviceKey) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });

  let trigger: 'cron' | 'manual';

  if (req.method === 'POST') {
    // Manual re-run from the Partner Orders tab.
    const user = getSessionUser(req, serviceKey);
    if (!user) return res.status(401).json({ ok: false, error: 'not_authenticated' });
    trigger = 'manual';
  } else if (req.method === 'GET') {
    // Fails closed. The previous `if (cronSecret && ...)` meant an unset secret
    // left this open to the world — the configuration needing the check most was
    // the one where it did nothing.
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    trigger = 'cron';
  } else {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const sb = serviceClient(serviceKey);

  const { data: partners, error } = await sb
    .from('partner_api_clients')
    .select('id, partner_name, hospital_name, sync_url, sync_secret')
    .eq('is_active', true)
    .eq('sync_enabled', true)
    .is('revoked_at', null)
    .not('sync_url', 'is', null);

  if (error) {
    console.error('[partner-sync] partner lookup failed', { code: error.code });
    return res.status(502).json({ ok: false, error: 'partner_lookup_failed' });
  }

  const eligible = (partners || []).filter((p) => p.sync_url && p.sync_secret);

  // Sequential on purpose: one partner failing must not affect another, and a
  // handful of nightly pushes has no reason to race for the same connections.
  const results = [];
  for (const partner of eligible) {
    results.push(await syncPartner(sb, partner as PartnerRow, trigger));
  }

  console.log('[partner-sync] done', { trigger, partners: results.length, results });

  return res.status(200).json({ ok: true, trigger, partners: results.length, results });
}
