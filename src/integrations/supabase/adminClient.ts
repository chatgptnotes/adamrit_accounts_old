import { createClient } from '@supabase/supabase-js';

// Admin client with service role key — bypasses RLS for internal tools
export const supabaseAdmin = createClient(
  'https://xvkxccqaopbnkvwgyfjv.supabase.co',
  import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY as string,
);
