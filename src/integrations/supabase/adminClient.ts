// A service-role key must never ship in a browser bundle — it bypasses RLS and
// is visible to anyone. The only table this client touches (email_inbox) has RLS
// disabled and grants anon full access, so the regular anon client is sufficient.
// Re-export it under the old name to keep existing import sites working.
export { supabase as supabaseAdmin } from './client';
