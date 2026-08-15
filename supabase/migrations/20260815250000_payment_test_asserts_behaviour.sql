-- Assert what the rule DOES, not how it is worded.
--
-- The suite went red on "cash was accepted with nobody named". It had not
-- been. The rule refused it correctly — the wording had changed from "the
-- person who took it" to "the person who handled it", because the same rule
-- now covers refunds going out, and the test matched on the old text.
--
-- Two faults, and the second is worse than a brittle assertion: the failure
-- message SAID cash had been accepted. A test that lies about what went wrong
-- is worse than no test, because it sends whoever reads it hunting the wrong
-- bug at speed.
--
-- So it now checks the only thing that matters — that no payment row exists
-- afterwards — and reports the message it actually got when something is
-- wrong. This is the same lesson as this morning's overload: the check that
-- read the function's source text stayed green while the behaviour was broken.

CREATE OR REPLACE FUNCTION public.test_patient_payment_path()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $t$
DECLARE
  v_pat UUID; v_visit TEXT; v_user UUID; v_msg TEXT; v_res JSONB;
  v_before INT; v_after INT; v_err TEXT;
BEGIN
  SELECT id INTO v_user FROM "User" LIMIT 1;
  SELECT p.id, v.visit_id INTO v_pat, v_visit
    FROM patients p JOIN visits v ON v.patient_id = p.id
   WHERE p.hospital_name IS NOT NULL AND v.visit_id IS NOT NULL LIMIT 1;

  BEGIN
    v_msg := NULL;

    -- Cash with nobody named must leave NO ROW. Behaviour, not wording.
    SELECT count(*) INTO v_before FROM advance_payment WHERE patient_id = v_pat;
    v_err := NULL;
    BEGIN
      PERFORM record_patient_payment(v_pat, 100, 'CASH', NULL, v_visit);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN v_err := SQLERRM;
    END;
    SELECT count(*) INTO v_after FROM advance_payment WHERE patient_id = v_pat;

    IF v_after <> v_before THEN
      v_msg := 'cash with nobody named created a payment row';
    ELSIF v_err IS NULL THEN
      v_msg := 'cash with nobody named was accepted without any error';
    ELSIF v_err NOT ILIKE '%cash%' THEN
      -- Loose on wording, strict on subject: the message must at least be
      -- about the cash rule, or the cashier is being told the wrong thing.
      v_msg := format('refused, but the message does not mention cash: %s', v_err);
    END IF;

    -- A named collector is recorded, and the mode is normalised.
    IF v_msg IS NULL THEN
      v_res := record_patient_payment(v_pat, 100, ' cash ', v_user, v_visit);
      IF (SELECT payment_mode FROM advance_payment WHERE id = (v_res->>'id')::uuid) <> 'CASH'
      THEN v_msg := 'the payment mode was not normalised'; END IF;
      IF v_msg IS NULL AND (SELECT collected_by_user_id FROM advance_payment
                             WHERE id = (v_res->>'id')::uuid) IS DISTINCT FROM v_user
      THEN v_msg := 'the collector was not recorded'; END IF;
    END IF;

    -- A refund with no advance amount is still allowed.
    IF v_msg IS NULL THEN
      v_res := record_patient_payment(v_pat, 0, 'UPI', NULL, v_visit, NULL, NULL, NULL,
                                      NULL, NULL, true, 'suite', 250);
      IF (SELECT returned_amount FROM advance_payment WHERE id = (v_res->>'id')::uuid) <> 250
      THEN v_msg := 'a refund-only entry did not store what was refunded'; END IF;
    END IF;

    RAISE EXCEPTION 'ROLLBACK_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_OK' THEN v_msg := SQLERRM; END IF;
  END;

  RETURN jsonb_build_object(
    'test', 'cash names who handled it, mode is normalised, refund-only allowed',
    'ok', v_msg IS NULL, 'detail', v_msg);
END $t$;

REVOKE ALL ON FUNCTION public.test_patient_payment_path() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_patient_payment_path() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
