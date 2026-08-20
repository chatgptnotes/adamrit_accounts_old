#!/usr/bin/env node
/**
 * Import one company's sheet of the bank-only audit report
 * (bank-only-full-audit-fy2025-26.xlsx) into the audit evidence tables.
 *
 * Audit-only: writes ONLY to bank_reconciliation_batches and
 * bank_reconciliation_rows. Never touches vouchers, ledgers or any
 * tally_* table. Every row imports as pending_review — the xlsx
 * classification is carried along as advice, not as a decision.
 *
 * Duplicate-safe: the batch is unique on (company, file sha256, sheet), and
 * every row is unique on (company, fingerprint). Re-running the script skips
 * what is already there and says so.
 *
 * Usage:
 *   node scripts/import-bank-only-audit.cjs drm      <path-to-xlsx>
 *   node scripts/import-bank-only-audit.cjs ayushman <path-to-xlsx>
 *
 * Needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from .env).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

const COMPANIES = {
  drm: {
    company_id: '37548c73-14ac-4ba2-998e-d4ac14364151',
    sheet: 'DRM audit',
    label: 'DRM Hope Hospital Pvt Ltd',
  },
  ayushman: {
    company_id: '3201eb57-5cd5-49b2-af62-e4af0147e63a',
    sheet: 'Ayushman audit',
    label: 'Ayushman Nagpur Hospital',
  },
};

const ROOT = path.resolve(__dirname, '..');

const readEnv = () => {
  const env = { ...process.env };
  const file = path.join(ROOT, '.env');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const i = trimmed.indexOf('=');
      const key = trimmed.slice(0, i).trim();
      if (!env[key]) env[key] = trimmed.slice(i + 1).trim();
    }
  }
  return env;
};

const sha256 = (input) => crypto.createHash('sha256').update(input).digest('hex');

const main = async () => {
  const which = (process.argv[2] || '').toLowerCase();
  const xlsxPath = process.argv[3];
  const company = COMPANIES[which];
  if (!company || !xlsxPath) {
    console.error('Usage: node scripts/import-bank-only-audit.cjs <drm|ayushman> <path-to-xlsx>');
    process.exit(1);
  }
  if (!fs.existsSync(xlsxPath)) {
    console.error('File not found: ' + xlsxPath);
    process.exit(1);
  }

  const env = readEnv();
  const base = env.VITE_SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/';
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
  };

  const fileBuffer = fs.readFileSync(xlsxPath);
  const fileSha = sha256(fileBuffer);
  const wb = XLSX.read(fileBuffer);
  const ws = wb.Sheets[company.sheet];
  if (!ws) {
    console.error('Sheet "' + company.sheet + '" not found in ' + xlsxPath);
    process.exit(1);
  }
  const sheetRows = XLSX.utils.sheet_to_json(ws, { raw: true });
  console.log(company.label + ': ' + sheetRows.length + ' rows in sheet "' + company.sheet + '"');

  // -------------------------------------------------------------------------
  // Build the evidence rows. The xlsx already carries the fingerprint
  // material (company|bank|date|amount|reference|file|page); the ordinal is
  // appended because real statements repeat identical lines on one page.
  // -------------------------------------------------------------------------
  const ordinalSeen = new Map();
  const rows = [];
  for (const r of sheetRows) {
    const material = String(r['Fingerprint material (not a posting key)'] || '').trim();
    if (!material) throw new Error('Row without fingerprint material: ' + JSON.stringify(r));
    const parts = material.split('|');
    if (parts.length !== 7) throw new Error('Unexpected fingerprint material: ' + material);
    const [fpCompany, fpBank, fpDate, fpAmount, fpReference, fpFile, fpPage] = parts;
    if (fpCompany !== company.company_id) {
      throw new Error('Company mismatch in sheet row — expected ' + company.company_id + ' got ' + fpCompany);
    }

    const ordinal = (ordinalSeen.get(material) || 0) + 1;
    ordinalSeen.set(material, ordinal);

    // Zero is allowed: Saraswat prints informational Rs 0.00 lines and the
    // evidence must tie to the report row for row.
    const amount = Number(r['Signed amount']);
    if (!Number.isFinite(amount)) {
      throw new Error('Bad amount on ' + fpDate + ' ' + fpReference + ': ' + r['Signed amount']);
    }
    if (Math.abs(amount - Number(fpAmount)) > 0.005) {
      throw new Error('Amount disagrees with fingerprint material: ' + material);
    }

    rows.push({
      company_id: company.company_id,
      bank_ledger: String(r['Bank']).trim(),
      statement_date: String(r['Statement date']).trim(),
      signed_amount: amount,
      reference: fpReference || null,
      narration: r['Bank description'] != null ? String(r['Bank description']) : null,
      source_file: fpFile,
      source_page: Number(fpPage) || null,
      row_ordinal: ordinal,
      audit_classification: r['Classification'] != null ? String(r['Classification']) : null,
      candidate_details: r['Candidate details'] ? String(r['Candidate details']) : null,
      fingerprint: sha256(material + '|' + ordinal),
      dedupe_key: sha256([fpCompany, fpBank, fpDate, fpAmount, fpReference].join('|')),
      status: 'pending_review',
    });
  }

  // -------------------------------------------------------------------------
  // Batch: unique on (company, file sha, sheet). A conflict means this exact
  // file was already imported for this company — reuse that batch so a
  // re-run only fills whatever rows are missing.
  // -------------------------------------------------------------------------
  const batchQuery = 'bank_reconciliation_batches'
    + '?company_id=eq.' + company.company_id
    + '&source_sha256=eq.' + fileSha
    + '&source_sheet=eq.' + encodeURIComponent(company.sheet);
  let res = await fetch(base + batchQuery, { headers });
  let existing = await res.json();
  if (!res.ok) throw new Error('batch lookup failed: ' + JSON.stringify(existing));

  let batchId;
  if (existing.length > 0) {
    batchId = existing[0].id;
    console.log('Batch already exists (' + batchId + ') — re-run fills missing rows only.');
  } else {
    res = await fetch(base + 'bank_reconciliation_batches', {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        company_id: company.company_id,
        source_file_name: path.basename(xlsxPath),
        source_sheet: company.sheet,
        source_sha256: fileSha,
        imported_by: 'import-bank-only-audit.cjs',
      }),
    });
    const created = await res.json();
    if (!res.ok) throw new Error('batch insert failed: ' + JSON.stringify(created));
    batchId = created[0].id;
    console.log('Created batch ' + batchId);
  }

  // -------------------------------------------------------------------------
  // Rows, in chunks, duplicates skipped on (company_id, fingerprint).
  // A failed chunk aborts loudly — a failed write must never look like a
  // quiet day.
  // -------------------------------------------------------------------------
  const CHUNK = 500;
  let attempted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((row) => ({ ...row, batch_id: batchId }));
    res = await fetch(
      base + 'bank_reconciliation_rows?on_conflict=company_id,fingerprint',
      {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(chunk),
      }
    );
    if (!res.ok) {
      throw new Error('row insert failed at chunk ' + i + ': ' + res.status + ' ' + (await res.text()));
    }
    attempted += chunk.length;
    console.log('  ' + attempted + '/' + rows.length + ' sent');
  }

  // Count what the table actually holds for this batch, and stamp the batch.
  res = await fetch(
    base + 'bank_reconciliation_rows?batch_id=eq.' + batchId + '&select=id',
    { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } }
  );
  if (!res.ok) throw new Error('count failed: ' + (await res.text()));
  const total = Number((res.headers.get('content-range') || '/0').split('/')[1]);

  res = await fetch(base + 'bank_reconciliation_batches?id=eq.' + batchId, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ row_count: total }),
  });
  if (!res.ok) throw new Error('batch row_count update failed: ' + (await res.text()));

  console.log('');
  console.log(company.label + ' — sheet rows: ' + rows.length + ', rows now in batch: ' + total
    + (total === rows.length ? ' (complete)' : ' (MISMATCH — investigate)'));
  if (total !== rows.length) process.exit(1);
};

main().catch((err) => {
  console.error('IMPORT FAILED: ' + err.message);
  process.exit(1);
});
