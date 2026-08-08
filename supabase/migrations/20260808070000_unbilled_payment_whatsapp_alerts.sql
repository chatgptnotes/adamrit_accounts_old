-- WhatsApp alerts for payments that left with no bill.
--
-- Tilak's tile lists every breach of the rule; this carries the ones that
-- should not wait — Rs 10,000 or more, or still unexplained after 48 hours —
-- to the management on WhatsApp, once each.
--
-- ONE THING MUST BE DONE BY HAND FIRST. WhatsApp only delivers a
-- business-initiated message through a template Meta has approved, so register
-- this on DoubleTick before the alerts can go out:
--
--     Template name: unbilled_payment_alert
--     Language:      en
--     Category:      Utility
--     Body:
--
--       Adamrit alert: {{1}} payment(s) with no bill — Rs {{2}}
--
--       {{3}}
--
--       The rule is that money leaves only against a bill in the system.
--       Review: https://adamrit.com/t/reconciliation-tilak
--       Sent: {{4}}
--
--     Placeholders: {{1}} count, {{2}} total value, {{3}} the first five
--     exceptions (one per line), {{4}} time sent.
--
-- Until it is approved DoubleTick rejects the send, the exception simply stays
-- unsent, and nothing else breaks — the tile and the director pop-up carry on.
--
-- Applied through apply_migration(): one transaction, rolls back on failure.
-- Idempotent, and it verifies itself before committing.

-- ---------------------------------------------------------------------------
-- STEP 1 — who is told, and what has already been sent
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recon_alert_recipients (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label      TEXT NOT NULL,
  phone      TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS recon_alert_recipients_phone_uidx
  ON public.recon_alert_recipients (phone);
ALTER TABLE public.recon_alert_recipients ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recon_alert_recipients') THEN
    CREATE POLICY recon_alert_recipients_all ON public.recon_alert_recipients
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Dr Murali's number is the one the existing payment alerts already use.
-- Tilak's is seeded inactive with a placeholder: fill in the number and set
-- is_active, and he starts receiving them without a deploy.
INSERT INTO public.recon_alert_recipients (label, phone, is_active)
SELECT 'Dr Murali', '+919373111709', true
 WHERE NOT EXISTS (SELECT 1 FROM public.recon_alert_recipients WHERE phone = '+919373111709');

INSERT INTO public.recon_alert_recipients (label, phone, is_active)
SELECT 'Tilak — set the number', 'TILAK-NUMBER-PENDING', false
 WHERE NOT EXISTS (
   SELECT 1 FROM public.recon_alert_recipients WHERE label LIKE 'Tilak%'
 );

ALTER TABLE public.recon_transactions
  ADD COLUMN IF NOT EXISTS alerted_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- STEP 2 — what qualifies for a message
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unbilled_payments_to_alert(
  p_min_amount    NUMERIC DEFAULT 10000,
  p_min_age_hours INTEGER DEFAULT 48
) RETURNS TABLE (
  id            UUID,
  amount        NUMERIC,
  counterparty  TEXT,
  txn_date      DATE,
  source_label  TEXT,
  source_holder TEXT,
  days_old      INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT t.id, t.amount, t.counterparty, t.txn_date, s.label, s.holder,
         (CURRENT_DATE - t.txn_date)::INTEGER
    FROM public.recon_transactions t
    JOIN public.recon_sources s ON s.id = t.source_id
   WHERE t.status = 'UNMATCHED'
     AND t.direction = 'DEBIT'
     AND t.alerted_at IS NULL
     AND (t.amount >= p_min_amount
          OR t.created_at <= now() - make_interval(hours => p_min_age_hours))
   ORDER BY t.amount DESC, t.txn_date;
$function$;

CREATE OR REPLACE FUNCTION public.mark_unbilled_payments_alerted(p_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.recon_transactions
     SET alerted_at = now()
   WHERE id = ANY(p_ids) AND alerted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.unbilled_payments_to_alert(NUMERIC, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_unbilled_payments_alerted(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unbilled_payments_to_alert(NUMERIC, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_unbilled_payments_alerted(UUID[]) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- STEP 3 — verify before committing
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_missing TEXT := ''; v_recipients INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname='public' AND p.proname='unbilled_payments_to_alert') THEN
    v_missing := v_missing || ' selector;';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname='public' AND p.proname='mark_unbilled_payments_alerted') THEN
    v_missing := v_missing || ' marker;';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='recon_transactions'
                    AND column_name='alerted_at') THEN
    v_missing := v_missing || ' alerted_at;';
  END IF;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'ABORT — not created:%', v_missing;
  END IF;

  SELECT COUNT(*) INTO v_recipients FROM public.recon_alert_recipients WHERE is_active;
  RAISE NOTICE 'OK — % active recipient(s); register the unbilled_payment_alert template on DoubleTick to start sending', v_recipients;
END $$;
