-- Jagruti and Priyanka Tandekar are no longer billing executives. Deactivate
-- their seeded sentinel rows (synthetic @billing.adamrit.local emails created
-- by 20260613000000_seed_billing_executives.sql) so they stop appearing in the
-- Billing Executive dropdown. Real login accounts are not touched.

UPDATE public."User"
SET is_active = false
WHERE email LIKE '%@billing.adamrit.local'
  AND lower(coalesce(NULLIF(trim(full_name), ''), split_part(email, '@', 1))) IN ('jagruti', 'priyanka tandekar');
