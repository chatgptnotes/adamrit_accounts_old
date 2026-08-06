-- RMO duty bills queued before the tile filled in the accounting side.
--
-- addRmoDutyApproval only ever set the RMO's own ledger, so every duty
-- landed in Approvals with no company and no expense head — needsDetails()
-- refuses to approve those, and with no approval there is no JV and nothing
-- for the RMO Payments tab to pay. The tile now resolves both from the RMO's
-- ledger; this fills in the ones already queued the same way.
--
--   company        = the company the RMO's own ledger belongs to (so the JV
--                    cannot credit a ledger in a company it was not posted in)
--   expense head   = "Rmo Salary Expenses" in that same company
--
-- Only PENDING, unpaid rows are touched. Anything already approved has a JV
-- and its accounts are settled fact.
--
-- Applied with scripts/apply-migration.py, which supplies the transaction.

UPDATE public.approval_queue q
   SET company_id = party.company_id,
       expense_account_id = expense.id
  FROM public.chart_of_accounts party
  JOIN LATERAL (
    SELECT a.id
      FROM public.chart_of_accounts a
     WHERE a.company_id = party.company_id
       AND a.is_active
       AND lower(btrim(a.account_name)) = 'rmo salary expenses'
     ORDER BY a.account_code
     LIMIT 1
  ) expense ON true
 WHERE q.reference_no LIKE 'RMO-DUTY-%'
   AND q.status = 'PENDING'
   AND q.is_paid = false
   AND q.party_account_id = party.id
   AND (q.company_id IS NULL OR q.expense_account_id IS NULL);

DO $verify$
DECLARE
  v_stuck   INT;
  v_ready   INT;
  v_crossco INT;
BEGIN
  -- Nothing pending may still be missing its accounting side.
  SELECT count(*) INTO v_stuck
    FROM public.approval_queue
   WHERE reference_no LIKE 'RMO-DUTY-%'
     AND status = 'PENDING'
     AND is_paid = false
     AND party_account_id IS NOT NULL
     AND (company_id IS NULL OR expense_account_id IS NULL);
  IF v_stuck > 0 THEN
    RAISE EXCEPTION '% pending RMO duty bill(s) still cannot be approved', v_stuck;
  END IF;

  -- Both ledgers must sit in the company the bill posts to.
  SELECT count(*) INTO v_crossco
    FROM public.approval_queue q
    JOIN public.chart_of_accounts p ON p.id = q.party_account_id
    JOIN public.chart_of_accounts x ON x.id = q.expense_account_id
   WHERE q.reference_no LIKE 'RMO-DUTY-%'
     AND (p.company_id IS DISTINCT FROM q.company_id
       OR x.company_id IS DISTINCT FROM q.company_id);
  IF v_crossco > 0 THEN
    RAISE EXCEPTION '% RMO duty bill(s) point at a ledger in another company', v_crossco;
  END IF;

  SELECT count(*) INTO v_ready
    FROM public.approval_queue
   WHERE reference_no LIKE 'RMO-DUTY-%'
     AND status = 'PENDING'
     AND company_id IS NOT NULL
     AND expense_account_id IS NOT NULL;
  RAISE NOTICE 'OK — % pending RMO duty bill(s) are now approvable', v_ready;
END;
$verify$;
