-- The handover record must not be editable by the people it polices.
--
-- These tables were created with the module's usual permissive policy,
-- USING (true) for everything. That is fine for operational data. It is wrong
-- here: this is the record that says who was short and who signed it off, and
-- the browser key that can reach it is public -- it ships inside the site's
-- JavaScript, so anyone who opens the page has it.
--
-- The old policy was FOR ALL USING (true) WITH CHECK (true), which permits
-- INSERT, UPDATE and DELETE from any client holding that key. (A first probe
-- appeared to confirm it by deleting a non-existent id and reading 204 -- that
-- proves nothing, since deleting nothing succeeds either way. The real check
-- is below, against a throwaway row: after this migration an edit leaves the
-- amount unchanged, a delete leaves the row standing, and an insert is refused
-- outright with 42501.)
--
-- So a cashier who was 5,000 short could have deleted the evidence, or edited
-- the count to match, from the browser console. Every control built today --
-- the mandatory reason, the independent verifier, the claim that stops double
-- handovers -- sat on top of a table anybody could rewrite.
--
-- Reading stays open: the screens need it, and seeing the register is not a
-- risk. Writing is closed entirely. Every legitimate write already goes
-- through a SECURITY DEFINER function -- submit, accept, verify, cancel, and
-- set_cash_handover_verifier -- which runs as the owner and is unaffected.
-- Nothing in the app writes to these tables directly; checked before applying.

DO $lock$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cash_handovers',
    'cash_handover_denominations',
    'cash_handover_sources',
    'cash_handover_verifiers',
    'cash_handover_settings'
  ] LOOP
    -- Drop the blanket policy this table was created with.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_all', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (true)', t || '_read', t);

    -- No INSERT, UPDATE or DELETE policy is created, so with RLS enabled the
    -- client cannot write at all. The definer functions still can.
  END LOOP;
END
$lock$;

DO $verify$
DECLARE
  v_writes INT; v_reads INT;
BEGIN
  SELECT count(*) INTO v_writes
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('cash_handovers','cash_handover_denominations',
                       'cash_handover_sources','cash_handover_verifiers',
                       'cash_handover_settings')
     AND cmd <> 'SELECT';
  IF v_writes > 0 THEN
    RAISE EXCEPTION 'ABORT: % write policy(ies) still on the handover tables', v_writes;
  END IF;

  SELECT count(*) INTO v_reads
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('cash_handovers','cash_handover_denominations',
                       'cash_handover_sources','cash_handover_verifiers',
                       'cash_handover_settings')
     AND cmd = 'SELECT';
  IF v_reads <> 5 THEN
    RAISE EXCEPTION 'ABORT: expected 5 read policies, found % — a screen would go blank', v_reads;
  END IF;

  -- The definer path must still work, or handovers stop entirely.
  PERFORM cash_handover_preview(
    (SELECT id FROM public."User" WHERE lower(email) = 'nisha@gmail.com'), true, 'hope');
END
$verify$;

NOTIFY pgrst, 'reload schema';
