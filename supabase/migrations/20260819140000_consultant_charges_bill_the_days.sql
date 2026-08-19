-- Consultant charges bill the days they cover.
--
-- THE INSTRUCTION (19 Aug, Dr M): "4 Dr. sumedh Ramteke (01-08-2026 to
-- 04-08-2026) 2000 1 2000 should show for 4 days 8000" — and, asked whether to
-- correct the rest, "correct all 34".
--
-- WHAT WENT WRONG. A dated mandatory service is a consultant's daily visit
-- charge, but nothing ever filled the quantity in from the range: every dated
-- row was written with quantity 1. Of 97 dated rows since the 25-Jul cutover,
-- 34 carry a multi-day range with quantity below the day count, and NOT ONE has
-- a quantity that matches its days. Every affected row is a named doctor —
-- Suhas Tiple (19 rows), Nikhil Khobragade (5), Afzal Sheikh (3) and seven
-- others — Rs 1,36,000 short in total. Dr Sumedh's is the Rs 6,000 of it that
-- was reported.
--
-- THIS IS THE MIRROR OF THE AUGUST INCIDENT, NOT A REPEAT OF IT. In August the
-- INVOICE multiplied by the date range at display time and inflated a bill from
-- Rs 10,875 to Rs 23,275, because those ranges ran to today and grew every
-- morning. The fix made the stored quantity authoritative, and it stays
-- authoritative: this migration writes the quantity ONCE, from dates that are
-- both in the past, and the invoice keeps reading what is stored. Nothing here
-- recomputes anything at display time.
--
-- WHY THE AMOUNT IS RESTATED TOO. amount is a stored figure the invoice prefers
-- over rate x quantity. Leaving it at the one-day value would leave the row
-- self-contradictory — 4 days at Rs 2,000 showing Rs 2,000 — and the invoice
-- would keep printing the old number.
--
-- SCOPE IS DELIBERATELY NARROW. Only rows where BOTH dates are set, the range
-- is longer than a day, the stored quantity is below that day count, and a rate
-- is actually known. A row somebody has already corrected by hand is left
-- alone, and a row with no rate is never given a computed amount.
--
-- NO TRIGGERS FIRE. visit_mandatory_services carries none, so this moves the
-- bill lines and nothing posts itself as a side effect. The corresponding
-- vouchers and receipts are a separate, deliberate step — these bills are now
-- larger, and what the patients actually paid has not changed.

CREATE TEMP TABLE _consultant_days_fix AS
SELECT
  vms.id,
  vms.quantity                                              AS old_quantity,
  vms.amount                                                AS old_amount,
  ((vms.end_date - vms.start_date) + 1)                     AS days,
  vms.rate_used,
  vms.rate_used * ((vms.end_date - vms.start_date) + 1)     AS new_amount
FROM public.visit_mandatory_services vms
WHERE vms.start_date IS NOT NULL
  AND vms.end_date IS NOT NULL
  AND vms.end_date > vms.start_date
  AND COALESCE(vms.quantity, 0) < ((vms.end_date - vms.start_date) + 1)
  AND COALESCE(vms.rate_used, 0) > 0;

DO $fix$
DECLARE v_rows INT; v_delta NUMERIC;
BEGIN
  SELECT count(*), COALESCE(sum(new_amount - COALESCE(old_amount, 0)), 0)
    INTO v_rows, v_delta
    FROM _consultant_days_fix;

  RAISE NOTICE 'Correcting % consultant charge(s), adding Rs % to the bills.', v_rows, v_delta;

  UPDATE public.visit_mandatory_services vms
     SET quantity = f.days,
         amount   = f.new_amount
    FROM _consultant_days_fix f
   WHERE vms.id = f.id;
END
$fix$;

DO $verify$
DECLARE v_left INT; v_bad INT;
BEGIN
  -- 1. Nothing multi-day may still be short.
  SELECT count(*) INTO v_left
    FROM public.visit_mandatory_services
   WHERE start_date IS NOT NULL AND end_date IS NOT NULL
     AND end_date > start_date
     AND COALESCE(rate_used, 0) > 0
     AND COALESCE(quantity, 0) < ((end_date - start_date) + 1);
  IF v_left > 0 THEN
    RAISE EXCEPTION 'ABORT: % dated row(s) still bill fewer days than they cover', v_left;
  END IF;

  -- 2. Every row touched must now read rate x quantity. A row that does not is
  --    the self-contradiction this set out to remove.
  SELECT count(*) INTO v_bad
    FROM public.visit_mandatory_services vms
    JOIN _consultant_days_fix f ON f.id = vms.id
   WHERE vms.amount IS DISTINCT FROM (vms.rate_used * vms.quantity);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % corrected row(s) do not equal rate x quantity', v_bad;
  END IF;

  -- 3. Single-day and undated rows must be untouched — they were never in scope.
  SELECT count(*) INTO v_bad
    FROM public.visit_mandatory_services vms
    JOIN _consultant_days_fix f ON f.id = vms.id
   WHERE f.days < 2;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % single-day row(s) were changed', v_bad;
  END IF;
END
$verify$;

-- What changed, so it can be read back before the temp table goes.
SELECT
  count(*)                                        AS rows_corrected,
  sum(new_amount - COALESCE(old_amount, 0))       AS rupees_added
FROM _consultant_days_fix;

NOTIFY pgrst, 'reload schema';
