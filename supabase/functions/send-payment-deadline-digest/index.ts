import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0'
import { corsHeaders } from '../_shared/cors.ts'

const TEMPLATE_NAME = 'payment_deadline_digest'

interface PaymentDeadline {
  id: string
  service_name: string
  amount: number
  due_date: string
  status: 'pending' | 'paid' | 'overdue'
  hospital_type: string
  notes?: string | null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const DOUBLETICK_API_KEY = Deno.env.get('DOUBLETICK_API_KEY')
    if (!DOUBLETICK_API_KEY) throw new Error('DOUBLETICK_API_KEY not configured')

    // Director phone(s): comma-separated env var, fallback to known admin numbers
    const phonesRaw = Deno.env.get('DIRECTOR_WHATSAPP_PHONES') || '+919373111709,+919822202396'
    const directorPhones = phonesRaw.split(',').map(p => p.trim()).filter(Boolean)

    // Fetch all unpaid deadlines
    const now = new Date()
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const in7DaysStr = in7Days.toISOString().split('T')[0]

    const { data: deadlines, error } = await supabase
      .from('payment_deadlines')
      .select('*')
      .neq('status', 'paid')
      .lte('due_date', in7DaysStr)
      .order('due_date', { ascending: true })
      .returns<PaymentDeadline[]>()

    if (error) throw error
    if (!deadlines || deadlines.length === 0) {
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'No deadlines due or overdue' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Bucket
    const overdue = deadlines.filter(d => new Date(d.due_date) < now)
    const dueSoon = deadlines.filter(d => new Date(d.due_date) >= now)
    const total = deadlines.reduce((sum, d) => sum + Number(d.amount), 0)

    // Top items (max 3) — most overdue first, then soonest due
    const topItems = [...overdue, ...dueSoon].slice(0, 3)
      .map(d => `• ${d.service_name} – ₹${Number(d.amount).toLocaleString('en-IN')} (${new Date(d.due_date).toLocaleDateString('en-IN')})`)
      .join('\n')

    const hospitals = [...new Set(deadlines.map(d => d.hospital_type))].join(', ') || 'Hope'
    const timeStr = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })

    // Template placeholders: {{1}}=overdue count, {{2}}=due-soon count, {{3}}=total, {{4}}=top items, {{5}}=hospital, {{6}}=time
    const placeholders = [
      String(overdue.length),
      String(dueSoon.length),
      total.toLocaleString('en-IN'),
      topItems,
      hospitals,
      timeStr,
    ]

    // Mirror the digest into the in-app bell + phone push (the notifications
    // insert fires trg_notifications_push). One shared row per calendar day —
    // the cron runs daily, but a manual re-run must not re-buzz the phones.
    const todayStr = now.toISOString().split('T')[0]
    const { data: existingDigest } = await supabase
      .from('notifications')
      .select('id')
      .eq('notification_type', 'payment_deadline_due')
      .gte('created_at', `${todayStr}T00:00:00Z`)
      .limit(1)
    if (!existingDigest || existingDigest.length === 0) {
      await supabase.from('notifications').insert({
        notification_type: 'payment_deadline_due',
        title: 'Payment deadlines',
        message: `${overdue.length} overdue, ${dueSoon.length} due within 7 days — total ₹${total.toLocaleString('en-IN')}.\n${topItems}`,
        recipient_user_id: null,
        recipient_role: 'all',
        source_table: 'payment_deadlines',
        source_id: todayStr,
        payload: { overdue: overdue.length, due_soon: dueSoon.length, total_amount: total },
      })
    }

    const apiUrl = 'https://public.doubletick.io/whatsapp/message/template'
    const results: Array<{ phone: string; success: boolean; response: unknown }> = []

    for (const phone of directorPhones) {
      const dtPayload = {
        messages: [{
          to: phone,
          content: {
            templateName: TEMPLATE_NAME,
            language: 'en',
            templateData: { body: { placeholders } },
          },
        }],
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': DOUBLETICK_API_KEY,
          'accept': 'application/json',
        },
        body: JSON.stringify(dtPayload),
      })

      const responseData = await response.json()
      const isSuccess = responseData.messages?.[0]?.status === 'ENQUEUED'
      results.push({ phone, success: isSuccess, response: responseData })

      // Build readable log message
      const logMessage = `PAYMENT DEADLINE DIGEST – ${hospitals}\n` +
        `${overdue.length} overdue | ${dueSoon.length} due in 7 days\n` +
        `Total: ₹${total.toLocaleString('en-IN')}\n\n` +
        `Top items:\n${topItems}\n\nSent: ${timeStr}`

      await supabase.from('whatsapp_notifications').insert({
        patient_id: null,
        visit_id: null,
        patient_name: 'Director Digest',
        phone_number: phone,
        message_content: logMessage,
        template_name: TEMPLATE_NAME,
        status: isSuccess ? 'sent' : 'failed',
        sent_at: isSuccess ? new Date().toISOString() : null,
        error_message: isSuccess ? null : JSON.stringify(responseData),
        doubletick_response: responseData,
      })
    }

    return new Response(
      JSON.stringify({
        success: results.every(r => r.success),
        deadline_count: deadlines.length,
        overdue: overdue.length,
        due_soon: dueSoon.length,
        total_amount: total,
        recipients: results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Payment deadline digest error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
