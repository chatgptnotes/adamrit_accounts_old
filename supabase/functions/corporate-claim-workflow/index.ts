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
    const body = await request.json() as { action?: string; claimId?: string; reviewItemId?: string; note?: string };
    if (!body.claimId || !['resolve_review', 'add_query_note'].includes(String(body.action))) throw new Error('Invalid claim tracking action.');
    const { data: claim, error: claimError } = await db.from('corporate_claims').select('id,hospital_name,scheme_code').eq('id', body.claimId).maybeSingle();
    if (claimError || !claim) throw new Error('Claim not found.');
    if (body.action === 'resolve_review') {
      if (!body.reviewItemId) throw new Error('Review item is required.');
      const { error } = await db.from('corporate_claim_review_items').update({ status: 'resolved', resolved_by: authData.user.email, resolved_at: new Date().toISOString() }).eq('id', body.reviewItemId).eq('claim_id', claim.id).eq('status', 'open');
      if (error) throw error;
      await db.from('corporate_claim_audit_events').insert({ claim_id: claim.id, hospital_name: claim.hospital_name, scheme_code: claim.scheme_code, event_type: 'review_resolved', actor: authData.user.email, details: {} });
    } else {
      const note = String(body.note || '').trim(); if (!note) throw new Error('A query note is required.');
      const { error } = await db.from('corporate_claim_queries').insert({ claim_id: claim.id, source_kind: 'manual', hospital_action: note, workflow_state: 'active', actor: authData.user.email });
      if (error) throw error;
      await db.from('corporate_claims').update({ query_state: 'active', updated_at: new Date().toISOString() }).eq('id', claim.id);
      await db.from('corporate_claim_audit_events').insert({ claim_id: claim.id, hospital_name: claim.hospital_name, scheme_code: claim.scheme_code, event_type: 'query_note_added', actor: authData.user.email, details: { note } });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) { return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Claim workflow failed.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
});
