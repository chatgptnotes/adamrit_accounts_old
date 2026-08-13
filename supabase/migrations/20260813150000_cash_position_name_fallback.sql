-- Show a name when the login is missing.
--
-- Before the collecting user was stamped (and whenever staff share a login),
-- cash lands with no user id and the whole lot collapses into a single
-- "Not recorded to anyone" row -- which is what Hope's counter looked like on
-- day one. The payment screen has always captured a billing executive name by
-- hand, so fall back to that rather than showing nothing.
--
-- This is DISPLAY ONLY. Claiming still works off collected_by_user_id, because
-- a hand-typed name is not evidence of who is holding money: the list contains
-- both "Abhishek" and "Abhishekh", and five names that match no user at all.
-- The attribution column says which of the two you are looking at.

DROP FUNCTION IF EXISTS public.cash_position_by_holder();

CREATE OR REPLACE FUNCTION public.cash_position_by_holder()
RETURNS TABLE (
  holder_user_id UUID,
  holder_name TEXT,
  attribution TEXT,          -- 'login' | 'name' | 'none'
  net_cash NUMERIC,
  receipt_count INTEGER,
  oldest_uncollected TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cutover AS (SELECT cutover_at FROM cash_handover_settings WHERE id),
  pool AS (
    SELECT a.collected_by_user_id AS uid,
           NULLIF(btrim(COALESCE(a.billing_executive, '')), '') AS label,
           COALESCE(a.advance_amount, 0) AS amount,
           a.payment_date AS at
      FROM advance_payment a, cutover c
     WHERE a.cash_handover_id IS NULL
       AND upper(btrim(COALESCE(a.payment_mode, ''))) = 'CASH'
       AND COALESCE(a.is_refund, false) = false
       AND COALESCE(a.status, 'ACTIVE') = 'ACTIVE'
       AND COALESCE(a.advance_amount, 0) > 0
       AND a.payment_date >= c.cutover_at
    UNION ALL
    SELECT f.collected_by_user_id, NULL, COALESCE(f.amount, 0), f.payment_date
      FROM final_payments f, cutover c
     WHERE f.cash_handover_id IS NULL
       AND upper(btrim(COALESCE(f.mode_of_payment, ''))) = 'CASH'
       AND COALESCE(f.amount, 0) > 0
       AND f.payment_date >= c.cutover_at
  ),
  keyed AS (
    SELECT p.uid,
           CASE WHEN p.uid IS NOT NULL THEN 'login'
                WHEN p.label IS NOT NULL THEN 'name'
                ELSE 'none' END AS attribution,
           CASE WHEN p.uid IS NOT NULL THEN COALESCE(u.full_name, u.email, 'Unknown user')
                WHEN p.label IS NOT NULL THEN p.label
                ELSE 'Not recorded to anyone' END AS holder_name,
           p.amount, p.at
      FROM pool p LEFT JOIN "User" u ON u.id = p.uid
  )
  SELECT k.uid, k.holder_name, k.attribution,
         sum(k.amount)::NUMERIC, count(*)::INT, min(k.at)
    FROM keyed k
   GROUP BY k.uid, k.holder_name, k.attribution
   ORDER BY sum(k.amount) DESC;
$$;

REVOKE ALL ON FUNCTION public.cash_position_by_holder() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cash_position_by_holder() TO anon, authenticated;

DO $verify$
DECLARE v_cols INT;
BEGIN
  SELECT count(*) INTO v_cols
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace,
         unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) AS arg
   WHERE n.nspname = 'public' AND p.proname = 'cash_position_by_holder';
  IF v_cols <> 6 THEN
    RAISE EXCEPTION 'ABORT: cash_position_by_holder should return 6 columns, got %', v_cols;
  END IF;

  -- The fallback must never invent a holder id: a name is not a person.
  IF EXISTS (
    SELECT 1 FROM cash_position_by_holder()
     WHERE attribution = 'name' AND holder_user_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ABORT: a name-only row was given a user id';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
