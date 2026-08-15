// Vercel Serverless Function: relay Skill Factory chatbot prompts to the
// VPS Claude sidecar fronted by the existing `aiass` reverse-proxy.
//
// Keeps VPS_CLAUDE_TOKEN server-side. No fallback to any other LLM — upstream
// errors are surfaced verbatim with the same status code so the chatbot can
// show the real failure (per-decision: no silent degradation).

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { withRoute } from './_middleware.js'

const VPS_URL = process.env.VPS_CLAUDE_URL
const VPS_TOKEN = process.env.VPS_CLAUDE_TOKEN

// Staff-only: this runs an arbitrary prompt on the VPS sidecar and the tokens
// are billed to the hospital. It was previously open to anyone who knew the
// path. The per-minute ceiling is low because a single request here can be
// expensive and no legitimate screen fires them in bursts.
export default withRoute({ auth: 'session', methods: ['POST'], rateLimit: { perMinute: 10, perHour: 200 } },
  async (req: VercelRequest, res: VercelResponse) => {
  if (!VPS_URL || !VPS_TOKEN) {
    return res.status(500).json({
      error: 'vps_not_configured',
      detail: 'VPS_CLAUDE_URL or VPS_CLAUDE_TOKEN missing in Vercel env.',
    })
  }

  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt : ''
  if (!prompt.trim()) return res.status(400).json({ error: 'prompt required' })

  // Optional per-request model override (sonnet|opus|haiku). The sidecar
  // allowlists it; we just pass it through. Discharge-summary generation
  // sends 'opus'; the Skill Factory chatbot omits it (sidecar default sonnet).
  const model = typeof req.body?.model === 'string' ? req.body.model : undefined

  // Optional vision images: [{ base64, mimeType }]. The sidecar writes each to a
  // temp file and points the CLI's Read tool at it. Passed through as-is.
  const rawImages = Array.isArray(req.body?.images) ? req.body.images : []
  const images = rawImages
    .filter((i: any) => i && typeof i.base64 === 'string' && typeof i.mimeType === 'string')
    .map((i: any) => ({ base64: i.base64, mimeType: i.mimeType }))

  // Token-usage attribution: tag this call with the page that made it so the
  // sidecar's /usage report can break spend down per feature — without touching
  // any of the ~20 call sites. Same-origin fetches send the full page path in
  // Referer; fall back to an explicit body.feature, then 'unknown'.
  let feature = typeof req.body?.feature === 'string' ? req.body.feature : ''
  if (!feature) {
    try {
      feature = req.headers.referer ? new URL(req.headers.referer).pathname : ''
    } catch {
      feature = ''
    }
  }
  feature = (feature || 'unknown').slice(0, 80)

  let upstream: Response
  try {
    upstream = await fetch(VPS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VPS_TOKEN}`,
      },
      body: JSON.stringify({ prompt, feature, ...(model ? { model } : {}), ...(images.length ? { images } : {}) }),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown'
    return res.status(502).json({ error: 'vps_unreachable', detail: message })
  }

  const text = await upstream.text()
  res.status(upstream.status)
  const contentType = upstream.headers.get('content-type') || 'application/json'
  res.setHeader('content-type', contentType)
  res.send(text)
})
