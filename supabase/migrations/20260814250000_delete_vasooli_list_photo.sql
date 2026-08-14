-- Let the person who photographed a collection sheet remove it. Only them.
--
-- Gaurav retakes a blurred sheet and the old one stays in the strip, so Avani
-- has two lists in front of her and no way to know which is the live one. That
-- is worse than no photo: she will type from whichever she opens.
--
-- The check belongs here rather than in the tile. Hiding a button decides what
-- is easy to do, not what is possible -- the delete would still go through from
-- anywhere holding the public key. So the only route is this function, and it
-- refuses on three counts:
--
--   * the row must be a vasooli_collection_list photo, so this can never be
--     turned on a patient document, a deposit slip or an invoice;
--   * it must have been uploaded by the person asking;
--   * a row uploaded by nobody (uploaded_by NULL) can be removed by nobody,
--     rather than by everybody.
--
-- It returns the storage path so the caller can drop the object afterwards.
-- The row goes first on purpose: the row is what makes a photo findable, so if
-- the object delete then fails the sheet has already stopped appearing, and
-- the leftover file is invisible rather than a list nobody can get rid of.
--
-- p_user_id is passed by the caller, which is the pattern the rest of this
-- application already runs on (submit_cash_handover, declare_opening_cash) --
-- these users are rows in "User", not Supabase Auth identities, so there is no
-- auth.uid() to read. It is an ownership rule, not a security boundary against
-- someone holding the key and willing to forge an id.

CREATE OR REPLACE FUNCTION public.delete_vasooli_list_photo(
  p_id UUID, p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner UUID; v_category TEXT; v_path TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before deleting a list photo';
  END IF;

  SELECT uploaded_by, category, storage_path
    INTO v_owner, v_category, v_path
    FROM file_uploads WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That list photo has already been removed';
  END IF;
  IF v_category IS DISTINCT FROM 'vasooli_collection_list' THEN
    RAISE EXCEPTION 'That file is not a collection list photo';
  END IF;
  IF v_owner IS NULL OR v_owner <> p_user_id THEN
    RAISE EXCEPTION 'Only the person who took this photo can remove it';
  END IF;

  DELETE FROM file_uploads WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id, 'storagePath', v_path);
END $$;

REVOKE ALL ON FUNCTION public.delete_vasooli_list_photo(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_vasooli_list_photo(UUID, UUID) TO anon, authenticated;

DO $verify$
DECLARE
  v_mine UUID; v_other UUID; v_row UUID; v_ok BOOLEAN; v_res JSONB; v_left INT;
BEGIN
  SELECT id INTO v_mine  FROM "User" ORDER BY created_at LIMIT 1;
  SELECT id INTO v_other FROM "User" WHERE id <> v_mine ORDER BY created_at LIMIT 1;
  IF v_mine IS NULL OR v_other IS NULL THEN
    RAISE EXCEPTION 'ABORT: need two users to self-test ownership';
  END IF;

  -- (a) somebody else's photo is refused
  INSERT INTO file_uploads (file_name, file_url, file_type, file_size, storage_path,
                            category, patient_id, notes, uploaded_by)
  VALUES ('SELFTEST-VL-A.jpg', 'https://example.invalid/a.jpg', 'image/jpeg', 1,
          'vasooli-lists/SELFTEST-A', 'vasooli_collection_list', NULL, 'selftest', v_other)
  RETURNING id INTO v_row;
  v_ok := false;
  BEGIN
    PERFORM delete_vasooli_list_photo(v_row, v_mine);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_ok := (SQLERRM LIKE '%Only the person who took this photo%');
  END;
  IF NOT v_ok THEN
    DELETE FROM file_uploads WHERE id = v_row;
    RAISE EXCEPTION 'ABORT: one person deleted another person''s list photo';
  END IF;
  DELETE FROM file_uploads WHERE id = v_row;

  -- (b) an ownerless photo is deletable by nobody, not by anybody
  INSERT INTO file_uploads (file_name, file_url, file_type, file_size, storage_path,
                            category, patient_id, notes, uploaded_by)
  VALUES ('SELFTEST-VL-B.jpg', 'https://example.invalid/b.jpg', 'image/jpeg', 1,
          'vasooli-lists/SELFTEST-B', 'vasooli_collection_list', NULL, 'selftest', NULL)
  RETURNING id INTO v_row;
  v_ok := false;
  BEGIN
    PERFORM delete_vasooli_list_photo(v_row, v_mine);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'ABORT: an unattributed list photo was deletable';
  END IF;
  DELETE FROM file_uploads WHERE id = v_row;

  -- (c) a file of another kind is refused, even to its own uploader
  INSERT INTO file_uploads (file_name, file_url, file_type, file_size, storage_path,
                            category, patient_id, notes, uploaded_by)
  VALUES ('SELFTEST-VL-C.jpg', 'https://example.invalid/c.jpg', 'image/jpeg', 1,
          'uploads/SELFTEST-C', 'payment_proof', NULL, 'selftest', v_mine)
  RETURNING id INTO v_row;
  v_ok := false;
  BEGIN
    PERFORM delete_vasooli_list_photo(v_row, v_mine);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_ok := (SQLERRM LIKE '%not a collection list photo%');
  END;
  IF NOT v_ok THEN
    DELETE FROM file_uploads WHERE id = v_row;
    RAISE EXCEPTION 'ABORT: delete reached a file that is not a collection list';
  END IF;
  DELETE FROM file_uploads WHERE id = v_row;

  -- (d) my own photo goes, and hands back its storage path
  INSERT INTO file_uploads (file_name, file_url, file_type, file_size, storage_path,
                            category, patient_id, notes, uploaded_by)
  VALUES ('SELFTEST-VL-D.jpg', 'https://example.invalid/d.jpg', 'image/jpeg', 1,
          'vasooli-lists/SELFTEST-D', 'vasooli_collection_list', NULL, 'selftest', v_mine)
  RETURNING id INTO v_row;
  v_res := delete_vasooli_list_photo(v_row, v_mine);
  IF v_res->>'storagePath' <> 'vasooli-lists/SELFTEST-D' THEN
    RAISE EXCEPTION 'ABORT: the storage path was not returned for cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM file_uploads WHERE id = v_row) THEN
    RAISE EXCEPTION 'ABORT: the row survived its own delete';
  END IF;

  SELECT count(*) INTO v_left FROM file_uploads WHERE notes = 'selftest';
  IF v_left > 0 THEN
    DELETE FROM file_uploads WHERE notes = 'selftest';
    RAISE EXCEPTION 'ABORT: % self-test row(s) were left behind', v_left;
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
