-- A blank is honest; 0000000000 is not.
--
-- 295 patient ledgers carry no mobile number, and the reason is not that the
-- field was left empty. It is that something was typed to get past it:
--
--     239  0000000000
--      24  (blank)
--      23  1234567890 / 1234567891
--       9  1020202020, 2147483647, 3543254235, ...
--
-- Every other phone column was checked -- emergency contact, second contact,
-- relative. Exactly four had a usable alternative, and two of those were
-- 9100000000, another placeholder. So the real numbers are not in this
-- database and no join will find them; only asking the patient will.
--
-- What can be fixed is the lie. A recorded 0000000000 reads as "we have their
-- number" to every screen, every report and every required-field check, while
-- an empty field reads as "we do not" -- which is the truth, and which is what
-- makes the gap chaseable. Nobody dials a blank by mistake either.
--
-- The rule is the normaliser's, not a hand-written list of junk: any non-empty
-- phone that norm_party_mobile refuses is not a reachable Indian mobile and is
-- therefore not a phone number. Numbers stored untidily ("+91 98765 43210",
-- "098765-43210") normalise cleanly and are left exactly as they are.
--
-- Reversible. Every value removed is kept, with the patient it came from.

CREATE TABLE IF NOT EXISTS public.patient_phone_placeholders_removed (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   UUID NOT NULL,
  patients_id  TEXT,
  removed_value TEXT NOT NULL,
  removed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.patient_phone_placeholders_removed IS
  'What was in patients.phone before a placeholder was blanked, so it can be '
  'put back. Written by 20260814220000.';

-- Only rows that have something which is not a phone number. A blank is
-- already the truth and is left alone, so re-running this changes nothing.
WITH junk AS (
  SELECT id, patients_id, phone
    FROM public.patients
   WHERE btrim(COALESCE(phone, '')) <> ''
     AND public.norm_party_mobile(phone) IS NULL
),
kept AS (
  INSERT INTO public.patient_phone_placeholders_removed (patient_id, patients_id, removed_value)
  SELECT j.id, j.patients_id, j.phone FROM junk j
  RETURNING patient_id
)
UPDATE public.patients p
   SET phone = NULL
  FROM kept k
 WHERE p.id = k.patient_id;

DO $verify$
DECLARE v_left INT; v_removed INT; v_usable_before INT; v_usable_now INT;
BEGIN
  -- (a) nothing unusable may survive in the column
  SELECT count(*) INTO v_left FROM public.patients
   WHERE btrim(COALESCE(phone, '')) <> ''
     AND public.norm_party_mobile(phone) IS NULL;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'ABORT: % patient(s) still hold an unusable phone number', v_left;
  END IF;

  -- (b) a reachable number must never have been touched. Every value in the
  -- keep-table has to be one the normaliser rejects; if a good number is in
  -- there, the rule above was wrong and this must not commit.
  SELECT count(*) INTO v_removed
    FROM public.patient_phone_placeholders_removed
   WHERE public.norm_party_mobile(removed_value) IS NOT NULL;
  IF v_removed > 0 THEN
    RAISE EXCEPTION 'ABORT: % reachable number(s) were blanked', v_removed;
  END IF;

  SELECT count(*) INTO v_removed FROM public.patient_phone_placeholders_removed;
  SELECT count(*) INTO v_usable_now FROM public.patients
   WHERE public.norm_party_mobile(phone) IS NOT NULL;
  RAISE NOTICE 'Placeholders removed (all runs): %. Patients with a reachable number: %',
    v_removed, v_usable_now;
END
$verify$;

NOTIFY pgrst, 'reload schema';
