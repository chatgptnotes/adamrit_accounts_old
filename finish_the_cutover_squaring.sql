-- Finish the cutover squaring, which stopped at the financial year boundary.
--
-- The squaring ran 2026-07-26 05:31 and cancelled 11,560 vouchers dated before
-- 25 July, on the basis that Tally's opening balances already contain that
-- period. 4,306 survived it, worth Rs 2,20,00,786.89, dated 15 Nov 2025 to
-- 25 March 2026.
--
-- That end date is the whole explanation. The squaring was run with a from-date
-- of 1 April 2026, so it cleared FY 2026-27 and left FY 2025-26 untouched.
-- Nothing is wrong with those vouchers; they were simply outside the window.
--
-- They are pre-cutover all the same, so they double-count against the opening
-- balances exactly as the 11,560 did, and the same answer applies. Cancelling
-- rather than deleting, so it reverses with one statement.
--
--   2026-01   1,385 vouchers   75,54,488.90
--   2026-02   1,290 vouchers   61,82,994.00
--   2026-03   1,159 vouchers   56,68,919.00
--   2025-12     401 vouchers   18,93,784.00
--   2025-11      71 vouchers    7,00,600.99
--
-- THE NINE ARE LEFT ALONE. Nine vouchers dated 22 to 24 July were created
-- today, after the squaring - late entry of payments actually received in
-- those days, worth Rs 4,196. Whether they belong to Tally depends on whether
-- Tally was told about them before the 24th, and only your accountant knows
-- that. They are listed rather than cancelled.
--
-- Marked distinctly from the first pass so the two are separable later.
--
-- TO UNDO:
--   UPDATE vouchers SET status = 'AUTHORISED', last_modified_by = NULL
--    WHERE last_modified_by = 'cutover-cleanup-fy2025';

CREATE TEMP TABLE fy2025_squared AS
SELECT v.id, v.voucher_number, v.voucher_date, v.total_amount
  FROM public.vouchers v
 WHERE v.status <> 'CANCELLED'
   AND v.voucher_date < DATE '2026-07-25'
   AND v.created_at < TIMESTAMPTZ '2026-07-26 05:31:13.949692+00';

UPDATE public.vouchers v
   SET status = 'CANCELLED',
       last_modified_by = 'cutover-cleanup-fy2025',
       updated_at = now()
  FROM fy2025_squared f
 WHERE v.id = f.id;
