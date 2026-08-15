// Vercel Serverless Function: production Slack relay.
//
// The browser can't POST to a Slack webhook directly (no CORS), and the
// `/slack-proxy` Vite middleware only exists under `npm run dev`. This is the
// production equivalent: the page POSTs { text } here and we forward it
// server-side to SLACK_WEBHOOK_URL, keeping the webhook secret off the client.
//
// The Slack Workflow webhook variable key is literally "t-e-x-t" (with dashes),
// so the forwarded body MUST use that key — matches the dev middleware in
// vite.config.ts.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { withRoute } from './_middleware.js'

const WEBHOOK = process.env.SLACK_WEBHOOK_URL

// Staff-only: unauthenticated, this was an open relay for posting arbitrary
// text into the hospital's Slack under the hospital's own webhook.
export default withRoute({ auth: 'session', methods: ['POST'], rateLimit: { perMinute: 20 } },
  async (req: VercelRequest, res: VercelResponse) => {
  if (!WEBHOOK) {
    return res.status(500).json({ error: 'slack_not_configured', detail: 'SLACK_WEBHOOK_URL missing in Vercel env.' })
  }

  const text = typeof req.body?.text === 'string' ? req.body.text : ''
  if (!text.trim()) return res.status(400).json({ error: 'text required' })

  try {
    const upstream = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 't-e-x-t': text }),
    })
    return res.status(upstream.ok ? 200 : 502).json({ ok: upstream.ok, status: upstream.status })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown'
    return res.status(502).json({ error: 'slack_unreachable', detail: message })
  }
})
