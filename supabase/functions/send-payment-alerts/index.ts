import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0'
import { corsHeaders } from '../_shared/cors.ts'

const ALERT_PHONE = '+919373111709'
const TEMPLATE_NAME = 'payment_alert'

interface AlertPayload {
  alert_type: 'receipt' | 'invoice' | 'discount'
  amount: number
  patient_name: string
  patient_id?: string
  visit_id?: string
  hospital_name?: string
  additional_info?: string
}

const ALERT_TITLES: Record<string, string> = {
  receipt: 'CASH RECEIPT',
  invoice: 'HIGH VALUE INVOICE',
  discount: 'LARGE DISCOUNT',
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
    if (!DOUBLETICK_API_KEY) {
      throw new Error('DOUBLETICK_API_KEY not configured')
    }

    const payload: AlertPayload = await req.json()
    const { alert_type, amount, patient_name, patient_id, visit_id, hospital_name, additional_info } = payload

    // Validate thresholds
    const thresholds: Record<string, number> = {
      receipt: 10000,
      invoice: 100000,
      discount: 33000,
    }

    if (amount < (thresholds[alert_type] || 0)) {
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'Below threshold' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build template placeholders
    const formattedAmount = amount.toLocaleString('en-IN')
    const now = new Date()
    const timeStr = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })

    const alertTitle = ALERT_TITLES[alert_type] || 'PAYMENT'
    const hospitalStr = hospital_name || 'Hope'
    const detailsStr = additional_info || (visit_id ? `Visit: ${visit_id}` : 'N/A')

    // Template placeholders: {{1}}=alert type, {{2}}=amount, {{3}}=patient, {{4}}=hospital, {{5}}=details, {{6}}=time
    const placeholders = [
      alertTitle,
      formattedAmount,
      patient_name || 'N/A',
      hospitalStr,
      detailsStr,
      timeStr,
    ]

    // Send via DoubleTick template message API (same pattern as send-admission-reminders)
    const apiUrl = 'https://public.doubletick.io/whatsapp/message/template'
    const dtPayload = {
      messages: [
        {
          to: ALERT_PHONE,
          content: {
            templateName: TEMPLATE_NAME,
            language: 'en',
            templateData: {
              body: {
                placeholders: placeholders,
              },
            },
          },
        },
      ],
    }

    // Also build a readable message string for logging
    const message = `${alertTitle} ALERT\nAmount: Rs. ${formattedAmount}\nPatient: ${patient_name}\nHospital: ${hospitalStr}\nDetails: ${detailsStr}\nTime: ${timeStr}`

    // Mirror into the in-app bell + phone push (the insert fires
    // trg_notifications_push). Event-driven — one call is one alert, so no
    // dedupe needed beyond the caller's own threshold gate above.
    await supabase.from('notifications').insert({
      notification_type: 'payment_alert',
      title: `${alertTitle} — ₹${formattedAmount}`,
      message: `${patient_name || 'N/A'} at ${hospitalStr}. ${detailsStr}`,
      recipient_user_id: null,
      recipient_role: 'all',
      hospital_name: hospital_name || null,
      patient_id: patient_id || null,
      patient_name: patient_name || null,
      visit_id: visit_id || null,
      source_table: 'payment_alerts',
      source_id: null,
      payload: { alert_type, amount },
    })

    console.log(`Sending ${alert_type} alert: Rs. ${formattedAmount} for ${patient_name}`)

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

    // Log to whatsapp_notifications table
    await supabase.from('whatsapp_notifications').insert({
      visit_id: visit_id || null,
      patient_id: patient_id || null,
      patient_name: patient_name,
      phone_number: ALERT_PHONE,
      message_content: message,
      template_name: `${TEMPLATE_NAME}_${alert_type}`,
      status: isSuccess ? 'sent' : 'failed',
      sent_at: isSuccess ? new Date().toISOString() : null,
      error_message: isSuccess ? null : JSON.stringify(responseData),
      doubletick_response: responseData,
    })

    return new Response(
      JSON.stringify({
        success: isSuccess,
        alert_type,
        amount,
        message: isSuccess ? 'Alert sent successfully' : 'Failed to send alert',
        response: responseData,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Payment alert error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
