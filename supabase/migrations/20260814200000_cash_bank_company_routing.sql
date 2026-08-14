-- Hope Pharmacy keeps its own cash book. Route cash/bank entries by company.
--
-- Hope Pharmacy and DRM Hope Hospital Private Limited are two companies. Their
-- sales, their debtors and their income already post to separate books: a
-- pharmacy sale raises a JV against Hope Pharmacy's own Cash and Medicine Sales
-- ledgers, a patient receipt against DRM Hope's.
--
-- Cash movements were the one hole left. post_cash_bank_entry resolved the
-- company with
--
--     CASE WHEN hospital_type = 'ayushman' THEN 'ayushman_nagpur'
--          ELSE 'drm_pvt_ltd' END
--
-- so anything that was not Ayushman was DRM Hope. A pharmacy deposit would have
-- credited DRM Hope's Cash ledger for money that was never in DRM Hope's
-- drawer: one company's cash book paying down another's. Nothing has actually
-- been posted that way yet -- there are no deposit vouchers at all -- so this
-- closes the hole before it is used rather than repairing damage.
--
-- The mapping is lifted out into its own function so it can be tested for what
-- it is: a rule about which set of books a counter belongs to. The rest of
-- post_cash_bank_entry is unchanged, and 'hope' and 'ayushman' resolve exactly
-- as before.

CREATE OR REPLACE FUNCTION public.cash_bank_company_key(p_hospital_type TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(btrim(COALESCE(p_hospital_type, '')))
           WHEN 'ayushman' THEN 'ayushman_nagpur'
           WHEN 'pharmacy' THEN 'hope_pharmacy'
           ELSE 'drm_pvt_ltd'
         END;
$$;

COMMENT ON FUNCTION public.cash_bank_company_key(TEXT) IS
  'Which company''s books a counter posts to. Hope Pharmacy is its own company, '
  'so its cash never touches DRM Hope Hospital Private Limited.';

CREATE OR REPLACE FUNCTION public.post_cash_bank_entry(
  p_kind            TEXT,   -- DEPOSIT | WITHDRAW | BANK_CHARGE | BANK_INTEREST
  p_hospital_type   TEXT,
  p_bank_account_id UUID,
  p_amount          NUMERIC,
  p_narration       TEXT DEFAULT NULL,
  p_user            TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_kind TEXT := upper(btrim(COALESCE(p_kind, '')));
  v_company UUID; v_cash UUID; v_bank RECORD; v_other UUID; v_code TEXT;
  v_type_id UUID; v_type_code TEXT; v_voucher_id UUID := gen_random_uuid();
  v_no TEXT; v_narr TEXT; v_cat TEXT;
  v_dr UUID; v_cr UUID;
  v_user TEXT := COALESCE(NULLIF(btrim(p_user), ''), 'bank-cash-tile');
BEGIN
  IF v_kind NOT IN ('DEPOSIT', 'WITHDRAW', 'BANK_CHARGE', 'BANK_INTEREST') THEN
    RAISE EXCEPTION 'Kind must be DEPOSIT, WITHDRAW, BANK_CHARGE or BANK_INTEREST';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Enter an amount greater than zero';
  END IF;

  SELECT id INTO v_company FROM public.companies
   WHERE company_key = public.cash_bank_company_key(p_hospital_type);
  IF v_company IS NULL THEN RAISE EXCEPTION 'Company not configured'; END IF;

  SELECT id, account_name, company_id INTO v_bank
    FROM public.chart_of_accounts WHERE id = p_bank_account_id AND is_active;
  IF v_bank.id IS NULL OR (v_bank.company_id IS NOT NULL AND v_bank.company_id <> v_company) THEN
    RAISE EXCEPTION 'Pick the bank ledger from this company';
  END IF;

  SELECT id INTO v_cash FROM public.chart_of_accounts
   WHERE company_id = v_company AND is_active
     AND lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g'))) = 'cash'
   ORDER BY created_at LIMIT 1;
  IF v_cash IS NULL AND v_kind IN ('DEPOSIT', 'WITHDRAW') THEN
    RAISE EXCEPTION 'No Cash ledger found in this company';
  END IF;

  IF v_kind IN ('BANK_CHARGE', 'BANK_INTEREST') THEN
    v_code := CASE v_kind WHEN 'BANK_CHARGE' THEN 'Bank Charges' ELSE 'Bank Interest Received' END;
    SELECT id INTO v_other FROM public.chart_of_accounts
     WHERE company_id = v_company AND is_active
       AND lower(btrim(account_name)) = lower(v_code)
     ORDER BY created_at LIMIT 1;
    IF v_other IS NULL THEN
      INSERT INTO public.chart_of_accounts
        (account_code, account_name, account_type, account_group, company_id,
         is_active, opening_balance, opening_balance_type)
      VALUES (
        'BKCI' || upper(substr(md5(v_company::text || v_code), 1, 8)), v_code,
        CASE v_kind WHEN 'BANK_CHARGE' THEN 'INDIRECT_EXPENSES' ELSE 'INDIRECT_INCOME' END,
        CASE v_kind WHEN 'BANK_CHARGE' THEN 'Indirect Expenses' ELSE 'Indirect Incomes' END,
        v_company, true, 0, CASE v_kind WHEN 'BANK_CHARGE' THEN 'DR' ELSE 'CR' END)
      ON CONFLICT (account_code) DO NOTHING;
      SELECT id INTO v_other FROM public.chart_of_accounts
       WHERE company_id = v_company AND is_active AND lower(btrim(account_name)) = lower(v_code)
       ORDER BY created_at LIMIT 1;
    END IF;
  END IF;

  v_cat := CASE WHEN v_kind IN ('DEPOSIT', 'WITHDRAW') THEN 'CONTRA' ELSE 'JOURNAL' END;
  SELECT id, voucher_type_code INTO v_type_id, v_type_code FROM public.voucher_types
   WHERE voucher_category = v_cat AND is_active = true
   ORDER BY CASE voucher_type_code WHEN 'CV' THEN 1 WHEN 'JV' THEN 1 ELSE 2 END LIMIT 1;
  IF v_type_id IS NULL THEN RAISE EXCEPTION 'No active % voucher type', v_cat; END IF;

  -- Dr / Cr per kind.
  IF    v_kind = 'DEPOSIT'       THEN v_dr := v_bank.id; v_cr := v_cash;
  ELSIF v_kind = 'WITHDRAW'      THEN v_dr := v_cash;    v_cr := v_bank.id;
  ELSIF v_kind = 'BANK_CHARGE'   THEN v_dr := v_other;   v_cr := v_bank.id;
  ELSE                                v_dr := v_bank.id; v_cr := v_other;
  END IF;

  v_no := public.generate_voucher_number(v_type_code);
  v_narr := CASE v_kind
      WHEN 'DEPOSIT' THEN 'Cash deposited into ' || v_bank.account_name
      WHEN 'WITHDRAW' THEN 'Cash withdrawn from ' || v_bank.account_name
      WHEN 'BANK_CHARGE' THEN 'Bank charges - ' || v_bank.account_name
      ELSE 'Bank interest received - ' || v_bank.account_name END
    || COALESCE(' — ' || NULLIF(btrim(p_narration), ''), '');

  INSERT INTO public.vouchers (id, voucher_number, voucher_type_id, voucher_date,
    narration, total_amount, company_id, status, is_auto, created_by, created_at, updated_at)
  VALUES (v_voucher_id, v_no, v_type_id, current_date, v_narr, p_amount,
    v_company, 'AUTHORISED', true, v_user, now(), now());
  INSERT INTO public.voucher_entries (id, voucher_id, account_id, narration,
    debit_amount, credit_amount, entry_order, created_at)
  VALUES
    (gen_random_uuid(), v_voucher_id, v_dr, v_narr, p_amount, 0, 1, now()),
    (gen_random_uuid(), v_voucher_id, v_cr, v_narr, 0, p_amount, 2, now());

  RETURN jsonb_build_object('voucherNumber', v_no, 'voucherId', v_voucher_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.cash_bank_company_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_cash_bank_entry(TEXT, TEXT, UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cash_bank_company_key(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_cash_bank_entry(TEXT, TEXT, UUID, NUMERIC, TEXT, TEXT) TO anon, authenticated;

DO $verify$
DECLARE v_key TEXT; v_company UUID; v_missing TEXT := '';
BEGIN
  -- The counters that already worked must still resolve to the same books.
  IF public.cash_bank_company_key('hope')     <> 'drm_pvt_ltd'     THEN
    RAISE EXCEPTION 'ABORT: hope no longer posts to DRM Hope';
  END IF;
  IF public.cash_bank_company_key('Hope')     <> 'drm_pvt_ltd'     THEN
    RAISE EXCEPTION 'ABORT: the counter name is case sensitive';
  END IF;
  IF public.cash_bank_company_key('ayushman') <> 'ayushman_nagpur' THEN
    RAISE EXCEPTION 'ABORT: ayushman no longer posts to Ayushman Nagpur';
  END IF;
  IF public.cash_bank_company_key(NULL)       <> 'drm_pvt_ltd'     THEN
    RAISE EXCEPTION 'ABORT: an unnamed counter must still default to DRM Hope';
  END IF;

  -- And the new one has to reach a real company with a real Cash ledger,
  -- otherwise the first pharmacy deposit fails at the counter.
  v_key := public.cash_bank_company_key('pharmacy');
  IF v_key <> 'hope_pharmacy' THEN
    RAISE EXCEPTION 'ABORT: the pharmacy does not post to its own company (%)', v_key;
  END IF;

  SELECT id INTO v_company FROM public.companies WHERE company_key = 'hope_pharmacy';
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'ABORT: Hope Pharmacy company not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                  WHERE company_id = v_company AND is_active
                    AND lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g'))) = 'cash') THEN
    v_missing := v_missing || ' Cash;';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chart_of_accounts
                  WHERE company_id = v_company AND is_active
                    AND (account_group ILIKE '%bank%' OR account_name ILIKE '%bank%')) THEN
    v_missing := v_missing || ' a bank ledger;';
  END IF;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'ABORT: Hope Pharmacy is missing:%', v_missing;
  END IF;

  -- The guards on the posting itself must survive the rewrite.
  BEGIN
    PERFORM public.post_cash_bank_entry('TRANSFER', 'pharmacy', NULL, 100, NULL, 'verify');
    RAISE EXCEPTION 'ABORT: an unknown kind was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE '%Kind must be%' THEN RAISE; END IF;
  END;

  -- A DRM Hope bank ledger must be refused for a pharmacy deposit: that is the
  -- exact cross-company posting this migration exists to stop.
  BEGIN
    PERFORM public.post_cash_bank_entry(
      'DEPOSIT', 'pharmacy',
      (SELECT a.id FROM public.chart_of_accounts a
         JOIN public.companies c ON c.id = a.company_id
        WHERE c.company_key = 'drm_pvt_ltd' AND a.is_active
          AND (a.account_group ILIKE '%bank%' OR a.account_name ILIKE '%bank%')
        ORDER BY a.created_at LIMIT 1),
      100, NULL, 'verify');
    RAISE EXCEPTION 'ABORT: a pharmacy deposit reached a DRM Hope bank ledger';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE '%from this company%' THEN RAISE; END IF;
  END;
END
$verify$;

NOTIFY pgrst, 'reload schema';
