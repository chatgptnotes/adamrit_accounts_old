// Vercel Cron job: daily deadline reminder → Slack.
//
// Runs server-side every morning (see the cron entry in vercel.json), finds
// unpaid utility-bill deadlines that are overdue, due tomorrow, or due in 2
// days, and posts a digest straight to SLACK_WEBHOOK_URL. This is the server
// equivalent of the in-app Slack action — the browser-only notifyUtilitySlack
// can't run on a schedule, so deadline reminders live here instead.
//
// Security: if CRON_SECRET is set in Vercel, the cron invocation must carry it
// as a Bearer token (Vercel adds this automatically). Without CRON_SECRET the
// endpoint is open — set one to lock it down.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://xvkxccqaopbnkvwgyfjv.supabase.co'

// IST (UTC+5:30) "today" as YYYY-MM-DD — deadlines are stored as plain dates,
// so we compare in the hospital's local timezone, not UTC.
function istToday(): string {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000)
  return ist.toISOString().slice(0, 10)
}
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}
const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0)

interface DeadlineRow {
  name: string
  amount: number
  due_date: string
  status: string
  hospital_type: string | null
}

function section(title: string, rows: DeadlineRow[]): string[] {
  if (!rows.length) return []
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const lines = [`*${title} (${rows.length}) — ${inr(total)}*`]
  for (const r of rows) {
    const hosp = r.hospital_type ? ` _(${r.hospital_type})_` : ''
    lines.push(`• ${r.name} — ${inr(Number(r.amount) || 0)} — due ${r.due_date}${hosp}`)
  }
  lines.push('')
  return lines
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const webhook = process.env.SLACK_WEBHOOK_URL
  if (!webhook) return res.status(500).json({ error: 'SLACK_WEBHOOK_URL not configured' })

  const supabase = createClient(SUPABASE_URL, key)
  const { data, error } = await supabase
    .from('utility_deadlines')
    .select('name, amount, due_date, status, hospital_type')
    .neq('status', 'paid')
  if (error) return res.status(502).json({ error: 'db_query_failed', detail: error.message })

  const today = istToday()
  const tomorrow = addDays(today, 1)
  const in2 = addDays(today, 2)

  const rows = (data ?? []) as DeadlineRow[]
  const overdue = rows.filter((r) => r.due_date < today)
  const dueTomorrow = rows.filter((r) => r.due_date === tomorrow)
  const dueIn2 = rows.filter((r) => r.due_date === in2)

  // Nothing to report → don't post an empty digest.
  if (!overdue.length && !dueTomorrow.length && !dueIn2.length) {
    return res.status(200).json({ ok: true, posted: false, reason: 'no_due_or_overdue', today })
  }

  const lines: string[] = [`*⏰ Deadline reminders — ${today}*`, '']
  lines.push(...section('Overdue', overdue))
  lines.push(...section('Due tomorrow', dueTomorrow))
  lines.push(...section('Due in 2 days', dueIn2))
  while (lines[lines.length - 1] === '') lines.pop()
  const text = lines.join('\n')

  try {
    const r = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 't-e-x-t': text }),
    })
    return res.status(r.ok ? 200 : 502).json({
      ok: r.ok,
      posted: r.ok,
      counts: { overdue: overdue.length, dueTomorrow: dueTomorrow.length, dueIn2: dueIn2.length },
      today,
    })
  } catch (err: unknown) {
    return res.status(502).json({ error: 'slack_unreachable', detail: err instanceof Error ? err.message : 'unknown' })
  }
}
