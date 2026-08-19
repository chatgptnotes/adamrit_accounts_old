-- A pharmacy payment voucher posts in the pharmacy's books.
--
-- THE INSTRUCTION (19 Aug, Dr M): fix the pharmacy expense issue on the payment
-- voucher, so Hope Pharmacy's Cash Book can show a rupee going out.
--
-- MUST LAND BEFORE THE SCREEN OFFERS THE CHOICE. The screen writes
-- payment_vouchers.hospital_type from hospitalConfig.name, which is only ever
-- 'hope' or 'ayushman' (src/types/hospital.ts:45,83) — so no voucher has ever
-- carried 'pharmacy' and the pharmacy's expenses have been filed as the
-- hospital's. Adding a third choice to the screen is the other half of this fix.
--
-- WHY THE SCREEN CHANGE ALONE WOULD HAVE BEEN A BUG. post_one_payment_voucher
-- resolves the company with
--
--     resolve_patient_company(v_pv.hospital_type, NULL)
--
-- and that function knows two hospitals: 'ayushman' returns ayushman_nagpur and
-- EVERYTHING ELSE falls through to drm_pvt_ltd (20260726190000:56-74). It is a
-- patient-company resolver — the pharmacy has no patients, so it was never
-- taught the word. Feed it 'pharmacy' and the accounting entry is written into
-- DRM Hope Hospital Private Limited: the exact clubbing of the pharmacy into the
-- hospital that the Cash Book work has spent today undoing, except in the book
-- of record rather than on a screen.
--
-- WHAT THIS CHANGES, AND ONLY THIS. A pharmacy voucher resolves through
-- cash_bank_company_key, which already maps 'pharmacy' to hope_pharmacy and is
-- what the Bank Deposit and Bank & Cash tiles post through (20260814200000:25-33)
-- — so a deposit made from the tile and an expense paid on this screen meet in
-- one company. Hospital vouchers are untouched: they still go through
-- resolve_patient_company exactly as before, panel exceptions and all. Nothing
-- already written moves.
--
-- THE ROUTING IS A NAMED FUNCTION, NOT AN INLINE CASE. The live body is patched
-- by text (rule 3 of docs/money-path-rules.md — post_one_payment_voucher has
-- been redefined five times and rebuilding it from any one migration file would
-- drop whichever fixes came after), and a replacement carrying quoted literals
-- has to be double-escaped through the DO block into the generated body, which
-- is exactly how a patch like this goes silently wrong. A function call needs no
-- quotes at all, and it can be tested on its own below.

-- ------------------------------------------------------------- 1. the routing

CREATE OR REPLACE FUNCTION public.payment_voucher_company(p_hospital_type TEXT)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  -- The pharmacy is its own company and has no patients, so the patient
  -- resolver has nothing to say about it. Same mapping the cash and bank tiles
  -- post through, so one company holds both its deposits and its expenses.
  IF lower(btrim(COALESCE(p_hospital_type, ''))) = 'pharmacy' THEN
    SELECT id INTO v_id FROM companies
     WHERE company_key = public.cash_bank_company_key(p_hospital_type);
    RETURN v_id;
  END IF;

  -- Unchanged for the two hospitals, panel exceptions and all.
  RETURN public.resolve_patient_company(p_hospital_type, NULL);
END $$;

COMMENT ON FUNCTION public.payment_voucher_company(TEXT) IS
  'Which company a payment voucher posts into. The pharmacy is its own company '
  'and has no patients; the two hospitals keep resolve_patient_company.';

REVOKE ALL ON FUNCTION public.payment_voucher_company(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_voucher_company(TEXT) TO anon, authenticated;

-- ------------------------------------------------- 2. point the posting at it

DO $patch$
DECLARE
  v_src TEXT;
  v_new TEXT;
  v_pat TEXT := 'public\.resolve_patient_company\(v_pv\.hospital_type,\s*NULL\)';
  v_n INT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'post_one_payment_voucher';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'ABORT: post_one_payment_voucher is not in this database';
  END IF;

  IF v_src LIKE '%payment_voucher_company%' THEN
    RAISE NOTICE 'post_one_payment_voucher already routes the pharmacy — nothing to do';
    RETURN;
  END IF;

  SELECT count(*) INTO v_n FROM regexp_matches(v_src, v_pat, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: the company resolution matched % times, expected 1 — the live body is not the shape this patch was written for', v_n;
  END IF;

  v_new := regexp_replace(v_src, v_pat, 'public.payment_voucher_company(v_pv.hospital_type)');
  IF v_new = v_src THEN
    RAISE EXCEPTION 'ABORT: the patch changed nothing';
  END IF;

  EXECUTE v_new;
  RAISE NOTICE 'post_one_payment_voucher now posts a pharmacy voucher in Hope Pharmacy''s books';
END
$patch$;

-- ------------------------------------------------------------------ 3. verify

DO $verify$
DECLARE
  v_src TEXT;
  v_pharmacy UUID; v_drm UUID; v_ayushman UUID; v_cash UUID;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'post_one_payment_voucher';
  IF v_src NOT LIKE '%payment_voucher_company%' THEN
    RAISE EXCEPTION 'ABORT: the pharmacy is still not routed';
  END IF;

  -- The routing itself, tested rather than assumed. This is the whole change.
  v_pharmacy := public.payment_voucher_company('pharmacy');
  v_ayushman := public.payment_voucher_company('ayushman');
  v_drm      := public.payment_voucher_company('hope');

  IF v_pharmacy IS NULL THEN
    RAISE EXCEPTION 'ABORT: a pharmacy voucher resolves to no company at all';
  END IF;
  IF v_pharmacy = v_drm OR v_pharmacy = v_ayushman THEN
    RAISE EXCEPTION 'ABORT: the pharmacy still resolves to a hospital''s company';
  END IF;

  -- The two hospitals must be exactly where they were, or every existing
  -- voucher changes company on its next posting.
  IF v_drm IS DISTINCT FROM public.resolve_patient_company('hope', NULL) THEN
    RAISE EXCEPTION 'ABORT: DRM Hope no longer resolves as it did';
  END IF;
  IF v_ayushman IS DISTINCT FROM public.resolve_patient_company('ayushman', NULL) THEN
    RAISE EXCEPTION 'ABORT: Ayushman no longer resolves as it did';
  END IF;

  -- And the pharmacy must own a Cash ledger, or payment_voucher_cash_ledger has
  -- nothing to credit and falls back to a retired account (20260814360000:76-82).
  SELECT id INTO v_cash FROM public.chart_of_accounts
   WHERE company_id = v_pharmacy AND is_active
     AND lower(btrim(regexp_replace(account_name, '[^a-zA-Z0-9]+', ' ', 'g'))) = 'cash'
   ORDER BY created_at LIMIT 1;
  IF v_cash IS NULL THEN
    RAISE EXCEPTION 'ABORT: Hope Pharmacy has no active Cash ledger — a cash expense there could not be credited anywhere';
  END IF;

  RAISE NOTICE 'Pharmacy vouchers post into company % against cash ledger %', v_pharmacy, v_cash;
END
$verify$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------- 4. read it
-- Where each counter's vouchers will now post, and how many each already holds.

SELECT t.counter,
       c.company_name AS posts_into,
       (SELECT count(*) FROM public.payment_vouchers v
         WHERE lower(btrim(COALESCE(v.hospital_type, ''))) = t.counter) AS vouchers_so_far
  FROM (VALUES ('hope'), ('ayushman'), ('pharmacy')) AS t(counter)
  LEFT JOIN public.companies c ON c.id = public.payment_voucher_company(t.counter)
 ORDER BY t.counter;
