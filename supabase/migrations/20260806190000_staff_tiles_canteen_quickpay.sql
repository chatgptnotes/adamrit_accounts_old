-- Named staff tiles: Sonu's canteen collections and Avni's quick payments.
--
-- record_canteen_collection: Sonu's daily canteen cash becomes a proper
-- receipt (Dr Cash / Cr Canteen Income, find-or-created) instead of a typed
-- voucher.
--
-- record_quick_paid_bill: Avni's counter payments raise the invoice, post
-- its JV AND pay it in one transaction (bill + JV + PV) — with a built-in
-- duplicate guard: the same party for the same amount within 3 days is
-- refused unless forced, which is exactly the trap that produced the twin
-- Rs 5,000 Rehan payments.
--
-- Applied automatically via apply_migration.

CREATE OR REPLACE FUNCTION public.record_canteen_collection(
  p_hospital_type TEXT,
  p_amount        NUMERIC,
  p_date          DATE DEFAULT CURRENT_DATE,
  p_narration     TEXT DEFAULT NULL,
  p_user          TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_company UUID; v_cash UUID; v_income UUID; v_code TEXT;
  v_type_id UUID; v_type_code TEXT; v_id UUID := gen_random_uuid(); v_no TEXT; v_narr TEXT;
  v_user TEXT := COALESCE(NULLIF(btrim(p_user), ''), 'canteen-sonu');
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Enter the amount collected'; END IF;
  SELECT id INTO v_company FROM companies
   WHERE company_key = CASE WHEN lower(COALESCE(p_hospital_type,''))='ayushman'
                            THEN 'ayushman_nagpur' ELSE 'drm_pvt_ltd' END;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Company not configured'; END IF;

  SELECT id INTO v_cash FROM chart_of_accounts
   WHERE company_id = v_company AND is_active
     AND lower(btrim(regexp_replace(account_name,'[^a-zA-Z0-9]+',' ','g'))) = 'cash'
   ORDER BY created_at LIMIT 1;
  IF v_cash IS NULL THEN RAISE EXCEPTION 'No Cash ledger in this company'; END IF;

  SELECT id INTO v_income FROM chart_of_accounts
   WHERE company_id = v_company AND is_active
     AND lower(btrim(regexp_replace(account_name,'[^a-zA-Z0-9]+',' ','g'))) = 'canteen income'
   ORDER BY created_at LIMIT 1;
  IF v_income IS NULL THEN
    v_code := 'CANT' || upper(substr(md5(v_company::text || 'canteen-income'),1,8));
    BEGIN
      INSERT INTO chart_of_accounts (account_code, account_name, account_type, account_group,
        company_id, is_active, opening_balance, opening_balance_type)
      VALUES (v_code, 'Canteen Income', 'INDIRECT_INCOME', 'Indirect Incomes', v_company, true, 0, 'CR')
      ON CONFLICT (account_code) DO NOTHING;
    EXCEPTION WHEN unique_violation THEN NULL; END;
    SELECT id INTO v_income FROM chart_of_accounts
     WHERE company_id = v_company AND is_active
       AND lower(btrim(regexp_replace(account_name,'[^a-zA-Z0-9]+',' ','g'))) = 'canteen income'
     ORDER BY created_at LIMIT 1;
  END IF;

  SELECT id, voucher_type_code INTO v_type_id, v_type_code FROM voucher_types
   WHERE voucher_category = 'RECEIPT' AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'REC' THEN 1 ELSE 2 END LIMIT 1;
  IF v_type_id IS NULL THEN RAISE EXCEPTION 'No active Receipt voucher type'; END IF;

  v_no := generate_voucher_number(v_type_code);
  v_narr := 'Canteen collection ' || p_date
         || COALESCE(' — ' || NULLIF(btrim(p_narration), ''), '');
  INSERT INTO vouchers (id, voucher_number, voucher_type_id, voucher_date, narration,
    total_amount, company_id, status, is_auto, created_by, created_at, updated_at)
  VALUES (v_id, v_no, v_type_id, p_date, v_narr, p_amount, v_company, 'AUTHORISED', true,
    v_user, now(), now());
  INSERT INTO voucher_entries (id, voucher_id, account_id, narration, debit_amount, credit_amount, entry_order, created_at)
  VALUES
    (gen_random_uuid(), v_id, v_cash,   v_narr, p_amount, 0, 1, now()),
    (gen_random_uuid(), v_id, v_income, v_narr, 0, p_amount, 2, now());

  RETURN jsonb_build_object('voucherNumber', v_no);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_canteen_collection(TEXT, NUMERIC, DATE, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_canteen_collection(TEXT, NUMERIC, DATE, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_quick_paid_bill(
  p_hospital_type      TEXT,
  p_party_account_id   UUID,
  p_expense_account_id UUID,
  p_amount             NUMERIC,
  p_narration          TEXT DEFAULT NULL,
  p_user               TEXT DEFAULT NULL,
  p_force              BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_company UUID; v_party RECORD; v_dupe RECORD; v_bill_no TEXT; v_bill_id UUID; v_pay TEXT;
  v_user TEXT := COALESCE(NULLIF(btrim(p_user), ''), 'quick-pay-avni');
  v_cash UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Enter the amount paid'; END IF;
  SELECT id INTO v_company FROM companies
   WHERE company_key = CASE WHEN lower(COALESCE(p_hospital_type,''))='ayushman'
                            THEN 'ayushman_nagpur' ELSE 'drm_pvt_ltd' END;
  SELECT id, account_name, company_id INTO v_party
    FROM chart_of_accounts WHERE id = p_party_account_id AND is_active;
  IF v_party.id IS NULL THEN RAISE EXCEPTION 'Pick who was paid'; END IF;

  -- The duplicate guard: same party, same amount, last 3 days.
  SELECT v.voucher_number, v.voucher_date INTO v_dupe
    FROM voucher_entries e
    JOIN vouchers v ON v.id = e.voucher_id AND v.status <> 'CANCELLED'
   WHERE e.account_id = p_party_account_id
     AND (e.debit_amount = p_amount OR e.credit_amount = p_amount)
     AND v.voucher_date >= CURRENT_DATE - 3
   ORDER BY v.voucher_date DESC LIMIT 1;
  IF v_dupe.voucher_number IS NOT NULL AND NOT p_force THEN
    RAISE EXCEPTION 'DUPLICATE_WARNING: % already carries Rs % for % on % — confirm again to pay anyway',
      v_dupe.voucher_number, p_amount, v_party.account_name, v_dupe.voucher_date;
  END IF;

  SELECT id INTO v_cash FROM chart_of_accounts
   WHERE company_id = v_company AND is_active
     AND lower(btrim(regexp_replace(account_name,'[^a-zA-Z0-9]+',' ','g'))) = 'cash'
   ORDER BY created_at LIMIT 1;
  IF v_cash IS NULL THEN RAISE EXCEPTION 'No Cash ledger in this company'; END IF;

  v_bill_no := 'QP-' || to_char(now(), 'YYMMDDHH24MISS');
  INSERT INTO expense_bills (bill_number, bill_date, party_ledger_id, expense_ledger_id,
    amount, narration, company_id, status, created_by)
  VALUES (v_bill_no, CURRENT_DATE, p_party_account_id, p_expense_account_id, p_amount,
    COALESCE(NULLIF(btrim(p_narration), ''), 'Counter payment — ' || v_party.account_name),
    v_company, 'POSTED', v_user)
  RETURNING id INTO v_bill_id;

  v_pay := record_expense_bill_payment(v_bill_id, p_amount, v_cash, CURRENT_DATE, v_user,
    'Paid at counter (quick pay)');

  RETURN jsonb_build_object('billNumber', v_bill_no, 'payment', v_pay);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_quick_paid_bill(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_quick_paid_bill(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, BOOLEAN) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
