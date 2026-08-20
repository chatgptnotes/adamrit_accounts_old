-- Bank-only audit import: the 2,965 statement lines the FY 2025-26 audit
-- could not tie to the books, held as evidence a reviewing accountant can
-- work through — WITHOUT touching a single existing voucher, ledger or
-- Tally import.
--
-- Why: many bank entries were never entered into the software by the
-- accountant. The audit report (bank-only-full-audit-fy2025-26.xlsx) lists
-- them per company. They must be importable, reviewable and approvable
-- BEFORE any accounting posting, and the evidence must be impossible to
-- edit or lose.
--
-- Three tables:
--   bank_reconciliation_batches    one upload of one report sheet, per company
--   bank_reconciliation_rows       one bank statement line, frozen once written
--   bank_reconciliation_decisions  what the accountant decided about that line
--
-- Nothing here posts a voucher. Posting is a later, separate migration and
-- sits behind a switch defaulted off.
--
-- Company isolation: every row carries the explicit tally_config.company_id
-- (DRM 37548c73-…, Ayushman 3201eb57-…). Names and shared Tally GUIDs are
-- never used as keys.

-- ---------------------------------------------------------------------------
-- STEP 1 — the batch: one sheet of the audit file, for one company
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_reconciliation_batches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES public.tally_config(id),
  source_file_name TEXT NOT NULL,
  source_sheet     TEXT NOT NULL,
  source_sha256    TEXT NOT NULL,
  row_count        INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'void')),
  imported_by      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The same file+sheet cannot be batched twice for the same company.
CREATE UNIQUE INDEX IF NOT EXISTS brb_company_source_uidx
  ON public.bank_reconciliation_batches (company_id, source_sha256, source_sheet);

-- ---------------------------------------------------------------------------
-- STEP 2 — the rows: immutable bank evidence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_reconciliation_rows (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id             UUID NOT NULL REFERENCES public.bank_reconciliation_batches(id),
  company_id           UUID NOT NULL REFERENCES public.tally_config(id),
  bank_ledger          TEXT NOT NULL,
  statement_date       DATE NOT NULL,
  -- Signed: credit into the bank positive, debit out negative.
  signed_amount        NUMERIC(15,2) NOT NULL CHECK (signed_amount <> 0),
  reference            TEXT,
  narration            TEXT,
  source_file          TEXT NOT NULL,
  source_page          INTEGER,
  -- Position among identical lines on the same file+page. Real statements
  -- carry genuinely repeated lines (38 in Ayushman's Saraswat statements),
  -- so the fingerprint of the brief alone is not unique — the ordinal is
  -- what makes two identical Rs 118 ACH returns two rows, not one.
  row_ordinal          INTEGER NOT NULL DEFAULT 1,
  -- What the automated audit thought (advisory only, never a decision).
  audit_classification TEXT,
  candidate_details    TEXT,
  -- sha256 of company|bank|date|amount|reference|file|page|ordinal.
  fingerprint          TEXT NOT NULL,
  -- sha256 of company|bank|date|amount|reference — NOT unique on purpose:
  -- overlapping statement PDFs show the same real transaction under two
  -- fingerprints, and this key is how a reviewer finds those pairs.
  dedupe_key           TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending_review'
                       CHECK (status IN ('pending_review', 'matched',
                                         'found_elsewhere', 'ambiguous',
                                         'approved_missing', 'rejected',
                                         'posted')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS brr_fingerprint_uidx
  ON public.bank_reconciliation_rows (company_id, fingerprint);
CREATE INDEX IF NOT EXISTS brr_company_status_idx
  ON public.bank_reconciliation_rows (company_id, status);
CREATE INDEX IF NOT EXISTS brr_company_date_idx
  ON public.bank_reconciliation_rows (company_id, statement_date);
CREATE INDEX IF NOT EXISTS brr_dedupe_idx
  ON public.bank_reconciliation_rows (dedupe_key);
CREATE INDEX IF NOT EXISTS brr_batch_idx
  ON public.bank_reconciliation_rows (batch_id);

-- The evidence is frozen at entry: a row must belong to its batch's company,
-- may never be deleted, and after insert only its status may change.
CREATE OR REPLACE FUNCTION public.bank_recon_row_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.bank_reconciliation_batches b
       WHERE b.id = NEW.batch_id AND b.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'bank evidence row must carry the same company as its batch';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bank evidence rows are immutable — deletion is not allowed (row %)', OLD.id;
  END IF;

  IF (NEW.batch_id, NEW.company_id, NEW.bank_ledger, NEW.statement_date,
      NEW.signed_amount, NEW.reference, NEW.narration, NEW.source_file,
      NEW.source_page, NEW.row_ordinal, NEW.audit_classification,
      NEW.candidate_details, NEW.fingerprint, NEW.dedupe_key, NEW.created_at)
     IS DISTINCT FROM
     (OLD.batch_id, OLD.company_id, OLD.bank_ledger, OLD.statement_date,
      OLD.signed_amount, OLD.reference, OLD.narration, OLD.source_file,
      OLD.source_page, OLD.row_ordinal, OLD.audit_classification,
      OLD.candidate_details, OLD.fingerprint, OLD.dedupe_key, OLD.created_at)
  THEN
    RAISE EXCEPTION 'bank evidence rows are immutable — only status may change (row %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS bank_recon_row_guard_trg ON public.bank_reconciliation_rows;
CREATE TRIGGER bank_recon_row_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.bank_reconciliation_rows
  FOR EACH ROW EXECUTE FUNCTION public.bank_recon_row_guard();

-- ---------------------------------------------------------------------------
-- STEP 3 — the decisions: append-only, one active per row
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_reconciliation_decisions (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id                       UUID NOT NULL REFERENCES public.bank_reconciliation_rows(id),
  decision                     TEXT NOT NULL
                               CHECK (decision IN ('matched', 'found_elsewhere',
                                                   'ambiguous', 'approved_missing',
                                                   'rejected')),
  -- The other side of the entry, chosen by the accountant. Required for
  -- approved_missing; must belong to the row's company.
  counterparty_tally_ledger_id UUID REFERENCES public.tally_ledgers(id),
  voucher_type_id              UUID REFERENCES public.voucher_types(id),
  -- For matched / found_elsewhere: which existing record it was tied to.
  matched_tally_voucher_id     UUID REFERENCES public.tally_vouchers(id),
  note                         TEXT,
  decided_by                   TEXT NOT NULL,
  decided_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by                  TEXT,
  approved_at                  TIMESTAMPTZ,
  -- Stamped by the (future, switched-off) posting step only.
  posted_voucher_id            UUID REFERENCES public.vouchers(id),
  posted_at                    TIMESTAMPTZ,
  superseded_at                TIMESTAMPTZ
);

-- One live decision per row; history is kept by superseding, never deleting.
CREATE UNIQUE INDEX IF NOT EXISTS brd_active_uidx
  ON public.bank_reconciliation_decisions (row_id)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS brd_row_idx
  ON public.bank_reconciliation_decisions (row_id);

-- ---------------------------------------------------------------------------
-- STEP 4 — the one door for deciding: validates, supersedes, stamps the row
--
-- Enforced at entry, in one transaction, never in a BEFORE INSERT trigger
-- writing other rows. Raises on every violation — nothing is swallowed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_bank_recon_row(
  p_row_id     UUID,
  p_decision   TEXT,
  p_ledger_id  UUID DEFAULT NULL,
  p_voucher_type_id UUID DEFAULT NULL,
  p_matched_tally_voucher_id UUID DEFAULT NULL,
  p_note       TEXT DEFAULT NULL,
  p_decided_by TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_row public.bank_reconciliation_rows%ROWTYPE;
  v_decision_id UUID;
BEGIN
  SELECT * INTO v_row FROM public.bank_reconciliation_rows WHERE id = p_row_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank evidence row % does not exist', p_row_id;
  END IF;
  IF v_row.status = 'posted' THEN
    RAISE EXCEPTION 'row % is already posted — its decision cannot change', p_row_id;
  END IF;
  IF COALESCE(btrim(p_decided_by), '') = '' THEN
    RAISE EXCEPTION 'decided_by is required';
  END IF;

  IF p_decision = 'approved_missing' THEN
    IF p_ledger_id IS NULL OR p_voucher_type_id IS NULL THEN
      RAISE EXCEPTION 'approved_missing needs the counterparty ledger AND the voucher type';
    END IF;
  END IF;

  -- The chosen ledger must live in the same company as the evidence.
  IF p_ledger_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tally_ledgers l
     WHERE l.id = p_ledger_id AND l.company_id = v_row.company_id
  ) THEN
    RAISE EXCEPTION 'ledger % does not belong to company % — companies are never mixed',
      p_ledger_id, v_row.company_id;
  END IF;

  -- A matched voucher must also be of the same company.
  IF p_matched_tally_voucher_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tally_vouchers tv
     WHERE tv.id = p_matched_tally_voucher_id AND tv.company_id = v_row.company_id
  ) THEN
    RAISE EXCEPTION 'voucher % does not belong to company %',
      p_matched_tally_voucher_id, v_row.company_id;
  END IF;

  UPDATE public.bank_reconciliation_decisions
     SET superseded_at = now()
   WHERE row_id = p_row_id AND superseded_at IS NULL;

  INSERT INTO public.bank_reconciliation_decisions
    (row_id, decision, counterparty_tally_ledger_id, voucher_type_id,
     matched_tally_voucher_id, note, decided_by)
  VALUES
    (p_row_id, p_decision, p_ledger_id, p_voucher_type_id,
     p_matched_tally_voucher_id, p_note, btrim(p_decided_by))
  RETURNING id INTO v_decision_id;

  UPDATE public.bank_reconciliation_rows
     SET status = p_decision
   WHERE id = p_row_id;

  RETURN v_decision_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.decide_bank_recon_row(UUID, TEXT, UUID, UUID, UUID, TEXT, TEXT)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- STEP 5 — RLS, following the existing recon_* pattern
-- ---------------------------------------------------------------------------
ALTER TABLE public.bank_reconciliation_batches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliation_rows      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliation_decisions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bank_reconciliation_batches') THEN
    CREATE POLICY brb_all ON public.bank_reconciliation_batches FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bank_reconciliation_rows') THEN
    CREATE POLICY brr_all ON public.bank_reconciliation_rows FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bank_reconciliation_decisions') THEN
    CREATE POLICY brd_all ON public.bank_reconciliation_decisions FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- STEP 6 — verify before committing
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_missing TEXT := '';
BEGIN
  IF to_regclass('public.bank_reconciliation_batches') IS NULL THEN
    v_missing := v_missing || ' batches table missing;';
  END IF;
  IF to_regclass('public.bank_reconciliation_rows') IS NULL THEN
    v_missing := v_missing || ' rows table missing;';
  END IF;
  IF to_regclass('public.bank_reconciliation_decisions') IS NULL THEN
    v_missing := v_missing || ' decisions table missing;';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'bank_recon_row_guard_trg'
  ) THEN
    v_missing := v_missing || ' immutability guard missing;';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'decide_bank_recon_row'
  ) THEN
    v_missing := v_missing || ' decision function missing;';
  END IF;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'ABORT —%', v_missing;
  END IF;
  RAISE NOTICE 'OK — bank-only audit evidence can be imported; nothing existing was touched';
END $$;
