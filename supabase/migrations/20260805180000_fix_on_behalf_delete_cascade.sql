-- On-Behalf payments: deleting the PV must delete its JV.
--
-- Live testing (PV0710/JV0431, ₹10) showed the delete leaves the journal
-- behind with linked_voucher_id nulled: vouchers.linked_voucher_id already
-- existed on the live database with an ON DELETE SET NULL rule, so the
-- on-behalf migration's ADD COLUMN IF NOT EXISTS kept that FK instead of
-- creating the intended ON DELETE CASCADE one.
--
-- This script rebuilds whatever FK sits on vouchers.linked_voucher_id as
-- ON DELETE CASCADE (constraint found by column, not by name), removes the
-- orphaned test journal JV0431, and proves both.
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

-- 1. Rebuild the FK with the right delete rule.
DO $fix$
DECLARE
  v_con TEXT;
BEGIN
  FOR v_con IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'public.vouchers'::regclass
       AND con.contype = 'f'
       AND att.attname = 'linked_voucher_id'
  LOOP
    EXECUTE format('ALTER TABLE public.vouchers DROP CONSTRAINT %I', v_con);
  END LOOP;

  ALTER TABLE public.vouchers
    ADD CONSTRAINT vouchers_linked_voucher_id_fkey
    FOREIGN KEY (linked_voucher_id) REFERENCES public.vouchers(id) ON DELETE CASCADE;
END;
$fix$;

-- 2. Remove the orphaned ₹10/₹15 test journal from the feature test
--    (its payment voucher PV0710 is already deleted).
DELETE FROM public.vouchers
 WHERE voucher_number = 'JV0431'
   AND created_by = 'on-behalf-test'
   AND narration LIKE '%on-behalf feature test%';

-- 3. Proof.
DO $verify$
DECLARE
  v_rule "char";
  v_left INT;
BEGIN
  SELECT con.confdeltype INTO v_rule
    FROM pg_constraint con
   WHERE con.conname = 'vouchers_linked_voucher_id_fkey'
     AND con.conrelid = 'public.vouchers'::regclass;
  IF v_rule IS DISTINCT FROM 'c' THEN
    RAISE EXCEPTION 'linked_voucher_id FK delete rule is % — expected c (CASCADE)', v_rule;
  END IF;

  SELECT count(*) INTO v_left
    FROM public.vouchers
   WHERE created_by = 'on-behalf-test';
  IF v_left > 0 THEN
    RAISE EXCEPTION '% test voucher(s) still present', v_left;
  END IF;

  RAISE NOTICE 'OK — deleting an on-behalf PV now cascades to its JV; test vouchers cleaned';
END;
$verify$;

COMMIT;
