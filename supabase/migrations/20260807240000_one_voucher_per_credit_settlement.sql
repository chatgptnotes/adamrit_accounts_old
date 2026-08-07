-- One voucher per pharmacy credit settlement.
--
-- Audit of every voucher-posting trigger in the database (11 of them) found
-- pharmacy_credit_payments carrying three:
--
--   trg_settle_pharmacy_credit_payment      settle_pharmacy_credit_payment
--       Dr Cash/Canara Bank / Cr the debtor, keyed on the payment id alone —
--       it does not know about the receipt rail, so the next settlement would
--       post a second real voucher beside it. Nothing has been settled since
--       20260807100000 went in, so no duplicate exists in the data yet: this
--       is closing the hole before it is used, not cleaning up after it.
--   trg_optional_pharmacy_credit_payment_jv the same entry again, optional
--   trg_pharmacy_credit_payment_posts_receipt  the receipt rail, which is
--       idempotent by reference PHARMACY-CREDIT-REC-<id> and is the one kept
--
-- Same shape as the sale side in 20260807230000. The functions stay in place,
-- unused, in case anything else references them.
--
-- The other nine triggers were checked and are one rail each: advances (two
-- triggers, one function, insert and edit), bills, expense bills, GRN supplier
-- accrual, implant bills, medicine returns, patient payments and
-- physiotherapy. A data scan over every live non-optional voucher, keyed by
-- the entity it books and its ledger legs, finds no entity with two identical
-- vouchers.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

DROP TRIGGER IF EXISTS trg_settle_pharmacy_credit_payment ON public.pharmacy_credit_payments;
DROP TRIGGER IF EXISTS trg_optional_pharmacy_credit_payment_jv ON public.pharmacy_credit_payments;

DO $$
DECLARE
  v_left INTEGER;
  v_mine INTEGER;
  v_dupes INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_left
    FROM pg_trigger
   WHERE NOT tgisinternal
     AND tgname IN ('trg_settle_pharmacy_credit_payment',
                    'trg_optional_pharmacy_credit_payment_jv',
                    'trigger_pharmacy_credit_payment_voucher');
  IF v_left > 0 THEN
    RAISE EXCEPTION 'ABORT: % older credit-payment trigger(s) still attached', v_left;
  END IF;

  SELECT COUNT(*) INTO v_mine
    FROM pg_trigger
   WHERE NOT tgisinternal AND tgname = 'trg_pharmacy_credit_payment_posts_receipt';
  IF v_mine <> 1 THEN
    RAISE EXCEPTION 'ABORT: the receipt rail is not attached (found %)', v_mine;
  END IF;

  -- Nothing may already carry two live vouchers for one settlement.
  SELECT COUNT(*) INTO v_dupes
    FROM (
      SELECT p.id
        FROM public.pharmacy_credit_payments p
        JOIN public.vouchers v
          ON (v.reference_number = 'PHARMACY-CREDIT-REC-' || p.id::TEXT
              OR v.reference_number = p.id::TEXT)
         AND v.status <> 'CANCELLED'
         AND COALESCE(v.is_optional, false) = false
       GROUP BY p.id
      HAVING COUNT(*) > 1
    ) x;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'ABORT: % settlement(s) already have two live vouchers', v_dupes;
  END IF;

  RAISE NOTICE 'OK — a credit settlement posts one receipt, and only the receipt rail is attached';
END $$;
