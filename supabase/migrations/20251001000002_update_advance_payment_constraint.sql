-- Update advance_payment constraint to allow refund-only transactions
-- Created: 2025-10-01
-- Purpose: Allow advance_amount to be zero for refund-only transactions

-- Drop the old constraint that requires amount > 0
ALTER TABLE advance_payment
DROP CONSTRAINT IF EXISTS chk_advance_amount_positive;

-- Add new constraint that allows amount >= 0 (non-negative)
-- This supports:
-- 1. Advance payment: amount > 0
-- 2. Refund only: amount = 0
-- 3. Combined: amount > 0 with is_refund = true
ALTER TABLE advance_payment
ADD CONSTRAINT chk_advance_amount_non_negative
CHECK (advance_amount >= 0);

-- Success message
SELECT 'advance_payment constraint updated successfully - refund-only transactions now supported!' as status;
