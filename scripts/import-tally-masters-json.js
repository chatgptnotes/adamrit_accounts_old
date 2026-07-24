/**
 * Tally "All Masters" JSON Import
 * --------------------------------
 * Imports a hand-exported Tally Prime masters file (UTF-16 JSON) into Supabase:
 *   tally_groups      — the group tree
 *   tally_ledgers     — every ledger with its opening balance
 *   chart_of_accounts — mirrored so the accounting module sees the same ledgers
 *
 * The export carries OPENING balances only. Tally does not store a closing
 * balance on the master (it is derived as opening + vouchers), so closing_balance
 * is left NULL rather than written as a misleading 0.
 *
 * Usage:
 *   node scripts/import-tally-masters-json.js --file "/path/ALL LEDGER.json" --dry-run
 *   node scripts/import-tally-masters-json.js --file "/path/ALL LEDGER.json"
 *
 * Options:
 *   --file <path>      path to the exported JSON (or set TALLY_MASTERS_JSON)
 *   --company <name>   Tally company name; defaults to "Drm Hope Hospital Pvt Ltd"
 *                      (the JSON has no company field — only ALL DATA.xml's header does)
 *   --dry-run          parse, map and report; write nothing
 *
 * Environment variables — add to .env before running:
 *   VITE_SUPABASE_URL          (already in .env)
 *   SUPABASE_SERVICE_ROLE_KEY  Supabase Dashboard → Project Settings → API → service_role key
 *   TALLY_MASTERS_JSON         default path to the export file
 */

import fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config()

// ─── Configuration ─────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://xvkxccqaopbnkvwgyfjv.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DEFAULT_COMPANY = 'Drm Hope Hospital Pvt Ltd'
const CHUNK_SIZE = 100

// ─── Arguments ──────────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2)
  const opts = { file: process.env.TALLY_MASTERS_JSON || '', company: DEFAULT_COMPANY, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') opts.file = argv[++i]
    else if (argv[i] === '--company') opts.company = argv[++i]
    else if (argv[i] === '--dry-run') opts.dryRun = true
  }
  return opts
}

// ─── Company Name Matching ──────────────────────────────────────────────────
// Same normalisers the live sync uses, so a company resolves identically here
// and in supabase/functions/tally-proxy/index.ts.

function canonicalCompanyKey(value) {
  return (value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function accountingCompanyKey(value) {
  return canonicalCompanyKey(value)
    .replace(/privatelimited/g, 'pvtltd')
    .replace(/private/g, 'pvt')
    .replace(/limited/g, 'ltd')
}

// ─── Account Code ───────────────────────────────────────────────────────────
// FNV-1a, identical to tallyChartAccountCode() in the tally-proxy function so
// re-importing and live-syncing produce the same account_code for a ledger.

function tallyChartAccountCode(companyId, ledgerName) {
  let hash = 2166136261
  for (const char of ledgerName) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `TL${companyId.replace(/-/g, '').slice(0, 6)}${(hash >>> 0).toString(36).padStart(7, '0').slice(-7)}`
}

// ─── Group → Account Type ───────────────────────────────────────────────────

function matchAccountType(groupName) {
  const group = (groupName || '').toLowerCase()
  if (group.includes('bank') || group.includes('cash') || group.includes('debtor') || group.includes('stock')) return 'CURRENT_ASSETS'
  if (group.includes('fixed asset')) return 'FIXED_ASSETS'
  if (group.includes('loan')) return 'LONG_TERM_LIABILITIES'
  if (group.includes('creditor') || group.includes('dutie') || group.includes('liabilit')) return 'CURRENT_LIABILITIES'
  if (group.includes('capital') || group.includes('reserve')) return 'EQUITY'
  if (group.includes('income') || group.includes('sale')) return group.includes('direct') ? 'DIRECT_INCOME' : 'INDIRECT_INCOME'
  if (group.includes('expense') || group.includes('purchase')) return group.includes('direct') ? 'DIRECT_EXPENSES' : 'INDIRECT_EXPENSES'
  return null
}

/**
 * Resolve a ledger's account type by walking its group chain upward until a
 * group name matches a rule. Matching only the direct parent misfiles the
 * hospital's custom groups ("Consultant", "Hope Salary Exp", "Mjpjay") — the
 * ancestor is the one that carries the Tally nature.
 * Returns { type, matchedGroup } — matchedGroup is null when nothing matched.
 */
function resolveAccountType(parentGroup, groupParents, reservedName) {
  // Tally's reserved "Profit & Loss A/c" sits under no group at all. It is
  // accumulated profit, so it belongs in equity — the group walk cannot reach it.
  if (canonicalCompanyKey(reservedName) === 'profitlossac') return { type: 'EQUITY', matchedGroup: reservedName }

  let current = parentGroup
  for (let hops = 0; current && hops < 20; hops++) {
    const type = matchAccountType(current)
    if (type) return { type, matchedGroup: current }
    current = groupParents.get(current)
  }
  return { type: 'CURRENT_ASSETS', matchedGroup: null }
}

// ─── Parsing ────────────────────────────────────────────────────────────────

function readTallyJson(filePath) {
  const buf = fs.readFileSync(filePath)
  // Tally exports UTF-16LE with a BOM; plain UTF-8 files are also accepted.
  const text = buf[0] === 0xff && buf[1] === 0xfe
    ? buf.toString('utf16le').replace(/^﻿/, '')
    : buf.toString('utf8').replace(/^﻿/, '')
  return JSON.parse(text)
}

function parseNum(value) {
  const n = parseFloat(value)
  return Number.isNaN(n) ? 0 : n
}

function stateOf(ledger) {
  const details = ledger.ledmailingdetails
  if (!Array.isArray(details) || details.length === 0) return null
  return details[0]?.state || null
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs()

  console.log('='.repeat(64))
  console.log(`Tally Masters JSON Import  —  ${new Date().toLocaleString()}`)
  console.log('='.repeat(64))

  if (!opts.file) {
    console.error('ERROR: no input file. Pass --file "/path/ALL LEDGER.json" or set TALLY_MASTERS_JSON.')
    process.exit(1)
  }
  if (!fs.existsSync(opts.file)) {
    console.error(`ERROR: file not found: ${opts.file}`)
    process.exit(1)
  }
  if (!SUPABASE_KEY && !opts.dryRun) {
    console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY is not set.')
    console.error('Get it from: Supabase Dashboard → Project Settings → API → service_role key')
    console.error('Add it to .env, or re-run with --dry-run to preview without writing.')
    process.exit(1)
  }

  console.log(`File:     ${opts.file}`)
  console.log(`Company:  ${opts.company}`)
  console.log(`Mode:     ${opts.dryRun ? 'DRY RUN (nothing will be written)' : 'WRITE'}`)
  console.log('')

  // ── Parse ────────────────────────────────────────────────────────────────

  const data = readTallyJson(opts.file)
  const messages = data.tallymessage || []

  const ledgers = messages.filter((m) => m?.metadata?.type === 'Ledger')
  const groupsByName = new Map()
  for (const m of messages) {
    // The export repeats each master; last one wins.
    if (m?.metadata?.type === 'Group') groupsByName.set(m.metadata.name, m)
  }

  const groupParents = new Map()
  for (const [name, group] of groupsByName) groupParents.set(name, group.parent || null)

  console.log(`[PARSE] ${ledgers.length} ledgers, ${groupsByName.size} groups`)

  const withOpening = ledgers.filter((l) => l.openingbalance !== undefined)
  const openingSum = withOpening.reduce((sum, l) => sum + parseNum(l.openingbalance), 0)
  console.log(`[PARSE] ${withOpening.length} ledgers carry an opening balance (the rest are zero)`)
  console.log(`[PARSE] opening balance sum: ${openingSum.toFixed(2)}`)

  if (Math.abs(openingSum) > 1) {
    console.error(`ERROR: opening balances do not net to zero (${openingSum.toFixed(2)}).`)
    console.error('A Tally masters export should be a balanced trial balance — aborting.')
    process.exit(1)
  }

  // ── Map ──────────────────────────────────────────────────────────────────

  const typeCounts = {}
  const unmatchedGroups = {}
  const mapped = ledgers.map((ledger) => {
    const name = ledger.metadata.name
    const parentGroup = ledger.parent || null
    const opening = parseNum(ledger.openingbalance)
    const { type, matchedGroup } = resolveAccountType(parentGroup, groupParents, ledger.metadata.reservedname)

    typeCounts[type] = (typeCounts[type] || 0) + 1
    if (!matchedGroup) unmatchedGroups[parentGroup || '(no group)'] = (unmatchedGroups[parentGroup || '(no group)'] || 0) + 1

    return { name, guid: ledger.guid || null, parentGroup, opening, accountType: type, state: stateOf(ledger), raw: ledger }
  })

  console.log('')
  console.log('[MAP] ledgers per account type:')
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`        ${String(count).padStart(5)}  ${type}`)
  }

  const unmatchedEntries = Object.entries(unmatchedGroups).sort((a, b) => b[1] - a[1])
  if (unmatchedEntries.length > 0) {
    const total = unmatchedEntries.reduce((sum, [, count]) => sum + count, 0)
    console.log('')
    console.log(`[MAP] ${total} ledgers fell back to CURRENT_ASSETS (no rule matched their group chain):`)
    for (const [group, count] of unmatchedEntries) console.log(`        ${String(count).padStart(5)}  ${group}`)
  }

  if (opts.dryRun) {
    console.log('')
    console.log('Dry run complete — nothing written.')
    return
  }

  // ── Resolve companies ────────────────────────────────────────────────────

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
  console.log('')

  const { data: configs, error: configError } = await supabase
    .from('tally_config')
    .select('id, company_name, is_active')
  if (configError) { console.error(`ERROR: could not read tally_config: ${configError.message}`); process.exit(1) }

  const configRow = (configs || []).find((c) => canonicalCompanyKey(c.company_name) === canonicalCompanyKey(opts.company))
  if (!configRow) {
    console.error(`ERROR: no tally_config row matches "${opts.company}".`)
    console.error('Available companies:')
    for (const c of configs || []) console.error(`  - ${c.company_name}`)
    console.error('Create the config in the app (/tally) first, or pass --company with one of the names above.')
    process.exit(1)
  }
  console.log(`[COMPANY] tally_config: ${configRow.company_name} (${configRow.id})`)

  const { data: companies, error: companyError } = await supabase
    .from('companies')
    .select('id, company_name')
    .eq('is_active', true)
  if (companyError) { console.error(`ERROR: could not read companies: ${companyError.message}`); process.exit(1) }

  const company = (companies || []).find((c) => accountingCompanyKey(c.company_name) === accountingCompanyKey(opts.company))
  if (company) console.log(`[COMPANY] accounting company: ${company.company_name} (${company.id})`)
  else console.log(`[COMPANY] no accounting company matches "${opts.company}" — skipping chart_of_accounts mirror`)

  const now = new Date().toISOString()

  // ── Write: groups ────────────────────────────────────────────────────────

  const groupRows = [...groupsByName.values()].map((group) => ({
    company_id: configRow.id,
    name: group.metadata.name,
    parent_group: group.parent || null,
    nature_of_group: group.metadata.reservedname || null,
    is_revenue: group.isrevenue === true,
    is_deemed_positive: group.isdeemedpositive === true,
    raw_data: group,
    last_synced_at: now,
  }))

  const groupsSynced = await upsertChunks(supabase, 'tally_groups', groupRows, { onConflict: 'name' })
  console.log(`[GROUPS] ${groupsSynced}/${groupRows.length} synced`)

  // ── Write: ledgers ───────────────────────────────────────────────────────
  // is_mapped / adamrit_entity_id are deliberately absent — they are set by hand
  // in TallyMapping.tsx and must survive a re-import.

  const ledgerRows = mapped.map((l) => ({
    company_id: configRow.id,
    name: l.name,
    tally_guid: l.guid,
    parent_group: l.parentGroup,
    opening_balance: l.opening, // Tally's sign kept: + = Dr, - = Cr
    closing_balance: null,      // not in a masters export — never fake a zero
    address: l.state,
    phone: null,
    email: null,
    gst_number: null,
    pan_number: null,
    raw_data: l.raw,
    last_synced_at: now,
  }))

  const ledgersSynced = await upsertChunks(supabase, 'tally_ledgers', ledgerRows, { onConflict: 'company_id,name' })
  console.log(`[LEDGERS] ${ledgersSynced}/${ledgerRows.length} synced`)

  // ── Write: chart of accounts ─────────────────────────────────────────────

  let accountsSynced = 0
  if (company) {
    const { data: existing, error: existingError } = await supabase
      .from('chart_of_accounts')
      .select('account_name')
      .eq('company_id', company.id)
    if (existingError) { console.error(`ERROR: could not read chart_of_accounts: ${existingError.message}`); process.exit(1) }

    const existingNames = new Set((existing || []).map((a) => a.account_name.trim().toLowerCase()))
    const accountRows = mapped
      .filter((l) => !existingNames.has(l.name.trim().toLowerCase()))
      .map((l) => ({
        company_id: company.id,
        account_code: tallyChartAccountCode(company.id, l.name),
        account_name: l.name,
        account_type: l.accountType,
        account_group: l.parentGroup,
        opening_balance: Math.abs(l.opening),
        opening_balance_type: l.opening < 0 ? 'CR' : 'DR',
        is_active: true,
      }))

    const skipped = mapped.length - accountRows.length
    accountsSynced = await upsertChunks(supabase, 'chart_of_accounts', accountRows, { onConflict: 'account_code' })
    console.log(`[ACCOUNTS] ${accountsSynced}/${accountRows.length} synced (${skipped} already existed, left untouched)`)
  }

  // ── Sync log ─────────────────────────────────────────────────────────────

  const total = groupsSynced + ledgersSynced + accountsSynced
  const { error: logError } = await supabase.from('tally_sync_log').insert({
    company_id: configRow.id,
    sync_type: 'masters_json_import',
    direction: 'inward',
    status: 'completed',
    records_synced: total,
    completed_at: now,
  })
  if (logError) console.warn(`  [WARN] could not write sync log: ${logError.message}`)

  console.log('')
  console.log('─'.repeat(64))
  console.log('Import complete.')
  console.log(`  Groups:            ${groupsSynced}`)
  console.log(`  Ledgers:           ${ledgersSynced}`)
  console.log(`  Chart of accounts: ${accountsSynced}`)
  console.log(`  Total:             ${total} records`)
  console.log('')
  console.log('Closing balances are NOT included — this is a masters-only export.')
  console.log('To get them, export a Trial Balance or the Day Book vouchers from Tally.')
  console.log('─'.repeat(64))
}

async function upsertChunks(supabase, table, rows, options) {
  let synced = 0
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)
    const { error } = await supabase.from(table).upsert(chunk, { ...options, ignoreDuplicates: false })
    if (error) console.error(`  [ERROR] ${table} rows ${i}-${i + chunk.length - 1}: ${error.message}`)
    else synced += chunk.length
  }
  return synced
}

main().catch((err) => {
  console.error('FATAL:', err.message)
  process.exit(1)
})
