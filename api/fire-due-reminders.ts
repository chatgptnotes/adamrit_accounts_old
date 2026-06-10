// Exact-time reminder firer. Hit every ~15 minutes by a cron on the VPS (Vercel
// Hobby can't schedule sub-daily). Finds unpaid utility_deadlines whose
// notify_at has arrived and that haven't been sent yet, posts a one-off Slack
// alert for each, then stamps notify_sent_at so it never fires twice.
//
// This is the exact-time companion to the daily-digest cron (deadline-reminders).
// Security: if CRON_SECRET is set, the caller must send it as a Bearer token.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://xvkxccqaopbnkvwgyfjv.supabase.co'

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0)

interface DueRow {
  id: string
  name: string
  amount: number
  due_date: string
  hospital_type: string | null
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
  const nowIso = new Date().toISOString()

  const { data, error } = await supabase
    .from('utility_deadlines')
    .select('id, name, amount, due_date, hospital_type')
    .neq('status', 'paid')
    .not('notify_at', 'is', null)
    .is('notify_sent_at', null)
    .lte('notify_at', nowIso)
  if (error) return res.status(502).json({ error: 'db_query_failed', detail: error.message })

  const rows = (data ?? []) as DueRow[]
  if (rows.length === 0) return res.status(200).json({ ok: true, fired: 0, checked: 0 })

  const firedIds: string[] = []
  for (const r of rows) {
    const hosp = r.hospital_type ? ` _(${r.hospital_type})_` : ''
    const text = `⏰ Reminder: *${r.name}* — ${inr(Number(r.amount) || 0)} — due ${r.due_date}${hosp}`
    try {
      const resp = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 't-e-x-t': text }),
      })
      if (resp.ok) firedIds.push(r.id)
    } catch {
      /* best-effort: leave notify_sent_at null so the next run retries */
    }
  }

  if (firedIds.length) {
    await supabase.from('utility_deadlines').update({ notify_sent_at: nowIso }).in('id', firedIds)
  }

  return res.status(200).json({ ok: true, fired: firedIds.length, checked: rows.length })
}
