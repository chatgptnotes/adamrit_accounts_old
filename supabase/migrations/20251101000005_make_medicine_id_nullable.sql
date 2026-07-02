-- Migration: Make medicine_id nullable in medicine_batch_inventory table
-- Description: Allows batch inventory to exist without a medicine master record
-- Date: 2025-11-01

-- Make medicine_id nullable in medicine_batch_inventory table
ALTER TABLE public.medicine_batch_inventory
ALTER COLUMN medicine_id DROP NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.medicine_batch_inventory.medicine_id IS 'Reference to medicine master (optional - can be NULL for items not yet linked to medicine master)';
