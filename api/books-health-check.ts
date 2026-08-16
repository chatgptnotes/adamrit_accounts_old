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

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { withRoute } from './_middleware.js'

interface HealthRow {
  check_name: string
  severity: string
  detail: string
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
    console.log(
      `[books-health] ${rows.length} finding(s), ${critical} critical, ${raised ?? 0} newly notified` +
        (rows.length ? `: ${rows.map((r) => r.detail).join(' | ')}` : ''),
    )

    return res.status(200).json({
      ok: true,
      findings: rows.length,
      critical,
      notified: raised ?? 0,
      detail: rows,
    })
  })
