// Vercel Cron job: run the books health checks every morning and raise a
// notification for anything they find.
//
// WHY THIS EXISTS. run_books_health_checks() and notify_books_health() were
// written on 4-Aug and both work. Nothing ran them on a schedule: the only
// caller was src/tablet/shell/TabletNotificationBell.tsx, which fires the RPC
// when a tablet user happens to open the notification bell. So the books were
// checked when somebody opened a screen, and not otherwise.
//
// What that cost: Ayushman Nagpur's opening balances stopped netting to zero
// shortly after 4-Aug, and the first notification about it was raised on
// 13-Aug — the day somebody opened the bell. The imbalance was Rs 51,71,102.
//
// This route makes the check happen whether or not anyone opens anything.
//
// It does NOT replace the bell's call. Two callers are fine: notify_books_health
// already refuses to raise the same message twice in one day, so the second
// caller of the day inserts nothing.
//
// Security: 'cron' mode refuses unless the request carries CRON_SECRET as a
// Bearer token, which Vercel adds automatically. If CRON_SECRET is unset the
// route returns 401 rather than running open.
//
// -----------------------------------------------------------------------------
// TO TURN ON THE WHATSAPP ALERT
//
// WhatsApp will not carry a business-initiated message that is not an approved
// template, and approval happens in the DoubleTick console with Meta. Submit
// this one — the placeholders are already wired below, in this order:
//
//   Name      books_health_alert_v1
//   Language  English (en)
//   Category  Utility
//   Body      Adamrit books check, {{1}}.
//
//             {{2}} issue(s) found:
//             {{3}}
//
//             Please review this in Accounting. This message repeats each
//             morning until the books balance.
//
//   Sample    {{1}} 2026-08-16
//             {{2}} 1
//             {{3}} • Ayushman Nagpur Hospital: opening balances net
//                     ₹-51,71,102.00 instead of zero
//
// Then set, in Vercel Production:
//   DOUBLETICK_BOOKS_TEMPLATE  books_health_alert_v1
//   DOUBLETICK_BOOKS_ALERT_TO  91XXXXXXXXXX          (comma-separate for several)
//
// Until both are set the route runs normally and reports
// whatsapp="awaiting_approved_template". Nothing else changes.
// -----------------------------------------------------------------------------

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { withRoute } from './_middleware.js'

interface HealthRow {
  check_name: string
  severity: string
  detail: string
}

const DOUBLETICK_URL = 'https://public.doubletick.io/whatsapp/message/template'

/**
 * WhatsApp the findings, if a template has been approved for it.
 *
 * WHY IT IS ENV-DRIVEN AND OFF UNTIL CONFIGURED. WhatsApp will not carry a
 * business-initiated message that is not an approved template, and approval
 * happens in the DoubleTick console with Meta — it cannot be done from here.
 * So the send path is complete and the template name is the one thing missing.
 * Set DOUBLETICK_BOOKS_TEMPLATE and DOUBLETICK_BOOKS_ALERT_TO and it starts.
 *
 * NOT reusing extension_needed_patients_v1, the only template in the codebase:
 * its approved copy is about patients needing a stay extension, so a books
 * alert sent through it would reach staff dressed as a clinical message.
 *
 * NOT going through pg_net either. The database-triggered WhatsApp sends were
 * silently dead for weeks because pg_net was never enabled; this posts straight
 * from the serverless function, so there is no extension to forget.
 *
 * Returns a short status string rather than throwing: the caller decides what a
 * failure means, and a delivery problem must not lose the finding itself.
 */
async function whatsappFindings(rows: HealthRow[]): Promise<{ status: string; detail?: unknown }> {
  const apiKey = process.env.DOUBLETICK_API_KEY || ''
  const from = process.env.DOUBLETICK_PHONE || ''
  const template = process.env.DOUBLETICK_BOOKS_TEMPLATE || ''
  const recipients = (process.env.DOUBLETICK_BOOKS_ALERT_TO || '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)

  if (!apiKey || !from) return { status: 'doubletick_not_configured' }
  // Deliberately distinct from a failure: nothing is broken, the template just
  // does not exist yet. The daily run should not start returning 502 for it.
  if (!template) return { status: 'awaiting_approved_template' }
  if (recipients.length === 0) return { status: 'no_recipients_configured' }

  // WhatsApp template bodies cap out around 1024 characters, and a placeholder
  // that overflows is rejected outright rather than trimmed.
  const MAX = 700
  let detail = rows.map((r) => `• ${r.detail}`).join('\n')
  if (detail.length > MAX) {
    detail = `${detail.slice(0, MAX - 40)}\n…and more. Open Accounting for the rest.`
  }

  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)

  const payload = {
    messages: recipients.map((to) => ({
      to,
      from,
      content: {
        templateName: template,
        language: 'en',
        templateData: {
          header: { type: 'TEXT' },
          body: { placeholders: [today, String(rows.length), detail] },
        },
      },
    })),
  }

  try {
    const upstream = await fetch(DOUBLETICK_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', Authorization: apiKey },
      body: JSON.stringify(payload),
    })
    const raw = await upstream.text()
    let body: unknown = raw
    try { body = raw ? JSON.parse(raw) : null } catch { body = raw.slice(0, 500) }
    if (!upstream.ok) return { status: 'send_failed', detail: body }
    return { status: 'sent', detail: { recipients: recipients.length } }
  } catch (error: unknown) {
    return { status: 'unreachable', detail: error instanceof Error ? error.message : 'unknown' }
  }
}

export default withRoute({ auth: 'cron', methods: ['GET', 'POST'], rateLimit: false },
  async (_req: VercelRequest, res: VercelResponse, ctx) => {
    // Read the findings first, so the run is legible in the Vercel logs even
    // on a day when every one of them was already notified.
    const { data: findings, error: checkError } = await ctx.sb.rpc('run_books_health_checks')
    if (checkError) {
      // Loudly: a health check that fails silently is indistinguishable from
      // healthy books, which is the exact fault this endpoint exists to end.
      return res.status(502).json({ error: 'health_check_failed', detail: checkError.message })
    }

    const rows = (findings ?? []) as HealthRow[]

    const { data: raised, error: notifyError } = await ctx.sb.rpc('notify_books_health')
    if (notifyError) {
      return res.status(502).json({
        error: 'notify_failed',
        detail: notifyError.message,
        // Report what was found even though the notification did not go out,
        // so the finding is not lost with the delivery.
        findings: rows,
      })
    }

    const critical = rows.filter((r) => r.severity === 'critical').length

    // Only when something is wrong. A daily "the books are fine" trains people
    // to swipe the message away, and then the one that matters gets swiped too.
    const whatsapp = rows.length > 0
      ? await whatsappFindings(rows)
      : { status: 'nothing_to_report' }

    console.log(
      `[books-health] ${rows.length} finding(s), ${critical} critical, ` +
        `${raised ?? 0} newly notified, whatsapp=${whatsapp.status}` +
        (rows.length ? `: ${rows.map((r) => r.detail).join(' | ')}` : ''),
    )

    // A send that was ATTEMPTED and failed is a fault worth a 502 — the finding
    // exists and nobody was told. Not-yet-configured is not a fault, and must
    // not turn every morning's run red while the template awaits approval.
    if (whatsapp.status === 'send_failed' || whatsapp.status === 'unreachable') {
      return res.status(502).json({
        error: 'whatsapp_delivery_failed',
        whatsapp,
        // The notification row was already written, so the finding survives
        // even though this alert did not.
        findings: rows.length,
        critical,
        notified: raised ?? 0,
        detail: rows,
      })
    }

    return res.status(200).json({
      ok: true,
      findings: rows.length,
      critical,
      notified: raised ?? 0,
      whatsapp: whatsapp.status,
      detail: rows,
    })
  })
