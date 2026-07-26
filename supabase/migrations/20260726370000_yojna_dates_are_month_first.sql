-- The Yojna bill dates are month-first. Read them that way.
--
-- I read date_of_invoice as dd-mm-yyyy and reported bills dated into December
-- 2026. The invoice numbers said otherwise: MJPJAY-JUL-003 came out as
-- 7 September, PM-JAY-MAY-014 as 5 November. Read mm-dd-yyyy they are 9 July
-- and 11 May, matching the month written into the number every time.
--
-- WHY IT IS NOT A STRAIGHT SWAP. to_date does not reject an impossible month:
-- to_date('17-12-2026', 'MM-DD-YYYY') does not fail, it rolls 17 months forward
-- and returns a date in 2027. So reading everything month-first would turn the
-- handful of rows that can only be day-first into silent nonsense - worse than
-- the bug being fixed, because nothing would look wrong.
--
-- So: month-first, which is the format; but where the first number cannot be a
-- month and the second can, that string is only readable one way and is read
-- that way. Where neither works, NULL, so a trigger falls through to its other
-- dates rather than raising.
--
-- WHAT THIS ALSO CORRECTS. Any Yojna voucher already posted carries a date
-- from the old reading. Fixing the parser without re-dating them would leave
-- the parser right and the books wrong, so they are corrected below and listed.

CREATE OR REPLACE FUNCTION public.parse_bill_date(p_text TEXT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_in    TEXT := NULLIF(btrim(COALESCE(p_text, '')), '');
  v_parts TEXT[];
  v_first INT;
  v_secnd INT;
  v_year  INT;
BEGIN
  IF v_in IS NULL THEN
    RETURN NULL;
  END IF;

  v_parts := regexp_match(v_in, '^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$');

  IF v_parts IS NOT NULL THEN
    v_first := v_parts[1]::INT;
    v_secnd := v_parts[2]::INT;
    v_year  := v_parts[3]::INT;

    -- The format the bill pages write: month first.
    IF v_first BETWEEN 1 AND 12 AND v_secnd BETWEEN 1 AND 31 THEN
      BEGIN RETURN make_date(v_year, v_first, v_secnd);
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

    -- A first number above 12 cannot be a month, so that string is only
    -- readable day-first. make_date raises on a real impossibility rather
    -- than rolling over, which is why it is used instead of to_date.
    IF v_secnd BETWEEN 1 AND 12 AND v_first BETWEEN 1 AND 31 THEN
      BEGIN RETURN make_date(v_year, v_secnd, v_first);
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

    RETURN NULL;
  END IF;

  BEGIN RETURN v_in::DATE; EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
END;
$$;

COMMENT ON FUNCTION public.parse_bill_date(TEXT) IS
  'Reads a bill date held as text. Month-first, which is what the bill pages '
  'write; day-first only where the first number cannot be a month. Returns '
  'NULL rather than raising, so a bad date never blocks a save.';

-- Re-date the Yojna vouchers posted under the old reading. Only the header
-- date moves; no amount, ledger or entry is touched.
UPDATE public.vouchers v
   SET voucher_date = c.correct_date,
       last_modified_by = 'yojna-date-reparsed',
       updated_at = now()
  FROM (
    SELECT 'YOJNA-' || y.id::TEXT AS reference,
           COALESCE(public.parse_bill_date(y.date_of_invoice::TEXT),
                    public.parse_bill_date(y.date_of_discharge::TEXT)) AS correct_date
      FROM public.yojna_bills y
  ) c
 WHERE v.reference_number = c.reference
   AND c.correct_date IS NOT NULL
   AND v.voucher_date IS DISTINCT FROM c.correct_date;
