-- Let an announcement carry every referee, not just the first one.
--
-- THE ASK (17 Aug, from the owner): when two or more referees send the same
-- patient, the announce screen should record all of them.
--
-- WHERE THE LIST STOPS. The full list lives HERE, on the announcement, and
-- nowhere else. referee_initials stays exactly what it was -- ONE string, now
-- defined as the FIRST referee -- because everything downstream reads it as
-- one string: the frozen registration forms prefill from it
-- (PatientRegistrationForm.tsx collapses it into patients.relationship_manager),
-- and the Daily Revenue Report's rm_name fallback name-matches that text
-- against the RM master, where a joined "AB, CD" would match nobody. Who gets
-- paid is still decided at registration and on the Daily Revenue Report;
-- announcing extra names creates no second payable party.
--
-- NOTHING LIVE IS REDEFINED. announce_incoming_referral keeps its dedupe
-- guards and its exact signature; the new function CALLS it and then stores
-- the list on the row it created, in the same transaction. The verify block
-- asserts the live signature first and aborts on any surprise.

ALTER TABLE public.incoming_referrals
  ADD COLUMN IF NOT EXISTS referee_list JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.incoming_referrals.referee_list IS
  'Every referee named on the announcement, in the order they were picked. '
  'referee_initials holds the first of these (or the only one, for old rows) '
  'and remains what registration prefills and commission matching read.';

CREATE FUNCTION public.announce_incoming_referral_with_list(
  p_patient_name TEXT, p_coming_from TEXT, p_referee_list JSONB,
  p_is_direct BOOLEAN, p_documents JSONB, p_announced_by TEXT,
  p_patient_id UUID DEFAULT NULL, p_patient_uhid TEXT DEFAULT NULL,
  p_patient_mobile TEXT DEFAULT NULL, p_force_name BOOLEAN DEFAULT false
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_list JSONB; v_first TEXT; v_id UUID;
BEGIN
  -- Trim each entry, drop empties, keep order. jsonb_agg over a WITH ORDINALITY
  -- scan preserves the order the screen sent.
  SELECT COALESCE(jsonb_agg(to_jsonb(btrim(x.value)) ORDER BY x.ord), '[]'::jsonb)
    INTO v_list
    FROM jsonb_array_elements_text(COALESCE(p_referee_list, '[]'::jsonb))
      WITH ORDINALITY AS x(value, ord)
   WHERE btrim(x.value) <> '';

  IF NOT p_is_direct AND jsonb_array_length(v_list) = 0 THEN
    RAISE EXCEPTION 'Choose the RM or referee';
  END IF;

  v_first := CASE WHEN jsonb_array_length(v_list) > 0 THEN v_list->>0 ELSE NULL END;

  -- The existing function does the duplicate checks and the insert. Same
  -- transaction, so a failed list write cannot leave a half-made announcement.
  v_id := announce_incoming_referral(
    p_patient_name, p_coming_from, v_first, p_is_direct, p_documents,
    p_announced_by, p_patient_id, p_patient_uhid, p_patient_mobile, p_force_name);

  UPDATE incoming_referrals
     SET referee_list = CASE WHEN p_is_direct THEN '[]'::jsonb ELSE v_list END
   WHERE id = v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.announce_incoming_referral_with_list(TEXT, TEXT, JSONB, BOOLEAN, JSONB, TEXT, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.announce_incoming_referral_with_list(TEXT, TEXT, JSONB, BOOLEAN, JSONB, TEXT, UUID, TEXT, TEXT, BOOLEAN) TO anon, authenticated;

DO $verify$
DECLARE
  v_sig TEXT; v_n INT; v_id UUID; v_row RECORD;
BEGIN
  -- The function this one calls must be exactly the live signature it was
  -- written against.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'announce_incoming_referral';
  IF v_n <> 1 THEN RAISE EXCEPTION 'ABORT: % announce_incoming_referral overloads, expected 1', v_n; END IF;
  SELECT pg_get_function_identity_arguments(p.oid) INTO v_sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'announce_incoming_referral';
  IF v_sig <> 'p_patient_name text, p_coming_from text, p_referee_initials text, p_is_direct boolean, p_documents jsonb, p_announced_by text, p_patient_id uuid, p_patient_uhid text, p_patient_mobile text, p_force_name boolean' THEN
    RAISE EXCEPTION 'ABORT: announce_incoming_referral signature drifted: %', v_sig;
  END IF;

  -- Rehearsal: announce with two referees, read the row back, tear it down.
  -- No patient id and no mobile, so the dedupe backstop indexes are not
  -- touched; the name is one no human carries.
  v_id := announce_incoming_referral_with_list(
    'SELFTEST-REFEREE-LIST-DO-NOT-USE', 'selftest',
    '[" RM-A ", "", "Dr B"]'::jsonb, false, '[]'::jsonb, 'selftest');

  SELECT referee_initials, referee_list INTO v_row
    FROM incoming_referrals WHERE id = v_id;
  IF v_row.referee_initials <> 'RM-A' THEN
    RAISE EXCEPTION 'ABORT: first referee stored as %, expected RM-A', v_row.referee_initials;
  END IF;
  IF v_row.referee_list <> '["RM-A", "Dr B"]'::jsonb THEN
    RAISE EXCEPTION 'ABORT: list stored as %, expected ["RM-A", "Dr B"]', v_row.referee_list;
  END IF;

  DELETE FROM incoming_referrals WHERE id = v_id;

  -- A referred announcement with an empty list must still be refused.
  BEGIN
    PERFORM announce_incoming_referral_with_list(
      'SELFTEST-REFEREE-LIST-DO-NOT-USE', 'selftest',
      '[]'::jsonb, false, '[]'::jsonb, 'selftest');
    RAISE EXCEPTION 'ABORT: a referred announcement went through with no referee';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%ABORT%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Choose the RM or referee%' THEN
      RAISE EXCEPTION 'ABORT: wrong refusal for an empty list: %', SQLERRM;
    END IF;
  END;

  SELECT count(*) INTO v_n FROM incoming_referrals
   WHERE patient_name = 'SELFTEST-REFEREE-LIST-DO-NOT-USE';
  IF v_n > 0 THEN RAISE EXCEPTION 'ABORT: % rehearsal row(s) left behind', v_n; END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
