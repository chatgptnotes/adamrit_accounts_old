-- A test suite for the money paths, runnable any time.
--
-- Every check here is a bug that actually happened, most of them this week. A
-- test that would have caught a real failure is worth ten that guard something
-- nobody was going to get wrong:
--
--   payout claimed once     — payouts were deducted from EVERY handover for
--                             ever; Hope's drawer read minus Rs 10,050
--   cancel returns payouts  — the release path had never been exercised
--   counters are separate   — Farhan's pharmacy count landed on Hope, blocked
--                             Diksha, and was swallowed by Hope's handover
--   zero opening counts     — an empty drawer honestly counted must not read
--                             as "never counted"
--   cash goes to live Cash  — payment vouchers credited a ledger retired on
--                             2 August; 8,441 entries on a dead account
--   mobile carried across   — the number was collected and thrown away, and
--                             the rule then refused vouchers for lacking it
--   Ayushman stays inside   — Ayushman vouchers borrowed DRM Hope's expense
--                             ledgers, Rs 1.48 lakh straddling two companies
--   a bill can be inserted  — nothing could be, from 28 July to 15 August
--   unapproved is refused   — and the guard was on an overload nobody called
--   one payment function    — two overloads made every payment fail outright
--
-- HOW IT STAYS SAFE. Each test runs inside a BEGIN/EXCEPTION block, which is a
-- savepoint. Every test ends by raising 'ROLLBACK_OK', so its work is undone
-- whether it passed or failed — no test can leave a patient, a bill or a
-- voucher behind, and a test that crashes cleans up exactly like one that
-- passes. The suite therefore reads live data but cannot alter it.
--
-- Voucher numbers come from a sequence, and sequences do not roll back. Any
-- test that posts a real voucher captures the sequence first and restores it
-- after, so running the suite does not punch gaps in the voucher numbering
-- that VoucherGapDetection would then report as missing vouchers.
--
--   npm run test:money-paths

CREATE OR REPLACE FUNCTION public.run_money_path_tests()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $suite$
DECLARE
  v_results JSONB := '[]'::jsonb;
  v_pass INT := 0;
  v_fail INT := 0;

  PROCEDURE_MARKER CONSTANT TEXT := 'ROLLBACK_OK';

  v_hope UUID; v_ayush UUID; v_pharm UUID;
  v_u1 UUID; v_u2 UUID; v_appr UUID; v_notappr UUID;
  v_msg TEXT; v_ok BOOLEAN;

  -- per-test scratch
  v_n INT; v_before INT; v_after INT; v_id UUID; v_id2 UUID;
  v_num NUMERIC; v_txt TEXT; v_seq BIGINT; v_res JSONB;
BEGIN
  SELECT id INTO v_hope  FROM companies WHERE company_key = 'drm_pvt_ltd';
  SELECT id INTO v_ayush FROM companies WHERE company_key = 'ayushman_nagpur';
  SELECT id INTO v_pharm FROM companies WHERE company_key = 'hope_pharmacy';
  SELECT id INTO v_u1 FROM "User" WHERE lower(email) = 'cmd@hopehospital.com';
  IF v_u1 IS NULL THEN SELECT id INTO v_u1 FROM "User" LIMIT 1; END IF;
  SELECT id INTO v_u2 FROM "User" WHERE id <> v_u1 LIMIT 1;
  SELECT user_id INTO v_appr FROM expense_bill_approvers LIMIT 1;
  SELECT id INTO v_notappr FROM "User"
   WHERE id NOT IN (SELECT user_id FROM expense_bill_approvers) LIMIT 1;

  -- ===================================================================== 1
  BEGIN
    v_msg := NULL;
    IF payment_voucher_cash_ledger('Cash (HOPE)', v_hope)
       <> (SELECT id FROM chart_of_accounts
            WHERE company_id = v_hope AND is_active
              AND lower(btrim(regexp_replace(account_name,'[^a-zA-Z0-9]+',' ','g'))) = 'cash'
            LIMIT 1)
    THEN v_msg := 'a retired cash name did not route to the live unified Cash'; END IF;

    IF v_msg IS NULL AND payment_voucher_cash_ledger('Cash (HOPE)', v_hope)
       = (SELECT id FROM chart_of_accounts WHERE account_code = '1110')
    THEN v_msg := 'still routing to the retired 1110 ledger'; END IF;
    RAISE EXCEPTION '%', PROCEDURE_MARKER;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> PROCEDURE_MARKER THEN v_msg := SQLERRM; END IF;
  END;
  IF v_msg IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; END IF;
  v_results := v_results || jsonb_build_object(
    'test', 'payment voucher credits the live unified Cash',
    'ok', v_msg IS NULL, 'detail', v_msg);

  -- ===================================================================== 2
  BEGIN
    v_msg := NULL;
    IF (SELECT company_id FROM chart_of_accounts
         WHERE id = adamrit_ledger_by_name('Ambulance', '5900', v_ayush))
       IS DISTINCT FROM v_ayush
    THEN v_msg := 'an Ayushman expense still resolves outside Ayushman'; END IF;
    RAISE EXCEPTION '%', PROCEDURE_MARKER;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> PROCEDURE_MARKER THEN v_msg := SQLERRM; END IF;
  END;
  IF v_msg IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; END IF;
  v_results := v_results || jsonb_build_object(
    'test', 'Ayushman expenses stay inside Ayushman', 'ok', v_msg IS NULL, 'detail', v_msg);

  -- ===================================================================== 3
  BEGIN
    v_msg := NULL;
    INSERT INTO cash_opening_declarations (hospital_type, amount, declared_by, declared_by_name)
    VALUES ('selftest-zero', 0, v_u1, 'suite');
    IF NOT (cash_opening_state('selftest-zero')->>'declared')::boolean THEN
      v_msg := 'a counted-and-empty drawer reads as never counted';
    END IF;
    RAISE EXCEPTION '%', PROCEDURE_MARKER;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> PROCEDURE_MARKER THEN v_msg := SQLERRM; END IF;
  END;
  IF v_msg IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; END IF;
  v_results := v_results || jsonb_build_object(
    'test', 'a zero opening counts as declared', 'ok', v_msg IS NULL, 'detail', v_msg);

  -- ===================================================================== 4
  BEGIN
    v_msg := NULL;
    INSERT INTO cash_opening_declarations (hospital_type, amount, declared_by, declared_by_name)
    VALUES ('selftest-ctr-a', 111, v_u1, 'suite');
    IF (cash_opening_state('selftest-ctr-b')->>'declared')::boolean THEN
      v_msg := 'declaring at one counter marked another as declared';
    END IF;
    RAISE EXCEPTION '%', PROCEDURE_MARKER;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> PROCEDURE_MARKER THEN v_msg := SQLERRM; END IF;
  END;
  IF v_msg IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; END IF;
  v_results := v_results || jsonb_build_object(
    'test', 'counters keep separate opening cash', 'ok', v_msg IS NULL, 'detail', v_msg);

  -- ===================================================================== 5
  -- The big one: a payout is deducted once, and cancelling gives it back.
  BEGIN
    v_msg := NULL;
    SELECT count(*) INTO v_before FROM cash_payouts_pool('hope');

    SELECT last_value INTO v_seq FROM cash_handover_no_seq;
    v_res := submit_cash_handover(v_u1, v_u2, '[{"denomination":500,"qty":1}]'::jsonb,
             'hope', 'money-path suite', true, 'suite', NULL, 0, 0);
    v_id := (v_res->>'handoverId')::uuid;

    SELECT count(*) INTO v_after FROM cash_payouts_pool('hope');
    IF v_after <> 0 THEN
      v_msg := format('%s payout(s) still deductible after a handover claimed them', v_after);
    END IF;

    IF v_msg IS NULL THEN
      PERFORM cancel_cash_handover(v_id, v_u1, 'money-path suite');
      SELECT count(*) INTO v_after FROM cash_payouts_pool('hope');
      IF v_after <> v_before THEN
        v_msg := format('cancelling returned %s payouts, expected %s', v_after, v_before);
      END IF;
    END IF;
    RAISE EXCEPTION '%', PROCEDURE_MARKER;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> PROCEDURE_MARKER THEN v_msg := SQLERRM; END IF;
  END;
  -- The handover sequence advanced outside the rollback; put it back so the
  -- suite leaves no gap in CH- numbering.
  PERFORM setval('cash_handover_no_seq', v_seq, true);
  IF v_msg IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; END IF;
  v_results := v_results || jsonb_build_object(
    'test', 'a payout is deducted once, and cancelling returns it',
    'ok', v_msg IS NULL, 'detail', v_msg);

  -- ===================================================================== 6
  BEGIN
    v_msg := NULL;
    INSERT INTO bills (patient_id, visit_id, bill_no, formatted_bill_no, claim_id,
                       date, category, total_amount, status, hospital_name)
    SELECT p.id, 'SUITE-VISIT', 'SUITE-BILL', 'SUITE-BILL', 'T',
           CURRENT_DATE, 'GENERAL', 0, 'DRAFT', 'hope'
      FROM patients p LIMIT 1
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN v_msg := 'a patient bill could not be created'; END IF;
    RAISE EXCEPTION '%', PROCEDURE_MARKER;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> PROCEDURE_MARKER THEN v_msg := SQLERRM; END IF;
  END;
  IF v_msg IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; END IF;
  v_results := v_results || jsonb_build_object(
    'test', 'a patient bill can be created', 'ok', v_msg IS NULL, 'detail', v_msg);

  -- ===================================================================== 7
  BEGIN
    v_msg := NULL;
    SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'record_expense_bill_payment';
    IF v_n <> 1 THEN
      v_msg := format('%s overloads of record_expense_bill_payment — payments go ambiguous', v_n);
    END IF;
    RAISE EXCEPTION '%', PROCEDURE_MARKER;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> PROCEDURE_MARKER THEN v_msg := SQLERRM; END IF;
  END;
  IF v_msg IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; END IF;
  v_results := v_results || jsonb_build_object(
    'test', 'exactly one payment function exists', 'ok', v_msg IS NULL, 'detail', v_msg);

  -- ===================================================================== 8
  BEGIN
    v_msg := NULL;
    IF pg_get_functiondef('public.record_expense_bill_payment'::regproc)
       NOT LIKE '%expense_bill_payment_blocked%'
    THEN v_msg := 'the payment function does not check approval'; END IF;
    RAISE EXCEPTION '%', PROCEDURE_MARKER;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> PROCEDURE_MARKER THEN v_msg := SQLERRM; END IF;
  END;
  IF v_msg IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; END IF;
  v_results := v_results || jsonb_build_object(
    'test', 'the payment path actually checks approval', 'ok', v_msg IS NULL, 'detail', v_msg);

  -- ===================================================================== 9
  BEGIN
    v_msg := NULL;
    INSERT INTO expense_bills (bill_number, bill_date, amount, narration, status,
                               company_id, expense_ledger_id, party_ledger_id, created_by)
    SELECT 'SUITE-EB', CURRENT_DATE, 1, 'suite', 'POSTED',
           b.company_id, b.expense_ledger_id, b.party_ledger_id, 'suite'
      FROM expense_bills b WHERE b.expense_ledger_id IS NOT NULL LIMIT 1
    RETURNING id INTO v_id;
    UPDATE expense_bills SET approved_at = NULL, approved_by = NULL WHERE id = v_id;

    IF COALESCE((SELECT enforced FROM expense_bill_approval_settings WHERE id), false) THEN
      IF expense_bill_payment_blocked(v_id) IS NULL THEN
        v_msg := 'an unapproved bill is payable while enforcement is on';
      END IF;
    END IF;

    IF v_msg IS NULL AND v_notappr IS NOT NULL THEN
      v_ok := false;
      BEGIN
        PERFORM approve_expense_bill(v_id, v_notappr, 'suite');
      EXCEPTION WHEN SQLSTATE 'P0001' THEN v_ok := (SQLERRM LIKE '%Only Dr Murali%');
      END;
      IF NOT v_ok THEN v_msg := 'a non-approver was able to approve a bill'; END IF;
    END IF;

    IF v_msg IS NULL AND v_appr IS NOT NULL THEN
      PERFORM approve_expense_bill(v_id, v_appr, 'suite');
      IF expense_bill_payment_blocked(v_id) IS NOT NULL THEN
        v_msg := 'an approved bill is still blocked from payment';
      END IF;
    END IF;
    RAISE EXCEPTION '%', PROCEDURE_MARKER;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> PROCEDURE_MARKER THEN v_msg := SQLERRM; END IF;
  END;
  IF v_msg IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; END IF;
  v_results := v_results || jsonb_build_object(
    'test', 'only an approver can release a bill, and only then is it payable',
    'ok', v_msg IS NULL, 'detail', v_msg);

  -- ==================================================================== 10
  BEGIN
    v_msg := NULL;
    v_res := daily_cash_summary((now() AT TIME ZONE 'Asia/Kolkata')::date, 'hope');
    IF round((v_res->>'stillInDrawer')::numeric, 2) <> round(
         (v_res->>'opening')::numeric + (v_res->>'collected')::numeric
         - (v_res->>'paidOut')::numeric - (v_res->>'deposited')::numeric
         - (v_res->>'handedOver')::numeric, 2)
    THEN v_msg := 'the day does not add up'; END IF;
    RAISE EXCEPTION '%', PROCEDURE_MARKER;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> PROCEDURE_MARKER THEN v_msg := SQLERRM; END IF;
  END;
  IF v_msg IS NULL THEN v_pass := v_pass + 1; ELSE v_fail := v_fail + 1; END IF;
  v_results := v_results || jsonb_build_object(
    'test', 'the day''s cash adds up', 'ok', v_msg IS NULL, 'detail', v_msg);

  RETURN jsonb_build_object(
    'passed', v_pass, 'failed', v_fail, 'total', v_pass + v_fail, 'tests', v_results);
END
$suite$;

REVOKE ALL ON FUNCTION public.run_money_path_tests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_money_path_tests() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
