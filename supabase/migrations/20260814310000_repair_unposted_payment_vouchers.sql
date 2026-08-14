-- Put back the four payment vouchers the mobile rule threw away.
--
-- WHAT HAPPENED
--
-- Party-mobile enforcement was switched on at 10:30 UTC today. Between then
-- and 12:15 UTC, four payment vouchers were entered and none of them reached
-- the books.
--
-- The mechanism is worse than a refusal, and worth writing down so it is not
-- repeated. A payment voucher is written in two transactions: the header
-- first, then the lines. Posting to the ledger hangs off an AFTER INSERT
-- trigger on payment_voucher_lines. The enforcement check is a DEFERRED
-- constraint trigger, so it fires at COMMIT -- by which time the ledger
-- voucher has been written inside that same transaction. It raised, and
-- postgres rolled back the whole of the second transaction: the lines, and the
-- ledger voucher with them. The header, already committed, survived.
--
-- So the cashier saw the voucher appear in Previous Vouchers exactly as
-- always, and nothing at all reached the Day Book. Silent. A refusal that
-- announces itself is an inconvenience; one that leaves a plausible-looking
-- record and quietly drops the money is a different thing entirely, and it is
-- the reason enforcement is now off.
--
-- Patient receipts in the same window were unaffected -- REC2355 and REC2356
-- posted normally, because patient ledgers carry mobile numbers and the fill
-- trigger stamped them. Only payments against expense heads, which have none,
-- were lost.
--
-- WHAT THIS DOES
--
-- Re-inserts the one missing line on each of the four, which re-fires
-- post_one_payment_voucher exactly as the screen would have. Nothing here
-- writes to the ledger directly: the repair goes through the same rail as a
-- normal entry, so a voucher restored by this script is indistinguishable from
-- one entered by hand.
--
-- The ledger is resolved by name from the header (person_name is the expense
-- head; account_ledger_name is the cash side), scoped to the voucher's own
-- company. Idempotent: a voucher that already has lines or an already-posted
-- ledger entry is skipped, so this cannot double-post.

DO $repair$
DECLARE
  v_pv RECORD;
  v_ledger UUID;
  v_company UUID;
  v_done INT := 0;
  v_skipped INT := 0;
BEGIN
  IF COALESCE((SELECT enforced FROM voucher_party_mobile_settings WHERE id), false) THEN
    RAISE EXCEPTION 'ABORT: enforcement is still on — the repair would be rolled back exactly as the originals were';
  END IF;

  FOR v_pv IN
    SELECT pv.id, pv.voucher_no, pv.person_name, pv.amount, pv.hospital_type
      FROM payment_vouchers pv
     WHERE pv.voucher_no IN ('PV-20260814-013', 'PV-20260814-015',
                             'PV-20260814-016', 'PV-20260814-017')
  LOOP
    -- Already whole? Leave it alone. Re-running must never double-post.
    IF EXISTS (SELECT 1 FROM payment_voucher_lines WHERE voucher_id = v_pv.id)
       OR EXISTS (SELECT 1 FROM vouchers WHERE reference_number = 'PV-' || v_pv.id::text) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- payment_voucher_lines.ledger_id points at tally_ledgers, and five
    -- different companies each have a ledger called "Petrol Expenses" -- which
    -- is why the desk has been picking whichever the dropdown offered, two
    -- different ones on the same afternoon.
    --
    -- It does not affect the accounting: post_one_payment_voucher resolves the
    -- posting by ledger NAME into the company derived from hospital_type
    -- (adamrit_ledger_by_name), and never reads this id. It is a label on the
    -- line. So the correct one is simply the one belonging to this voucher's
    -- own hospital, which is what is chosen here rather than copying whatever
    -- the previous voucher happened to hit.
    SELECT tc.id INTO v_company
      FROM tally_config tc
     WHERE lower(btrim(COALESCE(tc.hospital_id, ''))) = lower(btrim(v_pv.hospital_type))
     ORDER BY tc.is_active DESC, tc.updated_at DESC
     LIMIT 1;

    SELECT tl.id INTO v_ledger
      FROM tally_ledgers tl
     WHERE tl.company_id = v_company
       AND lower(btrim(tl.name)) = lower(btrim(v_pv.person_name))
     ORDER BY tl.created_at
     LIMIT 1;

    IF v_ledger IS NULL THEN
      RAISE EXCEPTION 'ABORT: no tally ledger named "%" for hospital % (%)',
        v_pv.person_name, v_pv.hospital_type, v_pv.voucher_no;
    END IF;

    INSERT INTO payment_voucher_lines (voucher_id, ledger_id, ledger_name, amount, line_order)
    VALUES (v_pv.id, v_ledger, v_pv.person_name, v_pv.amount, 0);

    v_done := v_done + 1;
  END LOOP;

  RAISE NOTICE 'Repaired %, skipped % already whole', v_done, v_skipped;
END
$repair$;

DO $verify$
DECLARE
  v_no TEXT; v_id UUID; v_missing TEXT := ''; v_amt NUMERIC; v_posted NUMERIC;
  v_list CONSTANT TEXT[] := ARRAY['PV-20260814-013', 'PV-20260814-015',
                                  'PV-20260814-016', 'PV-20260814-017'];
BEGIN
  FOREACH v_no IN ARRAY v_list LOOP
    SELECT id, amount INTO v_id, v_amt FROM payment_vouchers WHERE voucher_no = v_no;

    -- (a) it must now exist in the ledger at all
    IF NOT EXISTS (SELECT 1 FROM vouchers WHERE reference_number = 'PV-' || v_id::text) THEN
      v_missing := v_missing || ' ' || v_no;
      CONTINUE;
    END IF;

    -- (b) and for the right money. A voucher that posted the wrong amount
    --     would be worse than one that never posted, because it looks fine.
    SELECT v.total_amount INTO v_posted
      FROM vouchers v WHERE v.reference_number = 'PV-' || v_id::text;
    IF round(COALESCE(v_posted, 0), 2) <> round(v_amt, 2) THEN
      RAISE EXCEPTION 'ABORT: % posted % against a voucher of %', v_no, v_posted, v_amt;
    END IF;

    -- (c) and balanced, which is the whole point of a day book
    IF (SELECT round(sum(ve.debit_amount) - sum(ve.credit_amount), 2)
          FROM voucher_entries ve
          JOIN vouchers v ON v.id = ve.voucher_id
         WHERE v.reference_number = 'PV-' || v_id::text) <> 0 THEN
      RAISE EXCEPTION 'ABORT: % posted unbalanced', v_no;
    END IF;
  END LOOP;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'ABORT: still not in the books:%', v_missing;
  END IF;

  -- Exactly one ledger voucher each. Two would be a double payment.
  IF EXISTS (
    SELECT 1 FROM payment_vouchers pv
     WHERE pv.voucher_no = ANY (v_list)
       AND (SELECT count(*) FROM vouchers WHERE reference_number = 'PV-' || pv.id::text) <> 1
  ) THEN
    RAISE EXCEPTION 'ABORT: a voucher posted more than once';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
