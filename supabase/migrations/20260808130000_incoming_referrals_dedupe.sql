-- One Incoming Referral per patient ("Incoming Referrals - Suraj Arpit" tile).
--
-- Until now nothing stopped two marketing executives announcing the same
-- patient: the insert was a plain PostgREST write with no unique constraint
-- behind it. Two people then chased one referral and two referees could be
-- paid for one admission.
--
-- The patient has not arrived when the announcement is made, so there is no
-- UHID to key on. This migration adds the three things that CAN identify a
-- patient at that moment, in descending order of confidence:
--   patient_id / patient_uhid  — the announcer picked an already-registered
--                                patient from the search (returning patient)
--   patient_mobile             — the number given over the phone
--   patient_name               — the weakest signal, and the only one that
--                                can be overridden deliberately
--
-- The check lives in a SECURITY DEFINER function rather than in the tablet,
-- because incoming_referrals RLS is fully permissive: a screen-side check
-- alone loses the race between two tablets tapping Announce together. Two
-- partial unique indexes are the hard backstop underneath it.
--
-- Apply with: python3 scripts/apply-migration.py <this file>. Safe to run twice.
-- apply_migration() already runs this inside one transaction, so there is no
-- BEGIN/COMMIT here — EXECUTE refuses transaction commands.

-- ---------------------------------------------------------------------------
-- 1. The identity columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.incoming_referrals
  ADD COLUMN IF NOT EXISTS patient_id     UUID REFERENCES public.patients(id),
  ADD COLUMN IF NOT EXISTS patient_uhid   TEXT,
  ADD COLUMN IF NOT EXISTS patient_mobile TEXT;

-- patient_id is stamped at ANNOUNCE time when the announcer recognises a
-- returning patient; linked_patient_id is stamped later at LINK time. Either
-- one identifies the same human, hence the COALESCE everywhere below.
COMMENT ON COLUMN public.incoming_referrals.patient_id IS
  'Registered patient recognised at announce time (nullable — most announcements are for patients who have never been here).';
COMMENT ON COLUMN public.incoming_referrals.patient_uhid IS
  'Denormalised patients.patients_id, for display and for matching when the row was announced against a known UHID.';
COMMENT ON COLUMN public.incoming_referrals.patient_mobile IS
  'Mobile as typed; compared through norm_mobile() on the last 10 digits.';

-- ---------------------------------------------------------------------------
-- 2. Normalisers — IMMUTABLE so they can back a unique index
-- ---------------------------------------------------------------------------

-- Numbers arrive as "9373111709", "+91 93731 11709", "093731-11709". Only the
-- last 10 digits are the subscriber number; anything shorter is not a mobile
-- and must never collide with a real one, so it returns NULL.
CREATE OR REPLACE FUNCTION public.norm_mobile(p_value TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE
    WHEN length(regexp_replace(COALESCE(p_value, ''), '\D', '', 'g')) < 10 THEN NULL
    ELSE right(regexp_replace(p_value, '\D', '', 'g'), 10)
  END;
$function$;

-- Mirrors normalizeName in src/hooks/useClaimPatientMatch.ts so the database
-- and the screen agree on what "the same name" means: honorific dropped, then
-- every non-letter removed. "Mr. Ramesh  Patil." and "RAMESH PATIL" both
-- become 'rameshpatil'.
CREATE OR REPLACE FUNCTION public.norm_person_name(p_value TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $function$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(
        lower(COALESCE(p_value, '')),
        '^\s*(mr|mrs|ms|master|baby|dr|smt|shri)\.?\s+', ''
      ),
      '[^a-z]', '', 'g'
    ), '');
$function$;

-- ---------------------------------------------------------------------------
-- 3. Pre-flight — the unique indexes below cannot be created over existing
--    duplicates, and a half-applied migration is worse than a refused one.
-- ---------------------------------------------------------------------------

DO $preflight$
DECLARE
  v_dupes TEXT;
BEGIN
  SELECT string_agg(detail, '; ') INTO v_dupes FROM (
    SELECT 'patient ' || COALESCE(patient_id, linked_patient_id)::TEXT
           || ' x' || count(*)::TEXT AS detail
      FROM public.incoming_referrals
     WHERE status = 'ANNOUNCED' AND COALESCE(patient_id, linked_patient_id) IS NOT NULL
     GROUP BY COALESCE(patient_id, linked_patient_id) HAVING count(*) > 1
    UNION ALL
    SELECT 'mobile ' || public.norm_mobile(patient_mobile) || ' x' || count(*)::TEXT
      FROM public.incoming_referrals
     WHERE status = 'ANNOUNCED' AND public.norm_mobile(patient_mobile) IS NOT NULL
     GROUP BY public.norm_mobile(patient_mobile) HAVING count(*) > 1
  ) d;
  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Existing duplicate ANNOUNCED rows block the unique indexes: %. Cancel the stale ones from the tile, then re-run.', v_dupes;
  END IF;
  RAISE NOTICE 'Pre-flight OK — no duplicate ANNOUNCED rows';
END;
$preflight$;

-- ---------------------------------------------------------------------------
-- 4. The guard: every announce goes through this
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.announce_incoming_referral(
  p_patient_name     TEXT,
  p_coming_from      TEXT    DEFAULT NULL,
  p_referee_initials TEXT    DEFAULT NULL,
  p_is_direct        BOOLEAN DEFAULT false,
  p_documents        JSONB   DEFAULT '[]'::jsonb,
  p_announced_by     TEXT    DEFAULT NULL,
  p_patient_id       UUID    DEFAULT NULL,
  p_patient_uhid     TEXT    DEFAULT NULL,
  p_patient_mobile   TEXT    DEFAULT NULL,
  p_force_name       BOOLEAN DEFAULT false
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_name    TEXT := NULLIF(btrim(p_patient_name), '');
  v_ref     TEXT := NULLIF(btrim(p_referee_initials), '');
  v_uhid    TEXT := NULLIF(btrim(p_patient_uhid), '');
  v_mobile  TEXT := norm_mobile(p_patient_mobile);
  v_norm    TEXT := norm_person_name(p_patient_name);
  v_clash   RECORD;
  v_found   BOOLEAN;
  v_owner   TEXT;
  v_id      UUID;
BEGIN
  -- The screen validates these too; the function must stand on its own.
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Enter the patient''s name';
  END IF;
  IF NOT p_is_direct AND v_ref IS NULL THEN
    RAISE EXCEPTION 'Enter the referee''s initials';
  END IF;

  -- Only live claims block a new one: anything still awaited, plus anything
  -- linked in the last 30 days. A genuine re-admission after that is a new
  -- referral and must be announceable again.
  SELECT r.announced_by, r.referee_initials, r.patient_name, r.status,
         COALESCE(
           (p_patient_id IS NOT NULL AND COALESCE(r.patient_id, r.linked_patient_id) = p_patient_id)
           OR (v_uhid IS NOT NULL AND r.patient_uhid = v_uhid)
           OR (v_mobile IS NOT NULL AND norm_mobile(r.patient_mobile) = v_mobile), false) AS hard
    INTO v_clash
    FROM public.incoming_referrals r
   WHERE r.status <> 'CANCELLED'
     AND (r.status = 'ANNOUNCED' OR r.linked_at >= now() - INTERVAL '30 days')
     AND (
          (p_patient_id IS NOT NULL AND COALESCE(r.patient_id, r.linked_patient_id) = p_patient_id)
       OR (v_uhid IS NOT NULL AND r.patient_uhid = v_uhid)
       OR (v_mobile IS NOT NULL AND norm_mobile(r.patient_mobile) = v_mobile)
       OR (v_norm IS NOT NULL AND norm_person_name(r.patient_name) = v_norm)
     )
   -- A hard (id / mobile) clash outranks a name-only one, so the stronger
   -- message and the no-override path win when both exist.
   ORDER BY COALESCE(
          (p_patient_id IS NOT NULL AND COALESCE(r.patient_id, r.linked_patient_id) = p_patient_id)
       OR (v_uhid IS NOT NULL AND r.patient_uhid = v_uhid)
       OR (v_mobile IS NOT NULL AND norm_mobile(r.patient_mobile) = v_mobile), false
   ) DESC, r.created_at DESC
   LIMIT 1;
  v_found := FOUND;

  IF v_found THEN
    -- nisha@gmail.com reads back as "Nisha"; the referee initials come along
    -- so the blocked user knows both who to ask and which referee it was.
    v_owner := COALESCE(
      initcap(NULLIF(split_part(COALESCE(v_clash.announced_by, ''), '@', 1), '')),
      'another user');
    IF v_clash.referee_initials IS NOT NULL THEN
      v_owner := v_owner || ' (referee ' || v_clash.referee_initials || ')';
    END IF;

    IF v_clash.hard THEN
      RAISE EXCEPTION 'ALREADY_ANNOUNCED: This patient is already registered by % and cannot be registered again.', v_owner;
    ELSIF NOT p_force_name THEN
      RAISE EXCEPTION 'ALREADY_ANNOUNCED_NAME: This patient is already registered by % and cannot be registered again.', v_owner;
    END IF;
  END IF;

  INSERT INTO public.incoming_referrals (
    patient_name, coming_from, referee_initials, is_direct, documents,
    announced_by, patient_id, patient_uhid, patient_mobile
  ) VALUES (
    v_name, NULLIF(btrim(p_coming_from), ''),
    CASE WHEN p_is_direct THEN NULL ELSE v_ref END,
    p_is_direct, COALESCE(p_documents, '[]'::jsonb),
    NULLIF(btrim(p_announced_by), ''), p_patient_id, v_uhid,
    NULLIF(btrim(p_patient_mobile), '')
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.announce_incoming_referral(TEXT, TEXT, TEXT, BOOLEAN, JSONB, TEXT, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.announce_incoming_referral(TEXT, TEXT, TEXT, BOOLEAN, JSONB, TEXT, UUID, TEXT, TEXT, BOOLEAN) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Backstop — catches the race the function cannot see inside
-- ---------------------------------------------------------------------------

-- Partial and NULL-tolerant, the shape used by patients_hospital_aadhaar_unique.
-- Scoped to ANNOUNCED so a row leaves the index the moment it is linked, which
-- keeps the existing Link step and repeat admissions working untouched.
CREATE UNIQUE INDEX IF NOT EXISTS incoming_referrals_patient_uidx
  ON public.incoming_referrals (COALESCE(patient_id, linked_patient_id))
  WHERE status = 'ANNOUNCED';

CREATE UNIQUE INDEX IF NOT EXISTS incoming_referrals_mobile_uidx
  ON public.incoming_referrals (public.norm_mobile(patient_mobile))
  WHERE status = 'ANNOUNCED' AND public.norm_mobile(patient_mobile) IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 6. Proof — the guard must actually refuse, not merely exist
-- ---------------------------------------------------------------------------

DO $verify$
DECLARE
  v_n     INT;
  v_a     UUID;
  v_fired TEXT;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'incoming_referrals'
     AND column_name IN ('patient_id', 'patient_uhid', 'patient_mobile');
  IF v_n <> 3 THEN RAISE EXCEPTION 'incoming_referrals is missing identity columns (found % of 3)', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN ('incoming_referrals_patient_uidx', 'incoming_referrals_mobile_uidx');
  IF v_n <> 2 THEN RAISE EXCEPTION 'backstop indexes missing (found % of 2)', v_n; END IF;

  IF norm_mobile('+91 93731-11709') <> '9373111709' THEN RAISE EXCEPTION 'norm_mobile is wrong'; END IF;
  IF norm_mobile('12345') IS NOT NULL THEN RAISE EXCEPTION 'norm_mobile must reject short numbers'; END IF;
  IF norm_person_name('Mr. Ramesh  Patil.') <> norm_person_name('RAMESH PATIL')
    THEN RAISE EXCEPTION 'norm_person_name is wrong'; END IF;

  -- Round trip: announce, then prove a second announce on the same mobile is
  -- refused and a fresh one is not. Undone before the migration commits.
  v_a := announce_incoming_referral(
    '__dedupe_probe__', NULL, 'ZZ', false, '[]'::jsonb,
    'probe@example.com', NULL, NULL, '9000000001', false);

  BEGIN
    PERFORM announce_incoming_referral(
      'Someone Else Entirely', NULL, 'YY', false, '[]'::jsonb,
      'other@example.com', NULL, NULL, '91-9000000001', false);
    RAISE EXCEPTION 'guard did NOT fire on a duplicate mobile';
  EXCEPTION WHEN others THEN
    v_fired := SQLERRM;
    IF v_fired NOT LIKE 'ALREADY_ANNOUNCED:%' THEN RAISE; END IF;
  END;

  IF v_fired NOT LIKE '%Probe%' THEN
    RAISE EXCEPTION 'guard fired but did not name the announcer: %', v_fired;
  END IF;

  DELETE FROM public.incoming_referrals WHERE id = v_a;

  RAISE NOTICE 'OK — incoming_referrals dedupe ready. Guard proved: %', v_fired;
END;
$verify$;
