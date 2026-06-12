// Vercel Serverless Function: Tally CORS Proxy (Complete)
// Handles all 4 endpoints: test-connection, proxy, push, sync
// Adapted from supabase/functions/tally-proxy/index.ts for Vercel (Node.js)

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://xvkxccqaopbnkvwgyfjv.supabase.co'

function getSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured')
  return createClient(SUPABASE_URL, key)
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
  // companyName is intentionally not embedded in SVCURRENTCOMPANY because
  // Tally silently returns 0 records when the name doesn't match exactly
  // (case, spacing, & vs &amp;). Tally uses the currently-loaded company
  // when SVCURRENTCOMPANY is omitted, which is what we want.
  void companyName
  return `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>${reportId}</ID></HEADER>
  <BODY><DESC><STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
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

  // Tally sometimes returns CREATED:0/ALTERED:0 even on a successful import
  // (e.g. when the company context is implied). Treat no-errors as success.
  return {
    success: errors.length === 0,
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

// ─── Endpoint: test-connection ───
async function handleTestConnection(body: any) {
  const { serverUrl, companyName } = body
  if (!serverUrl) return { error: 'Missing serverUrl' }

  const xmlBody = `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>List of Companies</ID></HEADER>
  <BODY><DESC><STATICVARIABLES>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    ${companyName ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>` : ''}
  </STATICVARIABLES></DESC></BODY>
</ENVELOPE>`

  // Try with 60s timeout, retry once on timeout
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const responseText = await fetchFromTally(serverUrl, xmlBody, 60000)
      const companies: string[] = []
      const companyMatches = responseText.match(/<NAME[^>]*>([^<]+)<\/NAME>/gi) || []
      for (const match of companyMatches) {
        const name = match.replace(/<\/?NAME[^>]*>/gi, '').trim()
        if (name && !companies.includes(name)) companies.push(name)
      }
      const versionMatch = responseText.match(/<VERSION[^>]*>([^<]+)<\/VERSION>/i)
      return { connected: true, companies, version: versionMatch ? versionMatch[1] : 'Connected' }
    } catch (err: any) {
      if (attempt === 0 && err.message.includes('timed out')) continue
      return { connected: false, companies: [], version: '', error: err.message }
    }
  }
  return { connected: false, companies: [], version: '', error: 'Connection timed out after retries' }
}

// ─── Endpoint: proxy (raw XML) ───
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

// ─── Endpoint: push (create/alter/cancel vouchers & ledgers) ───
async function handlePush(body: any) {
  const { action, serverUrl, companyName, data } = body
  if (!serverUrl || !companyName || !action || !data) return { error: 'Missing required fields' }

  let xmlBody = ''
  switch (action) {
    case 'create-ledger': {
      const addressXml = data.address ? `<ADDRESS.LIST><ADDRESS>${escapeXml(data.address)}</ADDRESS></ADDRESS.LIST>` : ''
      const phoneXml = data.phone ? `<LEDGERPHONE>${escapeXml(data.phone)}</LEDGERPHONE>` : ''
      const emailXml = data.email ? `<LEDGEREMAIL>${escapeXml(data.email)}</LEDGEREMAIL>` : ''
      const gstXml = data.gstNumber ? `<PARTYGSTIN>${escapeXml(data.gstNumber)}</PARTYGSTIN>` : ''
      const obXml = data.openingBalance ? `<OPENINGBALANCE>${data.openingBalance}</OPENINGBALANCE>` : ''
      xmlBody = `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST><TYPE>Data</TYPE><ID>All Masters</ID></HEADER>
  <BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES></DESC>
    <DATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
      <LEDGER NAME="${escapeXml(data.name)}" ACTION="Create">
        <NAME>${escapeXml(data.name)}</NAME><PARENT>${escapeXml(data.parent || data.parentGroup)}</PARENT>
        ${obXml}${addressXml}${phoneXml}${emailXml}${gstXml}
      </LEDGER>
    </TALLYMESSAGE></DATA></BODY></ENVELOPE>`
      break
    }
    case 'create-voucher': {
      let entriesXml = ''
      for (const entry of (data.ledgerEntries || [])) {
        const amount = entry.isDeemedPositive ? -Math.abs(entry.amount) : Math.abs(entry.amount)
        entriesXml += `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${escapeXml(entry.ledgerName || entry.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${entry.isDeemedPositive ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${amount}</AMOUNT></ALLLEDGERENTRIES.LIST>`
      }
      xmlBody = `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST><TYPE>Data</TYPE><ID>Vouchers</ID></HEADER>
  <BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES></DESC>
    <DATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="${escapeXml(data.voucherType)}" ACTION="Create">
        <DATE>${formatDate(data.date)}</DATE><NARRATION>${escapeXml(data.narration || '')}</NARRATION>
        <VOUCHERTYPENAME>${escapeXml(data.voucherType)}</VOUCHERTYPENAME>
        <PARTYLEDGERNAME>${escapeXml(data.partyLedger || '')}</PARTYLEDGERNAME>${entriesXml}
      </VOUCHER>
    </TALLYMESSAGE></DATA></BODY></ENVELOPE>`
      break
    }
    case 'create-sales-voucher': {
      let entriesXml = `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${escapeXml(data.patientName)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${data.totalAmount}</AMOUNT></ALLLEDGERENTRIES.LIST>`
      for (const item of (data.items || [])) {
        entriesXml += `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${escapeXml(item.ledgerName || 'Hospital Income')}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${item.amount}</AMOUNT></ALLLEDGERENTRIES.LIST>`
      }
      xmlBody = `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST><TYPE>Data</TYPE><ID>Vouchers</ID></HEADER>
  <BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES></DESC>
    <DATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="Sales" ACTION="Create">
        <DATE>${formatDate(data.date)}</DATE><NARRATION>IPD Bill #${escapeXml(data.billNumber || '')}</NARRATION>
        <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><PARTYLEDGERNAME>${escapeXml(data.patientName)}</PARTYLEDGERNAME>${entriesXml}
      </VOUCHER>
    </TALLYMESSAGE></DATA></BODY></ENVELOPE>`
      break
    }
    case 'create-receipt-voucher': {
      const bankLedger = data.bankLedger || (data.paymentMode === 'Cash' ? 'Cash' : 'Bank Account')
      xmlBody = `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST><TYPE>Data</TYPE><ID>Vouchers</ID></HEADER>
  <BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES></DESC>
    <DATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="Receipt" ACTION="Create">
        <DATE>${formatDate(data.date)}</DATE><NARRATION>Receipt #${escapeXml(data.receiptNumber || '')} from ${escapeXml(data.patientName || '')}</NARRATION>
        <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><PARTYLEDGERNAME>${escapeXml(data.patientName || '')}</PARTYLEDGERNAME>
        <ALLLEDGERENTRIES.LIST><LEDGERNAME>${escapeXml(bankLedger)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${data.amount}</AMOUNT></ALLLEDGERENTRIES.LIST>
        <ALLLEDGERENTRIES.LIST><LEDGERNAME>${escapeXml(data.patientName || '')}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${data.amount}</AMOUNT></ALLLEDGERENTRIES.LIST>
      </VOUCHER>
    </TALLYMESSAGE></DATA></BODY></ENVELOPE>`
      break
    }
    case 'alter-voucher': {
      let alterEntriesXml = ''
      for (const entry of (data.ledgerEntries || [])) {
        const amt = entry.isDeemedPositive ? -Math.abs(entry.amount) : Math.abs(entry.amount)
        alterEntriesXml += `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${escapeXml(entry.ledger || entry.ledgerName)}</LEDGERNAME><ISDEEMEDPOSITIVE>${entry.isDeemedPositive ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${amt}</AMOUNT></ALLLEDGERENTRIES.LIST>`
      }
      xmlBody = `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST><TYPE>Data</TYPE><ID>Vouchers</ID></HEADER>
  <BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES></DESC>
    <DATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="${escapeXml(data.voucherType)}" ACTION="Alter" VOUCHERNUMBER="${escapeXml(data.originalVoucherNumber)}">
        <VOUCHERNUMBER>${escapeXml(data.originalVoucherNumber)}</VOUCHERNUMBER>
        <DATE>${formatDate(data.date)}</DATE><NARRATION>${escapeXml(data.narration || '')}</NARRATION>
        <VOUCHERTYPENAME>${escapeXml(data.voucherType)}</VOUCHERTYPENAME>
        <PARTYLEDGERNAME>${escapeXml(data.partyLedger || '')}</PARTYLEDGERNAME>${alterEntriesXml}
      </VOUCHER>
    </TALLYMESSAGE></DATA></BODY></ENVELOPE>`
      break
    }
    case 'cancel-voucher': {
      xmlBody = `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST><TYPE>Data</TYPE><ID>Vouchers</ID></HEADER>
  <BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES></DESC>
    <DATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER VCHTYPE="${escapeXml(data.voucherType)}" ACTION="Delete" VOUCHERNUMBER="${escapeXml(data.voucherNumber)}">
        <VOUCHERNUMBER>${escapeXml(data.voucherNumber)}</VOUCHERNUMBER>
        <VOUCHERTYPENAME>${escapeXml(data.voucherType)}</VOUCHERTYPENAME>
      </VOUCHER>
    </TALLYMESSAGE></DATA></BODY></ENVELOPE>`
      break
    }
    default:
      return { error: `Unknown push action: ${action}` }
  }

  try {
    const responseText = await fetchFromTally(serverUrl, xmlBody)
    return parseResponse(responseText)
  } catch (err: any) {
    return { success: false, message: err.message }
  }
}

// ─── Endpoint: sync (pull from Tally → save to Supabase) ───
async function handleSync(body: any) {
  const { action, serverUrl, companyName, companyId, dateRange } = body
  if (!serverUrl || !companyName || !action) return { error: 'Missing required fields' }

  // Tally company names can contain &, <, > which must be escaped before
  // being embedded inside <SVCURRENTCOMPANY> — otherwise Tally rejects the XML.
  const safeCompany = escapeXml(companyName)

  const supabase = getSupabase()
  const startTime = Date.now()

  // Create sync log
  const { data: logData } = await supabase.from('tally_sync_log').insert({
    sync_type: action, direction: 'inward', status: 'started',
    company_id: companyId,
  }).select().single()
  const logId = logData?.id

  let recordsSynced = 0
  let recordsFailed = 0
  const errors: string[] = []

  try {
    switch (action) {
      case 'ledgers': {
        // TallyPrime Collection-based export — SVCURRENTCOMPANY omitted; Tally
        // uses the currently-loaded company. Sending it caused silent 0-record
        // responses when name didn't match exactly (case/spacing/&-encoding).
        const xml = `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>Ledger Collection</ID></HEADER>
  <BODY><DESC>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="Ledger Collection" ISMODIFY="No">
        <TYPE>Ledger</TYPE>
        <FETCH>NAME,PARENT,OPENINGBALANCE,CLOSINGBALANCE,ADDRESS,LEDGERPHONE,EMAIL,PARTYGSTIN,INCOMETAXNUMBER,GUID</FETCH>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>`
        const response = await fetchFromTally(serverUrl, xml, 120000)
        const elements = getAll(response, 'LEDGER')
        // Batch upsert for speed (50 at a time instead of 1-by-1)
        const BATCH_SIZE = 50
        const now = new Date().toISOString()
        const allRows: any[] = []
        for (const el of elements) {
          const name = getVal(el, 'NAME') || getAttr(el, 'NAME')
          if (!name) continue
          allRows.push({
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
            last_synced_at: now,
          })
        }
        for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
          const batch = allRows.slice(i, i + BATCH_SIZE)
          const { error: upsertError } = await supabase.from('tally_ledgers').upsert(batch, { onConflict: 'company_id,name', ignoreDuplicates: false })
          if (upsertError) {
            recordsFailed += batch.length
            errors.push(`Ledger batch ${i}-${i + batch.length}: ${upsertError.message}`)
          } else {
            recordsSynced += batch.length
          }
        }
        break
      }
      case 'groups': {
        const xml = `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>Group Collection</ID></HEADER>
  <BODY><DESC>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="Group Collection" ISMODIFY="No">
        <TYPE>Group</TYPE>
        <FETCH>NAME,PARENT,NATUREOFGROUP,ISDEEMEDPOSITIVE,GUID</FETCH>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>`
        const response = await fetchFromTally(serverUrl, xml, 120000)
        const elements = getAll(response, 'GROUP')
        const nowG = new Date().toISOString()
        const groupRows: any[] = []
        for (const el of elements) {
          const name = getVal(el, 'NAME') || getAttr(el, 'NAME')
          if (!name) continue
          groupRows.push({
            company_id: companyId,
            name, parent_group: getVal(el, 'PARENT') || null,
            nature_of_group: getVal(el, 'NATUREOFGROUP') || null,
            is_revenue: (getVal(el, 'NATUREOFGROUP') || '').toLowerCase().includes('revenue'),
            is_deemed_positive: getVal(el, 'ISDEEMEDPOSITIVE') === 'Yes',
            last_synced_at: nowG,
          })
        }
        for (let i = 0; i < groupRows.length; i += 50) {
          const batch = groupRows.slice(i, i + 50)
          const { error: upsertError } = await supabase.from('tally_groups').upsert(batch, { onConflict: 'company_id,name' })
          if (upsertError) {
            recordsFailed += batch.length
            errors.push(`Groups batch ${i}: ${upsertError.message}`)
          } else {
            recordsSynced += batch.length
          }
        }
        break
      }
      case 'stock': {
        const xml = `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>StockItem Collection</ID></HEADER>
  <BODY><DESC>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="StockItem Collection" ISMODIFY="No">
        <TYPE>StockItem</TYPE>
        <FETCH>NAME,PARENT,BASEUNITS,OPENINGBALANCE,CLOSINGBALANCE,OPENINGVALUE,CLOSINGVALUE,CLOSINGRATE,GSTRATE,HSNCODE,GUID</FETCH>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>`
        const response = await fetchFromTally(serverUrl, xml, 120000)
        const elements = getAll(response, 'STOCKITEM')
        if (elements.length === 0 && response.length > 0) {
          errors.push(`No STOCKITEM elements found in Tally response (${response.length} chars). Response preview: ${response.substring(0, 500)}`)
        }
        const nowS = new Date().toISOString()
        const stockRows: any[] = []
        for (const el of elements) {
          const name = getVal(el, 'NAME') || getAttr(el, 'NAME')
          if (!name) continue
          stockRows.push({
            company_id: companyId,
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
            last_synced_at: nowS,
          })
        }
        for (let i = 0; i < stockRows.length; i += 50) {
          const batch = stockRows.slice(i, i + 50)
          const { error: upsertError } = await supabase.from('tally_stock_items').upsert(batch, { onConflict: 'company_id,name', ignoreDuplicates: false })
          if (upsertError) {
            recordsFailed += batch.length
            errors.push(`Stock batch ${i}: ${upsertError.message}`)
          } else {
            recordsSynced += batch.length
          }
        }
        break
      }
      case 'vouchers': {
        // Default to financial year start (April 1)
        const now = new Date()
        const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
        const defaultFrom = `${fyYear}-04-01`
        const from = dateRange?.from || defaultFrom
        const to = dateRange?.to || new Date().toISOString().split('T')[0]
        // Use Voucher Collection as primary — returns every voucher in the loaded
        // company across all dates. Day Book has been observed to ignore
        // SVFROMDATE/SVTODATE in some TallyPrime versions, returning only 1
        // record from outside the requested range. Collection is reliable.
        const collectionXml = `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>Voucher Collection</ID></HEADER>
  <BODY><DESC>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="Voucher Collection" ISMODIFY="No">
        <TYPE>Voucher</TYPE>
        <FETCH>DATE,VOUCHERTYPENAME,VOUCHERNUMBER,PARTYLEDGERNAME,AMOUNT,NARRATION,ISCANCELLED,GUID</FETCH>
        <FETCH>ALLLEDGERENTRIES.LIST</FETCH>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>`
        let response: string
        try {
          response = await fetchFromTally(serverUrl, collectionXml, 180000)
        } catch {
          // Fallback to Day Book export with date range
          const dayBookXml = buildExportXml('Day Book', safeCompany,
            `<SVFROMDATE>${from.replace(/-/g, '')}</SVFROMDATE><SVTODATE>${to.replace(/-/g, '')}</SVTODATE>`)
          response = await fetchFromTally(serverUrl, dayBookXml, 120000)
        }
        const elements = getAll(response, 'VOUCHER')
        // Batch upsert vouchers for speed
        const VBATCH = 50
        const voucherRows: any[] = []
        const nowV = new Date().toISOString()
        let vIdx = 0
        for (const el of elements) {
          try {
            const rawDate = getVal(el, 'DATE')
            const date = rawDate ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : to
            let entryElements = getAll(el, 'ALLLEDGERENTRIES.LIST')
            if (entryElements.length === 0) entryElements = getAll(el, 'LEDGERENTRIES.LIST')
            if (entryElements.length === 0) entryElements = getAll(el, 'ALLLEDGERENTRIES')
            if (entryElements.length === 0) entryElements = getAll(el, 'LEDGERENTRIES')
            const ledgerEntries = entryElements.map(entryEl => {
              const amt = parseFloat(getVal(entryEl, 'AMOUNT') || '0')
              return { ledger: getVal(entryEl, 'LEDGERNAME'), amount: Math.abs(amt), is_debit: amt < 0 }
            })
            const debitTotal = ledgerEntries.filter(e => e.is_debit).reduce((s, e) => s + e.amount, 0)
            const creditTotal = ledgerEntries.filter(e => !e.is_debit).reduce((s, e) => s + e.amount, 0)
            const voucherLevelAmt = Math.abs(parseFloat(getVal(el, 'AMOUNT') || '0'))
            const totalAmount = debitTotal || creditTotal || voucherLevelAmt
            const vchNum = getVal(el, 'VOUCHERNUMBER')
            const vchType = getVal(el, 'VOUCHERTYPENAME') || getAttr(el, 'VCHTYPE')
            // Use GUID if available, otherwise generate a deterministic key from voucher details
            const guid = getVal(el, 'GUID') || getAttr(el, 'REMOTEID') || `${vchType}-${vchNum}-${date}-${vIdx}`
            vIdx++
            voucherRows.push({
              company_id: companyId,
              tally_guid: guid,
              voucher_number: vchNum,
              voucher_type: vchType,
              date, party_ledger: getVal(el, 'PARTYLEDGERNAME'),
              amount: totalAmount, narration: getVal(el, 'NARRATION') || null,
              is_cancelled: getVal(el, 'ISCANCELLED') === 'Yes',
              sync_direction: 'from_tally', sync_status: 'synced',
              ledger_entries: ledgerEntries, synced_at: nowV,
            })
          } catch (e: any) { recordsFailed++; errors.push(e.message) }
        }
        for (let i = 0; i < voucherRows.length; i += VBATCH) {
          const batch = voucherRows.slice(i, i + VBATCH)
          const { error: upsertError } = await supabase.from('tally_vouchers').upsert(batch, { onConflict: 'company_id,tally_guid', ignoreDuplicates: false })
          if (upsertError) {
            recordsFailed += batch.length
            errors.push(`Voucher batch ${i}: ${upsertError.message}`)
          } else {
            recordsSynced += batch.length
          }
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
            const xml = buildExportXml(report.id, safeCompany, report.extra)
            const response = await fetchFromTally(serverUrl, xml, 120000)
            await supabase.from('tally_reports').insert({
              company_id: companyId,
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
          const xml = buildExportXml(gstReportId, safeCompany,
            `<SVFROMDATE>${gstFrom.replace(/-/g, '')}</SVFROMDATE><SVTODATE>${gstTo.replace(/-/g, '')}</SVTODATE>`)
          const response = await fetchFromTally(serverUrl, xml, 120000)
          await supabase.from('tally_gst_data').insert({
            company_id: companyId,
            report_type: gstType, period_from: gstFrom, period_to: gstTo,
            data: { raw: response }, fetched_at: new Date().toISOString(),
          })
          recordsSynced++
        } catch (e: any) { recordsFailed++; errors.push(`${gstType}: ${e.message}`) }
        break
      }
      case 'full': {
        for (const subAction of ['groups', 'ledgers', 'stock', 'vouchers', 'reports']) {
          const subResult = await handleSync({ action: subAction, serverUrl, companyName, companyId, dateRange }) as any
          recordsSynced += subResult.recordsSynced || 0
          recordsFailed += subResult.recordsFailed || 0
          if (subResult.errors?.length) errors.push(...subResult.errors)
          if (subResult.error) errors.push(`${subAction}: ${subResult.error}`)
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
    const status = recordsSynced === 0 && recordsFailed === 0 && action !== 'full'
      ? 'no_data'
      : recordsFailed > 0 && recordsSynced > 0
        ? 'partial'
        : recordsFailed > 0
          ? 'failed'
          : 'completed'
    await supabase.from('tally_sync_log').update({
      status,
      records_synced: recordsSynced, records_failed: recordsFailed,
      error_details: errors.length > 0 ? { errors } : null,
      completed_at: new Date().toISOString(), duration_ms: durationMs,
    }).eq('id', logId)
  }
  await supabase.from('tally_config').update({ last_sync_at: new Date().toISOString() }).eq('id', companyId)

  return { success: true, action, recordsSynced, recordsFailed, errors: errors.length > 0 ? errors : undefined, durationMs }
}

// ─── Main handler ───
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  // GET = health check
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      endpoints: ['test-connection', 'sync', 'push', 'proxy'],
      timestamp: new Date().toISOString(),
    })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const body = req.body
    const { endpoint } = body
    let result: any

    switch (endpoint) {
      case 'test-connection': result = await handleTestConnection(body); break
      case 'proxy': result = await handleProxy(body); break
      case 'push': result = await handlePush(body); break
      case 'sync': result = await handleSync(body); break
      default: result = { error: `Unknown endpoint: ${endpoint}` }
    }

    return res.status(200).json(result)
  } catch (err: any) {
    return res.status(400).json({ error: err.message })
  }
}
