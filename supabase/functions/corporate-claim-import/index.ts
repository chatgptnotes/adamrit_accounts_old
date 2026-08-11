import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/service-client.ts';

type IncomingRow = {
  rowNumber: number;
  originalValues: Record<string, string>;
  normalizedValues: Record<string, string | number | null>;
  issues: string[]
};
type IncomingFile = {
  fileName: string;
  fileType: string;
  reportDate: string | null;
  headers: string[];
  rows: IncomingRow[];
  fatalErrors: string[]
};

const permittedRoles = new Set(['superadmin', 'super_admin', 'ca', 'admin', 'billing']);
const stages = new Set(['under_treatment','claims_to_be_submitted','claims_sent_to_bank','pending_with_payer','payment_initiated','payment_accomplished','rejected']);
const validVerificationStates = new Set(['matched', 'unmatched', 'ambiguous', 'conflict', 'invalid', 'not_checked']);
const validAdmissionStatuses = new Set(['active_ipd', 'discharged', 'not_ipd', 'no_visit', 'not_matched', 'ambiguous', 'conflict', 'not_checked']);

const hash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))).map((item) => item.toString(16).padStart(2, '0')).join('');
const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Scheme classification from Program ID prefix - never guess */
const schemeOf = (value: unknown) => {
  const id = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (id.startsWith('PJ')) return 'PMJAY';
  if (id.startsWith('MJ')) return 'MJPJAY';
  return 'UNRESOLVED';
};

/** Stage detection from file type and Case Status */
const stageOf = (fileType: string, row: IncomingRow) => {
  if (fileType === 'claims_approved_from_bank') {
    const status = String(row.originalValues['Case Status'] || '').toLowerCase();
    if (status.includes('accomplished')) return 'payment_accomplished';
    if (status.includes('initiated')) return 'payment_initiated';
    return null;
  }
  const map: Record<string, string> = {
    under_treatment: 'under_treatment',
    claims_to_be_submitted: 'claims_to_be_submitted',
    claims_sent_to_bank: 'claims_sent_to_bank',
    pending_with_payer: 'pending_with_payer',
    claims_rejected: 'rejected'
  };
  return map[fileType] || null;
};

const sanitizeId = (value: unknown) => String(value || '').replace(/[^A-Za-z0-9-]/g, '');

/** Determine admission status from visit data */
const determineAdmissionStatus = (visit: { patient_type?: string | null; admission_date?: string | null; discharge_date?: string | null } | null): string => {
  if (!visit) return 'no_visit';
  if (visit.patient_type !== 'IPD') return 'not_ipd';
  if (!visit.admission_date) return 'not_ipd';
  if (visit.discharge_date) return 'discharged';
  return 'active_ipd';
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

    const body = await request.json() as {
      hospitalName?: string;
      schemeCode?: string;
      sourceKind?: string;
      files?: IncomingFile[];
      contentFingerprints?: string[]
    };

    const hospitalName = String(body.hospitalName || '').trim();
    const schemeCode = String(body.schemeCode || '').trim().toUpperCase();
    const files = body.files || [];

    if (!hospitalName || !['PMJAY','MJPJAY'].includes(schemeCode) || !files.length) {
      throw new Error('Hospital, PMJAY/MJPJAY scheme, and at least one file are required.');
    }

    if (files.some((file) => file.fatalErrors.length || !stages.has(file.fileType) && file.fileType !== 'claims_approved_from_bank')) {
      throw new Error('Every file must pass validation before import.');
    }

    // Check for duplicate files BEFORE creating batch
    const types = new Set(files.map((file) => file.fileType));
    const snapshotState = ['under_treatment','claims_to_be_submitted','claims_sent_to_bank','pending_with_payer','claims_approved_from_bank','claims_rejected']
      .every((type) => types.has(type)) ? 'complete' : 'incomplete';
    const reportDate = files.map((file) => file.reportDate).find(Boolean) || null;
    const suppliedHashes = body.contentFingerprints || [];
    const fileHashes = await Promise.all(files.map(async (file, index) =>
      suppliedHashes[index] || hash({
        type: file.fileType,
        reportDate: file.reportDate,
        headers: file.headers,
        rows: file.rows.map((row) => row.originalValues)
      })
    ));

    const duplicateChecks = await Promise.all(fileHashes.map((sourceHash) =>
      db.from('corporate_claim_import_files').select('id').eq('source_hash', sourceHash).maybeSingle()
    ));
    const newFiles = files.filter((_, index) => !duplicateChecks[index].data);
    const duplicateFiles = files.length - newFiles.length;

    if (!newFiles.length) {
      return new Response(JSON.stringify({
        alreadyImported: true,
        duplicateFiles,
        validRows: 0,
        invalidRows: 0,
        duplicateRows: files.reduce((total, file) => total + file.rows.length, 0)
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const totalRows = newFiles.reduce((total, file) => total + file.rows.length, 0);
    const { data: batch, error: batchError } = await db.from('corporate_claim_import_batches').insert({
      hospital_name: hospitalName,
      scheme_code: schemeCode,
      source_kind: body.sourceKind === 'system_initial_import' ? 'system_initial_import' : 'portal',
      portal_report_date: reportDate,
      snapshot_state: snapshotState,
      status: 'processing',
      total_rows: totalRows,
      created_by: authData.user.email
    }).select('id').single();

    if (batchError) throw batchError;

    let validRows = 0;
    let invalidRows = 0;
    let matchedRows = 0;
    let unmatchedRows = 0;
    let ambiguousRows = 0;
    let conflictRows = 0;
    let duplicateRows = 0;

    for (const file of newFiles) {
      const sourceHash = fileHashes[files.indexOf(file)];
      const { data: fileRow, error: fileError } = await db.from('corporate_claim_import_files').insert({
        batch_id: batch.id,
        source_file_name: file.fileName,
        source_hash: sourceHash,
        mime_type: null,
        detected_file_type: file.fileType,
        delimiter: '^',
        header_map: file.headers,
        total_rows: file.rows.length,
        valid_rows: file.rows.filter((row) => !row.issues.length).length,
        invalid_rows: file.rows.filter((row) => row.issues.length).length
      }).select('id').single();

      if (fileError) throw fileError;

      for (const row of file.rows) {
        const fingerprint = await hash({ sourceHash, row: row.originalValues });
        const duplicate = await db.from('corporate_claim_import_rows').select('id').eq('row_fingerprint', fingerprint).maybeSingle();
        if (duplicate.data) {
          duplicateRows += 1;
          continue;
        }

        const stage = stageOf(file.fileType, row);
        const resolvedScheme = schemeOf(row.normalizedValues.program_id);
        const schemeConflict = resolvedScheme !== 'UNRESOLVED' && resolvedScheme !== schemeCode;

        if (row.issues.length || !stage || schemeConflict) {
          invalidRows += 1;
          await db.from('corporate_claim_import_rows').insert({
            import_file_id: fileRow.id,
            row_number: row.rowNumber,
            row_fingerprint: fingerprint,
            original_values: row.originalValues,
            normalized_values: row.normalizedValues,
            detected_stage: stage,
            parse_errors: row.issues.length ? row.issues : [schemeConflict ? `Program ID belongs to ${resolvedScheme}, not ${schemeCode}.` : 'Government stage could not be determined.']
          });
          continue;
        }

        validRows += 1;
        const normalized = row.normalizedValues;
        const registration = String(normalized.registration_id || '');
        const claimScheme = resolvedScheme === 'UNRESOLVED' ? 'UNRESOLVED' : schemeCode;

        // Find or create claim
        const { data: foundClaim } = await db.from('corporate_claims')
          .select('id,current_stage,current_source_observed_on,paid_amount,verification_state,admission_status')
          .eq('hospital_name', hospitalName)
          .eq('scheme_code', claimScheme)
          .eq('normalized_registration_id', registration)
          .maybeSingle();

        let claim = foundClaim;
        if (!claim) {
          const { data, error } = await db.from('corporate_claims').insert({
            hospital_name: hospitalName,
            scheme_code: claimScheme,
            government_registration_id: row.originalValues['Registration ID'],
            normalized_registration_id: registration,
            government_program_id: row.originalValues['Program ID'],
            normalized_program_id: normalized.program_id,
            beneficiary_name: row.originalValues['Beneficiary Name'],
            current_stage: stage,
            raw_government_status: row.originalValues['Case Status'] || null,
            payment_state: stage === 'payment_accomplished' ? (numberOrNull(normalized.paid_amount) || 0) > 0 ? 'received' : 'unknown' :
              stage === 'payment_initiated' || stage === 'claims_sent_to_bank' || stage === 'pending_with_payer' ? 'pending' :
              stage === 'rejected' ? 'rejected' : 'not_due',
            claimed_amount: numberOrNull(normalized.claim_amount),
            approved_amount: numberOrNull(normalized.approved_amount),
            paid_amount: numberOrNull(normalized.paid_amount) || 0,
            current_source_observed_on: file.reportDate,
            last_seen_at: new Date().toISOString(),
            verification_state: 'not_checked',
            admission_status: 'not_checked'
          }).select('id,current_stage,current_source_observed_on,paid_amount').single();
          if (error) throw error;
          claim = data;
        } else if (!claim.current_source_observed_on || !file.reportDate || file.reportDate >= claim.current_source_observed_on) {
          await db.from('corporate_claims').update({
            current_stage: stage,
            raw_government_status: row.originalValues['Case Status'] || null,
            current_source_observed_on: file.reportDate,
            last_seen_at: new Date().toISOString(),
            approved_amount: numberOrNull(normalized.approved_amount),
            paid_amount: numberOrNull(normalized.paid_amount) || claim.paid_amount,
            updated_at: new Date().toISOString()
          }).eq('id', claim.id);
        }

        const { data: importRow, error: rowError } = await db.from('corporate_claim_import_rows').insert({
          import_file_id: fileRow.id,
          claim_id: claim.id,
          row_number: row.rowNumber,
          row_fingerprint: fingerprint,
          original_values: row.originalValues,
          normalized_values: row.normalizedValues,
          detected_stage: stage,
          match_outcome: 'unmatched'
        }).select('id').single();

        if (rowError) throw rowError;

        // Adamrit patient matching with exact identifiers only
        const registrationId = sanitizeId(row.originalValues['Registration ID']);
        const programId = sanitizeId(row.originalValues['Program ID']);

        const { data: patientCandidates } = await db.from('patients')
          .select('id,registration_id,patients_id,patient_name')
          .or(`registration_id.eq.${registrationId},patients_id.eq.${programId}`);

        const candidates = patientCandidates || [];

        if (candidates.length === 1) {
          // Exact match found - verify admission
          matchedRows += 1;
          const patient = candidates[0];

          const { data: visit } = await db.from('visits')
            .select('id,visit_id,patient_type,admission_date,discharge_date')
            .eq('patient_id', patient.id)
            .order('admission_date', { ascending: false, nullsFirst: false })
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const admissionStatus = determineAdmissionStatus(visit);

          await db.from('corporate_claims').update({
            matched_patient_id: patient.id,
            matched_visit_id: visit?.id || null,
            match_state: 'matched',
            verification_state: 'matched',
            admission_status: admissionStatus,
            verification_evidence: {
              match_method: 'exact_identifier',
              patient_id: patient.id,
              patient_name: patient.patient_name,
              visit_id: visit?.id || null,
              patient_type: visit?.patient_type || null,
              admission_date: visit?.admission_date || null,
              discharge_date: visit?.discharge_date || null
            },
            verified_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }).eq('id', claim.id);

          await db.from('corporate_claim_matches').insert({
            claim_id: claim.id,
            import_row_id: importRow.id,
            patient_id: patient.id,
            visit_id: visit?.id || null,
            method: 'exact_identifier',
            confidence: 'high',
            candidate_evidence: [{
              registration_id: registrationId,
              program_id: programId,
              patient_name: patient.patient_name
            }],
            is_approved: true,
            reviewed_by: authData.user.email
          });

          // Create review item for specific issues
          if (admissionStatus === 'no_visit') {
            await db.from('corporate_claim_review_items').insert({
              claim_id: claim.id,
              import_row_id: importRow.id,
              hospital_name: hospitalName,
              scheme_code: claimScheme,
              review_type: 'no_visit',
              details: { reason: 'Patient matched but no visit found.' }
            });
          } else if (admissionStatus === 'not_ipd') {
            await db.from('corporate_claim_review_items').insert({
              claim_id: claim.id,
              import_row_id: importRow.id,
              hospital_name: hospitalName,
              scheme_code: claimScheme,
              review_type: 'not_ipd',
              details: { reason: 'Patient visit is not IPD.' }
            });
          } else if (admissionStatus === 'discharged') {
            await db.from('corporate_claim_review_items').insert({
              claim_id: claim.id,
              import_row_id: importRow.id,
              hospital_name: hospitalName,
              scheme_code: claimScheme,
              review_type: 'discharged',
              details: { reason: 'Patient has been discharged.' }
            });
          }

        } else if (candidates.length > 1) {
          // Multiple matches - ambiguous
          ambiguousRows += 1;
          const verificationState = resolvedScheme === 'UNRESOLVED' ? 'conflict' : 'ambiguous';
          const admissionStatus = resolvedScheme === 'UNRESOLVED' ? 'conflict' : 'ambiguous';

          await db.from('corporate_claims').update({
            verification_state: verificationState,
            admission_status: admissionStatus,
            verification_evidence: {
              candidate_count: candidates.length,
              candidates: candidates.map(p => ({ id: p.id, registration_id: p.registration_id, patients_id: p.patients_id, patient_name: p.patient_name })),
              reason: 'Multiple Adamrit patients matched the identifiers.'
            },
            verified_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }).eq('id', claim.id);

          await db.from('corporate_claim_review_items').insert({
            claim_id: claim.id,
            import_row_id: importRow.id,
            hospital_name: hospitalName,
            scheme_code: claimScheme,
            review_type: resolvedScheme === 'UNRESOLVED' ? 'scheme_resolution' : 'ambiguous',
            details: {
              reason: resolvedScheme === 'UNRESOLVED' ? 'Program ID does not begin with PJ or MJ.' : 'Multiple Adamrit patients matched the identifiers.',
              candidate_count: candidates.length
            }
          });

        } else {
          // No match - unmatched
          unmatchedRows += 1;
          const verificationState = resolvedScheme === 'UNRESOLVED' ? 'conflict' : 'unmatched';
          const admissionStatus = resolvedScheme === 'UNRESOLVED' ? 'conflict' : 'not_matched';

          if (resolvedScheme === 'UNRESOLVED') {
            conflictRows += 1;
          }

          await db.from('corporate_claims').update({
            verification_state: verificationState,
            admission_status: admissionStatus,
            verification_evidence: {
              candidate_count: 0,
              reason: resolvedScheme === 'UNRESOLVED' ? 'Program ID does not begin with PJ or MJ.' : 'No Adamrit patient found with matching Registration ID or Program ID.'
            },
            verified_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }).eq('id', claim.id);

          await db.from('corporate_claim_review_items').insert({
            claim_id: claim.id,
            import_row_id: importRow.id,
            hospital_name: hospitalName,
            scheme_code: claimScheme,
            review_type: resolvedScheme === 'UNRESOLVED' ? 'unresolved_scheme' : 'unmatched',
            details: {
              reason: resolvedScheme === 'UNRESOLVED' ? 'Program ID does not begin with PJ or MJ.' : 'No Adamrit patient found with matching identifiers.'
            }
          });
        }

        // Record stage history
        await db.from('corporate_claim_status_history').insert({
          claim_id: claim.id,
          import_row_id: importRow.id,
          prior_stage: foundClaim?.current_stage || null,
          new_stage: stage,
          raw_source_status: row.originalValues['Case Status'] || null,
          effective_report_date: file.reportDate,
          actor: authData.user.email
        });

        // Record payment transactions for accomplished payments
        if (stage === 'payment_accomplished' && (numberOrNull(normalized.paid_amount) || 0) > 0) {
          await db.from('corporate_claim_payment_transactions').insert({
            claim_id: claim.id,
            import_row_id: importRow.id,
            transaction_fingerprint: await hash({ fingerprint, utr: normalized.utr }),
            approved_amount: numberOrNull(normalized.approved_amount),
            paid_amount: numberOrNull(normalized.paid_amount) || 0,
            payment_date: normalized.payment_date,
            utr: normalized.utr,
            tds_amount: numberOrNull(normalized.tds_amount),
            rf_amount: numberOrNull(normalized.rf_amount),
            government_case_status: row.originalValues['Case Status'] || null
          });
        }

        // Audit event
        await db.from('corporate_claim_audit_events').insert({
          claim_id: claim.id,
          batch_id: batch.id,
          import_file_id: fileRow.id,
          import_row_id: importRow.id,
          hospital_name: hospitalName,
          scheme_code: claimScheme,
          event_type: 'portal_row_imported',
          actor: authData.user.email,
          details: {
            source_file: file.fileName,
            row_number: row.rowNumber,
            verification_state: claim.verification_state,
            admission_status: claim.admission_status
          }
        });
      }
    }

    await db.from('corporate_claim_import_batches').update({
      status: 'completed',
      valid_rows: validRows,
      invalid_rows: invalidRows,
      matched_rows: matchedRows,
      unmatched_rows: unmatchedRows,
      ambiguous_rows: ambiguousRows,
      conflict_rows: conflictRows,
      duplicate_rows: duplicateRows,
      processed_at: new Date().toISOString()
    }).eq('id', batch.id);

    return new Response(JSON.stringify({
      batchId: batch.id,
      totalRows,
      validRows,
      invalidRows,
      matchedRows,
      unmatchedRows,
      ambiguousRows,
      conflictRows,
      duplicateRows,
      duplicateFiles,
      snapshotState
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Import failed.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
