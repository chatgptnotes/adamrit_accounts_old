-- Stores & Inventory: make stock movements atomic, and clear the sample data.
--
-- inventory_items and stock_transactions already exist, and so does 1,806
-- lines of inventory UI under components/operation-room/inventory. None of it
-- was ever mounted -- the components take their data as props and nothing
-- passed any. What was missing was the data layer, not the screens.
--
-- TWO THINGS THIS FIXES BEFORE THE SCREENS GO LIVE.
--
-- 1. A stock movement is two writes: the new level on the item, and the row in
--    the ledger that explains it. Done from the browser they can diverge --
--    two people issuing the same item at once both read 30, both write 25, and
--    five units vanish from the count while the ledger shows ten issued. This
--    does both inside one statement, under FOR UPDATE, and computes the
--    before/after itself so a caller cannot report a level it did not set.
--
-- 2. Every row in both tables is sample data. All 22 items and 15 movements
--    were written on 2025-06-13 by
--    20250613130001_insert_operation_theatre_sample_data.sql and never touched
--    again -- "Forceps (Straight)" from "Surgical Instruments Ltd", movements
--    performed by "System Auto". Opening a stores module onto invented stock
--    is worse than opening it onto nothing: somebody orders against it.
--
--    Backed up rather than dropped, following opening_balance_backup_20260804
--    and grn_items_rate_backup_20260807. If any of it turns out to be real it
--    can be put back.

CREATE TABLE IF NOT EXISTS public.inventory_sample_backup_20260816 AS
  SELECT * FROM public.inventory_items;
CREATE TABLE IF NOT EXISTS public.stock_txn_sample_backup_20260816 AS
  SELECT * FROM public.stock_transactions;

DO $purge$
DECLARE v_items INT; v_txns INT; v_kept INT;
BEGIN
  -- Only the sample rows, identified by the day the sample migration ran.
  -- Anything entered since is real and stays.
  DELETE FROM public.stock_transactions
   WHERE created_at::date = DATE '2025-06-13';
  GET DIAGNOSTICS v_txns = ROW_COUNT;

  DELETE FROM public.inventory_items
   WHERE created_at::date = DATE '2025-06-13';
  GET DIAGNOSTICS v_items = ROW_COUNT;

  SELECT count(*) INTO v_kept FROM public.inventory_items;
  RAISE NOTICE 'Removed % sample item(s) and % sample movement(s); % real item(s) remain',
    v_items, v_txns, v_kept;
END
$purge$;

-- One movement, one statement.
--
-- SECURITY INVOKER deliberately: both tables carry authenticated-only policies,
-- and this must be refused for anybody the database does not recognise rather
-- than quietly running as its owner.
CREATE OR REPLACE FUNCTION public.record_stock_movement(
  p_item_id UUID,
  p_quantity_change NUMERIC,
  p_transaction_type TEXT DEFAULT 'adjustment',
  p_notes TEXT DEFAULT NULL,
  p_performed_by TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_prev NUMERIC; v_new NUMERIC; v_cost NUMERIC; v_name TEXT;
BEGIN
  IF p_quantity_change IS NULL OR p_quantity_change = 0 THEN
    RAISE EXCEPTION 'Enter how many are coming in or going out';
  END IF;
  -- stock_transactions_transaction_type_check allows exactly these five. A
  -- caller sending anything else fails on the constraint AFTER the stock level
  -- has been recalculated, so it is refused here first, with a readable reason.
  IF COALESCE(NULLIF(btrim(p_transaction_type), ''), 'adjustment')
     NOT IN ('addition', 'consumption', 'adjustment', 'expiry', 'return') THEN
    RAISE EXCEPTION 'Movement type must be addition, consumption, adjustment, expiry or return (got %)',
      p_transaction_type;
  END IF;

  -- FOR UPDATE is the whole point: it holds the row while the level is
  -- recalculated, so two people issuing at once queue instead of overwriting.
  SELECT current_stock, unit_cost, name INTO v_prev, v_cost, v_name
    FROM inventory_items WHERE id = p_item_id FOR UPDATE;
  IF v_prev IS NULL THEN
    RAISE EXCEPTION 'No such stock item';
  END IF;

  v_new := v_prev + p_quantity_change;
  IF v_new < 0 THEN
    RAISE EXCEPTION 'Only % of % in stock — cannot issue %',
      v_prev, v_name, abs(p_quantity_change);
  END IF;

  UPDATE inventory_items
     SET current_stock = v_new,
         updated_at = now(),
         last_restocked = CASE WHEN p_quantity_change > 0 THEN now() ELSE last_restocked END
   WHERE id = p_item_id;

  INSERT INTO stock_transactions (
    inventory_item_id, transaction_type, quantity_change,
    previous_stock, new_stock, unit_cost, total_cost, notes, performed_by
  ) VALUES (
    p_item_id, COALESCE(NULLIF(btrim(p_transaction_type), ''), 'adjustment'), p_quantity_change,
    v_prev, v_new, v_cost, abs(p_quantity_change) * COALESCE(v_cost, 0),
    NULLIF(btrim(COALESCE(p_notes, '')), ''), NULLIF(btrim(COALESCE(p_performed_by, '')), '')
  );

  RETURN jsonb_build_object('previousStock', v_prev, 'newStock', v_new, 'name', v_name);
END $$;

GRANT EXECUTE ON FUNCTION public.record_stock_movement(UUID, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

DO $verify$
DECLARE v_id UUID; v_res JSONB; v_stock NUMERIC; v_txns INT; v_left INT;
BEGIN
  -- The sample rows must be gone, and safe in the backup.
  SELECT count(*) INTO v_left FROM public.inventory_items WHERE created_at::date = DATE '2025-06-13';
  IF v_left > 0 THEN RAISE EXCEPTION 'ABORT: % sample item(s) survived', v_left; END IF;
  IF (SELECT count(*) FROM public.inventory_sample_backup_20260816) < 1 THEN
    RAISE EXCEPTION 'ABORT: the backup is empty, so the delete was not reversible';
  END IF;

  -- Prove the movement is atomic and self-computing, then roll it back.
  BEGIN
    INSERT INTO inventory_items (name, category, current_stock, min_stock_level,
      max_stock_level, unit_cost, supplier, sterilization_required)
    VALUES ('SELFTEST Item', 'consumables', 10, 2, 50, 7, 'SELFTEST', false)
    RETURNING id INTO v_id;

    v_res := public.record_stock_movement(v_id, 5, 'addition', 'selftest in', 'verify');
    SELECT current_stock INTO v_stock FROM inventory_items WHERE id = v_id;
    IF v_stock <> 15 OR (v_res->>'newStock')::NUMERIC <> 15 THEN
      RAISE EXCEPTION 'ABORT: receiving 5 into 10 gave % (rpc said %)', v_stock, v_res->>'newStock';
    END IF;

    PERFORM public.record_stock_movement(v_id, -3, 'consumption', 'selftest out', 'verify');
    SELECT current_stock INTO v_stock FROM inventory_items WHERE id = v_id;
    IF v_stock <> 12 THEN RAISE EXCEPTION 'ABORT: issuing 3 from 15 gave %', v_stock; END IF;

    SELECT count(*) INTO v_txns FROM stock_transactions WHERE inventory_item_id = v_id;
    IF v_txns <> 2 THEN RAISE EXCEPTION 'ABORT: % ledger row(s) for 2 movements', v_txns; END IF;

    -- Issuing more than exists must be refused, not allowed to go negative.
    BEGIN
      PERFORM public.record_stock_movement(v_id, -99, 'consumption', 'selftest over', 'verify');
      RAISE EXCEPTION 'ABORT: stock was allowed to go negative';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM LIKE 'ABORT:%' THEN RAISE; END IF;
    END;

    RAISE EXCEPTION 'rollback_selftest';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'rollback_selftest' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM inventory_items WHERE supplier = 'SELFTEST') THEN
    RAISE EXCEPTION 'ABORT: the self-test item was left behind';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
