-- Bills can be created again. Since 28 July, not one could be.
--
-- WHAT WAS BROKEN
--
-- 20260728171000 moved invoice snapshots out of bills into bill_content, with
-- a BEFORE INSERT OR UPDATE trigger that copies the JSON across and blanks the
-- original columns. The copy is guarded:
--
--     IF NEW.bill_items_json IS NOT NULL OR NEW.bill_patient_data IS NOT NULL
--
-- and bills.bill_patient_data has a column DEFAULT of '{}'::jsonb. An empty
-- object is not NULL, so on EVERY insert the guard passes and the trigger runs
--
--     INSERT INTO bill_content (bill_id, ...) VALUES (NEW.id, ...)
--
-- while still BEFORE INSERT -- the bills row does not exist yet, and
-- bill_content.bill_id references it. The foreign key refuses, and the whole
-- insert dies with it.
--
-- It is total, not intermittent: it fails for the service role too, so it was
-- never a permissions problem. The last bill in the table is dated 29 July,
-- the day after the trigger went in. FinalBill.tsx creates the bill in a
-- useEffect whose only failure path is console.error, so the screen looked
-- normal while nothing was saved -- 31,306 bills, none since 1 August.
--
-- THE FIX IS TWO CHANGES, EACH CORRECT ON ITS OWN
--
--   1. The guard now ignores an EMPTY snapshot. A bill created with no invoice
--      JSON has nothing to move, so the trigger does nothing and the insert is
--      untouched. This alone unblocks the reported bug, and it stops a row of
--      empty JSON being written to bill_content for every bill ever created.
--
--   2. The foreign key becomes DEFERRABLE INITIALLY DEFERRED, so it is checked
--      at COMMIT rather than mid-statement. That covers the case (1) does not:
--      a bill inserted WITH real JSON in a single statement. By commit the
--      bills row exists, so the reference is valid; and if the insert rolls
--      back, both rows go together.
--
-- Deferring is safe here in a way it was NOT for yesterday's mobile rule. That
-- deferred a RULE, which turned a refusal into silent destruction. This defers
-- a REFERENCE CHECK between two rows written in the same transaction -- there
-- is no second transaction to lose, and a failure rolls the pair back whole.
--
-- Nothing in FinalBill.tsx changes; it is frozen and did not cause this.

ALTER TABLE public.bill_content
  DROP CONSTRAINT IF EXISTS bill_content_bill_id_fkey;
ALTER TABLE public.bill_content
  ADD CONSTRAINT bill_content_bill_id_fkey
  FOREIGN KEY (bill_id) REFERENCES public.bills(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION public.capture_bill_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- An empty snapshot is nothing to move. bill_patient_data defaults to
  -- '{}'::jsonb, so testing IS NOT NULL alone fired on every single insert.
  IF COALESCE(NEW.bill_items_json, 'null'::jsonb)   NOT IN ('null'::jsonb, '{}'::jsonb, '[]'::jsonb)
     OR COALESCE(NEW.bill_patient_data, 'null'::jsonb) NOT IN ('null'::jsonb, '{}'::jsonb, '[]'::jsonb)
  THEN
    INSERT INTO public.bill_content (bill_id, items_json, patient_data, updated_at)
    VALUES (NEW.id, NEW.bill_items_json, NEW.bill_patient_data, now())
    ON CONFLICT (bill_id) DO UPDATE
      SET items_json = COALESCE(EXCLUDED.items_json, public.bill_content.items_json),
          patient_data = COALESCE(EXCLUDED.patient_data, public.bill_content.patient_data),
          updated_at = now();
  END IF;

  -- The redaction is unconditional, exactly as before: these columns are
  -- broadly readable and must never hold the snapshot.
  NEW.bill_items_json := NULL;
  NEW.bill_patient_data := NULL;
  RETURN NEW;
END;
$$;

DO $verify$
DECLARE
  v_pat UUID; v_id UUID; v_n INT; v_items JSONB; v_left INT;
BEGIN
  SELECT id INTO v_pat FROM public.patients LIMIT 1;
  IF v_pat IS NULL THEN RAISE EXCEPTION 'ABORT: no patient to self-test with'; END IF;

  -- (a) THE BUG: a plain bill, exactly as FinalBill creates one, must insert.
  INSERT INTO public.bills (patient_id, visit_id, bill_no, formatted_bill_no, claim_id,
                            date, category, total_amount, status, hospital_name)
  VALUES (v_pat, 'SELFTEST-VISIT', 'SELFTEST-BILL-A', 'SELFTEST-BILL-A', 'T',
          CURRENT_DATE, 'GENERAL', 0, 'DRAFT', 'hope')
  RETURNING id INTO v_id;

  -- and it must NOT have written an empty snapshot row
  SELECT count(*) INTO v_n FROM public.bill_content WHERE bill_id = v_id;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'ABORT: an empty snapshot row was written for a plain bill';
  END IF;

  -- (b) a real snapshot still reaches bill_content, and is redacted from bills
  UPDATE public.bills
     SET bill_items_json = '[{"item":"self test","amount":1}]'::jsonb
   WHERE id = v_id;

  SELECT items_json INTO v_items FROM public.bill_content WHERE bill_id = v_id;
  IF v_items IS NULL OR v_items->0->>'item' <> 'self test' THEN
    RAISE EXCEPTION 'ABORT: the snapshot did not reach bill_content';
  END IF;
  IF (SELECT bill_items_json FROM public.bills WHERE id = v_id) IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: the snapshot was left readable on the bills row';
  END IF;

  DELETE FROM public.bills WHERE id = v_id;

  -- (c) an insert carrying its snapshot in ONE statement -- the case the
  --     deferred foreign key exists for, and the one that still failed with
  --     the guard alone.
  INSERT INTO public.bills (patient_id, visit_id, bill_no, formatted_bill_no, claim_id,
                            date, category, total_amount, status, hospital_name,
                            bill_items_json)
  VALUES (v_pat, 'SELFTEST-VISIT', 'SELFTEST-BILL-B', 'SELFTEST-BILL-B', 'T',
          CURRENT_DATE, 'GENERAL', 0, 'DRAFT', 'hope',
          '[{"item":"one shot","amount":2}]'::jsonb)
  RETURNING id INTO v_id;

  IF (SELECT items_json->0->>'item' FROM public.bill_content WHERE bill_id = v_id) <> 'one shot' THEN
    RAISE EXCEPTION 'ABORT: a one-statement insert lost its snapshot';
  END IF;

  DELETE FROM public.bills WHERE id = v_id;

  -- (d) the cascade still removes the snapshot with the bill
  SELECT count(*) INTO v_left FROM public.bill_content WHERE bill_id = v_id;
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'ABORT: % orphaned snapshot row(s) survived the bill', v_left;
  END IF;

  SELECT count(*) INTO v_left FROM public.bills WHERE bill_no LIKE 'SELFTEST-BILL-%';
  IF v_left > 0 THEN
    DELETE FROM public.bills WHERE bill_no LIKE 'SELFTEST-BILL-%';
    RAISE EXCEPTION 'ABORT: % self-test bill(s) left behind', v_left;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
