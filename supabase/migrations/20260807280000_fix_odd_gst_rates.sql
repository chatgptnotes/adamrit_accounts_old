-- Five GRN lines carry a rate that is not a GST slab.
--
--   HAND SANITIZER 5 LTR              9%   GRN26010006  04-Jan-26
--   KLOTIN-5ML INJ (TRANEXAMIC ACID) 25%   GRN26020005  07-Feb-26
--   NS 500 ML SODIUM CHLORIDE        10%   GRN26020032  27-Feb-26
--   ETHILON 3-0 RC (FILAMIDE)         4%   GRN26030026  19-Mar-26
--   Z FOLD THERMAL J PAPER            9%   GRN26060067  23-Jun-26
--
-- India has 0, 5, 12, 18 and 28. Each of these products is received at one
-- rate everywhere else in the data — sanitizer at 18% (17 lines), the other
-- four at 5% (3, 41, 15 and 5 lines) — so the odd figure is a slip in the rate
-- column at entry, and this sets each line to the rate that product is always
-- received at.
--
-- The money paid is not touched: amount stays exactly as recorded. What
-- changes is the tax inside it, recomputed as amount x rate / (100 + rate),
-- which is how every other line in the table is built, and the cgst/sgst
-- halves that go with it.
--
-- All five are before the 25-Jul cutover, so their vouchers sit inside the
-- Tally opening balances and no posted voucher moves. This makes the GRN data
-- consistent for GST reporting and for any later restatement.
--
-- The rows are copied to grn_items_rate_backup_20260807 first, so the original
-- entry survives.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

CREATE TABLE IF NOT EXISTS public.grn_items_rate_backup_20260807 (
  id           UUID PRIMARY KEY,
  grn_id       UUID,
  product_name TEXT,
  amount       NUMERIC,
  gst          NUMERIC,
  cgst         NUMERIC,
  sgst         NUMERIC,
  tax_amount   NUMERIC,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.grn_items_rate_backup_20260807 ENABLE ROW LEVEL SECURITY;

INSERT INTO public.grn_items_rate_backup_20260807
  (id, grn_id, product_name, amount, gst, cgst, sgst, tax_amount)
SELECT i.id, i.grn_id, i.product_name, i.amount, i.gst, i.cgst, i.sgst, i.tax_amount
  FROM public.grn_items i
 WHERE COALESCE(i.gst, 0) NOT IN (0, 5, 12, 18, 28)
   AND NOT EXISTS (SELECT 1 FROM public.grn_items_rate_backup_20260807 b WHERE b.id = i.id);

-- ---------------------------------------------------------------------------
-- Correct each line to the rate that product is received at everywhere else
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_rate NUMERIC;
  v_fixed INTEGER := 0;
  v_left INTEGER;
BEGIN
  FOR r IN
    SELECT i.id, i.product_name, i.amount, i.gst
      FROM public.grn_items i
     WHERE COALESCE(i.gst, 0) NOT IN (0, 5, 12, 18, 28)
  LOOP
    -- The rate this product is received at most often, ignoring odd ones.
    SELECT o.gst INTO v_rate
      FROM public.grn_items o
     WHERE lower(btrim(o.product_name)) = lower(btrim(r.product_name))
       AND COALESCE(o.gst, 0) IN (0, 5, 12, 18, 28)
     GROUP BY o.gst
     ORDER BY COUNT(*) DESC, o.gst
     LIMIT 1;

    IF v_rate IS NULL THEN
      RAISE NOTICE 'Left % at %%%: no other line for this product to learn from',
        r.product_name, r.gst;
      CONTINUE;
    END IF;

    UPDATE public.grn_items
       SET gst        = v_rate,
           cgst       = v_rate / 2,
           sgst       = v_rate / 2,
           tax_amount = ROUND(amount * v_rate / (100 + v_rate), 2)
     WHERE id = r.id;
    v_fixed := v_fixed + 1;
    RAISE NOTICE '% : %%% -> %%%', r.product_name, r.gst, v_rate;
  END LOOP;

  SELECT COUNT(*) INTO v_left FROM public.grn_items
   WHERE COALESCE(gst, 0) NOT IN (0, 5, 12, 18, 28);
  RAISE NOTICE 'Corrected % line(s); % still on a non-slab rate', v_fixed, v_left;
END $$;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_left INTEGER;
  v_inconsistent INTEGER;
  v_touched INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_left FROM public.grn_items
   WHERE COALESCE(gst, 0) NOT IN (0, 5, 12, 18, 28);
  IF v_left > 0 THEN
    RAISE EXCEPTION 'ABORT: % line(s) still carry a rate that is not a GST slab', v_left;
  END IF;

  -- Every corrected line must hold the tax its rate implies, and the amount
  -- must be exactly what was there before.
  SELECT COUNT(*) INTO v_inconsistent
    FROM public.grn_items i
    JOIN public.grn_items_rate_backup_20260807 b ON b.id = i.id
   WHERE i.amount IS DISTINCT FROM b.amount
      OR ABS(COALESCE(i.tax_amount,0) - ROUND(i.amount * i.gst / (100 + i.gst), 2)) > 0.01;
  IF v_inconsistent > 0 THEN
    RAISE EXCEPTION 'ABORT: % corrected line(s) are inconsistent', v_inconsistent;
  END IF;

  -- Nothing posted may have moved: all five are pre-cutover.
  SELECT COUNT(*) INTO v_touched
    FROM public.grn_items_rate_backup_20260807 b
    JOIN public.goods_received_notes g ON g.id = b.grn_id
   WHERE g.grn_date >= DATE '2026-07-25';
  IF v_touched > 0 THEN
    RAISE EXCEPTION 'ABORT: % corrected line(s) belong to a posted-after-cutover GRN whose voucher would need reposting', v_touched;
  END IF;

  RAISE NOTICE 'OK — every GRN line now carries a real GST slab';
END $$;
