// Vercel Serverless Function: read-only token-spend report for the VPS Claude
// sidecar(s). Pulls each sidecar's bearer-protected GET /usage and returns the
// per-sidecar detail status (all-time / today / this-month, per-model,
// per-feature) plus a combined roll-up.
//
// Keeps VPS_CLAUDE_TOKEN server-side, same as api/skill-factory-claude.ts.
//
// Config:
//   VPS_CLAUDE_USAGE_URL  — comma-separated list of public /usage URLs, one per
//                           sidecar you want tracked. If unset, it is derived
//                           from VPS_CLAUDE_URL by swapping the final `claude`
//                           path segment for `usage` (works when you add an
//                           nginx location that proxies …-usage → 127.0.0.1:<port>/usage).
//   VPS_CLAUDE_TOKEN      — bearer token the sidecars expect.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { withRoute } from './_middleware.js'

const VPS_URL = process.env.VPS_CLAUDE_URL
const VPS_TOKEN = process.env.VPS_CLAUDE_TOKEN
const USAGE_URLS_RAW = process.env.VPS_CLAUDE_USAGE_URL

function deriveUsageUrl(claudeUrl: string): string {
  // …/adamrit-claude  →  …/adamrit-usage     (replace the last 'claude' once)
  return claudeUrl.replace(/claude(?!.*claude)/, 'usage')
}

function emptyTotals() {
  return {
    calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    total_tokens: 0,
    total_cost_usd: 0,
  }
}
function addInto(acc: Record<string, number>, t: Record<string, number>) {
  for (const k of Object.keys(acc)) acc[k] += Number(t?.[k]) || 0
}

// Staff-only. It reports what the hospital is spending on AI; that is nobody
// else's business, and the sidecar URLs it names are not public either.
export default withRoute({ auth: 'session', methods: ['GET'] },
  async (req: VercelRequest, res: VercelResponse) => {
  if (!VPS_TOKEN || (!USAGE_URLS_RAW && !VPS_URL)) {
    return res.status(500).json({
      error: 'vps_not_configured',
      detail: 'Set VPS_CLAUDE_USAGE_URL (or VPS_CLAUDE_URL) and VPS_CLAUDE_TOKEN in Vercel env.',
    })
  }

  const urls = (USAGE_URLS_RAW
    ? USAGE_URLS_RAW.split(',')
    : [deriveUsageUrl(VPS_URL as string)]
  ).map((u) => u.trim()).filter(Boolean)

  const sidecars = await Promise.all(
    urls.map(async (url) => {
      try {
        const r = await fetch(url, {
          headers: { Authorization: `Bearer ${VPS_TOKEN}` },
        })
        const text = await r.text()
        if (!r.ok) return { url, ok: false, status: r.status, error: text.slice(0, 500) }
        return { url, ok: true, status: r.status, ...JSON.parse(text) }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown'
        return { url, ok: false, error: message }
      }
    }),
  )

  // Combined roll-up across every reachable sidecar.
  const combined = {
    all_time: emptyTotals(),
    today: emptyTotals(),
    this_month: emptyTotals(),
  }
  for (const s of sidecars) {
    if (!s.ok) continue
    addInto(combined.all_time, (s as any).all_time)
    addInto(combined.today, (s as any).today)
    addInto(combined.this_month, (s as any).this_month)
  }

  res.status(200).json({ generated_at: new Date().toISOString(), combined, sidecars })
})
