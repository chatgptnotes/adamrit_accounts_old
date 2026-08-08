-- Replacing a payment proof left the old screenshot behind in storage.
--
-- The bill stopped pointing at it, so nothing showed it, but the file stayed
-- in uploads/voucher-attachments/ forever. The caller cannot delete what it
-- cannot name, so the RPC now hands back the path it just overwrote and the
-- app removes that object after the swap has been committed.
--
-- Returns JSONB rather than the bare UUID it used to: the caller needs both
-- the bill it wrote and the file it displaced. The return type changes, so
-- the old signature is dropped first.
--
-- Applied with scripts/apply-migration.py, which supplies the transaction.
-- Idempotent, and it verifies itself before committing.

DROP FUNCTION IF EXISTS public.save_expense_bill_payment_proof(UUID, TEXT, TEXT);

CREATE FUNCTION public.save_expense_bill_payment_proof(
  p_bill_id UUID,
  p_path    TEXT,
  p_url     TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id       UUID;
  v_previous TEXT;
BEGIN
  -- Lock the row first: two people uploading against the same bill at once
  -- must not both read the same old path and both try to delete it.
  SELECT payment_proof_path INTO v_previous
    FROM public.expense_bills
   WHERE id = p_bill_id
     FOR UPDATE;

  UPDATE public.expense_bills
     SET payment_proof_path = p_path,
         payment_proof_url  = p_url
   WHERE id = p_bill_id
  RETURNING id INTO v_id;

  -- Never let a missing bill look like a successful upload.
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'no expense bill with id %', p_bill_id;
  END IF;

  RETURN jsonb_build_object(
    'bill_id', v_id,
    -- Only when it is genuinely a different file: re-saving the same path
    -- must not ask the caller to delete what the bill still points at.
    'previous_path', CASE WHEN v_previous IS DISTINCT FROM p_path THEN v_previous END
  );
END;
$$;

-- Adamrit's custom User-table login ordinarily reaches data as the anon role.
GRANT EXECUTE ON FUNCTION public.save_expense_bill_payment_proof(UUID, TEXT, TEXT)
  TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------------
-- Proof
-- ------------------------------------------------------------------
DO $verify$
DECLARE
  v_oid OID;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'save_expense_bill_payment_proof'
     AND pg_get_function_identity_arguments(p.oid) = 'p_bill_id uuid, p_path text, p_url text';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'ABORT: save_expense_bill_payment_proof(uuid, text, text) is missing';
  END IF;

  IF (SELECT pg_get_function_result(v_oid)) <> 'jsonb' THEN
    RAISE EXCEPTION 'ABORT: save_expense_bill_payment_proof does not return jsonb';
  END IF;

  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'ABORT: save_expense_bill_payment_proof is not SECURITY DEFINER';
  END IF;

  IF NOT has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: the app cannot execute save_expense_bill_payment_proof';
  END IF;

  RAISE NOTICE 'OK — a replaced payment proof now names the file it displaced';
END;
$verify$;
