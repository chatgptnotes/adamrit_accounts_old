import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/service-client.ts';

type IncomingRow = { rowNumber: number; originalValues: Record<string, string>; normalizedValues: Record<string, string | number | null>; issues: string[] };
type IncomingFile = { fileName: string; fileType: string; reportDate: string | null; headers: string[]; rows: IncomingRow[]; fatalErrors: string[] };
const permittedRoles = new Set(['superadmin', 'super_admin', 'ca', 'admin', 'doctor', 'nurse', 'user', 'marketing_manager']);
const stages = new Set(['under_treatment','claims_to_be_submitted','claims_sent_to_bank','pending_with_payer','payment_initiated','payment_accomplished','rejected']);

const hash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))).map((item) => item.toString(16).padStart(2, '0')).join('');
const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const stageOf = (fileType: string, row: IncomingRow) => {
  if (fileType === 'claims_approved_from_bank') {
    const status = String(row.originalValues['Case Status'] || '').toLowerCase();
    return status.includes('accomplished') ? 'payment_accomplished' : status.includes('initiated') ? 'payment_initiated' : null;
  }
  const map: Record<string, string> = { under_treatment: 'under_treatment', claims_to_be_submitted: 'claims_to_be_submitted', claims_sent_to_bank: 'claims_sent_to_bank', pending_with_payer: 'pending_with_payer', claims_rejected: 'rejected' };
  return map[fileType] || null;
};

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'POST is required.' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  try {
    const authHeader = request.headers.get('Authorization') || '';
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: authData, error: authError } = await anon.auth.getUser();
    if (authError || !authData.user?.email) throw new Error('A signed-in user is required to import claim data.');
    const db = getServiceClient();
    const { data: appUser } = await db.from('User').select('role').eq('email', authData.user.email).maybeSingle();
    if (!permittedRoles.has(String(appUser?.role || '').toLowerCase())) throw new Error('Your account has read-only access to claim tracking.');

    const body = await request.json() as { hospitalName?: string; schemeCode?: string; sourceKind?: string; files?: IncomingFile[] };
    const hospitalName = String(body.hospitalName || '').trim().toLowerCase();
    const schemeCode = String(body.schemeCode || '').trim().toUpperCase();
    const files = body.files || [];
    if (!hospitalName || !['PMJAY','MJPJAY'].includes(schemeCode) || !files.length) throw new Error('Hospital, PMJAY/MJPJAY scheme, and at least one file are required.');
    if (files.some((file) => file.fatalErrors.length || !stages.has(file.fileType) && file.fileType !== 'claims_approved_from_bank')) throw new Error('Every file must pass validation before import.');

    const types = new Set(files.map((file) => file.fileType));
    const snapshotState = ['under_treatment','claims_to_be_submitted','claims_sent_to_bank','pending_with_payer','claims_approved_from_bank','claims_rejected'].every((type) => types.has(type)) ? 'complete' : 'incomplete';
    const reportDate = files.map((file) => file.reportDate).find(Boolean) || null;
    const totalRows = files.reduce((total, file) => total + file.rows.length, 0);
    const { data: batch, error: batchError } = await db.from('corporate_claim_import_batches').insert({ hospital_name: hospitalName, scheme_code: schemeCode, source_kind: body.sourceKind === 'system_initial_import' ? 'system_initial_import' : 'portal', portal_report_date: reportDate, snapshot_state: snapshotState, status: 'processing', total_rows: totalRows, created_by: authData.user.email }).select('id').single();
    if (batchError) throw batchError;

    let validRows = 0; let invalidRows = 0; let unmatchedRows = 0; let duplicateRows = 0;
    for (const file of files) {
      const sourceHash = await hash({ name: file.fileName, type: file.fileType, reportDate: file.reportDate, rows: file.rows.map((row) => row.originalValues) });
      const existing = await db.from('corporate_claim_import_files').select('id').eq('source_hash', sourceHash).maybeSingle();
      if (existing.data) { duplicateRows += file.rows.length; continue; }
      const { data: fileRow, error: fileError } = await db.from('corporate_claim_import_files').insert({ batch_id: batch.id, source_file_name: file.fileName, source_hash: sourceHash, mime_type: null, detected_file_type: file.fileType, delimiter: '^', header_map: file.headers, total_rows: file.rows.length, valid_rows: file.rows.filter((row) => !row.issues.length).length, invalid_rows: file.rows.filter((row) => row.issues.length).length }).select('id').single();
      if (fileError) throw fileError;
      for (const row of file.rows) {
        const fingerprint = await hash({ sourceHash, row: row.originalValues });
        const duplicate = await db.from('corporate_claim_import_rows').select('id').eq('row_fingerprint', fingerprint).maybeSingle();
        if (duplicate.data) { duplicateRows += 1; continue; }
        const stage = stageOf(file.fileType, row);
        if (row.issues.length || !stage) {
          invalidRows += 1;
          await db.from('corporate_claim_import_rows').insert({ import_file_id: fileRow.id, row_number: row.rowNumber, row_fingerprint: fingerprint, original_values: row.originalValues, normalized_values: row.normalizedValues, detected_stage: stage, parse_errors: row.issues.length ? row.issues : ['Government stage could not be determined.'] });
          continue;
        }
        validRows += 1;
        const normalized = row.normalizedValues;
        const registration = String(normalized.registration_id || '');
        const { data: foundClaim } = await db.from('corporate_claims').select('id,current_stage,current_source_observed_on,paid_amount').eq('hospital_name', hospitalName).eq('scheme_code', schemeCode).eq('normalized_registration_id', registration).maybeSingle();
        let claim = foundClaim;
        if (!claim) {
          const { data, error } = await db.from('corporate_claims').insert({ hospital_name: hospitalName, scheme_code: schemeCode, government_registration_id: row.originalValues['Registration ID'], normalized_registration_id: registration, government_program_id: row.originalValues['Program ID'], normalized_program_id: normalized.program_id, beneficiary_name: row.originalValues['Beneficiary Name'], current_stage: stage, raw_government_status: row.originalValues['Case Status'] || null, payment_state: stage === 'payment_accomplished' ? (numberOrNull(normalized.paid_amount) || 0) > 0 ? 'received' : 'unknown' : stage === 'payment_initiated' || stage === 'claims_sent_to_bank' || stage === 'pending_with_payer' ? 'pending' : stage === 'rejected' ? 'rejected' : 'not_due', claimed_amount: numberOrNull(normalized.claim_amount), approved_amount: numberOrNull(normalized.approved_amount), paid_amount: numberOrNull(normalized.paid_amount) || 0, current_source_observed_on: file.reportDate, last_seen_at: new Date().toISOString() }).select('id,current_stage,current_source_observed_on,paid_amount').single();
          if (error) throw error; claim = data;
        } else if (!claim.current_source_observed_on || !file.reportDate || file.reportDate >= claim.current_source_observed_on) {
          await db.from('corporate_claims').update({ current_stage: stage, raw_government_status: row.originalValues['Case Status'] || null, current_source_observed_on: file.reportDate, last_seen_at: new Date().toISOString(), approved_amount: numberOrNull(normalized.approved_amount), paid_amount: numberOrNull(normalized.paid_amount) || claim.paid_amount, updated_at: new Date().toISOString() }).eq('id', claim.id);
        }
        const { data: importRow, error: rowError } = await db.from('corporate_claim_import_rows').insert({ import_file_id: fileRow.id, claim_id: claim.id, row_number: row.rowNumber, row_fingerprint: fingerprint, original_values: row.originalValues, normalized_values: row.normalizedValues, detected_stage: stage, match_outcome: 'unmatched' }).select('id').single();
        if (rowError) throw rowError;
        unmatchedRows += 1;
        await db.from('corporate_claim_status_history').insert({ claim_id: claim.id, import_row_id: importRow.id, prior_stage: foundClaim?.current_stage || null, new_stage: stage, raw_source_status: row.originalValues['Case Status'] || null, effective_report_date: file.reportDate, actor: authData.user.email });
        if (stage === 'payment_accomplished' && (numberOrNull(normalized.paid_amount) || 0) > 0) await db.from('corporate_claim_payment_transactions').insert({ claim_id: claim.id, import_row_id: importRow.id, transaction_fingerprint: await hash({ fingerprint, utr: normalized.utr }), approved_amount: numberOrNull(normalized.approved_amount), paid_amount: numberOrNull(normalized.paid_amount) || 0, payment_date: normalized.payment_date, utr: normalized.utr, tds_amount: numberOrNull(normalized.tds_amount), rf_amount: numberOrNull(normalized.rf_amount), government_case_status: row.originalValues['Case Status'] || null });
        await db.from('corporate_claim_review_items').insert({ claim_id: claim.id, import_row_id: importRow.id, hospital_name: hospitalName, scheme_code: schemeCode, review_type: 'unmatched', details: { reason: 'Phase 1 deliberately does not auto-attach a claim to an HMIS patient or admission.' } });
        await db.from('corporate_claim_audit_events').insert({ claim_id: claim.id, batch_id: batch.id, import_file_id: fileRow.id, import_row_id: importRow.id, hospital_name: hospitalName, scheme_code: schemeCode, event_type: 'portal_row_imported', actor: authData.user.email, details: { source_file: file.fileName, row_number: row.rowNumber } });
      }
    }
    await db.from('corporate_claim_import_batches').update({ status: 'completed', valid_rows: validRows, invalid_rows: invalidRows, unmatched_rows: unmatchedRows, duplicate_rows: duplicateRows, processed_at: new Date().toISOString() }).eq('id', batch.id);
    return new Response(JSON.stringify({ batchId: batch.id, totalRows, validRows, invalidRows, unmatchedRows, duplicateRows, snapshotState }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Import failed.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
