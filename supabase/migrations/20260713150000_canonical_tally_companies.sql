-- Keep Tally company selection explicit and manual. This migration updates only
-- tally_config; no synced ledgers, vouchers, stock, reports, or logs are touched.
BEGIN;

-- Manual refresh remains the only sync trigger for every existing company.
UPDATE public.tally_config
SET auto_sync_enabled = false,
    updated_at = now()
WHERE auto_sync_enabled IS DISTINCT FROM false;

-- Correct known spelling/capitalisation variants without changing config IDs.
UPDATE public.tally_config
SET company_name = 'DRM Hope Hospital Pvt. Ltd.',
    updated_at = now()
WHERE regexp_replace(lower(trim(company_name)), '[^a-z0-9]+', '', 'g') = 'drmhopehospitalpvtltd';

UPDATE public.tally_config
SET company_name = 'Hope Pharmacy',
    is_active = true,
    auto_sync_enabled = false,
    updated_at = now()
WHERE regexp_replace(lower(trim(company_name)), '[^a-z0-9]+', '', 'g') = 'hopepharmacy';

-- These are the only supported Tally companies. Preserve legacy rows but keep
-- them inactive so historical company_id relationships remain intact.
UPDATE public.tally_config
SET is_active = false,
    auto_sync_enabled = false,
    updated_at = now()
WHERE regexp_replace(lower(trim(company_name)), '[^a-z0-9]+', '', 'g') NOT IN (
  'ayushmannagpurhospital',
  'drmhopehospitalpvtltd',
  'drmhopehospitalpvtltdayushmanhospital',
  'hopepharmacy'
)
AND is_active IS DISTINCT FROM false;

-- Add the fourth company once, using the same read-only Tally server.
INSERT INTO public.tally_config (
  company_name,
  server_url,
  is_active,
  auto_sync_enabled,
  sync_interval_minutes,
  hospital_id
)
SELECT
  'DRM Hope Hospital Pvt Ltd & Ayushman Hospital',
  'http://103.171.134.253:12040',
  true,
  false,
  30,
  null
WHERE NOT EXISTS (
  SELECT 1
  FROM public.tally_config
  WHERE regexp_replace(lower(trim(company_name)), '[^a-z0-9]+', '', 'g') =
        'drmhopehospitalpvtltdayushmanhospital'
);

COMMIT;
