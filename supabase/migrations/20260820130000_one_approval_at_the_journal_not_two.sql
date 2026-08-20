-- One approval, at the journal. Not a second one at the payment.
--
-- THE INSTRUCTION (20 Aug, Dr M): "Approval while paying is not needed. Approval
-- should be only at the time of journal voucher... presently we need to take two
-- approvals for every payment: one at the time of creating general voucher, and
-- another at the time of payment voucher. Remove the approvals needed for
-- payment voucher if the JV is already approved."
--
-- WHERE THE SECOND ONE CAME FROM. expense_bill_payment_blocked (15-Aug) refuses
-- a payment until expense_bills.approved_at is set. That was right when a bill
-- was a bare record somebody typed. It is redundant for a bill whose journal has
-- already been raised and authorised by an approval step — the spot approval,
-- the per-patient Approve on the Daily Revenue Report, the implant referral.
-- Those all post an AUTHORISED JV at the moment the bill is created, so asking
-- again at payment is asking the same question twice.
--
-- HOW A BILL AND ITS JOURNAL ARE JOINED. vouchers.reference_number carries the
-- bill number: MLE-1469 has JV1834 and JV1835, both AUTHORISED. That is the link
-- the rule reads.
--
-- WHAT STAYS. A bill with NO authorised journal still needs approving before it
-- is paid — a bare invoice recorded by hand has had nobody look at it, and that
-- is the case the gate was built for. So this removes the duplicate, not the
-- control.
--
-- Of the 43 bills waiting this afternoon, this releases the ones whose journal
-- was already authorised and leaves the rest exactly where they were. The count
-- on the Awaiting approval button falls accordingly, which is the point.

CREATE OR REPLACE FUNCTION public.expense_bill_payment_blocked(p_bill_id UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_appr UUID; v_at TIMESTAMPTZ; v_no TEXT; v_jv INT;
BEGIN
  IF NOT COALESCE((SELECT enforced FROM expense_bill_approval_settings WHERE id), false) THEN
    RETURN NULL;
  END IF;

  SELECT bill_number, approved_by, approved_at INTO v_no, v_appr, v_at
    FROM expense_bills WHERE id = p_bill_id;

  -- Approved on the bill itself. Unchanged.
  IF v_at IS NOT NULL THEN RETURN NULL; END IF;

  -- Or already approved at the journal, which is the only approval Dr M wants.
  -- An AUTHORISED voucher against this bill number means the entry has been
  -- through that step; a cancelled or pending one does not count.
  SELECT count(*) INTO v_jv
    FROM vouchers v
   WHERE v.reference_number = v_no
     AND v.status = 'AUTHORISED';
  IF COALESCE(v_jv, 0) > 0 THEN
    RETURN NULL;
  END IF;

  RETURN format('Bill %s has not been approved by Dr Murali. Nothing has been paid — '
                'ask for approval and pay again.', COALESCE(v_no, ''));
END $$;

REVOKE ALL ON FUNCTION public.expense_bill_payment_blocked(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expense_bill_payment_blocked(UUID) TO anon, authenticated;

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE
  v_with_jv UUID; v_without UUID; v_no TEXT; v_msg TEXT; v_on BOOLEAN;
BEGIN
  SELECT enforced INTO v_on FROM expense_bill_approval_settings WHERE id;
  IF NOT v_on THEN
    RAISE NOTICE 'The approval gate is switched off entirely — nothing to test against';
    RETURN;
  END IF;

  -- A bill with no approval of its own but an authorised journal.
  SELECT b.id, b.bill_number INTO v_with_jv, v_no
    FROM expense_bills b
   WHERE b.approved_at IS NULL
     AND EXISTS (SELECT 1 FROM vouchers v
                  WHERE v.reference_number = b.bill_number AND v.status = 'AUTHORISED')
   LIMIT 1;
  IF v_with_jv IS NOT NULL THEN
    v_msg := public.expense_bill_payment_blocked(v_with_jv);
    IF v_msg IS NOT NULL THEN
      RAISE EXCEPTION 'ABORT: % has an authorised journal and is still blocked: %', v_no, v_msg;
    END IF;
  ELSE
    RAISE NOTICE 'No unapproved bill with an authorised journal to test against';
  END IF;

  -- And one with neither must still be refused, or the control is gone.
  SELECT b.id, b.bill_number INTO v_without, v_no
    FROM expense_bills b
   WHERE b.approved_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM vouchers v
                      WHERE v.reference_number = b.bill_number AND v.status = 'AUTHORISED')
   LIMIT 1;
  IF v_without IS NOT NULL THEN
    v_msg := public.expense_bill_payment_blocked(v_without);
    IF v_msg IS NULL THEN
      RAISE EXCEPTION 'ABORT: % has no journal and no approval, and is not blocked', v_no;
    END IF;
  ELSE
    RAISE NOTICE 'Every unapproved bill has an authorised journal — the gate now releases all of them';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
