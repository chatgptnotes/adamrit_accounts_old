#!/usr/bin/env node
/**
 * Audited historical Tally XML importer.
 *
 * The input must be an XML export produced by TallyPrime. Native .1800 files
 * are intentionally unsupported: only TallyPrime can interpret them safely.
 *
 * Examples:
 *   node scripts/import-tally-history.js --file Masters.xml --company "Ayushman Nagpur Hospital" --kind masters --dry-run
 *   node scripts/import-tally-history.js --file Vouchers_2025-26.xml --company "DRM Hope Hospital Pvt. Ltd." --kind vouchers --from 2025-04-01 --to 2026-03-31
 *   node scripts/import-tally-history.js --file Vouchers_2025-26.xml --company "DRM Hope Hospital Pvt. Ltd." --kind vouchers --from 2025-04-01 --to 2026-03-31 --promote
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DOMParser } from '@xmldom/xmldom'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

const CHUNK_SIZE = 200
const parser = new DOMParser({ errorHandler: { warning: () => {}, error: (message) => { throw new Error(message) }, fatalError: (message) => { throw new Error(message) } } })

function usage(exitCode = 0) {
  console.log(`
Audited Tally history importer

Required:
  --file <path>       TallyPrime XML export
  --company <name>    Exact Adamrit Tally company name
  --kind <value>      masters | vouchers | report

Optional:
  --from YYYY-MM-DD   Export period start (required for controlled voucher periods)
  --to YYYY-MM-DD     Export period end
  --report-type <v>   trial_balance | balance_sheet | pnl (required with --kind report)
  --promote           Promote only after staging validation succeeds
  --dry-run           Parse and validate locally; writes nothing

This script needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.
`)
  process.exit(exitCode)
}

function options() {
  const out = { dryRun: false, promote: false }
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') usage()
    if (arg === '--dry-run') { out.dryRun = true; continue }
    if (arg === '--promote') { out.promote = true; continue }
    if (['--file', '--company', '--kind', '--from', '--to', '--report-type'].includes(arg)) out[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = args[++i]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!out.file || !out.company || !out.kind || !['masters', 'vouchers', 'report'].includes(out.kind)) throw new Error('--file, --company, and --kind (masters|vouchers|report) are required')
  if (out.kind === 'report' && !['trial_balance', 'balance_sheet', 'pnl'].includes(out.reportType)) throw new Error('--report-type is required for reports')
  if (out.promote && out.dryRun) throw new Error('--promote and --dry-run cannot be used together')
  return out
}

function text(node, tag) {
  const result = node.getElementsByTagName(tag)[0]
  return result?.textContent?.trim() || ''
}

function attr(node, name) { return node.getAttribute?.(name)?.trim() || '' }

function tallyDate(value) {
  const clean = (value || '').trim()
  if (/^\d{8}$/.test(clean)) return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean
  return null
}

function number(value) {
  const cleaned = String(value || '0').replace(/,/g, '').trim()
  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}

function canonicalCompany(value) { return (value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '') }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function fileSha(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

function readTallyXml(file) {
  const buffer = fs.readFileSync(file)
  // TallyPrime's XML data-interchange exports are UTF-16LE with a BOM. Its
  // smaller All Masters export is safe to read into memory; vouchers are read
  // through streamTallyVouchers below instead.
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString('utf16le').replace(/^\uFEFF/, '')
  return buffer.toString('utf8').replace(/^\uFEFF/, '')
}

function tallyXmlEncoding(file) {
  const fd = fs.openSync(file, 'r')
  const header = Buffer.alloc(2)
  fs.readSync(fd, header, 0, 2, 0)
  fs.closeSync(fd)
  return header[0] === 0xff && header[1] === 0xfe ? 'utf16le' : 'utf8'
}

async function streamTallyVouchers(file, onVoucher) {
  const stream = fs.createReadStream(file, { encoding: tallyXmlEncoding(file), highWaterMark: 1024 * 1024 })
  let buffer = ''
  let first = true
  for await (const chunk of stream) {
    buffer += first ? chunk.replace(/^\uFEFF/, '') : chunk
    first = false
    for (;;) {
      const start = buffer.search(/<VOUCHER(?:\s|>)/)
      if (start < 0) {
        // Keep just enough trailing text to preserve an opening tag split
        // across chunks; never retain the whole 1.3 GB source in memory.
        buffer = buffer.slice(-32)
        break
      }
      const end = buffer.indexOf('</VOUCHER>', start)
      if (end < 0) {
        if (start > 0) buffer = buffer.slice(start)
        break
      }
      const voucherXml = buffer.slice(start, end + '</VOUCHER>'.length)
      buffer = buffer.slice(end + '</VOUCHER>'.length)
      await onVoucher(voucherXml)
    }
  }
  if (buffer.search(/<VOUCHER(?:\s|>)/) >= 0) throw new Error('The Tally XML ended before a VOUCHER element was closed')
}

function parseMasters(document) {
  const masters = []
  const add = (masterType, tag, mapper) => {
    for (const node of Array.from(document.getElementsByTagName(tag))) {
      const name = text(node, 'NAME') || attr(node, 'NAME')
      if (!name) continue
      masters.push({ master_type: masterType, source_key: text(node, 'GUID') || attr(node, 'GUID') || name, name, raw_data: { tally_guid: text(node, 'GUID') || attr(node, 'GUID') || null }, ...mapper(node) })
    }
  }
  add('group', 'GROUP', (node) => ({ parent_name: text(node, 'PARENT') || null, details: { nature_of_group: text(node, 'NATUREOFGROUP') || null } }))
  add('ledger', 'LEDGER', (node) => ({
    tally_guid: text(node, 'GUID') || attr(node, 'GUID') || null,
    parent_name: text(node, 'PARENT') || null,
    opening_balance: number(text(node, 'OPENINGBALANCE')),
    closing_balance: text(node, 'CLOSINGBALANCE') ? number(text(node, 'CLOSINGBALANCE')) : null,
    details: { address: text(node, 'ADDRESS') || null, phone: text(node, 'LEDGERPHONE') || text(node, 'PHONE') || null, email: text(node, 'EMAIL') || null, gst_number: text(node, 'PARTYGSTIN') || null, pan_number: text(node, 'INCOMETAXNUMBER') || null },
  }))
  add('stock_item', 'STOCKITEM', (node) => ({
    tally_guid: text(node, 'GUID') || attr(node, 'GUID') || null,
    parent_name: text(node, 'PARENT') || text(node, 'STOCKGROUP') || null,
    opening_balance: number(text(node, 'OPENINGBALANCE')),
    closing_balance: text(node, 'CLOSINGBALANCE') ? number(text(node, 'CLOSINGBALANCE')) : null,
    details: { unit: text(node, 'BASEUNITS') || text(node, 'UNIT') || null, opening_value: text(node, 'OPENINGVALUE') || null, closing_value: text(node, 'CLOSINGVALUE') || null, rate: text(node, 'CLOSINGRATE') || text(node, 'RATE') || null, gst_rate: text(node, 'GSTRATE') || null, hsn_code: text(node, 'HSNCODE') || text(node, 'HSNSACCODE') || null },
  }))
  return masters
}

function deduplicateMasters(masters) {
  const unique = new Map()
  for (const master of masters) unique.set(`${master.master_type}\u0000${master.source_key}`, master)
  return [...unique.values()]
}

function parseVoucherXml(voucherXml, companyKey) {
    const document = parser.parseFromString(voucherXml, 'text/xml')
    const node = document.getElementsByTagName('VOUCHER')[0]
    if (!node || document.getElementsByTagName('parsererror').length) throw new Error('A VOUCHER element is not valid XML')
    const date = tallyDate(text(node, 'DATE'))
    const voucherType = text(node, 'VOUCHERTYPENAME') || attr(node, 'VCHTYPE')
    if (!date || !voucherType) throw new Error('Every imported voucher must have DATE and VOUCHERTYPENAME')
    const lines = Array.from(node.getElementsByTagName('ALLLEDGERENTRIES.LIST')).flatMap((line) => {
      const signedAmount = number(text(line, 'AMOUNT'))
      const ledger = text(line, 'LEDGERNAME')
      // Tally sometimes includes a non-accounting allocation block under an
      // ALLLEDGERENTRIES.LIST node (for example an inventory/tax allocation).
      // It has no LEDGERNAME and must not become a fake accounting line.
      if (!ledger) return []
      return [{ ledger_name: ledger, amount: Math.abs(signedAmount), is_debit: signedAmount < 0, details: {} }]
    })
    lines.forEach((line, index) => { line.line_number = index + 1 })
    const tallyGuid = text(node, 'GUID') || attr(node, 'REMOTEID') || null
    const voucherNumber = text(node, 'VOUCHERNUMBER') || null
    if (lines.length < 2) {
      return { skipped: true, voucher_number: voucherNumber, tally_guid: tallyGuid, voucher_type: voucherType, voucher_date: date, reason: 'fewer_than_two_accounting_ledger_entries' }
    }
    const partyLedger = text(node, 'PARTYLEDGERNAME') || null
    const narration = text(node, 'NARRATION') || null
    const amount = lines.filter((line) => line.is_debit).reduce((sum, line) => sum + line.amount, 0)
    const fallback = JSON.stringify({ date, voucherType, voucherNumber, partyLedger, narration, lines: lines.map(({ ledger_name, amount: lineAmount, is_debit }) => [ledger_name, lineAmount, is_debit]) })
    const sourceFingerprint = sha(`${companyKey}|${tallyGuid || fallback}`)
    return {
      source_fingerprint: sourceFingerprint, tally_guid: tallyGuid, voucher_number: voucherNumber,
      voucher_type: voucherType, voucher_date: date, party_ledger: partyLedger, amount,
      narration, is_cancelled: /^yes$/i.test(text(node, 'ISCANCELLED')),
      raw_data: { tally_guid: tallyGuid, remote_id: attr(node, 'REMOTEID') || null }, lines,
    }
}

async function insertChunks(query, rows) {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const { error } = await query(rows.slice(i, i + CHUNK_SIZE))
    if (error) throw new Error(error.message)
  }
}

async function main() {
  const opts = options()
  if (!fs.existsSync(opts.file)) throw new Error(`File not found: ${opts.file}`)
  const sourceSha = await fileSha(opts.file)
  const companyKey = canonicalCompany(opts.company)
  let parsed = null
  let reportXml = null
  if (opts.kind !== 'vouchers') {
    const xml = readTallyXml(opts.file)
    const document = parser.parseFromString(xml, 'text/xml')
    if (document.getElementsByTagName('parsererror').length) throw new Error('The export file is not valid XML')
    parsed = opts.kind === 'masters' ? deduplicateMasters(parseMasters(document)) : null
    reportXml = opts.kind === 'report' ? xml : null
  }

  console.log(`[PARSE] ${path.basename(opts.file)} — ${opts.kind}`)
  console.log(`[PARSE] SHA-256: ${sourceSha}`)
  if (opts.kind !== 'vouchers') console.log(`[PARSE] ${opts.kind === 'report' ? '1 report snapshot' : `${parsed.length} masters`}`)

  const inspectVoucherStream = async (onVoucher) => {
    const fingerprints = new Set()
    const skipped = []
    let count = 0, firstDate = null, lastDate = null
    await streamTallyVouchers(opts.file, async (voucherXml) => {
      const voucher = parseVoucherXml(voucherXml, companyKey)
      if (voucher.skipped) { skipped.push(voucher); return }
      if (fingerprints.has(voucher.source_fingerprint)) throw new Error(`Duplicate voucher fingerprint: ${voucher.source_fingerprint}`)
      fingerprints.add(voucher.source_fingerprint)
      const difference = voucher.lines.reduce((sum, line) => sum + (line.is_debit ? line.amount : -line.amount), 0)
      if (Math.abs(difference) > 0.01) throw new Error(`Voucher ${voucher.voucher_number || voucher.tally_guid || '(blank)'} does not balance`)
      count++
      firstDate = !firstDate || voucher.voucher_date < firstDate ? voucher.voucher_date : firstDate
      lastDate = !lastDate || voucher.voucher_date > lastDate ? voucher.voucher_date : lastDate
      await onVoucher(voucher)
    })
    if (!count) throw new Error('No VOUCHER elements were found in the export')
    return { count, firstDate, lastDate, skipped }
  }

  if (opts.dryRun) {
    if (opts.kind === 'vouchers') {
      const stats = await inspectVoucherStream(async () => {})
      console.log(`[PARSE] ${stats.count} vouchers`)
      console.log(`[PARSE] dates: ${stats.firstDate} to ${stats.lastDate}`)
      if (stats.skipped.length) console.log(`[SKIPPED] ${stats.skipped.length} non-accounting/incomplete voucher(s); first: ${stats.skipped.slice(0, 5).map((v) => v.voucher_number || v.tally_guid).join(', ')}`)
    }
    console.log('[DRY RUN] No data written.')
    return
  }

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  const supabase = createClient(url, key)
  const { data: configs, error: configError } = await supabase.from('tally_config').select('id, company_name').eq('is_active', opts.company === 'Hope Hospital Partnership' ? false : true)
  if (configError) throw new Error(`Could not load Tally companies: ${configError.message}`)
  const company = (configs || []).find((row) => canonicalCompany(row.company_name) === companyKey)
  if (!company) throw new Error(`No configured Tally company exactly matches "${opts.company}". Run the historical-import migration first.`)

  const { data: existing, error: existingError } = await supabase.from('tally_history_import_batches').select('id,status').eq('company_id', company.id).eq('source_sha256', sourceSha).maybeSingle()
  if (existingError) throw new Error(existingError.message)
  if (existing?.status === 'failed') {
    const { error } = await supabase.from('tally_history_import_batches').delete().eq('id', existing.id)
    if (error) throw new Error(`Could not remove failed batch ${existing.id}: ${error.message}`)
    console.log(`[RETRY] Removed failed batch ${existing.id}; no historical data was promoted from it.`)
  } else if (existing) {
    throw new Error(`This file was already imported as batch ${existing.id} (${existing.status}). It was not imported again.`)
  }

  const { data: batch, error: batchError } = await supabase.from('tally_history_import_batches').insert({
    company_id: company.id, source_file_name: path.basename(opts.file), source_sha256: sourceSha,
    source_format: 'xml', import_kind: opts.kind, period_from: opts.from || null,
    period_to: opts.to || null, source_company_name: opts.company,
  }).select('id').single()
  if (batchError) throw new Error(batchError.message)

  try {
    let stagedRecords = opts.kind === 'report' ? 1 : parsed?.length || 0
    let detectedFrom = null, detectedTo = null
    if (opts.kind === 'masters') {
      await insertChunks((rows) => supabase.from('tally_history_stage_masters').insert(rows.map((row) => ({ ...row, batch_id: batch.id }))), parsed)
    } else if (opts.kind === 'vouchers') {
      let pending = []
      const flush = async () => {
        if (!pending.length) return
        const { data, error } = await supabase.from('tally_history_stage_vouchers').insert(pending.map(({ lines, ...voucher }) => ({ ...voucher, batch_id: batch.id }))).select('id,source_fingerprint')
        if (error) throw new Error(error.message)
        const ids = new Map(data.map((voucher) => [voucher.source_fingerprint, voucher.id]))
        const lines = pending.flatMap((voucher) => voucher.lines.map((line) => ({ ...line, staged_voucher_id: ids.get(voucher.source_fingerprint) })))
        await insertChunks((rows) => supabase.from('tally_history_stage_voucher_lines').insert(rows), lines)
        pending = []
      }
      const stats = await inspectVoucherStream(async (voucher) => {
        pending.push(voucher)
        if (pending.length >= CHUNK_SIZE) await flush()
      })
      await flush()
      stagedRecords = stats.count
      detectedFrom = stats.firstDate
      detectedTo = stats.lastDate
      console.log(`[PARSE] ${stats.count} vouchers, ${stats.firstDate} to ${stats.lastDate}`)
      if (stats.skipped.length) {
        const { error } = await supabase.from('tally_history_import_batches').update({ error_details: { skipped_vouchers: stats.skipped } }).eq('id', batch.id)
        if (error) throw new Error(error.message)
        console.log(`[SKIPPED] ${stats.skipped.length} non-accounting/incomplete voucher(s) recorded on this batch.`)
      }
    } else {
      const { error } = await supabase.from('tally_history_stage_reports').insert({
        batch_id: batch.id, report_type: opts.reportType, report_date: opts.to || null,
        period_from: opts.from || null, period_to: opts.to || null, data: { raw_xml: reportXml },
      })
      if (error) throw new Error(error.message)
    }

    const { error: countError } = await supabase.from('tally_history_import_batches').update({
      staged_records: stagedRecords,
      period_from: opts.from || detectedFrom,
      period_to: opts.to || detectedTo,
    }).eq('id', batch.id)
    if (countError) throw new Error(countError.message)
    const { data: validation, error: validationError } = await supabase.rpc('validate_tally_history_import', { p_batch_id: batch.id })
    if (validationError) throw new Error(validationError.message)
    console.log(`[VALIDATION] ${JSON.stringify(validation)}`)
    if (!validation.valid) throw new Error(`Batch ${batch.id} failed validation and remains in staging.`)
    if (opts.promote) {
      const { data: promotion, error: promotionError } = await supabase.rpc('promote_tally_history_import', { p_batch_id: batch.id })
      if (promotionError) throw new Error(promotionError.message)
      console.log(`[PROMOTED] ${JSON.stringify(promotion)}`)
    } else console.log(`[STAGED] Batch ${batch.id} validated. Re-run with --promote to publish it to tally_* tables.`)
  } catch (error) {
    await supabase.from('tally_history_import_batches').update({ status: 'failed', error_details: { message: error.message } }).eq('id', batch.id)
    throw error
  }
}

main().catch((error) => { console.error(`[ERROR] ${error.message}`); process.exit(1) })
