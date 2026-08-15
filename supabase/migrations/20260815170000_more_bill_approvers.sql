-- Ruby, Viji and Suraj may approve bills for payment, alongside Dr Murali.
--
-- The approver list was built as a table for exactly this: one approver who is
-- travelling means nothing gets paid. Three more names, and the rule is about
-- to be switched on, so this must land BEFORE enforcement rather than after --
-- turning the gate on with a single approver behind it is how a payment queue
-- seizes up on the first afternoon.
--
-- Suraj is a marketing role, not a director. That is deliberate on Dr M's
-- instruction and is recorded here rather than left to look like an oversight:
-- approving a bill for payment is authority over money, and this list is the
-- only thing that grants it.
--
-- Named by email and asserted one-by-one, not matched on a name pattern.
-- "suraj" appears in narrations all over the referral rail; resolving an
-- approver by fuzzy name is how the wrong person ends up able to release
-- payments.

DO $apply$
DECLARE
  v_emails CONSTANT TEXT[] := ARRAY['ruby@gmail.com', 'viji@hopehospital.com', 'suraj@gmail.com'];
  v_email TEXT; v_id UUID; v_n INT; v_name TEXT;
BEGIN
  FOREACH v_email IN ARRAY v_emails LOOP
    SELECT count(*) INTO v_n FROM public."User" WHERE lower(btrim(email)) = v_email;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'ABORT: % matches % accounts, not 1', v_email, v_n;
    END IF;

    SELECT id, COALESCE(full_name, email) INTO v_id, v_name
      FROM public."User" WHERE lower(btrim(email)) = v_email;

    IF NOT COALESCE((SELECT is_active FROM public."User" WHERE id = v_id), false) THEN
      RAISE EXCEPTION 'ABORT: % is not an active account', v_email;
    END IF;

    INSERT INTO public.expense_bill_approvers (user_id, note)
    VALUES (v_id, v_name || ' — added 15 Aug 2026 on Dr M''s instruction')
    ON CONFLICT (user_id) DO NOTHING;
  END LOOP;
END
$apply$;

DO $verify$
DECLARE
  v_email TEXT; v_id UUID; v_n INT;
  v_emails CONSTANT TEXT[] := ARRAY['ruby@gmail.com', 'viji@hopehospital.com',
                                    'suraj@gmail.com', 'drmurali@gmail.com',
                                    'cmd@hopehospital.com'];
BEGIN
  -- (a) all five can approve, and each is a real active account
  FOREACH v_email IN ARRAY v_emails LOOP
    SELECT u.id INTO v_id FROM public."User" u
     WHERE lower(btrim(u.email)) = v_email AND COALESCE(u.is_active, true);
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'ABORT: % is not an active account', v_email;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM expense_bill_approvers WHERE user_id = v_id) THEN
      RAISE EXCEPTION 'ABORT: % cannot approve', v_email;
    END IF;
  END LOOP;

  -- (b) and nobody else can. The list is the whole of the authority, so its
  --     size is worth asserting rather than assuming.
  SELECT count(*) INTO v_n FROM expense_bill_approvers;
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'ABORT: % approvers, expected exactly 5', v_n;
  END IF;

  -- (c) every approver still points at a live user
  SELECT count(*) INTO v_n FROM expense_bill_approvers a
    LEFT JOIN public."User" u ON u.id = a.user_id
   WHERE u.id IS NULL OR NOT COALESCE(u.is_active, true);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ABORT: % approver(s) point at a missing or inactive account', v_n;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
