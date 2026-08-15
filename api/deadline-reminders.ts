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
import { withRoute } from './_middleware.js'
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
  recipient_id: string | null
  important: boolean
}

// Build a Slack mention for a recipient row: real mention syntax when a Slack ID
// is wired (so it pings), else plain '@Name' fallback. Mirrors mentionFor() in
// src/lib/slackRecipients.ts (duplicated so the API has no src/ import).
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

// Scheduler-only. The old guard read `if (cronSecret && ...)`, so an unset
// CRON_SECRET left the route open to anyone — the one configuration where the
// check mattered most was the one where it did nothing. withRoute's 'cron' mode
// refuses when the secret is missing instead. CRON_SECRET must be set in Vercel
// or this returns 401 and the digest silently stops arriving.
export default withRoute({ auth: 'cron', methods: ['GET', 'POST'], rateLimit: false },
  async (req: VercelRequest, res: VercelResponse, ctx) => {
  const key = ctx.serviceKey
  const webhook = process.env.SLACK_WEBHOOK_URL
  if (!webhook) return res.status(500).json({ error: 'SLACK_WEBHOOK_URL not configured' })

  const supabase = createClient(SUPABASE_URL, key)
  const { data, error } = await supabase
    .from('utility_deadlines')
    .select('name, amount, due_date, status, hospital_type, recipient_id, important')
    .neq('status', 'paid')
  if (error) return res.status(502).json({ error: 'db_query_failed', detail: error.message })

  const today = istToday()
  const tomorrow = addDays(today, 1)
  const in2 = addDays(today, 2)

  const rows = (data ?? []) as DeadlineRow[]
  const relevant = rows.filter((r) => r.due_date < today || r.due_date === tomorrow || r.due_date === in2)

  // Nothing to report → don't post an empty digest.
  if (!relevant.length) {
    return res.status(200).json({ ok: true, posted: false, reason: 'no_due_or_overdue', today })
  }

  // Recipient mentions for addressed rows (with director flag), plus the full
  // set of active directors (MDs) — who get an important-only summary even if no
  // row is addressed to them.
  const recipientMap = new Map<string, { mention: string; is_director: boolean }>()
  const recipientIds = Array.from(new Set(relevant.map((r) => r.recipient_id).filter(Boolean))) as string[]
  if (recipientIds.length) {
    const { data: recips } = await supabase
      .from('slack_recipients')
      .select('id, name, slack_target, kind, is_director')
      .in('id', recipientIds)
    for (const rc of recips ?? []) recipientMap.set(rc.id, { mention: mentionFor(rc), is_director: !!rc.is_director })
  }
  const { data: directorRows } = await supabase
    .from('slack_recipients')
    .select('id, name, slack_target, kind')
    .eq('is_director', true)
    .eq('active', true)
  const directors = (directorRows ?? []).map((rc) => ({ mention: mentionFor(rc) }))

  const buildText = (groupRows: DeadlineRow[], header: string): string => {
    const overdue = groupRows.filter((r) => r.due_date < today)
    const dueTomorrow = groupRows.filter((r) => r.due_date === tomorrow)
    const dueIn2 = groupRows.filter((r) => r.due_date === in2)
    const lines: string[] = [header, '']
    lines.push(...section('Overdue', overdue))
    lines.push(...section('Due tomorrow', dueTomorrow))
    lines.push(...section('Due in 2 days', dueIn2))
    while (lines[lines.length - 1] === '') lines.pop()
    return lines.join('\n')
  }

  const post = async (text: string): Promise<boolean> => {
    try {
      const r = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 't-e-x-t': text }),
      })
      return r.ok
    } catch {
      return false
    }
  }

  let posted = 0
  let failed = 0

  // ── Regular per-recipient digests ──
  // Directors are excluded here (they get the important-only summary below);
  // their routine rows fold into the shared bucket so they're recorded without
  // pinging the MD.
  const groups = new Map<string | null, DeadlineRow[]>()
  for (const r of relevant) {
    const rec = r.recipient_id ? recipientMap.get(r.recipient_id) : undefined
    const groupKey = rec && !rec.is_director ? r.recipient_id : null
    const arr = groups.get(groupKey) ?? []
    arr.push(r)
    groups.set(groupKey, arr)
  }
  for (const [groupKey, groupRows] of Array.from(groups.entries())) {
    const mention = groupKey ? recipientMap.get(groupKey)?.mention ?? null : null
    const header = mention
      ? `*${mention} — ⏰ Deadline reminders — ${today}*`
      : `*⏰ Deadline reminders — ${today}*`
    if (await post(buildText(groupRows, header))) posted++
    else failed++
  }

  // ── Director (MD) important-only summary ──
  // Every active director gets the same hospital-wide "important" briefing.
  const importantRows = relevant.filter((r) => isImportant(r, today))
  if (importantRows.length) {
    for (const d of directors) {
      const header = `*${d.mention} — ⭐ Important — ${today}*`
      if (await post(buildText(importantRows, header))) posted++
      else failed++
    }
  }

  return res.status(failed && !posted ? 502 : 200).json({
    ok: posted > 0,
    posted,
    failed,
    directors: directors.length,
    important: importantRows.length,
    today,
  })
})
