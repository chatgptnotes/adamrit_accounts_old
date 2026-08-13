-- Record of a one-off data fix: 36 passwords were stored in plain text.
--
-- The User table held 36 readable passwords against 71 properly hashed ones,
-- two of the 36 belonging to superadmin accounts, and one of those was the
-- digits 1 to 0 twice over. Anyone reaching that table, through the database,
-- a backup, an export or the admin API, could read them; and because people
-- reuse passwords, the exposure did not stop at this hospital.
--
-- Each was bcrypted in place at cost 12, the same the application uses when it
-- creates a user or resets one. No password changed, so nobody was locked out:
-- api/auth-session.ts already reads either form
--   stored.startsWith('$2') ? bcrypt.compare(...) : stored === password
-- and now takes the first branch. Verified afterwards by checking a known
-- password still matched its new hash, and a wrong one still did not.
--
-- Done through the application's own bcrypt rather than in SQL, because
-- pgcrypto is not installed here and inventing a second hashing path for the
-- same passwords is how the two drift apart. This file is the audit record.
--
-- Idempotent by nature: it asserts the work rather than repeating it.

DO $verify$
DECLARE v_plain INT; v_hashed INT;
BEGIN
  SELECT count(*) FILTER (WHERE password IS NOT NULL AND left(password, 2) <> '$2'),
         count(*) FILTER (WHERE password IS NOT NULL AND left(password, 2) =  '$2')
    INTO v_plain, v_hashed
  FROM public."User";

  IF v_plain > 0 THEN
    RAISE EXCEPTION 'ABORT: % password(s) are still stored in plain text', v_plain;
  END IF;

  RAISE NOTICE '% password(s) stored hashed, 0 readable', v_hashed;
END
$verify$;
