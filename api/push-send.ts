// Fans one notifications row out to every subscribed phone via Web Push.
//
// Called by the database trigger trg_notifications_push (pg_net) whenever a
// row lands in public.notifications — so anything that reaches the in-app
// bell also buzzes the phones, with no per-alert wiring.
//
// Auth: the trigger sends app.settings.service_role_key as the bearer; it must
// match SUPABASE_SERVICE_ROLE_KEY. No new secret to provision.
//
// Dead devices clean themselves up: a 404/410 from the push service means the
// subscription is gone (app uninstalled, site data cleared) and the row is
// deleted; other failures only bump failure_count.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import webpush from 'web-push';
import { serviceClient } from './_auth';

interface NotificationRow {
  id: string;
  notification_type: string;
  title: string;
  message: string;
  visit_id: string | null;
}

// Where a tap should land, per alert type. Mirrors the deep links in
// src/tablet/shell/TabletNotificationBell.tsx; computed here so the service
// worker stays dumb.
const targetUrl = (row: NotificationRow): string => {
  switch (row.notification_type) {
    case 'pharmacy_threshold':
    case 'ot_surgical_threshold':
      return row.visit_id ? `/patient-profile?visit_id=${encodeURIComponent(row.visit_id)}` : '/';
    case 'approval_pending':
      return '/t/expense-bills';
    case 'payment_deadline_due':
    case 'unbilled_payment':
      return '/t/payments-due';
    case 'payment_alert':
      return row.visit_id ? `/patient-profile?visit_id=${encodeURIComponent(row.visit_id)}` : '/';
    default:
      return '/';
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!serviceKey) return res.status(500).json({ error: 'supabase_not_configured' });
  if (req.headers.authorization !== `Bearer ${serviceKey}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const vapidPublic = process.env.VAPID_PUBLIC_KEY || '';
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY || '';
  if (!vapidPublic || !vapidPrivate) {
    return res.status(500).json({ error: 'vapid_not_configured' });
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@adamrit.com',
    vapidPublic,
    vapidPrivate,
  );

  const notificationId = String(req.body?.notification_id || '');
  if (!notificationId) return res.status(400).json({ error: 'notification_id_required' });

  const sb = serviceClient(serviceKey);
  const { data: row, error: rowError } = await sb
    .from('notifications')
    .select('id, notification_type, title, message, visit_id')
    .eq('id', notificationId)
    .maybeSingle();
  if (rowError) return res.status(500).json({ error: 'notification_lookup_failed' });
  if (!row) return res.status(404).json({ error: 'notification_not_found' });

  const { data: subs, error: subsError } = await sb
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth');
  if (subsError) return res.status(500).json({ error: 'subscriptions_lookup_failed' });
  if (!subs || subs.length === 0) return res.status(200).json({ ok: true, sent: 0, devices: 0 });

  const payload = JSON.stringify({
    title: row.title,
    body: row.message,
    url: targetUrl(row as NotificationRow),
    // Collapse key: a re-sent alert replaces its banner instead of stacking.
    tag: `adamrit-${row.id}`,
  });

  let sent = 0;
  let removed = 0;
  let failed = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 24 * 60 * 60 },
        );
        sent += 1;
      } catch (error: any) {
        const status = Number(error?.statusCode) || 0;
        if (status === 404 || status === 410) {
          // Device is gone for good — remove it so we stop retrying forever.
          await sb.from('push_subscriptions').delete().eq('id', sub.id);
          removed += 1;
        } else {
          failed += 1;
          const { data: current } = await sb
            .from('push_subscriptions')
            .select('failure_count')
            .eq('id', sub.id)
            .maybeSingle();
          await sb
            .from('push_subscriptions')
            .update({
              failed_at: new Date().toISOString(),
              failure_count: (Number(current?.failure_count) || 0) + 1,
            })
            .eq('id', sub.id);
        }
      }
    }),
  );

  return res.status(200).json({ ok: true, sent, removed, failed, devices: subs.length });
}
