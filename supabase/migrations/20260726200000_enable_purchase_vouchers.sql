-- Enable expense accrual.
--
-- Decision taken 2026-07-26: expenses should accrue, so a supplier bill is
-- recorded when it arrives rather than when it is paid. That brings expenses
-- onto the same basis as income, which has accrued since the bill accrual went
-- live on 25 July.
--
-- Almost no new machinery is needed. VoucherEntry.tsx already offers Purchase
-- on F9 (line 130) and the voucher_types CHECK constraint already permits the
-- PURCHASE category - but no PURCHASE voucher type was ever seeded, so the
-- screen had nothing to save against. Supplier ledgers already exist too: the
-- Tally import brought across 353 accounts under Sundry Creditors.
--
-- The workflow this unlocks, both screens already built:
--
--   Supplier bill arrives   Purchase (F9)   Dr Expense ledger / Cr Supplier
--   Supplier paid           Payment (F5)    Dr Supplier / Cr Bank or Cash
--
-- Expenses then appear in the month the cost was incurred, and the amount owed
-- to suppliers shows on the balance sheet.

INSERT INTO public.voucher_types
  (voucher_type_code, voucher_type_name, voucher_category, prefix, current_number, is_active)
VALUES
  ('PUR', 'Purchase Voucher', 'PURCHASE', 'PUR', 0, true)
ON CONFLICT (voucher_type_code) DO NOTHING;
