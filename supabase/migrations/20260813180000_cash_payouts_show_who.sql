-- Let the payouts line name who paid, and be opened up.
--
-- "There was a payment of one rupee by Diksha, which is not shown." It WAS in
-- the figure -- the last of ten vouchers behind Hope's -1,571 -- but the screen
-- collapsed all ten into one line with no way to look inside and no name
-- against them. payment_vouchers.paid_by was hardcoded null at the till, so
-- even now the older rows cannot say who paid; the app stamps it from here on.

-- The return type gains two columns, so the old signature has to go first.
-- No CASCADE: cash_position_by_holder and cash_handover_preview call this but
-- carry quoted bodies, which Postgres does not dependency-track, and both
-- reference the columns by name. The verify block below proves they still work.
DROP FUNCTION IF EXISTS public.cash_payouts_pool(TEXT);

CREATE OR REPLACE FUNCTION public.cash_payouts_pool(p_hospital_type TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID, amount NUMERIC, at TIMESTAMPTZ, label TEXT,
  voucher_no TEXT, paid_by TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.id, COALESCE(v.amount, 0), v.created_at,
         COALESCE(NULLIF(btrim(v.person_name), ''), 'Cash payment'),
         v.voucher_no,
         -- Prefer the person's real name over the login they typed it under.
         COALESCE(
           (SELECT COALESCE(u.full_name, u.email) FROM public."User" u
             WHERE lower(u.email) = lower(btrim(COALESCE(v.paid_by, ''))) LIMIT 1),
           NULLIF(btrim(v.paid_by), '')
         )
    FROM public.payment_vouchers v, (SELECT cutover_at FROM cash_handover_settings WHERE id) c
   WHERE v.cash_handover_id IS NULL
     AND COALESCE(v.amount, 0) > 0
     AND v.created_at >= c.cutover_at
     AND lower(COALESCE(v.account_ledger_name, '')) LIKE '%cash%'
     AND (COALESCE(btrim(p_hospital_type), '') = ''
          OR lower(btrim(COALESCE(v.hospital_type, ''))) = lower(btrim(p_hospital_type)));
$$;

REVOKE ALL ON FUNCTION public.cash_payouts_pool(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cash_payouts_pool(TEXT) TO anon, authenticated;

DO $verify$
DECLARE v_cols INT; v_one NUMERIC;
BEGIN
  SELECT count(*) INTO v_cols
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
         unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) AS a
   WHERE n.nspname = 'public' AND p.proname = 'cash_payouts_pool';
  -- 1 input + 6 output columns
  IF v_cols <> 7 THEN
    RAISE EXCEPTION 'ABORT: cash_payouts_pool should expose 7 names, got %', v_cols;
  END IF;

  -- The Rs 1 must be visible as its own row, not just inside a total.
  SELECT COALESCE(sum(amount), 0) INTO v_one
    FROM cash_payouts_pool('hope') WHERE amount = 1;
  IF v_one <> 1 THEN
    RAISE EXCEPTION 'ABORT: the Rs 1 payout is not listed individually (got %)', v_one;
  END IF;

  -- The two callers must survive the drop and recreate.
  PERFORM 1 FROM cash_position_by_holder('hope');
  PERFORM cash_handover_preview(
    (SELECT id FROM public."User" ORDER BY created_at LIMIT 1), true, 'hope');
END
$verify$;

NOTIFY pgrst, 'reload schema';
