-- The slab ledgers were not being found.
--
-- post_grn_purchase_voucher built the ledger name with
-- to_char(slab,'FM999990.99'), which renders 5.00 as "5." — so it looked for
-- "Mediccine Pur 5.%", found nothing, and fell back to the general Medicine
-- Purchase ledger for every line. The GST split, the rounding and the totals
-- were right; only the purchase side landed in one ledger instead of per slab.
--
-- This formats a whole-number rate as a whole number, matches the ledger name
-- case-insensitively, and accepts either spelling of Med(d)icine, since the
-- ledgers carried over from Tally read "Mediccine Pur 5%". Then it reposts the
-- cutover-onward purchases so they sit in the right slab ledgers.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

CREATE OR REPLACE FUNCTION public.purchase_slab_ledger(p_company UUID, p_slab NUMERIC)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_rate TEXT;
  v_id UUID;
BEGIN
  v_rate := CASE WHEN p_slab = ROUND(p_slab) THEN ROUND(p_slab)::INTEGER::TEXT
                 ELSE trim(to_char(p_slab, 'FM999990.99')) END;

  SELECT id INTO v_id FROM public.chart_of_accounts
   WHERE company_id = p_company AND is_active
     AND (lower(btrim(account_name)) = lower('Mediccine Pur ' || v_rate || '%')
       OR lower(btrim(account_name)) = lower('Medicine Pur ' || v_rate || '%')
       OR lower(btrim(account_name)) = lower('Mediccine Purchase ' || v_rate || '%'))
   LIMIT 1;

  IF v_id IS NULL THEN
    -- An unusual rate (4%, 9%, 10%, 25% appear in older data) has no ledger of
    -- its own; it lands in the general purchase ledger rather than being
    -- silently folded into a slab it does not belong to.
    SELECT id INTO v_id FROM public.chart_of_accounts
     WHERE account_code = '5110' AND is_active LIMIT 1;
  END IF;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_grn_purchase_voucher(p_grn_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_grn RECORD; v_supplier RECORD; v_company UUID; v_creditor UUID;
  v_type_id UUID; v_type_code TEXT; v_number TEXT; v_voucher UUID := gen_random_uuid();
  v_interstate BOOLEAN; v_taxable NUMERIC := 0; v_tax NUMERIC := 0;
  v_total NUMERIC; v_rounded NUMERIC; v_diff NUMERIC; v_order INTEGER := 0;
  v_ledger UUID; v_existing TEXT; r RECORD;
BEGIN
  SELECT * INTO v_grn FROM public.goods_received_notes WHERE id = p_grn_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('posted', false, 'reason', 'GRN not found'); END IF;
  IF upper(COALESCE(v_grn.status, '')) <> 'POSTED' THEN
    RETURN jsonb_build_object('posted', false, 'reason', 'GRN is not posted');
  END IF;

  SELECT voucher_number INTO v_existing FROM public.vouchers
   WHERE reference_number = p_grn_id::TEXT AND status <> 'CANCELLED' LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('posted', false, 'already', true, 'voucher_number', v_existing);
  END IF;

  SELECT COALESCE(SUM(amount), 0), COALESCE(SUM(tax_amount), 0) INTO v_taxable, v_tax
    FROM public.grn_items WHERE grn_id = p_grn_id;
  IF v_taxable <= 0 THEN
    RETURN jsonb_build_object('posted', false, 'reason', 'GRN has no valued lines');
  END IF;

  SELECT * INTO v_supplier FROM public.suppliers WHERE id = v_grn.supplier_id;
  SELECT id INTO v_company FROM public.companies WHERE company_key = 'hope_pharmacy';

  v_creditor := v_supplier.ledger_account_id;
  IF v_creditor IS NULL THEN
    SELECT id INTO v_creditor FROM public.chart_of_accounts WHERE account_code = '2120' AND is_active LIMIT 1;
  END IF;

  v_interstate := btrim(COALESCE(v_supplier.cst, '')) ~ '^[0-9]{2}'
                  AND left(btrim(v_supplier.cst), 2) <> '27';

  v_total := ROUND(v_taxable + v_tax, 2);
  v_rounded := ROUND(v_total, 0);
  v_diff := ROUND(v_rounded - v_total, 2);

  SELECT id, voucher_type_code INTO v_type_id, v_type_code
    FROM public.voucher_types WHERE voucher_category = 'PURCHASE' AND is_active
    ORDER BY voucher_type_code LIMIT 1;
  IF v_type_id IS NULL THEN
    RETURN jsonb_build_object('posted', false, 'reason', 'No active PURCHASE voucher type');
  END IF;
  v_number := public.generate_voucher_number(v_type_code);

  INSERT INTO public.vouchers (
    id, voucher_number, voucher_type_id, voucher_date, reference_number,
    narration, total_amount, company_id, status, is_optional, created_by, last_modified_by
  ) VALUES (
    v_voucher, v_number, v_type_id, COALESCE(v_grn.grn_date, CURRENT_DATE), p_grn_id::TEXT,
    'Purchase from ' || COALESCE(v_supplier.supplier_name, 'supplier')
      || ' - GRN ' || COALESCE(v_grn.grn_number, '')
      || COALESCE(', invoice ' || NULLIF(btrim(v_grn.invoice_number), ''), ''),
    v_rounded, v_company, 'AUTHORISED', false, 'grn-accrual-gst', 'grn-accrual-gst'
  );

  FOR r IN
    SELECT COALESCE(gst, 0) AS slab, ROUND(SUM(amount), 2) AS taxable
      FROM public.grn_items WHERE grn_id = p_grn_id
     GROUP BY COALESCE(gst, 0) HAVING ROUND(SUM(amount), 2) <> 0
     ORDER BY 1
  LOOP
    v_order := v_order + 1;
    INSERT INTO public.voucher_entries (voucher_id, account_id, debit_amount, credit_amount, narration, entry_order)
    VALUES (v_voucher, public.purchase_slab_ledger(v_company, r.slab), r.taxable, 0,
            'Purchase @ ' || CASE WHEN r.slab = ROUND(r.slab) THEN ROUND(r.slab)::INTEGER::TEXT
                                  ELSE trim(to_char(r.slab, 'FM999990.99')) END || '%', v_order);
  END LOOP;

  IF v_tax > 0 THEN
    IF v_interstate THEN
      SELECT id INTO v_ledger FROM public.chart_of_accounts
       WHERE company_id = v_company AND is_active AND account_name = 'IGST';
      v_order := v_order + 1;
      INSERT INTO public.voucher_entries (voucher_id, account_id, debit_amount, credit_amount, narration, entry_order)
      VALUES (v_voucher, v_ledger, ROUND(v_tax, 2), 0, 'IGST', v_order);
    ELSE
      SELECT id INTO v_ledger FROM public.chart_of_accounts
       WHERE company_id = v_company AND is_active AND account_name = 'CGST';
      v_order := v_order + 1;
      INSERT INTO public.voucher_entries (voucher_id, account_id, debit_amount, credit_amount, narration, entry_order)
      VALUES (v_voucher, v_ledger, ROUND(v_tax / 2, 2), 0, 'CGST', v_order);

      SELECT id INTO v_ledger FROM public.chart_of_accounts
       WHERE company_id = v_company AND is_active AND account_name = 'SGST';
      v_order := v_order + 1;
      INSERT INTO public.voucher_entries (voucher_id, account_id, debit_amount, credit_amount, narration, entry_order)
      VALUES (v_voucher, v_ledger, ROUND(v_tax, 2) - ROUND(v_tax / 2, 2), 0, 'SGST', v_order);
    END IF;
  END IF;

  IF v_diff <> 0 THEN
    SELECT id INTO v_ledger FROM public.chart_of_accounts
     WHERE company_id = v_company AND is_active AND account_name = 'ROUND OFF';
    v_order := v_order + 1;
    INSERT INTO public.voucher_entries (voucher_id, account_id, debit_amount, credit_amount, narration, entry_order)
    VALUES (v_voucher, v_ledger, GREATEST(v_diff, 0), GREATEST(-v_diff, 0), 'Round off', v_order);
  END IF;

  INSERT INTO public.voucher_entries (voucher_id, account_id, debit_amount, credit_amount, narration, entry_order)
  VALUES (v_voucher, v_creditor, 0, v_rounded,
          'Payable to ' || COALESCE(v_supplier.supplier_name, 'supplier'), v_order + 1);

  RETURN jsonb_build_object('posted', true, 'voucher_number', v_number,
    'taxable', v_taxable, 'tax', v_tax, 'total', v_rounded, 'interstate', v_interstate);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Repost the cutover-onward purchases into the right slab ledgers
-- ---------------------------------------------------------------------------
DO $$
DECLARE r RECORD; v_res JSONB; v_done INTEGER := 0;
BEGIN
  FOR r IN
    SELECT g.id, g.grn_number FROM public.goods_received_notes g
     WHERE g.status = 'POSTED' AND g.grn_date >= DATE '2026-07-25' ORDER BY g.grn_date
  LOOP
    UPDATE public.vouchers
       SET status = 'CANCELLED', last_modified_by = 'gst-slab-fix',
           narration = narration || ' [cancelled: reposted into the correct slab ledgers]',
           updated_at = NOW()
     WHERE reference_number = r.id::TEXT AND status <> 'CANCELLED';
    v_res := public.post_grn_purchase_voucher(r.id);
    IF NOT COALESCE((v_res ->> 'posted')::BOOLEAN, false) THEN
      RAISE EXCEPTION 'ABORT: % could not be reposted: %', r.grn_number, v_res;
    END IF;
    v_done := v_done + 1;
  END LOOP;
  RAISE NOTICE 'Reposted % purchases into their slab ledgers', v_done;
END $$;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_fallback INTEGER; v_unbalanced INTEGER;
BEGIN
  -- No cutover-onward line may still be sitting in the general purchase ledger
  -- for a rate that has a slab ledger of its own.
  SELECT COUNT(*) INTO v_fallback
    FROM public.voucher_entries e
    JOIN public.vouchers v ON v.id = e.voucher_id AND v.status = 'AUTHORISED'
    JOIN public.chart_of_accounts a ON a.id = e.account_id AND a.account_code = '5110'
    JOIN public.goods_received_notes g ON g.id::TEXT = v.reference_number
   WHERE g.grn_date >= DATE '2026-07-25'
     AND e.narration IN ('Purchase @ 0%', 'Purchase @ 5%', 'Purchase @ 12%', 'Purchase @ 18%');
  IF v_fallback > 0 THEN
    RAISE EXCEPTION 'ABORT: % standard-slab line(s) still land in the general ledger', v_fallback;
  END IF;

  SELECT COUNT(*) INTO v_unbalanced
    FROM (
      SELECT e.voucher_id FROM public.voucher_entries e
        JOIN public.vouchers v ON v.id = e.voucher_id
       WHERE v.status = 'AUTHORISED' GROUP BY e.voucher_id
      HAVING ABS(COALESCE(SUM(e.debit_amount), 0) - COALESCE(SUM(e.credit_amount), 0)) > 0.01
    ) x;
  IF v_unbalanced > 0 THEN
    RAISE EXCEPTION 'ABORT: % authorised vouchers have debits <> credits', v_unbalanced;
  END IF;

  RAISE NOTICE 'OK — every slab lands in its own ledger';
END $$;
