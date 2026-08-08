import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0'
import { corsHeaders } from '../_shared/cors.ts'

// WhatsApp alert for money that left with no bill behind it.
//
// The rule is that a payment may only be made against a bill in the system.
// Tilak's tile lists every breach, but a large or ageing one should reach the
// management without waiting for someone to open a tile — so this sends those,
// once each, and stays silent otherwise.
//
// Deliberately narrow: only debits at or above the value threshold, or older
// than the age threshold. Not every exception is worth a message; these are.

const TEMPLATE_NAME = 'unbilled_payment_alert'
const AMOUNT_THRESHOLD = 10000
const AGE_HOURS = 48

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const DOUBLETICK_API_KEY = Deno.env.get('DOUBLETICK_API_KEY')
    if (!DOUBLETICK_API_KEY) throw new Error('DOUBLETICK_API_KEY not configured')

    // Who gets told. Editable in the database, so a number changes without a
    // deploy; the env var is only a fallback for a fresh environment.
    const { data: recipients } = await supabase
      .from('recon_alert_recipients')
      .select('phone, label')
      .eq('is_active', true)
    const phones: string[] = (recipients || []).map((r: any) => r.phone).filter(Boolean)
    if (phones.length === 0) {
      const fallback = (Deno.env.get('DIRECTOR_WHATSAPP_PHONES') || '')
        .split(',').map((s) => s.trim()).filter(Boolean)
      phones.push(...fallback)
    }
    if (phones.length === 0) {
      return new Response(JSON.stringify({ success: true, skipped: 'no recipients configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // What qualifies, and has not been sent before.
    const { data: due, error } = await supabase.rpc('unbilled_payments_to_alert', {
      p_min_amount: AMOUNT_THRESHOLD,
      p_min_age_hours: AGE_HOURS,
    })
    if (error) throw error
    const rows = (due || []) as Array<{
      id: string
      amount: number
      counterparty: string | null
      txn_date: string
      source_label: string
      source_holder: string | null
      days_old: number
    }>

    if (rows.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, reason: 'nothing over the threshold' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const total = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0)
    const lines = rows.slice(0, 5).map((r) =>
      `₹${Number(r.amount).toLocaleString('en-IN')} to ${r.counterparty || 'unnamed payee'} — ` +
      `${r.source_holder || r.source_label}, ${r.days_old === 0 ? 'today' : `${r.days_old}d ago`}`
    ).join('\n')
    const sentAt = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
    })

    const results: Array<{ phone: string; ok: boolean; detail?: string }> = []
    for (const phone of phones) {
      const response = await fetch('https://public.doubletick.io/whatsapp/message/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: DOUBLETICK_API_KEY },
        body: JSON.stringify({
          messages: [{
            to: phone,
            content: {
              templateName: TEMPLATE_NAME,
              language: 'en',
              templateData: {
                body: {
                  placeholders: [
                    String(rows.length),                     // {{1}} how many
                    total.toLocaleString('en-IN'),           // {{2}} total value
                    lines,                                   // {{3}} the first five
                    sentAt,                                  // {{4}} when this was sent
                  ],
                },
              },
            },
          }],
        }),
      })
      const ok = response.ok
      results.push({ phone, ok, detail: ok ? undefined : (await response.text()).slice(0, 200) })
    }

    // Mark them sent only if at least one message got through, so a DoubleTick
    // outage does not silently swallow the alert.
    if (results.some((r) => r.ok)) {
      await supabase.rpc('mark_unbilled_payments_alerted', { p_ids: rows.map((r) => r.id) })
    }

    return new Response(
      JSON.stringify({ success: true, exceptions: rows.length, total, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: String((error as Error)?.message || error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
