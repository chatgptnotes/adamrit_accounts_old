-- New payment vouchers credit the unified Cash ledger, not the dead one.
--
-- WHAT WAS HAPPENING
--
-- post_one_payment_voucher resolved its credit side with
--
--     adamrit_ledger_by_name(account_ledger_name, '1110', company)
--
-- and that resolver only matches ACTIVE ledgers by name. "Cash (HOPE)" was
-- renamed to "Cash (HOPE) (merged 02 Aug 26)" and deactivated in the 2 August
-- merge, so the name stopped matching and every voucher fell through to the
-- fallback -- SELECT ... WHERE account_code = '1110' -- which has no active
-- filter and no company filter at all. Code 1110 is "Cash in Hand (merged 02
-- Aug 26)": deactivated, owned by no company.
--
-- The result is 8,441 entries on a retired ledger against 291 on the live
-- unified "Cash". The cash book is being kept in the wrong account, and the
-- names still being stored today make it worse -- of the payment vouchers
-- written since 1 August, 239 say "Cash", 194 say "Cash (HOPE)", 119 say
-- "cash in hand" and 34 say nothing at all. Only the first resolves.
--
-- WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
--
-- New vouchers only. The 8,441 historical entries are left exactly where they
-- are: moving them changes balances in the book of record that is reconciled
-- against Tally, and that is Dr M's decision to make against real numbers, not
-- a side effect of this fix.
--
-- IT NEVER RAISES. That is deliberate and it is the lesson from this
-- afternoon: post_one_payment_voucher runs from a trigger in the SECOND of the
-- two transactions that write a payment voucher, so an exception here does not
-- refuse the entry -- it rolls back the lines and the posting while the header,
-- already committed, survives. The voucher looks saved and the books never get
-- it. So an unresolvable name lands in the company's own Cash with a warning
-- in the log, which is recoverable, rather than nowhere at all, which is not.

CREATE OR REPLACE FUNCTION public.payment_voucher_cash_ledger(
  p_name TEXT, p_company_id UUID
) RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID; v_norm TEXT;
BEGIN
  -- 1. The name as given, if it is a live ledger. This is the normal path and
  --    it is unchanged: "Cash", "Canara Bank", anything the picker offers that
  --    still exists keeps resolving exactly as before, own company first.
  IF NULLIF(btrim(COALESCE(p_name, '')), '') IS NOT NULL THEN
    SELECT a.id INTO v_id
      FROM chart_of_accounts a
     WHERE a.is_active = true
       AND lower(btrim(a.account_name)) = lower(btrim(p_name))
     ORDER BY CASE
                WHEN p_company_id IS NOT NULL AND a.company_id = p_company_id THEN 0
                WHEN a.company_id IS NULL                                     THEN 1
                ELSE 2
              END,
              a.account_code
     LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  -- 2. It did not resolve. Use this company's own unified Cash -- the same
  --    ledger post_cash_bank_entry uses, found the same way, so a deposit made
  --    from the tile and a payment made from this screen meet in one place.
  SELECT a.id INTO v_id
    FROM chart_of_accounts a
   WHERE a.company_id = p_company_id
     AND a.is_active = true
     AND lower(btrim(regexp_replace(a.account_name, '[^a-zA-Z0-9]+', ' ', 'g'))) = 'cash'
   ORDER BY a.created_at
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    v_norm := lower(btrim(regexp_replace(COALESCE(p_name, '(none)'), '[^a-zA-Z0-9]+', ' ', 'g')));
    RAISE WARNING 'Payment voucher: ledger "%" is not a live ledger; credited this company''s Cash instead', v_norm;
    RETURN v_id;
  END IF;

  -- 3. No Cash in this company at all. Every company has one today, so this is
  --    a genuine misconfiguration rather than a bad name, and the old fallback
  --    is still better than a NULL account on a voucher entry.
  RAISE WARNING 'Payment voucher: no active Cash ledger in company %, falling back to code 1110', p_company_id;
  SELECT id INTO v_id FROM chart_of_accounts WHERE account_code = '1110';
  RETURN v_id;
END $$;

COMMENT ON FUNCTION public.payment_voucher_cash_ledger(TEXT, UUID) IS
  'The cash/bank side of a payment voucher: the named ledger if it is live, '
  'else this company''s unified Cash. Never raises -- it runs inside the second '
  'of two transactions, where an exception loses the posting silently.';

-- The only change to the posting itself is which resolver the credit side
-- uses. Everything else, including the party_mobile carried in 20260814320000,
-- is unchanged.
CREATE OR REPLACE FUNCTION public.post_one_payment_voucher(p_voucher_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pv         RECORD;
  v_credit_id  UUID;
  v_company_id UUID;
  v_type_id    UUID;
  v_type_code  TEXT;
  v_voucher_id UUID;
  v_voucher_no TEXT;
  v_reference  TEXT;
  v_narration  TEXT;
  v_total      NUMERIC(15,2);
BEGIN
  SELECT * INTO v_pv FROM payment_vouchers WHERE id = p_voucher_id;
  IF v_pv.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_reference := 'PV-' || v_pv.id::TEXT;

  IF EXISTS (SELECT 1 FROM vouchers
              WHERE reference_number = v_reference AND status <> 'CANCELLED') THEN
    RETURN NULL;
  END IF;

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM voucher_types
   WHERE voucher_category = 'PAYMENT' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'PAY' THEN 1 ELSE 2 END
   LIMIT 1;

  IF v_type_id IS NULL THEN
    RAISE WARNING 'Payment voucher %: no PAYMENT voucher type, nothing posted', v_pv.voucher_no;
    RETURN NULL;
  END IF;

  v_company_id := public.resolve_patient_company(v_pv.hospital_type, NULL);
  v_credit_id  := public.payment_voucher_cash_ledger(v_pv.account_ledger_name, v_company_id);

  v_narration := 'Payment voucher ' || COALESCE(v_pv.voucher_no, v_reference)
                 || COALESCE(' - ' || NULLIF(btrim(v_pv.narration), ''),
                      COALESCE(' - ' || NULLIF(btrim(v_pv.purpose), ''), ''));

  v_voucher_id := gen_random_uuid();
  v_voucher_no := generate_voucher_number(v_type_code);

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at,
    party_mobile
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id,
    COALESCE(v_pv.voucher_date, CURRENT_DATE),
    v_reference, v_narration, 0, v_company_id, 'AUTHORISED',
    COALESCE(NULLIF(btrim(v_pv.paid_by), ''), 'payment-voucher'), NOW(), NOW(),
    public.norm_party_mobile(v_pv.mobile_number)
  );

  WITH posted AS (
    INSERT INTO voucher_entries (
      id, voucher_id, account_id, narration, debit_amount, credit_amount,
      entry_order, created_at
    )
    SELECT gen_random_uuid(), v_voucher_id,
           public.adamrit_ledger_by_name(l.ledger_name, '5900', v_company_id),
           COALESCE(NULLIF(btrim(l.ledger_name), ''), 'Petty cash') || ' - ' || v_narration,
           ROUND(COALESCE(l.amount, 0), 2), 0,
           COALESCE(l.line_order, 0) + 1, NOW()
      FROM payment_voucher_lines l
     WHERE l.voucher_id = v_pv.id
       AND COALESCE(l.amount, 0) > 0
    RETURNING debit_amount
  )
  SELECT COALESCE(SUM(debit_amount), 0) INTO v_total FROM posted;

  IF v_total <= 0 THEN
    DELETE FROM vouchers WHERE id = v_voucher_id;
    RETURN NULL;
  END IF;

  INSERT INTO voucher_entries (
    id, voucher_id, account_id, narration, debit_amount, credit_amount,
    entry_order, created_at
  ) VALUES (
    gen_random_uuid(), v_voucher_id, v_credit_id, v_narration, 0, v_total, 0, NOW()
  );

  UPDATE vouchers SET total_amount = v_total WHERE id = v_voucher_id;

  RETURN v_voucher_no;
END;
$$;

DO $verify$
DECLARE
  v_hope UUID; v_ayush UUID; v_pharm UUID;
  v_cash_hope UUID; v_cash_ayush UUID; v_cash_pharm UUID;
  v_dead UUID; v_got UUID; v_name TEXT;
  v_names CONSTANT TEXT[] := ARRAY['Cash (HOPE)', 'cash in hand', 'Cash', 'CASH', 'Petty Cash'];
BEGIN
  SELECT id INTO v_dead FROM chart_of_accounts WHERE account_code = '1110';

  SELECT id INTO v_hope  FROM companies WHERE company_key = 'drm_pvt_ltd';
  SELECT id INTO v_ayush FROM companies WHERE company_key = 'ayushman_nagpur';
  SELECT id INTO v_pharm FROM companies WHERE company_key = 'hope_pharmacy';

  SELECT id INTO v_cash_hope  FROM chart_of_accounts
   WHERE company_id = v_hope  AND is_active
     AND lower(btrim(regexp_replace(account_name,'[^a-zA-Z0-9]+',' ','g'))) = 'cash' LIMIT 1;
  SELECT id INTO v_cash_ayush FROM chart_of_accounts
   WHERE company_id = v_ayush AND is_active
     AND lower(btrim(regexp_replace(account_name,'[^a-zA-Z0-9]+',' ','g'))) = 'cash' LIMIT 1;
  SELECT id INTO v_cash_pharm FROM chart_of_accounts
   WHERE company_id = v_pharm AND is_active
     AND lower(btrim(regexp_replace(account_name,'[^a-zA-Z0-9]+',' ','g'))) = 'cash' LIMIT 1;

  IF v_cash_hope IS NULL OR v_cash_ayush IS NULL OR v_cash_pharm IS NULL THEN
    RAISE EXCEPTION 'ABORT: a company has no live Cash ledger to route to';
  END IF;

  -- (a) every spelling actually in use, and a NULL, must reach that company's
  --     own live Cash -- and above all must NOT reach the dead 1110 ledger.
  FOREACH v_name IN ARRAY v_names LOOP
    v_got := payment_voucher_cash_ledger(v_name, v_hope);
    IF v_got = v_dead THEN
      RAISE EXCEPTION 'ABORT: "%" still lands on the retired 1110 ledger', v_name;
    END IF;
    IF v_got <> v_cash_hope THEN
      RAISE EXCEPTION 'ABORT: "%" resolved to % rather than DRM Hope Cash', v_name, v_got;
    END IF;
  END LOOP;

  IF payment_voucher_cash_ledger(NULL, v_hope) <> v_cash_hope THEN
    RAISE EXCEPTION 'ABORT: a voucher with no ledger name did not reach Cash';
  END IF;

  -- (b) each company reaches its OWN cash, never another's. This is the
  --     failure that would quietly move money between companies.
  IF payment_voucher_cash_ledger('Cash (HOPE)', v_ayush) <> v_cash_ayush THEN
    RAISE EXCEPTION 'ABORT: an Ayushman voucher did not reach Ayushman Cash';
  END IF;
  IF payment_voucher_cash_ledger('Cash (HOPE)', v_pharm) <> v_cash_pharm THEN
    RAISE EXCEPTION 'ABORT: a pharmacy voucher did not reach Hope Pharmacy Cash';
  END IF;
  IF v_cash_hope = v_cash_ayush OR v_cash_hope = v_cash_pharm THEN
    RAISE EXCEPTION 'ABORT: two companies resolved to the same Cash ledger';
  END IF;

  -- (c) a live named ledger still wins. The fix must not drag genuine bank
  --     payments into cash.
  SELECT id, account_name INTO v_got, v_name FROM chart_of_accounts
   WHERE company_id = v_hope AND is_active
     AND (account_group ILIKE '%bank%' OR account_name ILIKE '%bank%')
   ORDER BY created_at LIMIT 1;
  IF v_got IS NOT NULL THEN
    IF payment_voucher_cash_ledger(v_name, v_hope) <> v_got THEN
      RAISE EXCEPTION 'ABORT: a live bank ledger ("%") was diverted to Cash', v_name;
    END IF;
  END IF;

  -- (d) the posting function still reads the new resolver
  IF pg_get_functiondef('public.post_one_payment_voucher(uuid)'::regprocedure)
     NOT LIKE '%payment_voucher_cash_ledger%' THEN
    RAISE EXCEPTION 'ABORT: post_one_payment_voucher is not using the new resolver';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
