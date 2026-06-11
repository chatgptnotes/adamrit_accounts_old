// Vercel Serverless Function: relay Skill Factory chatbot prompts to the
// VPS Claude sidecar fronted by the existing `aiass` reverse-proxy.
//
// Keeps VPS_CLAUDE_TOKEN server-side. No fallback to any other LLM — upstream
// errors are surfaced verbatim with the same status code so the chatbot can
// show the real failure (per-decision: no silent degradation).

import type { VercelRequest, VercelResponse } from '@vercel/node'

const VPS_URL = process.env.VPS_CLAUDE_URL
const VPS_TOKEN = process.env.VPS_CLAUDE_TOKEN

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }
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

  let upstream: Response
  try {
    upstream = await fetch(VPS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VPS_TOKEN}`,
      },
      body: JSON.stringify({ prompt, ...(model ? { model } : {}), ...(images.length ? { images } : {}) }),
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
}
