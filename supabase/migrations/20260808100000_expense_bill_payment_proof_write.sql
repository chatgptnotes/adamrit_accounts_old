-- The PhonePe / UPI confirmation could be uploaded but never stuck to the bill.
--
-- 20260728180000_harden_expense_bills.sql enabled RLS on expense_bills and left
-- only SELECT and INSERT policies (and GRANT SELECT, INSERT). savePaymentProof
-- was the one place in the app that wrote to this table with a direct client
-- UPDATE, so it matched zero rows, PostgREST returned success with no error,
-- and the row went on showing "Upload proof" with the file sitting in storage.
--
-- Every other write to expense_bills goes through a SECURITY DEFINER RPC
-- (record_expense_bill_payment). This adds the missing one, rather than opening
-- UPDATE on a table that was deliberately hardened: a blanket GRANT UPDATE
-- would also let the browser rewrite amount, status and party_ledger_id.
--
-- Applied with scripts/apply-migration.py, which supplies the transaction.
-- Idempotent, and it verifies itself before committing.

CREATE OR REPLACE FUNCTION public.save_expense_bill_payment_proof(
  p_bill_id UUID,
  p_path    TEXT,
  p_url     TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  UPDATE public.expense_bills
     SET payment_proof_path = p_path,
         payment_proof_url  = p_url
   WHERE id = p_bill_id
  RETURNING id INTO v_id;

  -- Never let a missing bill look like a successful upload again.
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'no expense bill with id %', p_bill_id;
  END IF;

  RETURN v_id;
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
    RAISE EXCEPTION 'ABORT: save_expense_bill_payment_proof(uuid, text, text) was not created';
  END IF;

  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'ABORT: save_expense_bill_payment_proof is not SECURITY DEFINER';
  END IF;

  IF NOT has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: anon cannot execute save_expense_bill_payment_proof';
  END IF;

  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: authenticated cannot execute save_expense_bill_payment_proof';
  END IF;

  RAISE NOTICE 'OK — payment proofs can now be attached to expense bills';
END;
$verify$;
