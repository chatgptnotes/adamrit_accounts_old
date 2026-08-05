-- Fix from the 6-Aug RPC test sweep: expense_bills.document_path/url return
-- to nullable. The 20260728 hardening assumed every bill arrives through the
-- tablet Expense Bills flow with its invoice photo attached; the new counter
-- tiles (Spot, Diagnostics, Quick Pay, Tilak's mini-form) legitimately raise
-- bills without a document and were crashing on a raw 23502 NOT NULL
-- violation. Screens that need a photo still demand one in their UI (the
-- implant tile now hard-requires the calc sheet before a referred approval).
--
-- Applied automatically via apply_migration.

ALTER TABLE public.expense_bills
  ALTER COLUMN document_path DROP NOT NULL,
  ALTER COLUMN document_url DROP NOT NULL;
