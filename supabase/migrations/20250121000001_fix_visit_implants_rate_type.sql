-- =====================================================
-- Fix visit_implants rate_type constraint
-- Remove strict constraint to allow any rate type value
-- =====================================================

-- Drop the existing constraint on rate_type
ALTER TABLE visit_implants DROP CONSTRAINT IF EXISTS visit_implants_rate_type_check;

-- The column will now accept any text value for rate_type
-- This allows values like: 'private', 'non_nabh', 'nabh', 'private_fallback', etc.
