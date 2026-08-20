-- ------------------------------------------------------ who matches whom

-- Computed once into a table rather than a view. The matching is 127 names
-- against ~1,000 ledgers with a trigram comparison for the ones that do not
-- match outright, and re-deriving that on every read timed the migration out.
CREATE TABLE IF NOT EXISTS public.staff_roster_status (
  account_id    UUID PRIMARY KEY REFERENCES public.chart_of_accounts(id) ON DELETE CASCADE,
  account_name  TEXT NOT NULL,
  ledger_key    TEXT NOT NULL,
  role          TEXT,
  company_name  TEXT,
  paid_recently BOOLEAN NOT NULL,
  roster_name   TEXT,
  status        TEXT NOT NULL,
  refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.staff_roster_status TO anon, authenticated;

/** Work out, for every salary ledger, whether the newest sheet accounts for it. */
CREATE OR REPLACE FUNCTION public.refresh_staff_roster_status()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n INT;
BEGIN
  DELETE FROM staff_roster_status WHERE true;

  INSERT INTO staff_roster_status
    (account_id, account_name, ledger_key, role, company_name, paid_recently, roster_name, status)
  -- MATERIALIZED throughout: inlined, these keys are recomputed once per
  -- comparison rather than once per row — 127 x 995 x five regexes, which is
  -- what made the first attempt time out.
  WITH roster AS MATERIALIZED (
    SELECT name, staff_name_key(name) AS k
      FROM active_staff_roster
     WHERE is_active AND as_of = (SELECT max(as_of) FROM active_staff_roster)
  ),
  -- Deliberately NOT through v_party_ledger_candidates, which filters is_active:
  -- once a ledger is hidden it would drop out of its own status table and the
  -- second run would think it had never been seen.
  led AS MATERIALIZED (
    SELECT a.id AS account_id, a.account_name::TEXT AS account_name,
           staff_name_key(a.account_name) AS k,
           lower(btrim(COALESCE(a.account_group, ''))) AS grp,
           co.company_name::TEXT AS company_name
      FROM chart_of_accounts a
      LEFT JOIN companies co ON co.id = a.company_id
     WHERE lower(btrim(COALESCE(a.account_group, ''))) IN
           ('hope salary exp', 'ayushman salary expences', 'rmo salary')
       AND btrim(COALESCE(a.account_name, '')) <> ''
  ),
  -- One pass over the recent vouchers, rather than a lookup per ledger.
  paid AS MATERIALIZED (
    SELECT DISTINCT e.account_id
      FROM voucher_entries e
      JOIN vouchers v ON v.id = e.voucher_id
     WHERE v.status <> 'CANCELLED'
       AND v.voucher_date >= current_date - 180
  )
  SELECT l.account_id, l.account_name, l.k,
         CASE WHEN l.grp = 'rmo salary' THEN 'rmo' ELSE 'salary' END,
         l.company_name,
         p.account_id IS NOT NULL,
         m.name,
         CASE WHEN m.name IS NOT NULL         THEN 'on the sheet'
              WHEN p.account_id IS NOT NULL   THEN 'not on the sheet, but paid in the last 180 days'
              ELSE 'not on the sheet' END
    FROM led l
    LEFT JOIN paid p ON p.account_id = l.account_id
    LEFT JOIN LATERAL (
      SELECT r.name FROM roster r
       WHERE l.k <> '' AND r.k <> ''
         AND (r.k = l.k
              OR l.k LIKE r.k || ' %' OR l.k LIKE '% ' || r.k
              OR r.k LIKE l.k || ' %' OR r.k LIKE '% ' || l.k
              OR similarity(r.k, l.k) >= 0.7)
       ORDER BY (r.k = l.k) DESC, similarity(r.k, l.k) DESC
       LIMIT 1
    ) m ON true;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.refresh_staff_roster_status() FROM PUBLIC;

/** The two lists a human has to look at, and nothing else. */
CREATE OR REPLACE VIEW public.v_staff_roster_review AS
  SELECT 'kept — paid recently but not on the sheet' AS list,
         account_name AS name, company_name AS detail
    FROM public.staff_roster_status
   WHERE roster_name IS NULL AND paid_recently
  UNION ALL
  SELECT 'on the sheet but has no salary ledger', r.name, NULL
    FROM public.active_staff_roster r
   WHERE r.is_active
     AND r.as_of = (SELECT max(as_of) FROM public.active_staff_roster)
     AND NOT EXISTS (SELECT 1 FROM public.staff_roster_status s WHERE s.roster_name = r.name);

GRANT SELECT ON public.v_staff_roster_review TO anon, authenticated;


DO $r$ DECLARE n INT; BEGIN n := public.refresh_staff_roster_status(); RAISE NOTICE '% examined', n; END $r$;
