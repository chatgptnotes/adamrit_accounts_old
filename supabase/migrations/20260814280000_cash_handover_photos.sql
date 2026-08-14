-- Photographs taken at the handover: the cash register, and the signed note.
--
-- A handover is currently a set of numbers agreed between two people and
-- nothing else. When a count is later disputed -- and one already has been --
-- there is no paper to go back to, only two recollections. The ward keeps a
-- cash register and the cashier signs a handover note, and neither has ever
-- reached the system.
--
-- Many photos, not one. A register page, a signed slip and a second page of
-- denominations are three different pieces of evidence, and forcing them into
-- one attachment means two of them do not get taken.
--
-- Its own table rather than a column on cash_handovers, because the
-- relationship is one-to-many, and rather than file_uploads.patient_id because
-- a handover belongs to no patient. It mirrors cash_handover_denominations:
-- the rows that make up one handover, hanging off it and deleted with it.

CREATE TABLE IF NOT EXISTS public.cash_handover_photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_id   UUID NOT NULL REFERENCES public.cash_handovers(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  file_url      TEXT NOT NULL,
  file_type     TEXT,
  file_size     BIGINT,
  storage_path  TEXT,
  /** What it is a photograph OF, so a reader knows before opening it. */
  kind          TEXT NOT NULL DEFAULT 'other'
                CHECK (kind IN ('cash_register', 'signed_note', 'other')),
  uploaded_by   UUID REFERENCES public."User"(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cash_handover_photos_handover
  ON public.cash_handover_photos (handover_id, created_at);

ALTER TABLE public.cash_handover_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cash_handover_photos_read ON public.cash_handover_photos;
CREATE POLICY cash_handover_photos_read
  ON public.cash_handover_photos FOR SELECT USING (true);
DROP POLICY IF EXISTS cash_handover_photos_write ON public.cash_handover_photos;
CREATE POLICY cash_handover_photos_write
  ON public.cash_handover_photos FOR INSERT WITH CHECK (true);

COMMENT ON TABLE public.cash_handover_photos IS
  'Photographs taken when a drawer was handed over: the cash register page, '
  'the note the cashier signed. Evidence for a count that is later disputed.';

DO $verify$
DECLARE
  v_u UUID; v_u2 UUID; v_h UUID; v_left INT; v_ok BOOLEAN;
BEGIN
  SELECT id INTO v_u  FROM "User" LIMIT 1;
  SELECT id INTO v_u2 FROM "User" WHERE id <> v_u LIMIT 1;
  IF v_u IS NULL OR v_u2 IS NULL THEN
    RAISE EXCEPTION 'ABORT: need two users to self-test';
  END IF;

  INSERT INTO cash_handovers (handover_no, hospital_type, from_user_id, from_user_name,
    to_user_id, to_user_name, period_from, period_to, expected_cash, counted_cash, status)
  VALUES ('SELFTEST-PHOTO', 'selftest-photoctr', v_u, 'From', v_u2, 'To',
          now(), now(), 100, 100, 'SUBMITTED')
  RETURNING id INTO v_h;

  -- (a) many photographs may hang off one handover
  INSERT INTO cash_handover_photos (handover_id, file_name, file_url, kind, uploaded_by)
  VALUES (v_h, 'register.jpg', 'https://example.invalid/1.jpg', 'cash_register', v_u),
         (v_h, 'note.jpg',     'https://example.invalid/2.jpg', 'signed_note',   v_u),
         (v_h, 'extra.jpg',    'https://example.invalid/3.jpg', 'other',         v_u);

  SELECT count(*) INTO v_left FROM cash_handover_photos WHERE handover_id = v_h;
  IF v_left <> 3 THEN
    RAISE EXCEPTION 'ABORT: three photographs went in, % came back', v_left;
  END IF;

  -- (b) an invented kind is refused, so the label stays worth reading
  v_ok := false;
  BEGIN
    INSERT INTO cash_handover_photos (handover_id, file_name, file_url, kind)
    VALUES (v_h, 'x.jpg', 'https://example.invalid/x.jpg', 'selfie');
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  IF NOT v_ok THEN
    DELETE FROM cash_handovers WHERE id = v_h;
    RAISE EXCEPTION 'ABORT: an unknown photograph kind was accepted';
  END IF;

  -- (c) deleting the handover takes its photographs with it, rather than
  --     leaving rows pointing at a handover that no longer exists
  DELETE FROM cash_handovers WHERE id = v_h;
  SELECT count(*) INTO v_left FROM cash_handover_photos WHERE handover_id = v_h;
  IF v_left <> 0 THEN
    DELETE FROM cash_handover_photos WHERE handover_id = v_h;
    RAISE EXCEPTION 'ABORT: % orphaned photograph row(s) survived', v_left;
  END IF;

  IF EXISTS (SELECT 1 FROM cash_handovers WHERE hospital_type = 'selftest-photoctr') THEN
    RAISE EXCEPTION 'ABORT: the self-test handover was left behind';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
