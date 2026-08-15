-- Give Ayushman its own copies of the expense ledgers it keeps borrowing.
--
-- Ayushman has no "Ambulance", "AMAZON", "Anil Laundary" or "Patient Refund"
-- ledger, so adamrit_ledger_by_name falls through to DRM Hope's copy and the
-- voucher straddles two companies: Ayushman's report shows the money leaving
-- and not what it was spent on, DRM Hope's shows an expense with no payment
-- behind it, and neither adds up. 24 vouchers and Rs 1,11,480 so far, still
-- happening -- the most recent was yesterday.
--
-- This is the same "the name does not resolve in my company" mechanism behind
-- the cash-ledger bug, wearing different clothes. The cure there was to route
-- to the right ledger; here the right ledger does not exist yet, so it is made.
--
-- PREVENTION ONLY. Not one existing entry is touched. New vouchers will resolve
-- inside Ayushman from now on; the 42 already posted stay exactly where they
-- are, because moving them changes balances in the book reconciled against
-- Tally and that is a separate decision taken against real numbers.
--
-- WHAT IS DELIBERATELY NOT CREATED, though it appears in the same list:
--
--   Canara Bank Jaripatka, CANARA BANK (Hope Pharmacy) -- bank accounts belong
--     to ONE company. An Ayushman copy of DRM Hope's bank account would be a
--     fiction, and money could then be posted "into" an account that does not
--     exist. Those two entries are wrong postings, not missing ledgers.
--   Pradhan Mantri Jan Arogya Yojana (PMJAY) -- a scheme receivable. Whether
--     Ayushman should carry its own is a question about how the schemes are
--     claimed, not a naming gap.
--   Ayushman Nagpur Hospital -- an inter-company ledger held BY DRM Hope. A
--     copy inside Ayushman named after itself would be nonsense.
--   ABHISHEKH DANAR -- one payment of Rs 200 to a named party. Not a pattern.
--
-- The classification is COPIED from DRM Hope rather than chosen, so the same
-- expense is classified the same way in both companies. Two of them look
-- questionable in the original -- "Ambulance" sits in Fixed Assets while being
-- paid out monthly like hire, and "Patient Refund" is typed DIRECT_EXPENSES
-- inside a group called Indirect Expenses. Copying keeps the two companies
-- consistent; re-classifying DRM Hope's chart is a separate decision and is
-- not smuggled in here.

DO $apply$
DECLARE
  v_ay UUID; v_hope UUID; v_name TEXT; v_src RECORD; v_code TEXT; v_made INT := 0;
  v_names CONSTANT TEXT[] := ARRAY['Ambulance', 'AMAZON', 'Anil Laundary', 'Patient Refund'];
BEGIN
  SELECT id INTO v_ay   FROM companies WHERE company_key = 'ayushman_nagpur';
  SELECT id INTO v_hope FROM companies WHERE company_key = 'drm_pvt_ltd';
  IF v_ay IS NULL OR v_hope IS NULL THEN
    RAISE EXCEPTION 'ABORT: could not find both companies';
  END IF;

  FOREACH v_name IN ARRAY v_names LOOP
    -- Already there? Leave it. Re-running must change nothing.
    IF EXISTS (SELECT 1 FROM chart_of_accounts
                WHERE company_id = v_ay AND is_active
                  AND lower(btrim(account_name)) = lower(btrim(v_name))) THEN
      CONTINUE;
    END IF;

    SELECT account_type, account_group INTO v_src
      FROM chart_of_accounts
     WHERE company_id = v_hope AND is_active
       AND lower(btrim(account_name)) = lower(btrim(v_name))
     ORDER BY created_at LIMIT 1;

    IF v_src.account_type IS NULL THEN
      RAISE EXCEPTION 'ABORT: no DRM Hope ledger called "%" to copy the classification from', v_name;
    END IF;

    -- Deterministic, so a second run would generate the same code and collide
    -- with itself rather than quietly making a duplicate under a new one.
    v_code := 'AYU' || upper(substr(md5(v_ay::text || lower(btrim(v_name))), 1, 10));
    IF EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = v_code) THEN
      RAISE EXCEPTION 'ABORT: account code % is already taken', v_code;
    END IF;

    INSERT INTO chart_of_accounts
      (account_code, account_name, account_type, account_group, company_id,
       is_active, opening_balance, opening_balance_type)
    VALUES (v_code, v_name, v_src.account_type, v_src.account_group, v_ay,
            true, 0, 'DR');
    v_made := v_made + 1;
  END LOOP;

  RAISE NOTICE 'Created % Ayushman ledger(s)', v_made;
END
$apply$;

DO $verify$
DECLARE
  v_ay UUID; v_hope UUID; v_name TEXT; v_got UUID; v_owner UUID; v_bal NUMERIC;
  v_names CONSTANT TEXT[] := ARRAY['Ambulance', 'AMAZON', 'Anil Laundary', 'Patient Refund'];
BEGIN
  SELECT id INTO v_ay   FROM companies WHERE company_key = 'ayushman_nagpur';
  SELECT id INTO v_hope FROM companies WHERE company_key = 'drm_pvt_ltd';

  FOREACH v_name IN ARRAY v_names LOOP
    -- (a) THE POINT OF THE WHOLE MIGRATION: an Ayushman voucher now resolves
    --     this name inside Ayushman, not by reaching into DRM Hope.
    v_got := adamrit_ledger_by_name(v_name, '5900', v_ay);
    SELECT company_id INTO v_owner FROM chart_of_accounts WHERE id = v_got;
    IF v_owner IS DISTINCT FROM v_ay THEN
      RAISE EXCEPTION 'ABORT: Ayushman still reaches outside itself for "%"', v_name;
    END IF;

    -- (b) and DRM Hope still resolves to its own, unchanged.
    v_got := adamrit_ledger_by_name(v_name, '5900', v_hope);
    SELECT company_id INTO v_owner FROM chart_of_accounts WHERE id = v_got;
    IF v_owner IS DISTINCT FROM v_hope THEN
      RAISE EXCEPTION 'ABORT: DRM Hope no longer resolves "%" to its own ledger', v_name;
    END IF;

    -- (c) the new ledger is classified exactly as DRM Hope classifies it, so
    --     one expense is not two different things in two companies.
    IF (SELECT account_type || '|' || account_group FROM chart_of_accounts
         WHERE company_id = v_ay AND is_active AND lower(btrim(account_name)) = lower(v_name))
       IS DISTINCT FROM
       (SELECT account_type || '|' || account_group FROM chart_of_accounts
         WHERE company_id = v_hope AND is_active AND lower(btrim(account_name)) = lower(v_name)
         ORDER BY created_at LIMIT 1) THEN
      RAISE EXCEPTION 'ABORT: "%" is classified differently in the two companies', v_name;
    END IF;

    -- (d) it opens empty. A new ledger carrying a balance would invent money.
    SELECT opening_balance INTO v_bal FROM chart_of_accounts
     WHERE company_id = v_ay AND is_active AND lower(btrim(account_name)) = lower(v_name);
    IF COALESCE(v_bal, 0) <> 0 THEN
      RAISE EXCEPTION 'ABORT: "%" was created holding %', v_name, v_bal;
    END IF;

    -- (e) exactly one active copy in Ayushman, or the picker offers a choice
    --     nobody can make correctly.
    IF (SELECT count(*) FROM chart_of_accounts
         WHERE company_id = v_ay AND is_active
           AND lower(btrim(account_name)) = lower(v_name)) <> 1 THEN
      RAISE EXCEPTION 'ABORT: Ayushman has more than one active "%"', v_name;
    END IF;
  END LOOP;

  -- (f) no bank account was duplicated. This is the mistake that would let
  --     money be posted into an account that does not exist.
  IF EXISTS (SELECT 1 FROM chart_of_accounts
              WHERE company_id = v_ay AND is_active
                AND account_name IN ('Canara Bank Jaripatka', 'CANARA BANK (Hope Pharmacy)')) THEN
    RAISE EXCEPTION 'ABORT: a DRM Hope bank account was copied into Ayushman';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
