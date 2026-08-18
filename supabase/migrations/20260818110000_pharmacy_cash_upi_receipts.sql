-- The pharmacy's cash reaches the books, and UPI stops hiding in the bank.
--
-- THE COMPLAINT (18 Aug, Dr M, with screenshots): the pharmacy module's cash
-- book shows the day's receipts and payments, but the accounting module shows
-- almost nothing against them and there is no ledger posting.
--
-- WHAT WAS ACTUALLY HAPPENING. The machinery is all there and correct
-- (20260807100000): every sale raises an invoice JV -- Dr Pharmacy Debtors,
-- Cr Medicine Sales -- and a RECEIPT is meant to follow when the money lands.
-- The receipt refuses unless payment_status is COMPLETED or REFUNDED. But the
-- counter marks a discounted bill PENDING_DISCOUNT_APPROVAL, and sales made
-- before the 7-Aug trigger existed never fired at all. So the cash was taken,
-- the debtor was raised, and nothing ever cleared it.
--
-- Measured on 17-Aug, the day in the screenshots: 17 sales worth Rs 12,349 all
-- debited Pharmacy Debtors, and only Rs 4,603 came back (Canara Bank 4,553 +
-- Cash 50 -- voucher REC2492, the single line Dr M could see). Six cash sales
-- worth Rs 850 that day; exactly one of them, Rs 50, reached the Cash ledger.
--
-- Since the 25-Jul cutover: 143 non-credit sales worth Rs 1,67,309 carry no
-- receipt. Pharmacy Debtors stands at Rs 4,20,301 -- part genuine credit, part
-- money already in the drawer, recorded as though the customer still owes it.
--
-- WHAT THIS DOES
--   1. Adds a 'Pharmacy UPI' ledger. Dr M, 18-Aug: UPI to a separate ledger.
--      It was settling into Canara Bank, mixed in with real bank movement.
--   2. Rebuilds post_pharmacy_sale_receipt to route UPI there. CASH still goes
--      to Cash; card and anything else still go to Canara Bank.
--   3. Moves the UPI receipts already posted since the cutover off Canara Bank
--      onto the new ledger.
--   4. Backfills the missing receipts from the cutover forward.
--
-- REBUILT FROM THE LIVE DATABASE, NOT FROM THE MIGRATION FILE. CLAUDE.md money
-- rule 3. The running definition was read with pg_get_functiondef and its md5
-- is asserted below before anything is replaced, so if somebody has edited
-- this function since, this migration refuses rather than silently reverting
-- their change. Only the ledger-selection CASE differs from what is running.
--
-- WHAT IS DELIBERATELY NOT BACKFILLED. 38 sales worth Rs 46,758 sit at
-- PENDING_DISCOUNT_APPROVAL: the customer has paid, but the discount is not
-- approved, so total_amount is not final. Posting a receipt for an amount that
-- then changes puts a wrong figure in the books, which is worse than a late
-- one. They post themselves the moment the discount is approved, because the
-- UPDATE trigger already fires on payment_status. Reported, not guessed at.

-- ---------------------------------------------------------------------------
-- 1. The UPI ledger
-- ---------------------------------------------------------------------------
DO $ledger$
DECLARE v_company UUID;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE company_key = 'hope_pharmacy';
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'ABORT: Hope Pharmacy company not found';
  END IF;

  INSERT INTO public.chart_of_accounts
    (account_code, account_name, account_type, account_group,
     opening_balance, opening_balance_type, company_id, is_active)
  SELECT 'PHARMUPI', 'Pharmacy UPI', 'CURRENT_ASSETS', 'Bank Accounts',
         0, 'DR', v_company, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.chart_of_accounts
     WHERE company_id = v_company AND account_name = 'Pharmacy UPI'
  );
END
$ledger$;

-- ---------------------------------------------------------------------------
-- 2. Route UPI to it, from here on
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE v_md5 TEXT;
BEGIN
  SELECT md5(pg_get_functiondef(p.oid)) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'post_pharmacy_sale_receipt';

  IF v_md5 IS NULL THEN
    RAISE EXCEPTION 'ABORT: post_pharmacy_sale_receipt does not exist';
  END IF;
  IF v_md5 <> 'b8810fcc412bac9a6b51e429df9be502' THEN
    RAISE EXCEPTION
      'ABORT: post_pharmacy_sale_receipt has changed since this was written (md5 %) -- re-read the live definition before replacing it', v_md5;
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.post_pharmacy_sale_receipt(p_sale_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale RECORD;
  v_debtor UUID;
  v_bank UUID;
  v_company UUID;
  v_mode TEXT;
  v_invoice JSONB;
BEGIN
  SELECT * INTO v_sale FROM public.pharmacy_sales WHERE sale_id = p_sale_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('posted', false, 'reason', 'Sale not found');
  END IF;

  -- The invoice always exists first, whether or not anyone pressed the button.
  v_invoice := public.post_pharmacy_sale_invoice(p_sale_id);

  v_mode := upper(COALESCE(v_sale.payment_method, ''));
  IF v_mode = 'CREDIT' THEN
    RETURN jsonb_build_object('posted', false, 'invoice', v_invoice,
      'reason', 'Credit bill — the receipt posts when the patient pays');
  END IF;
  IF COALESCE(v_sale.payment_status, '') NOT IN ('COMPLETED', 'REFUNDED') THEN
    RETURN jsonb_build_object('posted', false, 'invoice', v_invoice,
      'reason', 'Bill is not settled yet (' || COALESCE(v_sale.payment_status, 'unknown') || ')');
  END IF;
  IF COALESCE(v_sale.status, 'active') = 'cancelled' THEN
    RETURN jsonb_build_object('posted', false, 'invoice', v_invoice, 'reason', 'Sale is cancelled');
  END IF;

  SELECT id INTO v_company FROM public.companies WHERE company_key = 'hope_pharmacy';
  SELECT id INTO v_debtor FROM public.chart_of_accounts
   WHERE company_id = v_company AND account_name = 'Pharmacy Debtors' AND is_active;
  -- Cash over the counter stays in the pharmacy cash box. UPI has its own
  -- ledger (18-Aug): it used to settle into Canara Bank, where it was
  -- indistinguishable from real bank movement. Card and anything else still
  -- settle into the bank.
  SELECT id INTO v_bank FROM public.chart_of_accounts
   WHERE company_id = v_company AND is_active
     AND account_name = CASE
       WHEN v_mode = 'CASH' THEN 'Cash'
       WHEN v_mode = 'UPI'  THEN 'Pharmacy UPI'
       ELSE 'Canara Bank'
     END;

  RETURN jsonb_build_object(
    'invoice', v_invoice,
    'receipt', public.post_pharmacy_voucher(
      'RECEIPT',
      COALESCE(v_sale.sale_date::DATE, CURRENT_DATE),
      v_sale.total_amount,
      v_bank,
      v_debtor,
      'Pharmacy bill ' || COALESCE(v_sale.bill_number, v_sale.sale_id::TEXT)
        || ' paid by ' || COALESCE(NULLIF(btrim(v_sale.patient_name), ''), 'Walk-in')
        || ' via ' || v_mode,
      'PHARMACY-REC-' || p_sale_id::TEXT,
      COALESCE(v_sale.created_by::TEXT, 'pharmacy')
    )
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3 & 4. Move the UPI already posted, then backfill what never posted
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  v_company UUID;
  v_upi UUID;
  v_canara UUID;
  v_moved INT := 0;
  v_posted INT := 0;
  v_skipped INT := 0;
  r RECORD;
  v_result JSONB;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE company_key = 'hope_pharmacy';
  SELECT id INTO v_upi FROM public.chart_of_accounts
   WHERE company_id = v_company AND account_name = 'Pharmacy UPI' AND is_active;
  SELECT id INTO v_canara FROM public.chart_of_accounts
   WHERE company_id = v_company AND account_name = 'Canara Bank' AND is_active;
  IF v_upi IS NULL OR v_canara IS NULL THEN
    RAISE EXCEPTION 'ABORT: could not resolve the UPI or Canara Bank ledger';
  END IF;

  -- Receipts for UPI sales since the cutover currently debit Canara Bank.
  -- Only the DEBIT leg moves; the credit to Pharmacy Debtors is unchanged, so
  -- every voucher stays in balance.
  UPDATE public.voucher_entries e
     SET account_id = v_upi
    FROM public.vouchers v, public.pharmacy_sales s
   WHERE e.voucher_id = v.id
     AND v.status <> 'CANCELLED'
     AND v.company_id = v_company
     AND v.reference_number = 'PHARMACY-REC-' || s.sale_id::TEXT
     AND s.sale_date >= DATE '2026-07-25'
     AND upper(COALESCE(s.payment_method, '')) = 'UPI'
     AND e.account_id = v_canara
     AND e.debit_amount > 0;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- Every settled, non-credit, non-cancelled sale since the cutover that has
  -- no live receipt. post_pharmacy_voucher is idempotent on the reference, so
  -- re-running this migration cannot double-post.
  FOR r IN
    SELECT s.sale_id
      FROM public.pharmacy_sales s
     WHERE s.sale_date >= DATE '2026-07-25'
       AND upper(COALESCE(s.payment_method, '')) <> 'CREDIT'
       AND COALESCE(s.payment_status, '') IN ('COMPLETED', 'REFUNDED')
       AND COALESCE(s.status, 'active') <> 'cancelled'
       AND NOT EXISTS (
         SELECT 1 FROM public.vouchers v
          WHERE v.reference_number = 'PHARMACY-REC-' || s.sale_id::TEXT
            AND v.status <> 'CANCELLED'
       )
     ORDER BY s.sale_date, s.sale_id
  LOOP
    v_result := public.post_pharmacy_sale_receipt(r.sale_id);
    IF COALESCE((v_result -> 'receipt' ->> 'posted')::BOOLEAN, false) THEN
      v_posted := v_posted + 1;
    ELSE
      -- Never swallowed: anything that refused is counted and reported.
      v_skipped := v_skipped + 1;
      RAISE NOTICE 'sale % not receipted: %', r.sale_id, v_result -> 'receipt';
    END IF;
  END LOOP;

  RAISE NOTICE 'UPI legs moved to the new ledger: %, receipts backfilled: %, refused: %',
    v_moved, v_posted, v_skipped;
END
$backfill$;

-- ---------------------------------------------------------------------------
-- 5. Verify
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_company UUID;
  v_upi UUID;
  v_canara UUID;
  v_left INT;
  v_bad INT;
  v_upi_rows INT;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE company_key = 'hope_pharmacy';
  SELECT id INTO v_upi FROM public.chart_of_accounts
   WHERE company_id = v_company AND account_name = 'Pharmacy UPI' AND is_active;
  IF v_upi IS NULL THEN
    RAISE EXCEPTION 'ABORT: the Pharmacy UPI ledger was not created';
  END IF;

  -- Nothing settled since the cutover may still be missing its receipt.
  SELECT count(*) INTO v_left
    FROM public.pharmacy_sales s
   WHERE s.sale_date >= DATE '2026-07-25'
     AND upper(COALESCE(s.payment_method, '')) <> 'CREDIT'
     AND COALESCE(s.payment_status, '') IN ('COMPLETED', 'REFUNDED')
     AND COALESCE(s.status, 'active') <> 'cancelled'
     AND NOT EXISTS (
       SELECT 1 FROM public.vouchers v
        WHERE v.reference_number = 'PHARMACY-REC-' || s.sale_id::TEXT
          AND v.status <> 'CANCELLED'
     );
  IF v_left > 0 THEN
    RAISE EXCEPTION 'ABORT: % settled sale(s) since the cutover still have no receipt', v_left;
  END IF;

  -- No UPI receipt since the cutover may still be sitting in Canara Bank.
  SELECT id INTO v_canara FROM public.chart_of_accounts
   WHERE company_id = v_company AND account_name = 'Canara Bank' AND is_active;
  SELECT count(*) INTO v_bad
    FROM public.voucher_entries e
    JOIN public.vouchers v ON v.id = e.voucher_id
    JOIN public.pharmacy_sales s
      ON v.reference_number = 'PHARMACY-REC-' || s.sale_id::TEXT
   WHERE v.status <> 'CANCELLED'
     AND s.sale_date >= DATE '2026-07-25'
     AND upper(COALESCE(s.payment_method, '')) = 'UPI'
     AND e.account_id = v_canara
     AND e.debit_amount > 0;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % UPI receipt(s) still debit Canara Bank', v_bad;
  END IF;

  -- The new ledger must actually carry something, or the move silently did nothing.
  SELECT count(*) INTO v_upi_rows FROM public.voucher_entries WHERE account_id = v_upi;
  IF v_upi_rows = 0 THEN
    RAISE EXCEPTION 'ABORT: the Pharmacy UPI ledger has no entries at all';
  END IF;

  -- Every voucher this touched must still balance. An unbalanced voucher is
  -- the one thing that breaks every report downstream.
  SELECT count(*) INTO v_bad FROM (
    SELECT e.voucher_id
      FROM public.voucher_entries e
      JOIN public.vouchers v ON v.id = e.voucher_id
     WHERE v.company_id = v_company AND v.status = 'AUTHORISED'
     GROUP BY e.voucher_id
    HAVING ROUND(SUM(e.debit_amount), 2) <> ROUND(SUM(e.credit_amount), 2)
  ) d;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % Hope Pharmacy voucher(s) do not balance', v_bad;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
