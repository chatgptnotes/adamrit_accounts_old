import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0'
import { corsHeaders } from '../_shared/cors.ts'

const SYSTEM_PROMPT = `You are a professional billing email assistant for Hope Hospital billing department.
Guidelines:
- Always maintain a professional, empathetic, and helpful tone.
- For document requests (bill copy, discharge summary, insurance letter): acknowledge and say it will be shared within 24 hours.
- For corporate billing queries: acknowledge receipt and say the corporate billing team will follow up within 1 business day.
- For approval requests: acknowledge and say it will be reviewed by the billing manager.
- Never share other patients' information.
- Sign off as "Hope Hospital Billing Team".
- Keep replies concise — 3 to 6 sentences.`

async function getAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Gmail token error: ${JSON.stringify(data)}`)
  return data.access_token
}

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function decodeBase64Url(data: string): string {
  try {
    return atob(data.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return ''
  }
}

function extractTextBody(payload: Record<string, unknown>): string {
  const body = payload.body as { data?: string } | undefined
  if (body?.data) return decodeBase64Url(body.data)

  const parts = payload.parts as Array<Record<string, unknown>> | undefined
  if (parts) {
    for (const part of parts) {
      if (part.mimeType === 'text/plain') {
        const pb = part.body as { data?: string } | undefined
        if (pb?.data) return decodeBase64Url(pb.data)
      }
    }
    for (const part of parts) {
      if (part.mimeType === 'text/html') {
        const pb = part.body as { data?: string } | undefined
        if (pb?.data) return decodeBase64Url(pb.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      }
    }
  }
  return ''
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Get Gmail access token
    const accessToken = await getAccessToken(
      Deno.env.get('GMAIL_CLIENT_ID')!,
      Deno.env.get('GMAIL_CLIENT_SECRET')!,
      Deno.env.get('GMAIL_REFRESH_TOKEN')!,
    )

    // Fetch unread emails
    const listRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=20',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const listData = await listRes.json()
    const messages: Array<{ id: string }> = listData.messages ?? []

    // Fetch last 5 approved draft replies as format examples
    const { data: approvedExamples } = await supabase
      .from('email_inbox')
      .select('subject, draft_reply')
      .eq('status', 'approved')
      .not('draft_reply', 'is', null)
      .order('approved_at', { ascending: false })
      .limit(5)

    const formatSection = (approvedExamples ?? []).length > 0
      ? '\n\nPreviously approved reply formats (use similar tone and structure):\n' +
        (approvedExamples ?? []).map((e, i) =>
          `--- Example ${i + 1} ---\nSubject: ${e.subject}\nReply: ${e.draft_reply}`
        ).join('\n\n')
      : ''

    const today = new Date().toISOString().split('T')[0]
    let saved = 0
    let skipped = 0

    for (const msg of messages) {
      // Fetch full message
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const msgData = await msgRes.json()

      const headers: Array<{ name: string; value: string }> = (msgData.payload as Record<string, unknown>)?.headers as Array<{ name: string; value: string }> ?? []
      const subject = getHeader(headers, 'Subject') || '(no subject)'
      const fromHeader = getHeader(headers, 'From')
      const fromEmail = fromHeader.match(/<(.+)>/)?.[1] ?? fromHeader.trim()
      const fromName = fromHeader.match(/^([^<]+)/)?.[1]?.trim() ?? fromEmail

      // Dedup: skip if same from_email + subject already exists today
      const { count } = await supabase
        .from('email_inbox')
        .select('id', { count: 'exact', head: true })
        .eq('from_email', fromEmail)
        .eq('subject', subject)
        .eq('check_date', today)

      if ((count ?? 0) > 0) { skipped++; continue }

      const body = extractTextBody(msgData.payload as Record<string, unknown>)
      const bodyPreview = body.slice(0, 400)

      // Single Claude call: classify + draft
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 600,
          system: SYSTEM_PROMPT + formatSection,
          messages: [{
            role: 'user',
            content: `Analyze this email and return ONLY a JSON object (no markdown, no extra text):
{
  "category": one of ["billing", "corporate", "tpa", "general", "urgent"],
  "urgency": one of ["high", "medium", "low"],
  "draft_reply": "your complete draft reply text here"
}

From: ${fromName} <${fromEmail}>
Subject: ${subject}
Message: ${body.slice(0, 1200)}`
          }]
        })
      })

      const aiData = await anthropicRes.json()
      const aiText: string = (aiData.content?.[0]?.text ?? '').trim()

      let category = 'general'
      let urgency = 'low'
      let draftReply = ''

      try {
        const match = aiText.match(/\{[\s\S]*\}/)
        if (match) {
          const parsed = JSON.parse(match[0])
          const allowed = ['billing', 'corporate', 'tpa', 'appointment', 'general', 'urgent']
          category = allowed.includes(parsed.category) ? parsed.category : 'general'
          urgency = ['high', 'medium', 'low'].includes(parsed.urgency) ? parsed.urgency : 'low'
          draftReply = parsed.draft_reply ?? ''
        }
      } catch {
        // keep defaults
      }

      await supabase.from('email_inbox').insert({
        from_email: fromEmail,
        from_name: fromName,
        subject,
        body_preview: bodyPreview,
        category,
        urgency,
        draft_reply: draftReply,
        status: 'pending',
        check_date: today,
        // check_run intentionally NULL — manual trigger, not scheduled run
      })

      saved++
    }

    return new Response(
      JSON.stringify({ fetched: messages.length, saved, skipped }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
