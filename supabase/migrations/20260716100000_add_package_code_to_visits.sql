-- Store the package code alongside package_name for Advance Statement visits.
ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS package_code TEXT;

CREATE INDEX IF NOT EXISTS idx_visits_package_code ON visits(package_code);
