import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/service-client.ts';

const permittedRoles = new Set(['superadmin', 'super_admin', 'ca', 'admin', 'billing']);

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'POST is required.' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const authHeader = request.headers.get('Authorization') || '';
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: authData, error: authError } = await anon.auth.getUser();
    if (authError || !authData.user?.email) throw new Error('A signed-in user is required.');

    const db = getServiceClient();
    const { data: appUser } = await db.from('User').select('role').eq('email', authData.user.email).maybeSingle();
    if (!permittedRoles.has(String(appUser?.role || '').toLowerCase())) throw new Error('Only Super Admin, Admin, and Billing users can update claim review data.');

    const body = await request.json() as {
      action?: string;
      claimId?: string;
      reviewItemId?: string;
      note?: string;
      resolutionType?: string;
      resolvedScheme?: string
    };

    if (!body.claimId || !['resolve_review', 'add_query_note', 'resolve_ambiguous', 'resolve_unmatched'].includes(String(body.action))) {
      throw new Error('Invalid claim tracking action.');
    }

    const { data: claim, error: claimError } = await db.from('corporate_claims')
      .select('id,hospital_name,scheme_code,verification_state,admission_status')
      .eq('id', body.claimId)
      .maybeSingle();

    if (claimError || !claim) throw new Error('Claim not found.');

    // Resolve review item
    if (body.action === 'resolve_review') {
      if (!body.reviewItemId) throw new Error('Review item is required.');

      const { data: reviewItem } = await db.from('corporate_claim_review_items')
        .select('review_type,details')
        .eq('id', body.reviewItemId)
        .eq('claim_id', claim.id)
        .maybeSingle();

      if (!reviewItem) throw new Error('Review item not found.');

      // Determine resolution based on review type
      let updates: { verification_state?: string; admission_status?: string; matched_patient_id?: string | null; matched_visit_id?: string | null } = {};

      switch (reviewItem.review_type) {
        case 'unmatched':
        case 'ambiguous':
          updates.verification_state = 'matched';
          break;
        case 'not_ipd':
          updates.admission_status = 'not_ipd';
          break;
        case 'discharged':
          updates.admission_status = 'discharged';
          break;
        case 'no_visit':
          updates.admission_status = 'no_visit';
          break;
        case 'unresolved_scheme':
          if (body.resolvedScheme && ['PMJAY', 'MJPJAY'].includes(body.resolvedScheme)) {
            updates = { ...updates, verification_state: 'matched' };
            await db.from('corporate_claims').update({ scheme_code: body.resolvedScheme }).eq('id', claim.id);
          }
          break;
      }

      const { error, count } = await db.from('corporate_claim_review_items')
        .update({
          status: 'resolved',
          resolved_by: authData.user.email,
          resolved_at: new Date().toISOString(),
          details: { ...reviewItem.details, resolution: body.resolutionType || 'resolved' }
        })
        .eq('id', body.reviewItemId)
        .eq('claim_id', claim.id)
        .eq('status', 'open');

      if (error) throw error;
      if (!count || count === 0) throw new Error('Review item not found or already resolved.');

      // Update claim state if applicable
      if (Object.keys(updates).length > 0) {
        await db.from('corporate_claims')
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq('id', claim.id);
      }

      await db.from('corporate_claim_audit_events').insert({
        claim_id: claim.id,
        hospital_name: claim.hospital_name,
        scheme_code: claim.scheme_code,
        event_type: 'review_resolved',
        actor: authData.user.email,
        details: { review_type: reviewItem.review_type, resolution: body.resolutionType }
      });

    } else if (body.action === 'add_query_note') {
      const note = String(body.note || '').trim();
      if (!note) throw new Error('A query note is required.');

      const { error: insertError } = await db.from('corporate_claim_queries').insert({
        claim_id: claim.id,
        source_kind: 'manual',
        hospital_action: note,
        workflow_state: 'active',
        actor: authData.user.email
      });

      if (insertError) throw insertError;

      const { error: updateError } = await db.from('corporate_claims')
        .update({ query_state: 'active', updated_at: new Date().toISOString() })
        .eq('id', claim.id);

      if (updateError) throw updateError;

      await db.from('corporate_claim_audit_events').insert({
        claim_id: claim.id,
        hospital_name: claim.hospital_name,
        scheme_code: claim.scheme_code,
        event_type: 'query_note_added',
        actor: authData.user.email,
        details: { note }
      });

    } else if (body.action === 'resolve_ambiguous' || body.action === 'resolve_unmatched') {
      // Manual resolution for ambiguous or unmatched claims
      if (!body.resolutionType) throw new Error('Resolution type is required.');

      let updates: { verification_state?: string; admission_status?: string; match_state?: string } = {};

      if (body.action === 'resolve_ambiguous') {
        updates = { verification_state: 'matched', match_state: 'manual_match' };
      } else if (body.action === 'resolve_unmatched') {
        if (body.resolutionType === 'manual_skip') {
          updates = { verification_state: 'matched', match_state: 'manual_skip' };
        } else {
          updates = { verification_state: 'matched', match_state: 'manual_match' };
        }
      }

      const { error: updateError } = await db.from('corporate_claims')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', claim.id);

      if (updateError) throw updateError;

      await db.from('corporate_claim_audit_events').insert({
        claim_id: claim.id,
        hospital_name: claim.hospital_name,
        scheme_code: claim.scheme_code,
        event_type: 'manual_resolution',
        actor: authData.user.email,
        details: { action: body.action, resolution: body.resolutionType }
      });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Claim workflow failed.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
