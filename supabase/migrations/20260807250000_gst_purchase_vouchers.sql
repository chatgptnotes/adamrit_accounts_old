-- Purchase vouchers as GST wants them, from the GRN.
--
-- Tally books a pharmacy purchase like this (Hope Pharmacy, invoice 1325):
--
--     Dr  Mediccine Pur 5%       228.00
--     Dr  CGST                     5.70
--     Dr  SGST                     5.70
--     Cr  ROUND OFF                0.40
--         Cr  HOSPIRUSH PHARMACY      239.00
--
-- Adamrit was booking Dr Medicine Purchase (one gross ledger) / Cr the
-- supplier, with no tax split and no rounding — so no input credit was
-- recorded anywhere and the supplier was credited with the taxable value
-- instead of what the invoice actually demands.
--
-- Everything needed is already captured on the GRN lines: amount (taxable),
-- gst (the slab), cgst, sgst and tax_amount. This posts from those:
--
--   * one debit per slab, into Mediccine Pur 0/5/12/18%
--   * CGST + SGST for an intra-state supplier, IGST when the supplier's GSTIN
--     is registered in another state
--   * ROUND OFF for the difference to the rupee
--   * the supplier credited with the rounded invoice total
--
-- Then it restates every purchase posted since the 25-Jul-2026 accounting
-- cutover — 28 GRNs — cancelling the old voucher and its optional mirror and
-- posting the GST-correct one on the same date. Purchases before the cutover
-- belong to the Tally opening balances and are left alone.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

-- ---------------------------------------------------------------------------
-- STEP 1 — the two missing ledgers
-- ---------------------------------------------------------------------------
INSERT INTO public.chart_of_accounts
  (account_code, account_name, account_type, account_group, company_id,
   is_active, opening_balance, opening_balance_type)
SELECT v.code, v.name, v.type, v.grp, c.id, true, 0, v.ob
  FROM public.companies c
  CROSS JOIN (VALUES
    ('PHPUR0',  'Mediccine Pur 0%', 'INDIRECT_EXPENSES',   'Purchase Accounts', 'DR'),
    ('PHIGST',  'IGST',             'CURRENT_LIABILITIES', 'Duties & Taxes',    'DR')
  ) AS v(code, name, type, grp, ob)
 WHERE c.company_key = 'hope_pharmacy'
   AND NOT EXISTS (
     SELECT 1 FROM public.chart_of_accounts a
      WHERE a.company_id = c.id AND lower(btrim(a.account_name)) = lower(v.name)
   );

-- ---------------------------------------------------------------------------
-- STEP 2 — the posting itself
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_grn_purchase_voucher(p_grn_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_grn RECORD;
  v_supplier RECORD;
  v_company UUID;
  v_creditor UUID;
  v_round UUID;
  v_type_id UUID;
  v_type_code TEXT;
  v_number TEXT;
  v_voucher UUID := gen_random_uuid();
  v_interstate BOOLEAN;
  v_taxable NUMERIC := 0;
  v_tax NUMERIC := 0;
  v_total NUMERIC;
  v_rounded NUMERIC;
  v_diff NUMERIC;
  v_order INTEGER := 0;
  v_ledger UUID;
  v_existing TEXT;
  r RECORD;
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

  SELECT COALESCE(SUM(amount), 0), COALESCE(SUM(tax_amount), 0)
    INTO v_taxable, v_tax
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

  -- Maharashtra is 27. A supplier registered elsewhere charges IGST; an
  -- unreadable or missing GSTIN is treated as local, which is what the
  -- invoices in hand actually are.
  v_interstate := COALESCE(left(btrim(v_supplier.cst), 2), '27') NOT IN ('27', '')
                  AND btrim(COALESCE(v_supplier.cst, '')) ~ '^[0-9]{2}';

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

  -- One debit per GST slab.
  FOR r IN
    SELECT COALESCE(gst, 0) AS slab, ROUND(SUM(amount), 2) AS taxable
      FROM public.grn_items WHERE grn_id = p_grn_id
     GROUP BY COALESCE(gst, 0) HAVING ROUND(SUM(amount), 2) <> 0
     ORDER BY 1
  LOOP
    SELECT id INTO v_ledger FROM public.chart_of_accounts
     WHERE company_id = v_company AND is_active
       AND lower(btrim(account_name)) = lower('Mediccine Pur ' || trim(to_char(r.slab, 'FM999990.99')) || '%');
    IF v_ledger IS NULL THEN
      -- An unusual slab (4%, 9%, 10%, 25% appear in older data) has no ledger
      -- of its own; it lands in the general purchase ledger rather than being
      -- silently folded into a slab it does not belong to.
      SELECT id INTO v_ledger FROM public.chart_of_accounts WHERE account_code = '5110' AND is_active LIMIT 1;
    END IF;
    v_order := v_order + 1;
    INSERT INTO public.voucher_entries (voucher_id, account_id, debit_amount, credit_amount, narration, entry_order)
    VALUES (v_voucher, v_ledger, r.taxable, 0, 'Purchase @ ' || r.slab || '%', v_order);
  END LOOP;

  -- The tax, split the way the supplier's registration requires.
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

  -- Rounding to the rupee, the way the invoice is actually raised.
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
-- STEP 3 — the GRN posts through it from now on
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_grn_supplier_bill_gst()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF upper(COALESCE(NEW.status, '')) <> 'POSTED' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND upper(COALESCE(OLD.status, '')) = 'POSTED' THEN RETURN NEW; END IF;
  PERFORM public.post_grn_purchase_voucher(NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_grn_supplier_bill ON public.goods_received_notes;
CREATE TRIGGER trg_grn_supplier_bill
  AFTER INSERT OR UPDATE OF status ON public.goods_received_notes
  FOR EACH ROW EXECUTE FUNCTION public.post_grn_supplier_bill_gst();

-- The optional mirror repeated the old single-ledger shape; it would now
-- contradict the voucher beside it.
DROP TRIGGER IF EXISTS trg_optional_pharmacy_purchase_jv ON public.goods_received_notes;

-- ---------------------------------------------------------------------------
-- STEP 4 — restate every purchase since the cutover
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_res JSONB;
  v_done INTEGER := 0;
  v_before NUMERIC := 0;
  v_after NUMERIC := 0;
BEGIN
  FOR r IN
    SELECT g.id, g.grn_number
      FROM public.goods_received_notes g
     WHERE g.status = 'POSTED'
       AND g.grn_date >= DATE '2026-07-25'
     ORDER BY g.grn_date
  LOOP
    SELECT COALESCE(SUM(v.total_amount), 0) INTO v_before
      FROM public.vouchers v
     WHERE v.reference_number = r.id::TEXT AND v.status <> 'CANCELLED';

    UPDATE public.vouchers
       SET status = 'CANCELLED',
           last_modified_by = 'gst-purchase-restatement',
           narration = narration || ' [cancelled: reposted with the GST split the invoice carries]',
           updated_at = NOW()
     WHERE (reference_number = r.id::TEXT
            OR reference_number = 'PHARMACY-JV-PURCHASE-' || r.id::TEXT)
       AND status <> 'CANCELLED';

    v_res := public.post_grn_purchase_voucher(r.id);
    IF COALESCE((v_res ->> 'posted')::BOOLEAN, false) THEN
      v_done := v_done + 1;
      v_after := v_after + (v_res ->> 'total')::NUMERIC;
    ELSE
      RAISE EXCEPTION 'ABORT: % could not be reposted: %', r.grn_number, v_res;
    END IF;
  END LOOP;

  RAISE NOTICE 'Reposted % purchases since the cutover, now totalling Rs %', v_done, ROUND(v_after, 2);
END $$;

-- ---------------------------------------------------------------------------
-- STEP 5 — verify before committing
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_unbalanced INTEGER;
  v_bad INTEGER;
  v_multi INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_unbalanced
    FROM (
      SELECT e.voucher_id FROM public.voucher_entries e
        JOIN public.vouchers v ON v.id = e.voucher_id
       WHERE v.status = 'AUTHORISED'
       GROUP BY e.voucher_id
      HAVING ABS(COALESCE(SUM(e.debit_amount), 0) - COALESCE(SUM(e.credit_amount), 0)) > 0.01
    ) x;
  IF v_unbalanced > 0 THEN
    RAISE EXCEPTION 'ABORT: % authorised vouchers have debits <> credits', v_unbalanced;
  END IF;

  -- Every restated purchase must equal the rounded taxable + tax of its GRN.
  SELECT COUNT(*) INTO v_bad
    FROM public.goods_received_notes g
    JOIN public.vouchers v ON v.reference_number = g.id::TEXT AND v.status = 'AUTHORISED'
    JOIN LATERAL (
      SELECT COALESCE(SUM(amount), 0) AS taxable, COALESCE(SUM(tax_amount), 0) AS tax
        FROM public.grn_items WHERE grn_id = g.id
    ) i ON true
   WHERE g.status = 'POSTED' AND g.grn_date >= DATE '2026-07-25'
     AND ABS(v.total_amount - ROUND(i.taxable + i.tax, 0)) > 0.01;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % restated purchase(s) do not match their GRN total', v_bad;
  END IF;

  SELECT COUNT(*) INTO v_multi
    FROM (
      SELECT reference_number FROM public.vouchers
       WHERE status <> 'CANCELLED' AND COALESCE(is_optional, false) = false
         AND reference_number IN (
           SELECT id::TEXT FROM public.goods_received_notes
            WHERE status = 'POSTED' AND grn_date >= DATE '2026-07-25')
       GROUP BY reference_number HAVING COUNT(*) > 1
    ) y;
  IF v_multi > 0 THEN
    RAISE EXCEPTION 'ABORT: % GRN(s) carry more than one live purchase voucher', v_multi;
  END IF;

  RAISE NOTICE 'OK — purchases post with their GST split, and the cutover-onward history matches';
END $$;
