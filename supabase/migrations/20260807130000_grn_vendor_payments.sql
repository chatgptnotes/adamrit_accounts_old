-- Paying the vendor bill a GRN raised.
--
-- Receiving the goods already posts the liability: postGRN() moves the GRN to
-- POSTED and trg_grn_supplier_bill raises Dr 5110 Medicine Purchase / Cr the
-- supplier (migration 20260726240000). What had no home was the other half —
-- paying it. Lalit's tile pays from the row, so this adds:
--
--   * the payment columns on the GRN (mode, amount, voucher, proof, who, when)
--   * post_grn_vendor_payment(): Dr the supplier, Cr Cash or Canara Bank
--
-- Idempotent by reference GRN-PAY-<grn id>: paying twice returns the voucher
-- already raised rather than posting a second one.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- It verifies itself before committing.

-- ---------------------------------------------------------------------------
-- STEP 1 — what a paid GRN carries
-- ---------------------------------------------------------------------------
ALTER TABLE public.goods_received_notes
  ADD COLUMN IF NOT EXISTS paid_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_amount         NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS payment_mode        TEXT,
  ADD COLUMN IF NOT EXISTS payment_reference   TEXT,
  ADD COLUMN IF NOT EXISTS payment_voucher_no  TEXT,
  ADD COLUMN IF NOT EXISTS payment_proof_path  TEXT,
  ADD COLUMN IF NOT EXISTS payment_proof_url   TEXT,
  ADD COLUMN IF NOT EXISTS paid_by             TEXT;

-- ---------------------------------------------------------------------------
-- STEP 2 — the payment voucher
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_grn_vendor_payment(
  p_grn_id     UUID,
  p_mode       TEXT DEFAULT 'CASH',
  p_amount     NUMERIC DEFAULT NULL,
  p_reference  TEXT DEFAULT NULL,
  p_user       TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_grn RECORD;
  v_supplier RECORD;
  v_company UUID;
  v_creditor UUID;
  v_source UUID;
  v_mode TEXT := upper(COALESCE(p_mode, 'CASH'));
  v_amount NUMERIC;
  v_result JSONB;
BEGIN
  SELECT * INTO v_grn FROM public.goods_received_notes WHERE id = p_grn_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('posted', false, 'reason', 'GRN not found');
  END IF;
  IF COALESCE(v_grn.status, '') <> 'POSTED' THEN
    RETURN jsonb_build_object('posted', false,
      'reason', 'Only a posted GRN can be paid — this one is ' || COALESCE(v_grn.status, 'unknown'));
  END IF;

  v_amount := COALESCE(p_amount, v_grn.invoice_amount, v_grn.total_amount);
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('posted', false, 'reason', 'Nothing to pay on this GRN');
  END IF;

  SELECT * INTO v_supplier FROM public.suppliers WHERE id = v_grn.supplier_id;

  -- The supplier's own creditor ledger, or Other Creditors when unmapped —
  -- the same fallback the GRN accrual uses, so both halves hit one ledger.
  v_creditor := v_supplier.ledger_account_id;
  IF v_creditor IS NULL THEN
    SELECT id INTO v_creditor FROM public.chart_of_accounts
     WHERE account_code = '2120' AND is_active LIMIT 1;
  END IF;

  SELECT id INTO v_company FROM public.companies WHERE company_key = 'hope_pharmacy';
  SELECT id INTO v_source FROM public.chart_of_accounts
   WHERE company_id = v_company AND is_active
     AND account_name = CASE WHEN v_mode = 'CASH' THEN 'Cash' ELSE 'Canara Bank' END;

  v_result := public.post_pharmacy_voucher(
    'PAYMENT',
    CURRENT_DATE,
    v_amount,
    v_creditor,   -- Dr the supplier: the liability goes down
    v_source,     -- Cr cash or bank: the money goes out
    'Paid ' || COALESCE(v_supplier.supplier_name, 'supplier')
      || ' for GRN ' || COALESCE(v_grn.grn_number, '')
      || COALESCE(', invoice ' || NULLIF(btrim(v_grn.invoice_number), ''), '')
      || ' via ' || v_mode,
    'GRN-PAY-' || p_grn_id::TEXT,
    COALESCE(p_user, 'pharmacy-vendor-payments')
  );

  IF COALESCE((v_result ->> 'posted')::BOOLEAN, false) THEN
    UPDATE public.goods_received_notes
       SET paid_at            = NOW(),
           paid_amount        = v_amount,
           payment_mode       = v_mode,
           payment_reference  = NULLIF(btrim(COALESCE(p_reference, '')), ''),
           payment_voucher_no = v_result ->> 'voucher_number',
           paid_by            = COALESCE(p_user, 'pharmacy-vendor-payments'),
           updated_at         = NOW()
     WHERE id = p_grn_id;
  END IF;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.post_grn_vendor_payment(UUID, TEXT, NUMERIC, TEXT, TEXT)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- STEP 3 — verify before committing
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing TEXT := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'goods_received_notes'
       AND column_name = 'payment_voucher_no'
  ) THEN
    v_missing := v_missing || ' payment columns;';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'post_grn_vendor_payment'
  ) THEN
    v_missing := v_missing || ' post_grn_vendor_payment;';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voucher_types WHERE voucher_category = 'PAYMENT' AND is_active) THEN
    v_missing := v_missing || ' PAYMENT voucher type;';
  END IF;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'ABORT — not created:%', v_missing;
  END IF;
  RAISE NOTICE 'OK — vendor bills from GRNs can be paid from the row';
END $$;
