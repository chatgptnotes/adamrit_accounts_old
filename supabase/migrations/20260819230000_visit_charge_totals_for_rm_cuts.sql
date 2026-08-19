-- What a visit has actually been charged, so an RM's cut is worked out on the
-- patient's bill rather than on a figure somebody typed.
--
-- The Daily Revenue Report resolves its Cost column as
--   bills.total_amount -> bill_preparation.bill_amount -> saved override -> ...
-- and both bill lookups miss for every OPD patient, because an OPD visit never
-- produces a bills row. The only INSERT into bills in the app is the Final Bill
-- (discharge) save; src/pages/Invoice.tsx adds the charges up on screen and
-- persists nothing. So OPD rows fell through to whatever had been typed --
-- kriti bai lodhi (UHAY26H19011) billed Rs 13,700 and paid her RM 25% of
-- Rs 1,000.
--
-- This view is the same arithmetic Invoice.tsx does, in one place both screens
-- can read. It is deliberately faithful to that file rather than tidier than
-- it: if the two disagree, the report contradicts the invoice the patient was
-- handed, which is worse than inheriting a quirk. Each quirk is marked below.
--
-- Keyed on visits.id (UUID) -- every visit_* junction table below stores the
-- visit UUID, NOT the printed visit code. bills is the table that uses the
-- code, and it is not read here.
--
-- Pharmacy is excluded, matching what the invoice prints by default: it sits
-- behind the "Show Pharmacy Charge" toggle and is outside the Rs 13,700 above.
-- Discounts are excluded too -- bills.total_amount, the source this sits beside
-- in the chain, is likewise a gross figure.

CREATE OR REPLACE VIEW public.v_visit_charge_totals AS
WITH labs AS (
  -- Invoice.tsx:1131 filters is_hidden and sums the STORED cost. A hidden lab
  -- is one somebody removed from the bill; it must not reappear here.
  SELECT visit_id, SUM(COALESCE(cost, 0)) AS amount
  FROM public.visit_labs
  WHERE COALESCE(is_hidden, false) = false
  GROUP BY visit_id
),
radiology AS (
  -- Invoice.tsx:1169 falls back cost -> unit_rate -> 1000. The 1000 is a quirk
  -- of that file, carried so the two totals agree; NULLIF reproduces the
  -- JavaScript truthiness test, where a stored 0 also falls through.
  SELECT visit_id,
         SUM(COALESCE(NULLIF(cost, 0), NULLIF(unit_rate, 0), 1000)) AS amount
  FROM public.visit_radiology
  GROUP BY visit_id
),
clinical AS (
  SELECT visit_id, SUM(COALESCE(amount, 0)) AS amount
  FROM public.visit_clinical_services
  GROUP BY visit_id
),
mandatory AS (
  -- Invoice.tsx:1216 prefers the stored amount and only falls back to the rate.
  -- The fallback deliberately does NOT multiply by the date range: a range on a
  -- charge records the period it covers, it is not a quantity, and treating it
  -- as one is what once grew bills by a day every morning.
  SELECT visit_id, SUM(COALESCE(NULLIF(amount, 0), rate_used, 0)) AS amount
  FROM public.visit_mandatory_services
  WHERE COALESCE(NULLIF(amount, 0), rate_used, 0) > 0
  GROUP BY visit_id
),
surgeries AS (
  SELECT visit_id, SUM(COALESCE(rate, 0)) AS amount
  FROM public.visit_surgeries
  GROUP BY visit_id
),
accommodation AS (
  SELECT visit_id, SUM(COALESCE(amount, 0)) AS amount
  FROM public.visit_accommodations
  GROUP BY visit_id
),
anaesthesia AS (
  SELECT visit_id, SUM(COALESCE(rate, 0) + COALESCE(ot_charges, 0)) AS amount
  FROM public.visit_anesthetists
  GROUP BY visit_id
),
all_charges AS (
  SELECT visit_id, amount FROM labs
  UNION ALL SELECT visit_id, amount FROM radiology
  UNION ALL SELECT visit_id, amount FROM clinical
  UNION ALL SELECT visit_id, amount FROM mandatory
  UNION ALL SELECT visit_id, amount FROM surgeries
  UNION ALL SELECT visit_id, amount FROM accommodation
  UNION ALL SELECT visit_id, amount FROM anaesthesia
)
SELECT
  v.id                                        AS visit_id,
  v.visit_id                                  AS visit_code,
  COALESCE(SUM(c.amount), 0)::NUMERIC(14, 2)  AS charge_total
FROM public.visits v
JOIN all_charges c ON c.visit_id = v.id
GROUP BY v.id, v.visit_id
HAVING COALESCE(SUM(c.amount), 0) > 0;

COMMENT ON VIEW public.v_visit_charge_totals IS
  'Per-visit sum of the charges Invoice.tsx prints (pharmacy and discounts excluded). '
  'Keyed on visits.id. Read by the Daily Revenue Report so an RM cut is charged on '
  'the bill rather than a hand-typed cost.';

GRANT SELECT ON public.v_visit_charge_totals TO anon, authenticated, service_role;

-- The view is read-only and touches no money by itself, but the figure it
-- returns decides what a relationship manager is paid, so it fails loudly here
-- rather than quietly returning nonsense to the report.
DO $verify$
DECLARE
  v_rows   BIGINT;
  v_negative BIGINT;
  v_dupes  BIGINT;
BEGIN
  SELECT count(*) INTO v_rows FROM public.v_visit_charge_totals;
  RAISE NOTICE 'v_visit_charge_totals: % visit(s) carry charges', v_rows;

  -- A negative total would silently reduce somebody's commission.
  SELECT count(*) INTO v_negative
    FROM public.v_visit_charge_totals WHERE charge_total < 0;
  IF v_negative > 0 THEN
    RAISE EXCEPTION 'ABORT: % visit(s) total to a negative charge', v_negative;
  END IF;

  -- One row per visit, or the report would pick an arbitrary one of them.
  SELECT count(*) INTO v_dupes FROM (
    SELECT visit_id FROM public.v_visit_charge_totals
    GROUP BY visit_id HAVING count(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'ABORT: % visit(s) appear more than once', v_dupes;
  END IF;
END
$verify$;
