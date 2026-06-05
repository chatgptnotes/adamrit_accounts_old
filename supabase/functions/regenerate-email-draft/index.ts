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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { email_id, feedback } = await req.json() as { email_id: string; feedback?: string }

    if (!email_id) {
      return new Response(JSON.stringify({ error: 'email_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Fetch the email to regenerate for
    const { data: email, error: emailErr } = await supabase
      .from('email_inbox')
      .select('from_name, from_email, subject, body_preview, category, urgency')
      .eq('id', email_id)
      .single()

    if (emailErr || !email) {
      return new Response(JSON.stringify({ error: 'Email not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch last 5 approved replies as format reference
    const { data: approvedExamples } = await supabase
      .from('email_inbox')
      .select('subject, draft_reply')
      .eq('status', 'approved')
      .not('draft_reply', 'is', null)
      .order('approved_at', { ascending: false })
      .limit(5)

    const formatSection = (approvedExamples ?? []).length > 0
      ? '\n\nPreviously approved reply formats (match this tone and structure):\n' +
        (approvedExamples ?? []).map((e, i) =>
          `--- Example ${i + 1} ---\nSubject: ${e.subject}\nReply: ${e.draft_reply}`
        ).join('\n\n')
      : ''

    const feedbackNote = feedback?.trim()
      ? `\n\nHuman feedback for this draft: "${feedback.trim()}"`
      : ''

    // Call Claude for a fresh draft
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: SYSTEM_PROMPT + formatSection,
        messages: [{
          role: 'user',
          content: `Draft a reply to this email. Return ONLY the reply body text — no subject line, start directly with greeting.

Category: ${email.category ?? 'general'}
Urgency: ${email.urgency ?? 'low'}
From: ${email.from_name ?? email.from_email} <${email.from_email}>
Subject: ${email.subject}
Message preview: ${email.body_preview ?? ''}${feedbackNote}`
        }]
      })
    })

    const aiData = await anthropicRes.json()
    const newDraft: string = (aiData.content?.[0]?.text ?? '').trim()

    if (!newDraft) {
      return new Response(JSON.stringify({ error: 'AI returned empty draft' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Update the draft in DB
    await supabase
      .from('email_inbox')
      .update({ draft_reply: newDraft })
      .eq('id', email_id)

    return new Response(
      JSON.stringify({ draft_reply: newDraft }),
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
