-- Ayushman's doctor payouts settle into Saraswat, and always will.
--
-- THE INSTRUCTION (19 Aug, Dr M): "24 Ayushman payments should go to saraswat
-- only."
--
-- WHAT IS BEING MOVED. The 24 QR-mode doctor payouts in Ayushman Nagpur Hospital
-- that credit Canara Bank (Itwari) — Rs 31,700 in total, 11-Aug to 19-Aug. They
-- credit Canara for no reason anyone chose: pay_doctor_services picked the
-- company's first name-matching bank ledger itself, and nothing offered the
-- person paying a say (fixed earlier today in 20260819240000 and 20260819250000).
--
-- ONLY THE BANK CHANGES. The narration still says "by QR", because that is how
-- these were taken and Dr M corrected the ACCOUNT, not the method. PV1436 was
-- different — he said that one was a NEFT — and it was restated on its own.
--
-- AND THE DEFAULT MOVES WITH THEM, or the next payout lands on Canara again and
-- somebody repeats this correction next week. A company can now name the bank
-- its QR settles into; Ayushman's is Saraswat. DRM Hope is deliberately left
-- unset — its three payouts credited "Bank Charges" and which account they
-- really came from has not been answered yet, so it falls back to the
-- group-based pick, which at least can no longer choose an expense ledger.

-- ------------------------------------------------- 1. a company's QR bank

CREATE TABLE IF NOT EXISTS public.company_qr_bank (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.chart_of_accounts(id),
  note       TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.company_qr_bank IS
  'The bank account a company''s QR collections and payouts settle into. Read '
  'by qr_payout_bank_ledger before it falls back to guessing.';

GRANT SELECT ON public.company_qr_bank TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.qr_payout_bank_ledger(p_company_id UUID)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  -- What the company has actually said, if it has said anything.
  SELECT b.account_id INTO v_id
    FROM company_qr_bank b
    JOIN chart_of_accounts a ON a.id = b.account_id AND a.is_active
   WHERE b.company_id = p_company_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- Otherwise a ledger FILED as a bank. Never matched on the name: "Bank
  -- Charges" is an expense and "Dr. Badal Bankar" is a consultant.
  SELECT id INTO v_id FROM chart_of_accounts
   WHERE company_id = p_company_id AND is_active
     AND lower(COALESCE(account_group, '')) LIKE '%bank%'
   ORDER BY created_at, account_name
   LIMIT 1;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.qr_payout_bank_ledger(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qr_payout_bank_ledger(UUID) TO anon, authenticated;

INSERT INTO public.company_qr_bank (company_id, account_id, note)
SELECT c.id, a.id, 'Dr M, 19-Aug: Ayushman payouts go to Saraswat only'
  FROM public.companies c
  JOIN public.chart_of_accounts a
    ON a.company_id = c.id AND a.is_active AND a.account_name = 'Saraswat Bank'
 WHERE c.company_key = 'ayushman_nagpur'
ON CONFLICT (company_id) DO UPDATE
  SET account_id = EXCLUDED.account_id, note = EXCLUDED.note, updated_at = now();

-- --------------------------------------------------- 2. move the 24 across

DO $move$
DECLARE
  v_canara   UUID;
  v_saraswat UUID;
  v_company  UUID;
  v_n        INT;
  v_amount   NUMERIC;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE company_key = 'ayushman_nagpur';
  SELECT id INTO v_canara   FROM public.chart_of_accounts
   WHERE company_id = v_company AND account_name = 'Canara Bank (Itwari)';
  SELECT id INTO v_saraswat FROM public.chart_of_accounts
   WHERE company_id = v_company AND account_name = 'Saraswat Bank' AND is_active;
  IF v_saraswat IS NULL THEN
    RAISE EXCEPTION 'ABORT: Ayushman has no active Saraswat Bank ledger';
  END IF;

  SELECT count(*), COALESCE(sum(v.total_amount), 0) INTO v_n, v_amount
    FROM public.vouchers v
    JOIN public.voucher_entries e ON e.voucher_id = v.id AND e.credit_amount > 0
   WHERE v.company_id = v_company
     AND v.narration LIKE 'Doctor payout%by QR%'
     AND e.account_id = v_canara;

  -- Only the credit side, only these vouchers, only while still on Canara: a
  -- re-run must not move a correction somebody has since made by hand.
  UPDATE public.voucher_entries e
     SET account_id = v_saraswat
    FROM public.vouchers v
   WHERE v.id = e.voucher_id
     AND v.company_id = v_company
     AND v.narration LIKE 'Doctor payout%by QR%'
     AND e.credit_amount > 0
     AND e.account_id = v_canara;

  RAISE NOTICE '% doctor payout(s) worth Rs % moved from Canara Bank (Itwari) to Saraswat Bank',
    v_n, to_char(v_amount, 'FM99,99,99,990.00');
END
$move$;

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE v_left INT; v_unbalanced INT; v_pick UUID; v_name TEXT; v_company UUID;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE company_key = 'ayushman_nagpur';

  -- Nothing of that shape may still sit on Canara.
  SELECT count(*) INTO v_left
    FROM public.vouchers v
    JOIN public.voucher_entries e ON e.voucher_id = v.id AND e.credit_amount > 0
    JOIN public.chart_of_accounts a ON a.id = e.account_id
   WHERE v.company_id = v_company
     AND v.narration LIKE 'Doctor payout%by QR%'
     AND a.account_name = 'Canara Bank (Itwari)';
  IF v_left > 0 THEN
    RAISE EXCEPTION 'ABORT: % payout(s) are still on Canara', v_left;
  END IF;

  -- Every one of them must still balance.
  SELECT count(*) INTO v_unbalanced FROM (
    SELECT v.id
      FROM public.vouchers v
      JOIN public.voucher_entries e ON e.voucher_id = v.id
     WHERE v.company_id = v_company AND v.narration LIKE 'Doctor payout%'
     GROUP BY v.id
    HAVING round(sum(e.debit_amount) - sum(e.credit_amount), 2) <> 0
  ) t;
  IF v_unbalanced > 0 THEN
    RAISE EXCEPTION 'ABORT: % payout voucher(s) no longer balance', v_unbalanced;
  END IF;

  -- And the next one must land on Saraswat without anybody choosing.
  v_pick := public.qr_payout_bank_ledger(v_company);
  SELECT account_name INTO v_name FROM public.chart_of_accounts WHERE id = v_pick;
  IF v_name IS DISTINCT FROM 'Saraswat Bank' THEN
    RAISE EXCEPTION 'ABORT: the next Ayushman QR payout would go to %', v_name;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------- read it

SELECT c.company_name,
       a.account_name AS credited,
       count(*)       AS payouts,
       to_char(sum(v.total_amount), 'FM99,99,99,990.00') AS total
  FROM public.vouchers v
  JOIN public.companies c ON c.id = v.company_id
  JOIN public.voucher_entries e ON e.voucher_id = v.id AND e.credit_amount > 0
  JOIN public.chart_of_accounts a ON a.id = e.account_id
 WHERE v.narration LIKE 'Doctor payout%'
 GROUP BY c.company_name, a.account_name
 ORDER BY c.company_name, a.account_name;
