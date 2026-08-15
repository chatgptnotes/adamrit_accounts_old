import { createClient } from '@supabase/supabase-js';
import { reportingFetch } from '@/integrations/supabase/loudFailures';

// Create a fresh Supabase client without corrupted types
const supabaseUrl = 'https://xvkxccqaopbnkvwgyfjv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2a3hjY3Fhb3Bibmt2d2d5Zmp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc4MjMwMTIsImV4cCI6MjA2MzM5OTAxMn0.z9UkKHDm4RPMs_2IIzEPEYzd3-sbQSF6XpxaQg3vZhU';

// Same fetch as the main client, so a signed-in member of staff reaches the
// database as themselves here too -- this client is used by the advance
// payment modal and the prescription queue, both of which read patients and
// visits. Left as a bare anon client, it would be refused the moment those
// tables get a real access rule. Nothing changes while SUPABASE_USER_JWT is
// off: there is no token to attach.
export const supabaseClient = createClient(supabaseUrl, supabaseKey, {
  global: { fetch: reportingFetch },
});

// Export for easy import
export default supabaseClient;