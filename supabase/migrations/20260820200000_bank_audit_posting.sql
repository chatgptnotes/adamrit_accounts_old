-- Bank audit posting: an approved-missing bank line becomes a real voucher in
-- the company's books.
--
-- The books for the two audited companies are the Tally mirror — the ledger
-- view, bank book, cash book and day book screens all read tally_vouchers by
-- explicit company_id and render its ledger_entries. So posting means: one
-- tally_vouchers row, shaped exactly like the 79,402 promoted vouchers beside
-- it, marked with where it came from.
--
-- Guard-rails, all enforced at entry inside one transaction:
--   * only an approved_missing row with an active decision (ledger + type)
--   * ledgers resolved by ID within the row's company — never by name alone
--   * four duplicate checks run immediately before the insert
--   * every failure raises; nothing is swallowed
--
-- No BEFORE INSERT trigger writes anything; the function is the single door.

-- ---------------------------------------------------------------------------
-- STEP 1 — where the posted voucher is remembered
-- ---------------------------------------------------------------------------
ALTER TABLE public.bank_reconciliation_decisions
  ADD COLUMN IF NOT EXISTS posted_tally_voucher_id UUID REFERENCES public.tally_vouchers(id);

-- ---------------------------------------------------------------------------
-- STEP 2 — the posting function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_bank_audit_row(
  p_row_id    UUID,
  p_posted_by TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_row       public.bank_reconciliation_rows%ROWTYPE;
  v_decision  public.bank_reconciliation_decisions%ROWTYPE;
  v_party     public.tally_ledgers%ROWTYPE;
  v_category  TEXT;
  v_vtype     TEXT;
  v_amount    NUMERIC(15,2);
  v_number    TEXT;
  v_seq       INTEGER;
  v_voucher_id UUID;
  v_dup       RECORD;
BEGIN
  IF COALESCE(btrim(p_posted_by), '') = '' THEN
    RAISE EXCEPTION 'posted_by is required';
  END IF;

  SELECT * INTO v_row FROM public.bank_reconciliation_rows WHERE id = p_row_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank evidence row % does not exist', p_row_id;
  END IF;
  IF v_row.status = 'posted' THEN
    RAISE EXCEPTION 'row % is already posted', p_row_id;
  END IF;
  IF v_row.status <> 'approved_missing' THEN
    RAISE EXCEPTION 'row % is % — only approved_missing rows can be posted', p_row_id, v_row.status;
  END IF;
  IF v_row.signed_amount = 0 THEN
    RAISE EXCEPTION 'a zero-value bank line cannot become a voucher';
  END IF;

  SELECT * INTO v_decision
    FROM public.bank_reconciliation_decisions
   WHERE row_id = p_row_id AND superseded_at IS NULL;
  IF NOT FOUND OR v_decision.decision <> 'approved_missing' THEN
    RAISE EXCEPTION 'row % has no active approved_missing decision', p_row_id;
  END IF;
  IF v_decision.counterparty_tally_ledger_id IS NULL OR v_decision.voucher_type_id IS NULL THEN
    RAISE EXCEPTION 'the decision on row % is missing its ledger or voucher type', p_row_id;
  END IF;

  -- Resolve the counterparty by ID, inside the row's company.
  SELECT * INTO v_party
    FROM public.tally_ledgers
   WHERE id = v_decision.counterparty_tally_ledger_id
     AND company_id = v_row.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'counterparty ledger % is not in company % — companies are never mixed',
      v_decision.counterparty_tally_ledger_id, v_row.company_id;
  END IF;

  -- The bank side must be a real ledger of this company too.
  IF NOT EXISTS (
    SELECT 1 FROM public.tally_ledgers l
     WHERE l.company_id = v_row.company_id
       AND lower(btrim(l.name)) = lower(btrim(v_row.bank_ledger))
  ) THEN
    RAISE EXCEPTION 'bank ledger "%" does not exist in this company''s Tally ledgers — create/map it first',
      v_row.bank_ledger;
  END IF;

  v_amount := ABS(v_row.signed_amount);

  -- -------------------------------------------------------------------------
  -- Duplicate checks, immediately before the insert.
  -- -------------------------------------------------------------------------
  -- (a) this exact evidence line was already posted (any path).
  SELECT id, voucher_number INTO v_dup
    FROM public.tally_vouchers
   WHERE company_id = v_row.company_id
     AND source_fingerprint = v_row.fingerprint
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'this bank line was already posted as voucher % (%)', v_dup.voucher_number, v_dup.id;
  END IF;

  -- (b) a promoted voucher with the same date, amount and bank already exists.
  SELECT tv.id, tv.voucher_number, tv.voucher_type INTO v_dup
    FROM public.tally_vouchers tv
   WHERE tv.company_id = v_row.company_id
     AND tv.date = v_row.statement_date
     AND ROUND(tv.amount, 2) = ROUND(v_amount, 2)
     AND COALESCE(tv.is_cancelled, false) = false
     AND (
       lower(btrim(COALESCE(tv.party_ledger, ''))) = lower(btrim(v_row.bank_ledger))
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(tv.ledger_entries, '[]'::jsonb)) e
          WHERE lower(btrim(COALESCE(e->>'ledger', ''))) = lower(btrim(v_row.bank_ledger))
       )
     )
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'a % voucher of the same amount on the same date already touches % (id %) — mark the row "already entered" instead',
      v_dup.voucher_type, v_row.bank_ledger, v_dup.id;
  END IF;

  -- (c) same-day same-amount record still sitting in the historical stage.
  IF EXISTS (
    SELECT 1
      FROM public.tally_history_stage_vouchers sv
      JOIN public.tally_history_import_batches b ON b.id = sv.batch_id
     WHERE b.company_id = v_row.company_id
       AND sv.voucher_date = v_row.statement_date
       AND ROUND(ABS(sv.amount), 2) = ROUND(v_amount, 2)
       AND sv.is_cancelled = false
       AND NOT EXISTS (
         SELECT 1 FROM public.tally_vouchers pv
          WHERE pv.source_fingerprint = sv.source_fingerprint
            AND pv.company_id = b.company_id
       )
  ) THEN
    RAISE EXCEPTION 'an unpromoted staged Tally voucher matches this date and amount — resolve the stage first';
  END IF;

  -- (d) a native voucher of this Tally company, same date and amount.
  IF EXISTS (
    SELECT 1 FROM public.vouchers v
     WHERE v.tally_company_id = v_row.company_id
       AND v.voucher_date = v_row.statement_date
       AND ROUND(v.total_amount, 2) = ROUND(v_amount, 2)
       AND COALESCE(v.status, '') NOT IN ('CANCELLED')
  ) THEN
    RAISE EXCEPTION 'a native accounting voucher matches this date and amount — mark the row "found elsewhere" instead';
  END IF;

  -- (e) the same underlying transaction, seen through an overlapping
  --     statement file, was already posted.
  SELECT r.id INTO v_dup
    FROM public.bank_reconciliation_rows r
   WHERE r.company_id = v_row.company_id
     AND r.dedupe_key = v_row.dedupe_key
     AND r.id <> v_row.id
     AND r.status = 'posted'
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'this same bank transaction (via an overlapping statement file) was already posted from evidence row %', v_dup.id;
  END IF;

  -- -------------------------------------------------------------------------
  -- Build and insert the voucher, shaped like its promoted neighbours.
  -- -------------------------------------------------------------------------
  SELECT vt.voucher_category INTO v_category
    FROM public.voucher_types vt WHERE vt.id = v_decision.voucher_type_id;
  v_vtype := CASE upper(COALESCE(v_category, ''))
               WHEN 'RECEIPT' THEN 'Receipt'
               WHEN 'PAYMENT' THEN 'Payment'
               WHEN 'CONTRA'  THEN 'Contra'
               ELSE 'Journal'
             END;

  SELECT COUNT(*) + 1 INTO v_seq
    FROM public.tally_vouchers
   WHERE company_id = v_row.company_id AND sync_direction = 'from_bank_audit';
  v_number := 'BA-' || lpad(v_seq::text, 4, '0');

  INSERT INTO public.tally_vouchers
    (company_id, voucher_number, voucher_type, date, party_ledger, amount,
     narration, is_cancelled, sync_direction, sync_status, source_fingerprint,
     ledger_entries, raw_data, created_at, synced_at)
  VALUES
    (v_row.company_id, v_number, v_vtype, v_row.statement_date, v_party.name,
     v_amount, v_row.narration, false, 'from_bank_audit', 'synced',
     v_row.fingerprint,
     CASE WHEN v_row.signed_amount > 0 THEN
       jsonb_build_array(
         jsonb_build_object('ledger', v_row.bank_ledger, 'amount', v_amount, 'is_debit', true),
         jsonb_build_object('ledger', v_party.name,      'amount', v_amount, 'is_debit', false))
     ELSE
       jsonb_build_array(
         jsonb_build_object('ledger', v_party.name,      'amount', v_amount, 'is_debit', true),
         jsonb_build_object('ledger', v_row.bank_ledger, 'amount', v_amount, 'is_debit', false))
     END,
     jsonb_build_object(
       'source', 'bank_only_audit',
       'evidence_row_id', v_row.id,
       'decision_id', v_decision.id,
       'posted_by', btrim(p_posted_by),
       'bank_reference', v_row.reference,
       'source_file', v_row.source_file,
       'source_page', v_row.source_page),
     now(), now())
  RETURNING id INTO v_voucher_id;

  UPDATE public.bank_reconciliation_decisions
     SET posted_tally_voucher_id = v_voucher_id,
         posted_at = now(),
         approved_by = btrim(p_posted_by),
         approved_at = COALESCE(approved_at, now())
   WHERE id = v_decision.id;

  UPDATE public.bank_reconciliation_rows
     SET status = 'posted'
   WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'voucher_id', v_voucher_id,
    'voucher_number', v_number,
    'voucher_type', v_vtype,
    'ledger', v_party.name,
    'amount', v_amount);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.post_bank_audit_row(UUID, TEXT)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- STEP 3 — verify before committing
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_missing TEXT := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'bank_reconciliation_decisions'
       AND column_name = 'posted_tally_voucher_id'
  ) THEN
    v_missing := v_missing || ' posted_tally_voucher_id column missing;';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'post_bank_audit_row'
  ) THEN
    v_missing := v_missing || ' posting function missing;';
  END IF;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'ABORT —%', v_missing;
  END IF;
  RAISE NOTICE 'OK — an approved-missing bank line can now become a voucher in its company''s books';
END $$;
