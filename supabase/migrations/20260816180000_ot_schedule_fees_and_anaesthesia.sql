-- The OT schedule records the anaesthesia and what the two doctors are paid.
--
-- WHY. Gaurav schedules the case; the surgeon's and anaesthetist's payables are
-- worked out much later, when the surgery is marked completed, from the fee
-- master. So the person with the case in front of him could not see what it
-- would cost, and could not say "not this one, this was a longer job" without
-- waiting for the payable to appear and editing it in the approval queue.
--
-- These three columns move that decision to the point the case is booked.
-- The amounts are OPTIONAL: left blank, the fee master prices the case exactly
-- as it does today, so nothing changes for a schedule created without them.
--
-- anaesthesia_type is a real column at last. It has been living inside
-- special_requirements as the text "Anesthesia Type: X" alongside free-text
-- notes, extracted with a regular expression in three separate files. The old
-- text is left alone and backfilled from, so nothing that reads it breaks.

ALTER TABLE public.ot_schedule
  ADD COLUMN IF NOT EXISTS anaesthesia_type TEXT,
  ADD COLUMN IF NOT EXISTS surgeon_fee      NUMERIC,
  ADD COLUMN IF NOT EXISTS anaesthetist_fee NUMERIC;

COMMENT ON COLUMN public.ot_schedule.anaesthesia_type IS
  'general | spinal | sedation. Backfilled from the "Anesthesia Type:" segment of special_requirements, which remains the fallback for older rows.';
COMMENT ON COLUMN public.ot_schedule.surgeon_fee IS
  'What the surgeon is to be paid for THIS case. NULL means price it from surgery_fee_master as before.';
COMMENT ON COLUMN public.ot_schedule.anaesthetist_fee IS
  'What the anaesthetist is to be paid for THIS case. NULL means price it from anaesthesia_fee_master by anaesthesia type, as before.';

-- A negative fee is not a discount, it is a typo that would reverse a payable.
ALTER TABLE public.ot_schedule
  DROP CONSTRAINT IF EXISTS ot_schedule_fees_not_negative;
ALTER TABLE public.ot_schedule
  ADD CONSTRAINT ot_schedule_fees_not_negative
  CHECK (COALESCE(surgeon_fee, 0) >= 0 AND COALESCE(anaesthetist_fee, 0) >= 0);

-- Backfill the type from where it has been hiding. Only where the column is
-- still empty, so a value set deliberately is never overwritten.
UPDATE public.ot_schedule
   SET anaesthesia_type = btrim(substring(special_requirements from 'Anesthesia Type:[[:space:]]*([^|' || chr(10) || ']+)'))
 WHERE anaesthesia_type IS NULL
   AND special_requirements ~* 'Anesthesia Type:[[:space:]]*[^|]'
   AND btrim(COALESCE(substring(special_requirements from 'Anesthesia Type:[[:space:]]*([^|' || chr(10) || ']+)'), '')) <> '';

DO $verify$
DECLARE
  v_backfilled INT;
  v_orphan     INT;
  v_neg        INT;
BEGIN
  SELECT count(*) INTO v_backfilled FROM public.ot_schedule WHERE anaesthesia_type IS NOT NULL;

  -- Every backfilled value must be priceable, or the anaesthetist's payable
  -- silently becomes zero — which is what 'sedation' did until today.
  SELECT count(*) INTO v_orphan
    FROM public.ot_schedule o
   WHERE o.anaesthesia_type IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.anaesthesia_fee_master a
        WHERE a.is_active
          AND lower(btrim(a.anaesthesia_type)) = lower(btrim(o.anaesthesia_type))
     );

  SELECT count(*) INTO v_neg FROM public.ot_schedule
   WHERE COALESCE(surgeon_fee, 0) < 0 OR COALESCE(anaesthetist_fee, 0) < 0;
  IF v_neg > 0 THEN
    RAISE EXCEPTION 'ABORT: % row(s) carry a negative fee', v_neg;
  END IF;

  RAISE NOTICE 'anaesthesia_type set on % OT row(s); % of them name a type with no rate (they price at 0 until a rate exists).',
    v_backfilled, v_orphan;
END
$verify$;

NOTIFY pgrst, 'reload schema';
