-- Close public."User" to the browser.
--
-- WHAT IS WRONG TODAY
-- Every request the browser makes to Supabase runs as the Postgres `anon` role
-- (or `authenticated` for the Google-OAuth users), and the anon key is hardcoded
-- in the JS bundle. "User" has no RLS and no column restrictions, so anyone who
-- opens devtools can read all 91 bcrypt password hashes and every 4-digit staff
-- PIN, and can UPDATE any row - including setting their own role to superadmin.
--
-- WHY COLUMN PRIVILEGES AND NOT JUST RLS
-- RLS decides which ROWS you may see; it cannot hide a column. The secret here
-- is not a row, it is two columns. So the fix is column-level GRANTs: anon keeps
-- SELECT on the harmless columns and loses it on `password` and `staff_pin`.
-- PostgREST honours this, so `?select=full_name` still works and `?select=*`
-- (which expands to every column) is refused with 42501.
--
-- WHY THAT SHAPE SPECIFICALLY
-- Four screens read "User" with the anon key and are not being edited - one of
-- them, FinalBill.tsx, is feature-frozen and must keep working untouched:
--   FinalBill.tsx            select full_name        where role
--   AdvancePaymentModal.tsx  select full_name,email,is_active,hospital_type
--   TileConfiguration.tsx    select id,full_name,email,role,department,is_active
--   PatientJourneyLogs.tsx   select email,role       where hospital_type
-- Postgres requires SELECT on columns named in WHERE and ORDER BY as well as in
-- the output, so every column those four touch is in the safe list below.
--
-- WHERE THE WRITES WENT
-- All administrative writes now go through api/admin-users.ts, and password and
-- login writes through api/auth-session.ts. Both authenticate the caller from
-- the signed hmis_session cookie and use the service-role key, which bypasses
-- RLS entirely. That is why anon needs no write grant at all.
--
-- DO NOT RUN THIS UNTIL those API routes are live in production and have been
-- exercised. Applied too early it breaks User Management, the forced password
-- change, and login stamping all at once.
--
-- ROLLBACK, if something unexpected reads this table:
--   GRANT SELECT ON public."User" TO anon, authenticated;

BEGIN;

-- Fail loudly on a column this migration has never seen, rather than silently
-- leaving a new secret readable or a new harmless column unreadable.
DO $$
DECLARE
  safe_cols   TEXT[] := ARRAY[
    'id','full_name','employee_id','email','phone','role','hospital_type',
    'company_id','department','designation','is_active','must_change_password',
    'hr_pulse_can_view_all','last_login_at','last_login','password_changed_at',
    'profile_photo','created_at','updated_at'
  ];
  secret_cols TEXT[] := ARRAY['password','staff_pin'];
  unknown_cols TEXT[];
  c TEXT;
BEGIN
  SELECT array_agg(column_name ORDER BY column_name) INTO unknown_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'User'
    AND NOT (column_name = ANY (safe_cols))
    AND NOT (column_name = ANY (secret_cols));

  IF unknown_cols IS NOT NULL THEN
    RAISE EXCEPTION
      'Unclassified column(s) on public."User": %. Decide whether each is safe for the browser to read, add it to safe_cols or secret_cols, and re-run.',
      unknown_cols;
  END IF;

  REVOKE ALL ON public."User" FROM anon, authenticated;

  FOREACH c IN ARRAY safe_cols LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'User' AND column_name = c
    ) THEN
      EXECUTE format('GRANT SELECT(%I) ON public."User" TO anon, authenticated', c);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;

-- Every staff member is visible to every screen that lists staff; the secret was
-- never which rows exist, only what two of their columns contain. There is
-- deliberately no INSERT, UPDATE or DELETE policy: writes arrive as service_role.
DROP POLICY IF EXISTS "User_select_all" ON public."User";
CREATE POLICY "User_select_all" ON public."User" FOR SELECT USING (true);

COMMENT ON TABLE public."User" IS
  'Staff accounts. anon and authenticated hold column-level SELECT on the '
  'non-secret columns only; password and staff_pin are service-role only, and '
  'all writes go through api/admin-users.ts or api/auth-session.ts. A NEWLY '
  'ADDED COLUMN IS UNREADABLE BY THE BROWSER UNTIL EXPLICITLY GRANTED - see '
  'migration 20260809120000_lock_down_user_table.sql.';

-- Prove it, rather than reporting success and hoping.
DO $$
BEGIN
  IF has_column_privilege('anon', 'public."User"', 'password', 'SELECT')
     OR has_column_privilege('anon', 'public."User"', 'staff_pin', 'SELECT')
     OR has_column_privilege('authenticated', 'public."User"', 'password', 'SELECT')
     OR has_column_privilege('authenticated', 'public."User"', 'staff_pin', 'SELECT') THEN
    RAISE EXCEPTION 'Lockdown failed: the browser can still read password or staff_pin.';
  END IF;

  IF has_table_privilege('anon', 'public."User"', 'INSERT')
     OR has_table_privilege('anon', 'public."User"', 'UPDATE')
     OR has_table_privilege('anon', 'public."User"', 'DELETE')
     OR has_table_privilege('authenticated', 'public."User"', 'INSERT')
     OR has_table_privilege('authenticated', 'public."User"', 'UPDATE')
     OR has_table_privilege('authenticated', 'public."User"', 'DELETE') THEN
    RAISE EXCEPTION 'Lockdown failed: the browser can still write to "User".';
  END IF;

  -- The frozen FinalBill billing-executive lookup selects full_name and filters
  -- on role. If either is missing, that dropdown silently empties.
  IF NOT has_column_privilege('anon', 'public."User"', 'full_name', 'SELECT')
     OR NOT has_column_privilege('anon', 'public."User"', 'role', 'SELECT')
     OR NOT has_column_privilege('anon', 'public."User"', 'is_active', 'SELECT')
     OR NOT has_column_privilege('anon', 'public."User"', 'hospital_type', 'SELECT') THEN
    RAISE EXCEPTION 'Lockdown too tight: screens that legitimately list staff would break.';
  END IF;

  RAISE NOTICE 'public."User" locked down: secrets revoked, staff directory still readable.';
END $$;

COMMIT;
