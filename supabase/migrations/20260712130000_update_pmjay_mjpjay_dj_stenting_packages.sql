-- Reclassify the DJ-stenting / ureteric stent package set under Urology
-- and map the package surgeon to the urology consultant.

UPDATE public.pmjay_mjpjay_packages
SET
  category = 'Urology',
  updated_at = now()
WHERE id IN (
  'b1d13174-0f00-4db6-8130-2021a17c51b8',
  '201bc1a0-e91d-4e3c-9127-df77dfd2e1ff',
  '5e912148-55e3-4224-a7ed-a044d0e7d52d',
  'edf71e3c-5dc1-4cb4-a12a-168f289be9f9',
  '7861c059-2fda-4547-8ed8-ae6b5599880e',
  'cf28c964-77e1-4926-bb83-ddb0d1220322',
  '217f2cf6-aaea-4e41-9dcd-0c7c596eab15',
  'ec146396-39ea-4ad2-990e-74e26d85b410',
  'c6cd60a2-f5b3-4994-8f9d-d1ae894d0c2d'
);

UPDATE public.pmjay_mjpjay_package_surgeons
SET
  surgeon_id = '462b88f7-83ff-499a-9c01-08e246a7b586',
  surgeon_name = 'Dr. Jayant Nikose',
  surgeon_department = 'Urology'
WHERE package_id IN (
  'b1d13174-0f00-4db6-8130-2021a17c51b8',
  '201bc1a0-e91d-4e3c-9127-df77dfd2e1ff',
  '5e912148-55e3-4224-a7ed-a044d0e7d52d',
  'edf71e3c-5dc1-4cb4-a12a-168f289be9f9',
  '7861c059-2fda-4547-8ed8-ae6b5599880e',
  'cf28c964-77e1-4926-bb83-ddb0d1220322',
  '217f2cf6-aaea-4e41-9dcd-0c7c596eab15',
  'ec146396-39ea-4ad2-990e-74e26d85b410',
  'c6cd60a2-f5b3-4994-8f9d-d1ae894d0c2d'
);

NOTIFY pgrst, 'reload schema';
