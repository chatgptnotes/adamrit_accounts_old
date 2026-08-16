-- Let a cashier SPEAK the explanation for a difference, not only type it.
--
-- The variance reason is the one thing a cashier must produce when the drawer
-- disagrees with the software, and it is currently a single-line text box on a
-- tablet. Staff at the counter type slowly, in a second language, under a queue
-- -- so the reason recorded is "short" or "paid out", which explains nothing to
-- the person reading the register a month later. Spoken, the same cashier gives
-- the whole story in fifteen seconds.
--
-- Stored as an ATTACHMENT, not a new column, because cash_handover_photos
-- already does all of this: it is keyed to the handover, cascades when the
-- handover is deleted, keeps the storage path for cleanup, records who uploaded
-- it, and is already read by the Cash Shift Report. A parallel table for one
-- more file type would be a second thing to keep in step.
--
-- The kind CHECK is the only thing standing in the way -- it admits three
-- values, all of them pictures.

ALTER TABLE public.cash_handover_photos
  DROP CONSTRAINT IF EXISTS cash_handover_photos_kind_check;

ALTER TABLE public.cash_handover_photos
  ADD CONSTRAINT cash_handover_photos_kind_check
  CHECK (kind = ANY (ARRAY['cash_register'::text, 'signed_note'::text,
                           'voice_reason'::text, 'other'::text]));

COMMENT ON COLUMN public.cash_handover_photos.kind IS
  'What the attachment IS, so a reader knows before opening it. '
  'voice_reason is a spoken explanation of the variance -- audio, not an image; '
  'anything rendering these must branch on file_type before using an <img>.';

DO $verify$
DECLARE v_bad INT; v_def TEXT;
BEGIN
  -- The three existing kinds must still be accepted, or every past attachment
  -- becomes unwritable and the constraint has quietly broken the photo path.
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.cash_handover_photos'::regclass
     AND conname = 'cash_handover_photos_kind_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'ABORT: the kind check is gone entirely';
  END IF;
  IF v_def NOT LIKE '%cash_register%' OR v_def NOT LIKE '%signed_note%'
     OR v_def NOT LIKE '%other%' OR v_def NOT LIKE '%voice_reason%' THEN
    RAISE EXCEPTION 'ABORT: the kind check lost a value: %', v_def;
  END IF;

  -- And no existing row may violate it.
  SELECT count(*) INTO v_bad FROM public.cash_handover_photos
   WHERE kind NOT IN ('cash_register', 'signed_note', 'voice_reason', 'other');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % attachment(s) hold a kind the check rejects', v_bad;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
