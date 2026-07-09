// Supabase Edge Function: Tally CORS Proxy
// Deploy: supabase functions deploy tally-proxy
// This function acts as a CORS proxy between the browser and TallyPrime Server
// It handles: test-connection, sync, push, and raw XML proxy

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function escapeXml(str: string): string {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formatDate(dateStr: string): string {
  return (dateStr || '').replace(/-/g, '')
}

function getVal(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'))
  return m ? m[1].trim() : ''
}

function getAll(xml: string, tag: string): string[] {
  return xml.match(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi')) || []
}

function getAttr(xml: string, attr: string): string {
  const m = xml.match(new RegExp(`${attr}="([^"]*)"`, 'i'))
  return m ? m[1] : ''
}

function buildExportXml(reportId: string, companyName: string, extraVars = ''): string {
  return `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>${reportId}</ID></HEADER>
  <BODY><DESC><STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    <SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>
    ${extraVars}
  </STATICVARIABLES></DESC></BODY>
</ENVELOPE>`
}

function parseResponse(xml: string) {
  const created = parseInt(getVal(xml, 'CREATED') || '0', 10)
  const altered = parseInt(getVal(xml, 'ALTERED') || '0', 10)
  const errors: string[] = []
  const errorMatches = xml.match(/<LINEERROR[^>]*>[^<]*<\/LINEERROR>/gi) || []
  for (const m of errorMatches) {
    errors.push(m.replace(/<\/?LINEERROR[^>]*>/gi, '').trim())
  }
  const lastMsg = getVal(xml, 'LASTMSG')
  if (lastMsg && lastMsg.toLowerCase().includes('error')) errors.push(lastMsg)

  return {
    success: errors.length === 0 && (created > 0 || altered > 0),
    message: errors.length > 0 ? errors.join('; ') : `Created: ${created}, Altered: ${altered}`,
    created, altered,
    errors: errors.length > 0 ? errors : undefined,
  }
}

async function fetchFromTally(serverUrl: string, xmlBody: string, timeoutMs = 30000): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: xmlBody,
      signal: controller.signal,
    })
    clearTimeout(timeout)
    return await res.text()
  } catch (err: any) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') throw new Error(`Connection to Tally timed out (${timeoutMs / 1000}s)`)
    throw new Error(`Cannot connect to Tally at ${serverUrl}: ${err.message}`)
  }
}

async function handleTestConnection(body: any) {
  const { serverUrl, companyName } = body
  if (!serverUrl) return { error: 'Missing serverUrl' }

  const xmlBody = `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>List of Companies</ID></HEADER>
  <BODY><DESC><STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    ${companyName ? `<SVCURRENTCOMPANY>${companyName}</SVCURRENTCOMPANY>` : ''}
  </STATICVARIABLES></DESC></BODY>
</ENVELOPE>`

  try {
    const responseText = await fetchFromTally(serverUrl, xmlBody, 15000)
    const companies: string[] = []
    const companyMatches = responseText.match(/<NAME[^>]*>([^<]+)<\/NAME>/gi) || []
    for (const match of companyMatches) {
      const name = match.replace(/<\/?NAME[^>]*>/gi, '').trim()
      if (name && !companies.includes(name)) companies.push(name)
    }
    const versionMatch = responseText.match(/<VERSION[^>]*>([^<]+)<\/VERSION>/i)
    return { connected: true, companies, version: versionMatch ? versionMatch[1] : 'Connected' }
  } catch (err: any) {
    return { connected: false, companies: [], version: '', error: err.message }
  }
}

async function handleProxy(body: any) {
  const { serverUrl, xmlBody } = body
  if (!serverUrl || !xmlBody) return { error: 'Missing serverUrl or xmlBody' }
  try {
    const response = await fetchFromTally(serverUrl, xmlBody)
    return { response }
  } catch (err: any) {
    return { error: err.message }
  }
}

async function handlePush(body: any) {
  void body
  return {
    success: false,
    message: 'Outbound push to Tally is disabled. This installation is read-only from Tally.',
  }
}

async function handleSync(body: any) {
  const { action, serverUrl, companyName, dateRange } = body
  if (!serverUrl || !companyName || !action) return { error: 'Missing required fields' }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseKey)
  const startTime = Date.now()

  // Resolve company_id from companyName (required for correct upsert conflict target)
  const { data: configRow } = await supabase.from('tally_config').select('id').eq('company_name', companyName).single()
  const companyId: string | null = configRow?.id ?? null

  // Create sync log
  const { data: logData } = await supabase.from('tally_sync_log').insert({
    sync_type: action, direction: 'inward', status: 'started',
  }).select().single()
  const logId = logData?.id

  let recordsSynced = 0
  let recordsFailed = 0
  const errors: string[] = []

  try {
    switch (action) {
      case 'ledgers': {
        const xml = buildExportXml('List of Ledgers', companyName)
        const response = await fetchFromTally(serverUrl, xml)
        const elements = getAll(response, 'LEDGER')
        for (const el of elements) {
          try {
            const name = getVal(el, 'NAME') || getAttr(el, 'NAME')
            if (!name) continue
            await supabase.from('tally_ledgers').upsert({
              company_id: companyId,
              name, tally_guid: getVal(el, 'GUID') || getAttr(el, 'GUID') || null,
              parent_group: getVal(el, 'PARENT'),
              opening_balance: parseFloat(getVal(el, 'OPENINGBALANCE') || '0'),
              closing_balance: parseFloat(getVal(el, 'CLOSINGBALANCE') || '0'),
              address: getVal(el, 'ADDRESS') || null,
              phone: getVal(el, 'LEDGERPHONE') || getVal(el, 'PHONE') || null,
              email: getVal(el, 'EMAIL') || getVal(el, 'LEDGEREMAIL') || null,
              gst_number: getVal(el, 'PARTYGSTIN') || null,
              pan_number: getVal(el, 'INCOMETAXNUMBER') || null,
              last_synced_at: new Date().toISOString(),
            }, { onConflict: 'company_id,name', ignoreDuplicates: false })
            recordsSynced++
          } catch (e: any) { recordsFailed++; errors.push(e.message) }
        }
        break
      }
      case 'groups': {
        const xml = buildExportXml('List of Groups', companyName)
        const response = await fetchFromTally(serverUrl, xml)
        const elements = getAll(response, 'GROUP')
        for (const el of elements) {
          try {
            const name = getVal(el, 'NAME') || getAttr(el, 'NAME')
            if (!name) continue
            await supabase.from('tally_groups').upsert({
              name, parent_group: getVal(el, 'PARENT') || null,
              nature_of_group: getVal(el, 'NATUREOFGROUP') || null,
              is_revenue: (getVal(el, 'NATUREOFGROUP') || '').toLowerCase().includes('revenue'),
              is_deemed_positive: getVal(el, 'ISDEEMEDPOSITIVE') === 'Yes',
              last_synced_at: new Date().toISOString(),
            }, { onConflict: 'name' })
            recordsSynced++
          } catch (e: any) { recordsFailed++; errors.push(e.message) }
        }
        break
      }
      case 'stock': {
        const xml = buildExportXml('List of Stock Items', companyName)
        const response = await fetchFromTally(serverUrl, xml)
        const elements = getAll(response, 'STOCKITEM')
        for (const el of elements) {
          try {
            const name = getVal(el, 'NAME') || getAttr(el, 'NAME')
            if (!name) continue
            await supabase.from('tally_stock_items').upsert({
              name, tally_guid: getVal(el, 'GUID') || getAttr(el, 'GUID') || null,
              stock_group: getVal(el, 'PARENT') || getVal(el, 'STOCKGROUP') || null,
              unit: getVal(el, 'BASEUNITS') || getVal(el, 'UNIT') || null,
              opening_balance: parseFloat(getVal(el, 'OPENINGBALANCE') || '0'),
              closing_balance: parseFloat(getVal(el, 'CLOSINGBALANCE') || '0'),
              opening_value: parseFloat(getVal(el, 'OPENINGVALUE') || '0'),
              closing_value: parseFloat(getVal(el, 'CLOSINGVALUE') || '0'),
              rate: parseFloat(getVal(el, 'CLOSINGRATE') || getVal(el, 'RATE') || '0'),
              gst_rate: parseFloat(getVal(el, 'GSTRATE') || '0'),
              hsn_code: getVal(el, 'HSNCODE') || getVal(el, 'HSNSACCODE') || null,
              last_synced_at: new Date().toISOString(),
            }, { onConflict: 'tally_guid', ignoreDuplicates: false })
            recordsSynced++
          } catch (e: any) { recordsFailed++; errors.push(e.message) }
        }
        break
      }
      case 'vouchers': {
        const from = dateRange?.from || '2024-04-01'
        const to = dateRange?.to || new Date().toISOString().split('T')[0]
        const xml = buildExportXml('Day Book', companyName,
          `<SVFROMDATE>${from.replace(/-/g, '')}</SVFROMDATE><SVTODATE>${to.replace(/-/g, '')}</SVTODATE>`)
        const response = await fetchFromTally(serverUrl, xml)
        const elements = getAll(response, 'VOUCHER')
        for (const el of elements) {
          try {
            const rawDate = getVal(el, 'DATE')
            const date = rawDate ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : to
            const entryElements = getAll(el, 'ALLLEDGERENTRIES.LIST')
            const ledgerEntries = entryElements.map(entryEl => {
              const amt = parseFloat(getVal(entryEl, 'AMOUNT') || '0')
              return { ledger: getVal(entryEl, 'LEDGERNAME'), amount: Math.abs(amt), is_debit: amt < 0 }
            })
            const totalAmount = ledgerEntries.reduce((s, e) => e.is_debit ? s + e.amount : s, 0)
            await supabase.from('tally_vouchers').upsert({
              tally_guid: getVal(el, 'GUID') || getAttr(el, 'REMOTEID') || null,
              voucher_number: getVal(el, 'VOUCHERNUMBER'),
              voucher_type: getVal(el, 'VOUCHERTYPENAME') || getAttr(el, 'VCHTYPE'),
              date, party_ledger: getVal(el, 'PARTYLEDGERNAME'),
              amount: totalAmount, narration: getVal(el, 'NARRATION') || null,
              is_cancelled: getVal(el, 'ISCANCELLED') === 'Yes',
              sync_direction: 'from_tally', sync_status: 'synced',
              ledger_entries: ledgerEntries, synced_at: new Date().toISOString(),
            }, { onConflict: 'tally_guid', ignoreDuplicates: false })
            recordsSynced++
          } catch (e: any) { recordsFailed++; errors.push(e.message) }
        }
        break
      }
      case 'reports': {
        const today = new Date().toISOString().split('T')[0]
        const todayFmt = today.replace(/-/g, '')
        const fyStart = `${new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1}-04-01`
        const fyStartFmt = fyStart.replace(/-/g, '')
        const reportIds = [
          { id: 'Trial Balance', type: 'trial_balance', extra: `<SVTODATE>${todayFmt}</SVTODATE>` },
          { id: 'Balance Sheet', type: 'balance_sheet', extra: `<SVTODATE>${todayFmt}</SVTODATE>` },
          { id: 'Profit and Loss A/c', type: 'pnl', extra: `<SVFROMDATE>${fyStartFmt}</SVFROMDATE><SVTODATE>${todayFmt}</SVTODATE>` },
          { id: 'Outstanding Receivables', type: 'outstanding_receivables', extra: '' },
          { id: 'Outstanding Payables', type: 'outstanding_payables', extra: '' },
        ]
        for (const report of reportIds) {
          try {
            const xml = buildExportXml(report.id, companyName, report.extra)
            const response = await fetchFromTally(serverUrl, xml)
            await supabase.from('tally_reports').insert({
              report_type: report.type, report_date: today, period_from: fyStart, period_to: today,
              data: { raw: response }, fetched_at: new Date().toISOString(),
            })
            recordsSynced++
          } catch (e: any) { recordsFailed++; errors.push(`${report.type}: ${e.message}`) }
        }
        break
      }
      case 'gst-r1': case 'gst-r3b': case 'gst-ledger': {
        const gstFrom = dateRange?.from || `${new Date().getFullYear()}-04-01`
        const gstTo = dateRange?.to || new Date().toISOString().split('T')[0]
        let gstReportId = '', gstType = ''
        if (action === 'gst-r1') { gstReportId = 'GSTR-1'; gstType = 'gstr1' }
        else if (action === 'gst-r3b') { gstReportId = 'GSTR-3B'; gstType = 'gstr3b' }
        else { gstReportId = 'Day Book'; gstType = 'gst_ledger' }
        try {
          const xml = buildExportXml(gstReportId, companyName,
            `<SVFROMDATE>${gstFrom.replace(/-/g, '')}</SVFROMDATE><SVTODATE>${gstTo.replace(/-/g, '')}</SVTODATE>`)
          const response = await fetchFromTally(serverUrl, xml)
          await supabase.from('tally_gst_data').insert({
            report_type: gstType, period_from: gstFrom, period_to: gstTo,
            data: { raw: response }, fetched_at: new Date().toISOString(),
          })
          recordsSynced++
        } catch (e: any) { recordsFailed++; errors.push(`${gstType}: ${e.message}`) }
        break
      }
      case 'full': {
        for (const subAction of ['groups', 'ledgers', 'stock', 'vouchers', 'reports']) {
          const subResult = await handleSync({ action: subAction, serverUrl, companyName, dateRange })
          recordsSynced += subResult.recordsSynced || 0
          recordsFailed += subResult.recordsFailed || 0
        }
        break
      }
      default:
        return { error: `Unknown sync action: ${action}` }
    }
  } catch (err: any) {
    errors.push(err.message)
  }

  const durationMs = Date.now() - startTime
  if (logId) {
    await supabase.from('tally_sync_log').update({
      status: recordsFailed > 0 && recordsSynced > 0 ? 'partial' : recordsFailed > 0 ? 'failed' : 'completed',
      records_synced: recordsSynced, records_failed: recordsFailed,
      error_details: errors.length > 0 ? { errors } : null,
      completed_at: new Date().toISOString(), duration_ms: durationMs,
    }).eq('id', logId)
  }
  await supabase.from('tally_config').update({ last_sync_at: new Date().toISOString() }).eq('is_active', true)

  return { success: true, action, recordsSynced, recordsFailed, errors: errors.length > 0 ? errors : undefined, durationMs }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { endpoint } = body
    let result: any

    switch (endpoint) {
      case 'test-connection': result = await handleTestConnection(body); break
      case 'proxy': result = await handleProxy(body); break
      case 'push': result = await handlePush(body); break
      case 'sync': result = await handleSync(body); break
      default: result = { error: `Unknown endpoint: ${endpoint}` }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
