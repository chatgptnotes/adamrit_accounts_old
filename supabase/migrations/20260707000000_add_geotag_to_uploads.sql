-- Geotag columns for in-app camera captures
ALTER TABLE public.file_uploads
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS gps_accuracy DECIMAL(8, 2),
  ADD COLUMN IF NOT EXISTS gps_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capture_source TEXT;

ALTER TABLE public.patient_documents
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS gps_accuracy DECIMAL(8, 2),
  ADD COLUMN IF NOT EXISTS gps_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capture_source TEXT;

ALTER TABLE public.pacs_images
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS gps_accuracy DECIMAL(8, 2),
  ADD COLUMN IF NOT EXISTS gps_captured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capture_source TEXT;

COMMENT ON COLUMN public.file_uploads.capture_source IS 'in_app_camera | file_picker';
COMMENT ON COLUMN public.patient_documents.capture_source IS 'in_app_camera | file_picker';
COMMENT ON COLUMN public.pacs_images.capture_source IS 'in_app_camera | file_picker';
