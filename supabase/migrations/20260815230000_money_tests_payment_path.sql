-- Add the single patient-payment path to the standing suite.
--
-- The suite is only worth having if every money rule is in it. This adds the
-- rule that matters most on that path: cash must name the person who took it.
-- 141 of the last 203 cash payments do not, because five of the seven screens
-- that take money never set it — which is the whole reason the single path
-- exists.

CREATE OR REPLACE FUNCTION public.test_patient_payment_path()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $t$
DECLARE
  v_pat UUID; v_visit TEXT; v_user UUID; v_msg TEXT; v_ok BOOLEAN; v_res JSONB;
BEGIN
  SELECT id INTO v_user FROM "User" LIMIT 1;
  SELECT p.id, v.visit_id INTO v_pat, v_visit
    FROM patients p JOIN visits v ON v.patient_id = p.id
   WHERE p.hospital_name IS NOT NULL AND v.visit_id IS NOT NULL LIMIT 1;

  BEGIN
    v_msg := NULL;

    v_ok := false;
    BEGIN PERFORM record_patient_payment(v_pat, 100, 'CASH', NULL, v_visit);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN v_ok := (SQLERRM LIKE '%person who took it%'); END;
    IF NOT v_ok THEN v_msg := 'cash was accepted with nobody named'; END IF;

    IF v_msg IS NULL THEN
      v_res := record_patient_payment(v_pat, 100, ' cash ', v_user, v_visit);
      IF (SELECT payment_mode FROM advance_payment WHERE id = (v_res->>'id')::uuid) <> 'CASH'
      THEN v_msg := 'the payment mode was not normalised'; END IF;
      IF v_msg IS NULL AND (SELECT collected_by_user_id FROM advance_payment
                             WHERE id = (v_res->>'id')::uuid) IS NULL
      THEN v_msg := 'the collector was not recorded'; END IF;
    END IF;

    RAISE EXCEPTION 'ROLLBACK_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_OK' THEN v_msg := SQLERRM; END IF;
  END;

  RETURN jsonb_build_object(
    'test', 'cash payments name who took them, and the mode is normalised',
    'ok', v_msg IS NULL, 'detail', v_msg);
END $t$;

REVOKE ALL ON FUNCTION public.test_patient_payment_path() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_patient_payment_path() TO anon, authenticated;

-- Fold it into the suite the team runs.
CREATE OR REPLACE FUNCTION public.run_money_path_tests_all()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $a$
DECLARE v_base JSONB; v_extra JSONB; v_tests JSONB; v_pass INT; v_fail INT;
BEGIN
  v_base  := run_money_path_tests();
  v_extra := test_patient_payment_path();
  v_tests := (v_base->'tests') || jsonb_build_array(v_extra);
  v_pass  := (v_base->>'passed')::int + CASE WHEN (v_extra->>'ok')::boolean THEN 1 ELSE 0 END;
  v_fail  := (v_base->>'failed')::int + CASE WHEN (v_extra->>'ok')::boolean THEN 0 ELSE 1 END;
  RETURN jsonb_build_object('passed', v_pass, 'failed', v_fail,
                            'total', v_pass + v_fail, 'tests', v_tests);
END $a$;

REVOKE ALL ON FUNCTION public.run_money_path_tests_all() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_money_path_tests_all() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
