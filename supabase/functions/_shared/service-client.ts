// =============================================================================
// Service-role Supabase client used inside Edge Functions.
// service_role key is read from secrets; never log it.
// =============================================================================

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export function getServiceClient(): SupabaseClient {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    return createClient(url, key, { auth: { persistSession: false } });
}

export function getInvokerId(req: Request): string | null {
    // Edge Functions automatically forward the user's JWT in the Authorization
    // header. We can't decode it without the JWT secret, but Supabase pre-parses
    // it into the `x-supabase-auth-user-id` header in newer runtimes.
    return req.headers.get('x-user-id') ?? null;
}
