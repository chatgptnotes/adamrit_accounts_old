-- Catch every rupee that leaves the drawer, whichever screen let it out.
--
-- cash_payouts_pool read payment_vouchers only, which is one of two ways cash
-- goes out. The accounting Voucher Entry screen (and the tablet tile that
-- wraps it) posts straight to vouchers/voucher_entries and never creates a
-- payment_vouchers row: 3 of today's 26 cash-out vouchers, Rs 7,461, were
-- invisible to the handover. A cashier would have been asked to hand over
-- money that had already been paid out.
--
-- So the pool is now the ledger movement itself -- a credit on a cash ledger --
-- with payment_vouchers joined on only to recover what the ledger cannot say:
-- the voucher number staff recognise, the date they filed it under, and who
-- paid. The two are matched on the reference the posting trigger writes, so a
-- payment appears once, not twice.

DROP FUNCTION IF EXISTS public.cash_payouts_pool(TEXT);

CREATE OR REPLACE FUNCTION public.cash_payouts_pool(p_hospital_type TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID, amount NUMERIC, at TIMESTAMPTZ, entry_date DATE,
  label TEXT, voucher_no TEXT, paid_by TEXT, source TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cutover AS (SELECT cutover_at FROM cash_handover_settings WHERE id),
  scope AS (SELECT lower(btrim(COALESCE(p_hospital_type, ''))) AS h),
  cash_ledgers AS (
    -- Both the live per-company "Cash" and the deactivated "Cash in Hand"
    -- stub, because the payment rail still posts to the stub.
    SELECT id, company_id FROM chart_of_accounts
     WHERE lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g')))
           IN ('cash', 'cash in hand')
  ),
  movement AS (
    SELECT v.id AS voucher_id,
           sum(ve.credit_amount) AS amount,
           min(v.created_at) AS at,
           min(v.voucher_date) AS entry_date,
           min(v.voucher_number) AS voucher_number,
           min(v.narration) AS narration,
           min(v.reference_number) AS reference_number,
           min(c.company_key) AS company_key
      FROM voucher_entries ve
      JOIN cash_ledgers cl ON cl.id = ve.account_id
      JOIN vouchers v ON v.id = ve.voucher_id
      LEFT JOIN companies c ON c.id = v.company_id,
           cutover cut
     WHERE ve.credit_amount > 0
       AND v.status = 'AUTHORISED'
       AND COALESCE(v.is_optional, false) = false
       AND v.created_at >= cut.cutover_at
     GROUP BY v.id
  ),
  joined AS (
    SELECT m.voucher_id, m.amount, m.at, m.entry_date,
           m.voucher_number, m.narration, m.company_key,
           pv.voucher_no AS pv_no, pv.person_name, pv.paid_by, pv.hospital_type,
           pv.cash_handover_id
      FROM movement m
      -- post_one_payment_voucher stamps reference_number = 'PV-' || the
      -- payment_vouchers id, which is the only reliable link between the two.
      LEFT JOIN payment_vouchers pv
             ON m.reference_number = 'PV-' || pv.id::text
  )
  SELECT j.voucher_id,
         j.amount,
         j.at,
         j.entry_date,
         COALESCE(NULLIF(btrim(j.person_name), ''),
                  NULLIF(btrim(j.narration), ''),
                  'Cash payment') AS label,
         COALESCE(j.pv_no, j.voucher_number) AS voucher_no,
         COALESCE(
           (SELECT COALESCE(u.full_name, u.email) FROM public."User" u
             WHERE lower(u.email) = lower(btrim(COALESCE(j.paid_by, ''))) LIMIT 1),
           NULLIF(btrim(j.paid_by), '')
         ) AS paid_by,
         CASE WHEN j.pv_no IS NOT NULL THEN 'payment_voucher' ELSE 'accounting' END AS source
    FROM joined j, scope s
   WHERE j.cash_handover_id IS NULL
     AND (
       s.h = ''
       OR lower(btrim(COALESCE(j.hospital_type, ''))) = s.h
       -- Fall back to the voucher's company when the payment did not come
       -- through the payment rail and so carries no hospital of its own.
       OR (j.hospital_type IS NULL AND s.h = 'hope' AND j.company_key = 'drm_pvt_ltd')
       OR (j.hospital_type IS NULL AND s.h = 'ayushman' AND j.company_key = 'ayushman_nagpur')
     );
$$;

REVOKE ALL ON FUNCTION public.cash_payouts_pool(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cash_payouts_pool(TEXT) TO anon, authenticated;

DO $verify$
DECLARE v_all NUMERIC; v_h NUMERIC; v_a NUMERIC; v_dupes INT; v_acc INT;
BEGIN
  -- A payment must appear once, never twice.
  SELECT count(*) INTO v_dupes FROM (
    SELECT id FROM cash_payouts_pool(NULL) GROUP BY id HAVING count(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'ABORT: % payment(s) counted twice', v_dupes;
  END IF;

  -- The accounting-screen payments the old version missed must now be here.
  SELECT count(*) INTO v_acc FROM cash_payouts_pool(NULL) WHERE source = 'accounting';
  IF v_acc = 0 THEN
    RAISE EXCEPTION 'ABORT: no accounting-screen payments found; the join is wrong';
  END IF;

  SELECT COALESCE(sum(amount),0) INTO v_all FROM cash_payouts_pool(NULL);
  SELECT COALESCE(sum(amount),0) INTO v_h   FROM cash_payouts_pool('hope');
  SELECT COALESCE(sum(amount),0) INTO v_a   FROM cash_payouts_pool('ayushman');
  IF round(v_h + v_a, 2) > round(v_all, 2) THEN
    RAISE EXCEPTION 'ABORT: hospitals overlap (% + % > %)', v_h, v_a, v_all;
  END IF;

  PERFORM 1 FROM cash_position_by_holder('hope');
END
$verify$;

NOTIFY pgrst, 'reload schema';
