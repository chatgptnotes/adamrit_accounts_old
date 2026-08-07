-- Void an invoice that was raised but never became a sale.
--
-- Generate Invoice saves the bill and posts its JV (Dr Pharmacy Debtors / Cr
-- Medicine Sales). If the patient walks away, that debtor is a receivable for
-- a sale that never happened, and nothing in the app could take it back.
--
-- Cancelling marks the bill cancelled and cancels its journal — the voucher is
-- kept, never deleted, so the Day Book shows what was raised and that it was
-- withdrawn. Refused once the bill has been paid: a receipt against a voided
-- invoice would leave the money with no bill behind it.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

CREATE OR REPLACE FUNCTION public.cancel_pharmacy_sale_invoice(
  p_sale_id BIGINT,
  p_user    TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_sale RECORD;
  v_receipt TEXT;
  v_journal TEXT;
BEGIN
  SELECT * INTO v_sale FROM public.pharmacy_sales WHERE sale_id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('cancelled', false, 'reason', 'That bill no longer exists');
  END IF;

  IF COALESCE(v_sale.status, 'active') = 'cancelled' THEN
    RETURN jsonb_build_object('cancelled', false, 'already', true,
      'reason', 'Bill ' || COALESCE(v_sale.bill_number, p_sale_id::TEXT) || ' is already cancelled');
  END IF;

  SELECT voucher_number INTO v_receipt
    FROM public.vouchers
   WHERE reference_number = 'PHARMACY-REC-' || p_sale_id::TEXT
     AND status <> 'CANCELLED';
  IF v_receipt IS NOT NULL THEN
    RETURN jsonb_build_object('cancelled', false, 'paid', true,
      'reason', 'Bill ' || COALESCE(v_sale.bill_number, p_sale_id::TEXT)
        || ' has been paid (receipt ' || v_receipt || ') and cannot be cancelled');
  END IF;

  IF upper(COALESCE(v_sale.payment_status, '')) NOT IN ('PENDING', 'PENDING_DISCOUNT_APPROVAL') THEN
    RETURN jsonb_build_object('cancelled', false,
      'reason', 'Bill ' || COALESCE(v_sale.bill_number, p_sale_id::TEXT)
        || ' is marked ' || COALESCE(v_sale.payment_status, 'unknown') || ', not an unpaid invoice');
  END IF;

  UPDATE public.pharmacy_sales
     SET status = 'cancelled',
         payment_status = 'CANCELLED',
         updated_at = NOW()
   WHERE sale_id = p_sale_id;

  UPDATE public.vouchers
     SET status = 'CANCELLED',
         last_modified_by = COALESCE(NULLIF(btrim(p_user), ''), 'pharmacy-invoice-cancel'),
         narration = narration || ' [cancelled: invoice withdrawn, the sale did not happen]',
         updated_at = NOW()
   WHERE reference_number = 'PHARMACY-INV-' || p_sale_id::TEXT
     AND status <> 'CANCELLED'
  RETURNING voucher_number INTO v_journal;

  RETURN jsonb_build_object(
    'cancelled', true,
    'bill_number', v_sale.bill_number,
    'journal', v_journal,
    'amount', v_sale.total_amount
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_pharmacy_sale_invoice(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_pharmacy_sale_invoice(BIGINT, TEXT)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'cancel_pharmacy_sale_invoice'
  ) THEN
    RAISE EXCEPTION 'ABORT: cancel_pharmacy_sale_invoice was not created';
  END IF;
  RAISE NOTICE 'OK — an unpaid invoice can be withdrawn, journal and all';
END $$;
