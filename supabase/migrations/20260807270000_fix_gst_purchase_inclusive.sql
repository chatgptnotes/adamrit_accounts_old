-- Correction: GRN line amounts already include their GST.
--
-- 20260807250000 read grn_items.amount as the taxable value and added the tax
-- on top, so each restated purchase credited the supplier with gross + GST.
-- The data says otherwise, on every line and every slab:
--
--     amount 281.14 @ 5%  ->  tax_amount 13.39  =  281.14 x 5/105
--                             (not 281.14 x 5% = 14.06)
--
-- So amount IS the invoice line total and tax_amount is the tax inside it.
-- The taxable value is amount - tax_amount. That also matches the Tally
-- voucher this was modelled on: 228.00 net + 5.70 + 5.70 = 239.40, and the
-- GRN would carry 239.40 as the amount.
--
-- Effect of the mistake: the 28 restated purchases credited suppliers
-- Rs 1,07,434 instead of Rs 1,03,298 — Rs 4,136 too much, exactly the GST,
-- counted twice. Nothing was paid against them, so this only rewrites the
-- accrual.
--
-- This corrects the posting and reposts those 28. Pre-cutover purchases stay
-- untouched, as before.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

CREATE OR REPLACE FUNCTION public.post_grn_purchase_voucher(p_grn_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_grn RECORD; v_supplier RECORD; v_company UUID; v_creditor UUID;
  v_type_id UUID; v_type_code TEXT; v_number TEXT; v_voucher UUID := gen_random_uuid();
  v_interstate BOOLEAN; v_gross NUMERIC := 0; v_tax NUMERIC := 0; v_taxable NUMERIC;
  v_rounded NUMERIC; v_diff NUMERIC; v_order INTEGER := 0;
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

  -- amount is the line total, tax included; tax_amount is the tax within it.
  SELECT COALESCE(SUM(amount), 0), COALESCE(SUM(tax_amount), 0) INTO v_gross, v_tax
    FROM public.grn_items WHERE grn_id = p_grn_id;
  IF v_gross <= 0 THEN
    RETURN jsonb_build_object('posted', false, 'reason', 'GRN has no valued lines');
  END IF;
  v_taxable := ROUND(v_gross - v_tax, 2);

  SELECT * INTO v_supplier FROM public.suppliers WHERE id = v_grn.supplier_id;
  SELECT id INTO v_company FROM public.companies WHERE company_key = 'hope_pharmacy';

  v_creditor := v_supplier.ledger_account_id;
  IF v_creditor IS NULL THEN
    SELECT id INTO v_creditor FROM public.chart_of_accounts WHERE account_code = '2120' AND is_active LIMIT 1;
  END IF;

  v_interstate := btrim(COALESCE(v_supplier.cst, '')) ~ '^[0-9]{2}'
                  AND left(btrim(v_supplier.cst), 2) <> '27';

  v_rounded := ROUND(v_gross, 0);
  v_diff := ROUND(v_rounded - ROUND(v_gross, 2), 2);

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

  -- Taxable value per slab: the line total less the tax inside it.
  FOR r IN
    SELECT COALESCE(gst, 0) AS slab,
           ROUND(SUM(amount) - SUM(COALESCE(tax_amount, 0)), 2) AS taxable
      FROM public.grn_items WHERE grn_id = p_grn_id
     GROUP BY COALESCE(gst, 0) HAVING ROUND(SUM(amount) - SUM(COALESCE(tax_amount, 0)), 2) <> 0
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
    'taxable', v_taxable, 'tax', ROUND(v_tax, 2), 'total', v_rounded, 'interstate', v_interstate);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Repost the 28 with the tax taken out of the line, not added to it
-- ---------------------------------------------------------------------------
DO $$
DECLARE r RECORD; v_res JSONB; v_done INTEGER := 0; v_total NUMERIC := 0;
BEGIN
  FOR r IN
    SELECT g.id, g.grn_number FROM public.goods_received_notes g
     WHERE g.status = 'POSTED' AND g.grn_date >= DATE '2026-07-25' ORDER BY g.grn_date
  LOOP
    UPDATE public.vouchers
       SET status = 'CANCELLED', last_modified_by = 'gst-inclusive-fix',
           narration = narration || ' [cancelled: the line amounts already included GST]',
           updated_at = NOW()
     WHERE reference_number = r.id::TEXT AND status <> 'CANCELLED';
    v_res := public.post_grn_purchase_voucher(r.id);
    IF NOT COALESCE((v_res ->> 'posted')::BOOLEAN, false) THEN
      RAISE EXCEPTION 'ABORT: % could not be reposted: %', r.grn_number, v_res;
    END IF;
    v_done := v_done + 1;
    v_total := v_total + (v_res ->> 'total')::NUMERIC;
  END LOOP;
  RAISE NOTICE 'Reposted % purchases, suppliers now credited Rs % in total', v_done, ROUND(v_total, 2);
END $$;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_bad INTEGER; v_unbalanced INTEGER;
BEGIN
  -- Each voucher must equal the rounded GRN line total, tax included.
  SELECT COUNT(*) INTO v_bad
    FROM public.goods_received_notes g
    JOIN public.vouchers v ON v.reference_number = g.id::TEXT AND v.status = 'AUTHORISED'
    JOIN LATERAL (SELECT COALESCE(SUM(amount), 0) AS gross FROM public.grn_items WHERE grn_id = g.id) i ON true
   WHERE g.status = 'POSTED' AND g.grn_date >= DATE '2026-07-25'
     AND ABS(v.total_amount - ROUND(i.gross, 0)) > 0.01;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % purchase(s) do not equal their GRN line total', v_bad;
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

  RAISE NOTICE 'OK — purchases equal the invoice, with the GST split out of it';
END $$;
