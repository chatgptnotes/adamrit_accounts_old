-- Resolve a ledger name within the voucher's own company first.
--
-- The previous fix preferred the shared copy, which repaired the entries whose
-- expense name had one. The rest are still on another company's ledger: an
-- Ayushman petty cash voucher debiting a ledger owned by DRM Hope.
--
-- WHY THAT ONE IS HARMFUL AND THE YOJNA ONES ARE NOT. A company's report is
-- its own ledgers plus the shared ones, with movements filtered to its own
-- vouchers (account_movements, 20260704230000:26). A Yojna voucher is DRM
-- Hope's and touches a DRM Hope scheme ledger and shared 4160 - both in DRM
-- Hope's set, and invisible to the others because the voucher is not theirs.
-- It reads as straddling but costs nothing. An Ayushman voucher touching a DRM
-- Hope ledger is different: Ayushman's report picks up the shared credit and
-- drops the owned debit, so Ayushman is out by that amount.
--
-- So the rule is not "prefer shared", it is "stay inside the voucher's company":
-- that company's own copy of the name, then a shared copy, then anything.
-- Shared stays second because operational ledgers - cash, banks, income - have
-- no per-company copy and must still resolve.

CREATE OR REPLACE FUNCTION public.adamrit_ledger_by_name(
  p_name          TEXT,
  p_fallback_code TEXT,
  p_company_id    UUID
) RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
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

  SELECT id INTO v_id FROM chart_of_accounts WHERE account_code = p_fallback_code;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.adamrit_ledger_by_name(TEXT, TEXT, UUID) IS
  'Resolves a ledger name within a company: that company''s own copy first, '
  'then a shared copy, then any. Keeps both legs of a voucher inside the '
  'company that made it.';

-- The payment voucher posting, resolving within its own company.
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
  v_credit_id  := public.adamrit_ledger_by_name(v_pv.account_ledger_name, '1110', v_company_id);

  v_narration := 'Payment voucher ' || COALESCE(v_pv.voucher_no, v_reference)
                 || COALESCE(' - ' || NULLIF(btrim(v_pv.narration), ''),
                      COALESCE(' - ' || NULLIF(btrim(v_pv.purpose), ''), ''));

  v_voucher_id := gen_random_uuid();
  v_voucher_no := generate_voucher_number(v_type_code);

  INSERT INTO vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, created_by, created_at, updated_at
  ) VALUES (
    v_voucher_id, v_voucher_no, v_type_id,
    COALESCE(v_pv.voucher_date, CURRENT_DATE),
    v_reference, v_narration, 0, v_company_id, 'AUTHORISED',
    COALESCE(NULLIF(btrim(v_pv.paid_by), ''), 'payment-voucher'), NOW(), NOW()
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
    gen_random_uuid(), v_voucher_id, v_credit_id,
    'Paid from ' || COALESCE(NULLIF(btrim(v_pv.account_ledger_name), ''), 'Cash in Hand')
    || ' - ' || v_narration,
    0, v_total, 9999, NOW()
  );

  UPDATE vouchers SET total_amount = v_total WHERE id = v_voucher_id;

  RETURN v_voucher_no;
END;
$$;

-- ------------------------------------------------------------------
-- Repair the entries still sitting on another company's ledger. Only where the
-- voucher's own company has a ledger of that name, or a shared one exists.
-- Vouchers already inside their own company are left alone - the Yojna ones
-- among them, which cost nothing.
-- ------------------------------------------------------------------
CREATE TEMP TABLE repointed_to_company AS
SELECT e.id AS entry_id, v.voucher_number, a.account_code AS was,
       t.account_code AS now_is, e.debit_amount, e.credit_amount, t.id AS target
  FROM voucher_entries e
  JOIN vouchers v          ON v.id = e.voucher_id AND v.status <> 'CANCELLED'
  JOIN chart_of_accounts a ON a.id = e.account_id
                          AND a.company_id IS NOT NULL
                          AND a.company_id IS DISTINCT FROM v.company_id
  JOIN LATERAL (
    SELECT t2.id, t2.account_code
      FROM chart_of_accounts t2
     WHERE t2.is_active
       AND lower(btrim(t2.account_name)) = lower(btrim(a.account_name))
       AND (t2.company_id = v.company_id OR t2.company_id IS NULL)
     ORDER BY (t2.company_id IS NULL), t2.account_code
     LIMIT 1
  ) t ON true;

UPDATE voucher_entries e
   SET account_id = r.target
  FROM repointed_to_company r
 WHERE e.id = r.entry_id;
