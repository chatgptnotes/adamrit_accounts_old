-- Date-wise settlement totals on the PhonePe tile, with the paperwork attached.
--
-- THE INSTRUCTION (18 Aug, Dr M): show the date-wise total transaction amount
-- on the PhonePe History tile, let staff attach several files or photograph
-- them with the camera against each settlement, and show those documents under
-- the date they belong to.
--
-- THE TOTALS ARE DERIVED, NOT STORED. recon_transactions already holds every
-- transaction read off the history screens, with txn_date, amount and
-- direction. A stored daily total would be a second copy that drifts the first
-- time a screenshot is re-read or a duplicate is dropped, and then two screens
-- would disagree about the day's takings. The view computes it every time.
--
-- CREDIT AND DEBIT ARE KEPT APART. A settlement figure that quietly nets a
-- refund against takings is how a short day looks normal, so money in, money
-- out and the net are three separate columns and the screen can show all three.
--
-- THE DOCUMENTS HANG OFF (source, date), NOT off an upload. One day's
-- settlement is usually several screenshots plus a slip; recon_uploads is one
-- row per screenshot read, so attaching to it would scatter one day's evidence
-- across several rows and lose anything photographed after the last screenshot.

CREATE TABLE IF NOT EXISTS public.recon_settlement_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES public.recon_sources(id) ON DELETE CASCADE,
  -- The settlement day this evidence belongs to, in the phone's own dates.
  settlement_date DATE NOT NULL,
  file_name TEXT,
  file_path TEXT NOT NULL,
  file_url TEXT,
  file_type TEXT,
  file_size BIGINT,
  note TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recon_settlement_docs_day
  ON public.recon_settlement_docs(source_id, settlement_date DESC);

ALTER TABLE public.recon_settlement_docs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recon_settlement_docs_all ON public.recon_settlement_docs;
CREATE POLICY recon_settlement_docs_all ON public.recon_settlement_docs
  FOR ALL USING (true) WITH CHECK (true);

-- One row per phone per day: what came in, what went out, the net, how many
-- transactions, and how many documents are attached.
CREATE OR REPLACE VIEW public.v_recon_settlement_days AS
SELECT
  t.source_id,
  t.txn_date                                   AS settlement_date,
  count(*)                                     AS txn_count,
  COALESCE(sum(t.amount) FILTER (WHERE upper(COALESCE(t.direction, 'IN')) <> 'OUT'), 0)  AS money_in,
  COALESCE(sum(t.amount) FILTER (WHERE upper(COALESCE(t.direction, '')) = 'OUT'), 0)     AS money_out,
  COALESCE(sum(t.amount) FILTER (WHERE upper(COALESCE(t.direction, 'IN')) <> 'OUT'), 0)
    - COALESCE(sum(t.amount) FILTER (WHERE upper(COALESCE(t.direction, '')) = 'OUT'), 0) AS net_total,
  (SELECT count(*) FROM public.recon_settlement_docs d
    WHERE d.source_id = t.source_id AND d.settlement_date = t.txn_date)                  AS doc_count
FROM public.recon_transactions t
WHERE t.txn_date IS NOT NULL
GROUP BY t.source_id, t.txn_date;

GRANT SELECT ON public.v_recon_settlement_days TO anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON public.recon_settlement_docs TO anon, authenticated, service_role;

DO $verify$
DECLARE v_n INT; v_bad INT;
BEGIN
  IF to_regclass('public.recon_settlement_docs') IS NULL THEN
    RAISE EXCEPTION 'ABORT: the documents table was not created';
  END IF;

  -- The view must answer, and must not invent days that have no transactions.
  SELECT count(*) INTO v_n FROM public.v_recon_settlement_days;
  SELECT count(DISTINCT (source_id, txn_date)) INTO v_bad
    FROM public.recon_transactions WHERE txn_date IS NOT NULL;
  IF v_n <> v_bad THEN
    RAISE EXCEPTION 'ABORT: the view reports % day(s) against % in the data', v_n, v_bad;
  END IF;

  -- Money in and money out must never be folded together: a day whose figures
  -- net to zero must still show both sides.
  SELECT count(*) INTO v_bad FROM public.v_recon_settlement_days
   WHERE money_in < 0 OR money_out < 0;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % day(s) report a negative side', v_bad;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
