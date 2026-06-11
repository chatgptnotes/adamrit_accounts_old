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
  recipient_id: string | null
  important: boolean
}

// Build a Slack mention for a recipient row: real mention syntax when a Slack ID
// is wired (so it pings), else plain '@Name' fallback. Mirrors mentionFor() in
// src/lib/slackRecipients.ts (duplicated here so the API has no src/ import).
function mentionFor(r: { name: string; slack_target: string | null; kind: string }): string {
  if (!r.slack_target) return `@${r.name}`
  return r.kind === 'channel' ? `<#${r.slack_target}>` : `<@${r.slack_target}>`
}

// Whether a reminder is MD-level. Mirrors src/lib/reminderImportance.ts.
const IMPORTANT_AMOUNT_THRESHOLD = 100_000
function isImportant(r: { important?: boolean; amount?: number; due_date?: string }, today: string): boolean {
  if (r.important) return true
  if ((Number(r.amount) || 0) >= IMPORTANT_AMOUNT_THRESHOLD) return true
  if (r.due_date && r.due_date < today) return true
  return false
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
    .select('id, name, amount, due_date, hospital_type, recipient_id, important')
    .neq('status', 'paid')
    .not('notify_at', 'is', null)
    .is('notify_sent_at', null)
    .lte('notify_at', nowIso)
  if (error) return res.status(502).json({ error: 'db_query_failed', detail: error.message })

  const rows = (data ?? []) as DueRow[]
  if (rows.length === 0) return res.status(200).json({ ok: true, fired: 0, checked: 0 })

  // Resolve recipient_id → mention + director flag. A director (MD) is only
  // pinged for IMPORTANT items; routine items addressed to them post without the
  // mention so they don't get bothered.
  const recipientMap = new Map<string, { mention: string; is_director: boolean }>()
  const recipientIds = Array.from(new Set(rows.map((r) => r.recipient_id).filter(Boolean))) as string[]
  if (recipientIds.length) {
    const { data: recips } = await supabase
      .from('slack_recipients')
      .select('id, name, slack_target, kind, is_director')
      .in('id', recipientIds)
    for (const rc of recips ?? []) recipientMap.set(rc.id, { mention: mentionFor(rc), is_director: !!rc.is_director })
  }

  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10) // IST

  const firedIds: string[] = []
  for (const r of rows) {
    const hosp = r.hospital_type ? ` _(${r.hospital_type})_` : ''
    const imp = isImportant(r, today)
    const rec = r.recipient_id ? recipientMap.get(r.recipient_id) : undefined
    // Skip the mention for a director on a routine item (don't ping the MD).
    const who = rec ? (rec.is_director && !imp ? null : rec.mention) : null
    const star = imp ? '⭐ ' : ''
    const text = `${who ? who + ' ' : ''}${star}⏰ Reminder: *${r.name}* — ${inr(Number(r.amount) || 0)} — due ${r.due_date}${hosp}`
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
