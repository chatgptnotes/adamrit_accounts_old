import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0'
import { corsHeaders } from '../_shared/cors.ts'

interface RequestBody {
  type: 'billing_summary' | 'payment_reminder' | 'custom'
  month?: string           // e.g. "June 2026"
  corporateIds?: string[]  // if empty/missing → send to ALL corporates
  subject?: string         // for custom type
  body?: string            // for custom type (plain text)
}

interface Corporate {
  id: string
  name: string
  email: string | null
  contact_person: string | null
}

function currentMonthLabel(): string {
  return new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

function formatCurrency(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} Lakh`
  return `₹${n.toLocaleString('en-IN')}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendKey  = Deno.env.get('RESEND_API_KEY')
    const fromEmail  = Deno.env.get('FROM_EMAIL') ?? 'billing@hopehospital.com'

    if (!resendKey) {
      return new Response(
        JSON.stringify({ error: 'RESEND_API_KEY not configured. Add it in Supabase project secrets.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseKey)
    const payload: RequestBody = req.method === 'POST' ? await req.json() : { type: 'billing_summary' }
    const { type, month, corporateIds, subject: customSubject, body: customBody } = payload
    const monthLabel = month ?? currentMonthLabel()

    // 1. Fetch corporates
    let query = supabase.from('corporate').select('id, name, email, contact_person')
    if (corporateIds && corporateIds.length > 0) {
      query = query.in('id', corporateIds)
    }
    const { data: corporates, error: corpErr } = await query
    if (corpErr) throw corpErr

    const results = { sent: 0, failed: 0, skipped: 0 }
    const logs: Array<{
      recipient: string; corporate_name: string; subject: string;
      template_type: string; status: string; resend_id?: string; error_message?: string
    }> = []

    for (const corp of (corporates as Corporate[]) ?? []) {
      if (!corp.email) { results.skipped++; continue }

      let emailSubject = ''
      let emailHtml = ''

      if (type === 'billing_summary') {
        // Fetch total billing for this corporate this month
        const monthStart = new Date()
        monthStart.setDate(1)
        const startStr = monthStart.toISOString().split('T')[0]
        const endStr   = new Date().toISOString().split('T')[0]

        const { data: patients } = await supabase
          .from('patients').select('id').eq('corporate', corp.name)
        const patientIds = (patients ?? []).map((p: { id: string }) => p.id)

        let totalBilled = 0
        let billCount   = 0
        if (patientIds.length > 0) {
          const { data: bills } = await supabase
            .from('bills').select('total_amount')
            .in('patient_id', patientIds)
            .gte('date', startStr).lte('date', endStr)
          totalBilled = (bills ?? []).reduce((s: number, b: { total_amount: number | null }) => s + (b.total_amount ?? 0), 0)
          billCount   = bills?.length ?? 0
        }

        emailSubject = `Monthly Billing Summary – ${monthLabel} | Hope Hospital`
        emailHtml = buildBillingSummaryHtml(corp.contact_person ?? corp.name, corp.name, monthLabel, billCount, totalBilled)

      } else if (type === 'payment_reminder') {
        // Fetch outstanding amount for this corporate
        const { data: patients } = await supabase
          .from('patients').select('id').eq('corporate', corp.name)
        const patientIds = (patients ?? []).map((p: { id: string }) => p.id)

        let outstanding = 0
        let pendingCount = 0
        if (patientIds.length > 0) {
          const { data: bills } = await supabase
            .from('bills').select('total_amount')
            .in('patient_id', patientIds)
            .not('status', 'eq', 'Received')
          outstanding  = (bills ?? []).reduce((s: number, b: { total_amount: number | null }) => s + (b.total_amount ?? 0), 0)
          pendingCount = bills?.length ?? 0
        }

        if (outstanding === 0) { results.skipped++; continue } // skip if nothing outstanding

        emailSubject = `Payment Reminder – Outstanding Dues | ${corp.name}`
        emailHtml = buildPaymentReminderHtml(corp.contact_person ?? corp.name, corp.name, pendingCount, outstanding)

      } else {
        // custom
        emailSubject = customSubject ?? `Message from Hope Hospital`
        emailHtml = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
          <p>Dear ${corp.contact_person ?? corp.name},</p>
          <div style="white-space:pre-wrap">${customBody ?? ''}</div>
          <p style="margin-top:24px">Regards,<br><strong>Hope Hospital – Billing Team</strong></p>
        </div>`
      }

      // 2. Send via Resend
      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: `Hope Hospital Billing <${fromEmail}>`,
            to: [corp.email],
            subject: emailSubject,
            html: emailHtml,
          }),
        })

        if (resendRes.ok) {
          const resendData = await resendRes.json()
          results.sent++
          logs.push({ recipient: corp.email, corporate_name: corp.name, subject: emailSubject, template_type: type, status: 'sent', resend_id: resendData.id })
        } else {
          const errText = await resendRes.text()
          results.failed++
          logs.push({ recipient: corp.email, corporate_name: corp.name, subject: emailSubject, template_type: type, status: 'failed', error_message: errText })
        }
      } catch (sendErr) {
        results.failed++
        logs.push({ recipient: corp.email, corporate_name: corp.name, subject: emailSubject, template_type: type, status: 'failed', error_message: String(sendErr) })
      }
    }

    // 3. Log all sends to email_logs
    if (logs.length > 0) {
      await supabase.from('email_logs').insert(logs)
    }

    return new Response(
      JSON.stringify({ success: true, ...results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ── Email HTML templates ────────────────────────────────────────────────────

function buildBillingSummaryHtml(contact: string, company: string, month: string, billCount: number, total: number): string {
  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:0">
  <div style="background:#1d4ed8;padding:24px 32px">
    <h1 style="color:white;margin:0;font-size:20px">Hope Hospital</h1>
    <p style="color:#bfdbfe;margin:4px 0 0;font-size:13px">Billing Department</p>
  </div>
  <div style="padding:32px;background:#f8fafc">
    <p style="margin:0 0 16px;color:#374151">Dear <strong>${contact}</strong>,</p>
    <p style="color:#374151">Please find below the billing summary for <strong>${company}</strong> for the month of <strong>${month}</strong>.</p>
    <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:24px;margin:20px 0">
      <table style="width:100%;border-collapse:collapse">
        <tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:10px 0;color:#6b7280;font-size:14px">Month</td>
          <td style="padding:10px 0;text-align:right;font-weight:600;color:#111827">${month}</td>
        </tr>
        <tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:10px 0;color:#6b7280;font-size:14px">Total Bills Generated</td>
          <td style="padding:10px 0;text-align:right;font-weight:600;color:#111827">${billCount}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#6b7280;font-size:14px">Total Amount</td>
          <td style="padding:10px 0;text-align:right;font-weight:700;color:#1d4ed8;font-size:18px">${formatCurrency(total)}</td>
        </tr>
      </table>
    </div>
    <p style="color:#6b7280;font-size:13px">For queries, contact our billing desk or reply to this email.</p>
    <p style="margin-top:24px;color:#374151">Warm regards,<br><strong>Hope Hospital – Corporate Billing Team</strong></p>
  </div>
  <div style="background:#f3f4f6;padding:16px 32px;text-align:center">
    <p style="color:#9ca3af;font-size:11px;margin:0">This is an automated email. Please do not reply directly.</p>
  </div>
</div>`
}

function buildPaymentReminderHtml(contact: string, company: string, pendingCount: number, outstanding: number): string {
  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:0">
  <div style="background:#dc2626;padding:24px 32px">
    <h1 style="color:white;margin:0;font-size:20px">Hope Hospital</h1>
    <p style="color:#fecaca;margin:4px 0 0;font-size:13px">Payment Reminder</p>
  </div>
  <div style="padding:32px;background:#f8fafc">
    <p style="margin:0 0 16px;color:#374151">Dear <strong>${contact}</strong>,</p>
    <p style="color:#374151">This is a gentle reminder regarding outstanding dues for <strong>${company}</strong> with Hope Hospital.</p>
    <div style="background:white;border:2px solid #fee2e2;border-radius:8px;padding:24px;margin:20px 0">
      <table style="width:100%;border-collapse:collapse">
        <tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:10px 0;color:#6b7280;font-size:14px">Pending Bills</td>
          <td style="padding:10px 0;text-align:right;font-weight:600;color:#111827">${pendingCount}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#6b7280;font-size:14px">Outstanding Amount</td>
          <td style="padding:10px 0;text-align:right;font-weight:700;color:#dc2626;font-size:18px">${formatCurrency(outstanding)}</td>
        </tr>
      </table>
    </div>
    <p style="color:#374151">Kindly arrange payment at the earliest to avoid any disruption in empanelled services.</p>
    <p style="margin-top:24px;color:#374151">Regards,<br><strong>Hope Hospital – Accounts Team</strong></p>
  </div>
  <div style="background:#f3f4f6;padding:16px 32px;text-align:center">
    <p style="color:#9ca3af;font-size:11px;margin:0">This is an automated email. Please do not reply directly.</p>
  </div>
</div>`
}
