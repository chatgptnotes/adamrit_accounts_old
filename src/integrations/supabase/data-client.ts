// Dedicated anon data client.
//
// The default client in `./client` keeps `persistSession: true` so Google
// OAuth logins survive a refresh (AuthContext relies on getSession() /
// onAuthStateChange). The side effect: once a user has a Supabase Auth session,
// that session's `authenticated`-role JWT is attached to EVERY request made
// through that client, and our tables' RLS returns 0 rows under the
// `authenticated` role (the policies are written for the `anon` role that the
// app's custom User-table auth actually uses). That silently turns reads into
// empty results — e.g. the pharmacy notification bell and prescription items
// showing nothing for an OAuth-logged-in pharmacist.
//
// Use THIS client for ordinary data reads/writes so they always run as `anon`,
// independent of any OAuth session. Use `./client` only for `supabase.auth.*`.
import { createClient } from '@supabase/supabase-js';
import { reportingFetch } from './loudFailures';

const supabaseUrl = 'https://xvkxccqaopbnkvwgyfjv.supabase.co';
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2a3hjY3Fhb3Bibmt2d2d5Zmp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc4MjMwMTIsImV4cCI6MjA2MzM5OTAxMn0.z9UkKHDm4RPMs_2IIzEPEYzd3-sbQSF6XpxaQg3vZhU';

export const supabaseData = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  // Same fetch as the main client, so a signed-in member of staff reaches the
  // database as themselves here too. Without it this client is permanently
  // `anon`, and every policy that asks who is calling would refuse it -- which
  // is what stands between the patient tables and a real access rule today.
  // No behaviour changes while SUPABASE_USER_JWT is off: there is no token to
  // attach, and the request goes out exactly as before.
  global: { fetch: reportingFetch },
});
