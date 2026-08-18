-- A backup cashier can hand over for an absent one.
--
-- THE INSTRUCTION (18 Aug, Dr M): if the assigned cashier is unavailable, Tilak
-- or Avni can perform the cash handover on their behalf as an authorized backup
-- cashier. Record the original cashier, the backup, the amount, the date/time
-- and the reason. The handover stays linked to the ORIGINAL cashier while
-- clearly showing who actually performed it.
--
-- WHY IT MUST STAY ON THE ORIGINAL CASHIER. expectedCash comes from
-- cash_handover_preview(from_user_id) -- the money that person collected. Put
-- the backup in from_user_id and the expected figure becomes the BACKUP's
-- collections, the absent cashier's takings stay unclaimed, and the variance is
-- computed against the wrong drawer. So from_user_id does not move. Who
-- actually stood at the counter is recorded alongside it.
--
-- AUTHORISED BY THE ROSTER, NOT BY NAME. can_backup is a new capability on
-- cash_handover_verifiers, granted here to Tilak and Avni. A hardcoded pair of
-- names would have to be found and edited by whoever comes next; a roster flag
-- is granted from the same place every other cash right is.
--
-- THE REASON IS MANDATORY. This is the one handover where the person whose
-- drawer it is did not count it, so the note explaining why is the only record
-- of that. It is refused if blank rather than defaulted to something bland.
--
-- NOTE ON SEPARATION. The backup counts the drawer AND receives it, because the
-- cashier is not there to hand it to anybody. That is the same shape as the
-- unattended opening (20260817100000) and is the reason the variance still
-- lands on the absent cashier's own handover, where blind verification and the
-- directors' watchdog already look.
--
-- submit_cash_handover IS NOT REDEFINED. The new function CALLS it and then
-- stamps the three columns, so the rebuild-from-a-migration-file trap
-- (money rule 3) does not apply and the posting logic stays in one place.

ALTER TABLE public.cash_handover_verifiers
  ADD COLUMN IF NOT EXISTS can_backup BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.cash_handovers
  ADD COLUMN IF NOT EXISTS performed_by_user_id UUID REFERENCES public."User"(id),
  ADD COLUMN IF NOT EXISTS performed_by_name TEXT,
  ADD COLUMN IF NOT EXISTS performed_reason TEXT;

COMMENT ON COLUMN public.cash_handovers.performed_by_user_id IS
  'Set only when a backup cashier counted for an absent one. NULL means the cashier in from_user_id did it themselves.';
COMMENT ON COLUMN public.cash_handover_verifiers.can_backup IS
  'May hand over on behalf of an absent cashier.';

CREATE INDEX IF NOT EXISTS idx_cash_handovers_performed_by
  ON public.cash_handovers(performed_by_user_id)
  WHERE performed_by_user_id IS NOT NULL;

-- Tilak and Avni, by id, both already on the roster as receivers.
DO $grant$
DECLARE v_n INT;
BEGIN
  UPDATE public.cash_handover_verifiers
     SET can_backup = true, updated_at = now()
   WHERE user_id IN (
     'ab0a5589-17c9-44ac-b0d7-884b5dc1d834',  -- Tilak
     '4bb9bfad-343d-4742-99c5-0c3818411676'   -- Avni
   );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'ABORT: neither Tilak nor Avni is on the cash roster to grant';
  END IF;
END
$grant$;

/**
 * May this person hand over for somebody else?
 */
CREATE OR REPLACE FUNCTION public.can_backup_handover(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cash_handover_verifiers
     WHERE user_id = p_user_id AND can_backup AND is_active
  );
$$;

/**
 * Hand over an absent cashier's drawer.
 *
 * p_from_user_id stays the cashier whose money it is; p_performed_by is whoever
 * actually counted it. Everything else is submit_cash_handover's job.
 */
CREATE OR REPLACE FUNCTION public.submit_cash_handover_on_behalf(
  p_from_user_id UUID,
  p_to_user_id UUID,
  p_performed_by UUID,
  p_reason TEXT,
  p_denominations JSONB,
  p_hospital_type TEXT DEFAULT NULL,
  p_variance_reason TEXT DEFAULT NULL,
  p_include_unattributed BOOLEAN DEFAULT true,
  p_notes TEXT DEFAULT NULL,
  p_declared_online NUMERIC DEFAULT NULL,
  p_locker_cash NUMERIC DEFAULT 0,
  p_bank_deposit NUMERIC DEFAULT 0,
  p_locker_withdrawn NUMERIC DEFAULT 0,
  p_locker_deposited NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_id UUID;
  v_name TEXT;
BEGIN
  IF p_performed_by IS NULL THEN
    RAISE EXCEPTION 'Who is doing this handover must be recorded';
  END IF;
  IF NOT public.can_backup_handover(p_performed_by) THEN
    RAISE EXCEPTION 'You are not authorised to hand over for another cashier';
  END IF;
  IF p_from_user_id = p_performed_by THEN
    RAISE EXCEPTION 'This is for handing over somebody ELSE''s drawer — use the normal handover for your own';
  END IF;
  -- The only record of why the cashier did not count their own drawer.
  IF btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Give the reason the cashier could not hand over themselves';
  END IF;

  SELECT COALESCE(full_name, email) INTO v_name FROM public."User" WHERE id = p_performed_by;

  v_result := public.submit_cash_handover(
    p_from_user_id, p_to_user_id, p_denominations, p_hospital_type,
    p_variance_reason, p_include_unattributed, p_notes, p_declared_online,
    p_locker_cash, p_bank_deposit, p_locker_withdrawn, p_locker_deposited
  );

  v_id := (v_result->>'handoverId')::UUID;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'ABORT: the handover did not come back with an id, nothing was stamped';
  END IF;

  UPDATE public.cash_handovers
     SET performed_by_user_id = p_performed_by,
         performed_by_name = v_name,
         performed_reason = btrim(p_reason),
         updated_at = now()
   WHERE id = v_id;

  RETURN v_result
    || jsonb_build_object('performedBy', v_name, 'performedReason', btrim(p_reason), 'onBehalf', true);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_cash_handover_on_behalf FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_cash_handover_on_behalf TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_backup_handover(UUID) TO authenticated, anon, service_role;

DO $verify$
DECLARE v_n INT;
BEGIN
  -- Counted per PERSON, not per row: Tilak is on the roster twice, once for
  -- hope and once for pharmacy, so three rows is two backup cashiers.
  SELECT count(DISTINCT user_id) INTO v_n
    FROM public.cash_handover_verifiers WHERE can_backup AND is_active;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'ABORT: % backup cashier(s), expected exactly Tilak and Avni', v_n;
  END IF;

  IF NOT public.can_backup_handover('ab0a5589-17c9-44ac-b0d7-884b5dc1d834') THEN
    RAISE EXCEPTION 'ABORT: Tilak cannot act as backup';
  END IF;
  IF NOT public.can_backup_handover('4bb9bfad-343d-4742-99c5-0c3818411676') THEN
    RAISE EXCEPTION 'ABORT: Avni cannot act as backup';
  END IF;

  -- Nobody else may have been granted it by a stray default.
  SELECT count(DISTINCT user_id) INTO v_n FROM public.cash_handover_verifiers
   WHERE can_backup AND user_id NOT IN
     ('ab0a5589-17c9-44ac-b0d7-884b5dc1d834','4bb9bfad-343d-4742-99c5-0c3818411676');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % other roster row(s) were granted backup rights', v_n;
  END IF;

  -- Every existing handover must read as done by its own cashier; this change
  -- may not retro-label historical ones as somebody else's work.
  SELECT count(*) INTO v_n FROM public.cash_handovers WHERE performed_by_user_id IS NOT NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % existing handover(s) were stamped with a performer', v_n;
  END IF;

  IF to_regprocedure('public.submit_cash_handover_on_behalf(uuid,uuid,uuid,text,jsonb,text,text,boolean,text,numeric,numeric,numeric,numeric,numeric)') IS NULL THEN
    RAISE EXCEPTION 'ABORT: the on-behalf function was not created';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
