  -- Seed the curated billing-executive names into the User table so the
  -- "Billing Executive" dropdown on the Advance Payment dialog has them backed by
  -- real Supabase rows (the frontend also keeps them as a base list). New billing
  -- executives added to the User table later show up in the dropdown automatically.
  --
  -- Each curated name is seeded once per hospital_type, and ONLY when no active
  -- user with that display name already exists for that hospital (so we don't
  -- duplicate people like Nisha / Diksha who are already in the table).
  -- These rows use a non-login sentinel password and a synthetic, unreachable
  -- email, so they cannot be used to authenticate.

  ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS full_name text;
  ALTER TABLE public."User" ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

  INSERT INTO public."User" (email, password, role, hospital_type, full_name, is_active)
  SELECT
    lower(replace(n.name, ' ', '.')) || '.' || h.htype || '@billing.adamrit.local',
    'no_login_billing_executive',
    'user',
    h.htype,
    n.name,
    true
  FROM (VALUES
    ('Chetna'), ('Arpit'), ('Akshay'), ('Shohib'), ('Nisha'), ('Diksha'),
    ('Pragati'), ('Jagruti'), ('Abhishekh'), ('Priyanka Tandekar'), ('Sailesh')
  ) AS n(name)
  CROSS JOIN (VALUES ('hope'), ('ayushman')) AS h(htype)
  WHERE NOT EXISTS (
    SELECT 1 FROM public."User" u
    WHERE u.hospital_type = h.htype
      AND lower(coalesce(NULLIF(trim(u.full_name), ''), split_part(u.email, '@', 1))) = lower(n.name)
  )
  ON CONFLICT (email) DO NOTHING;
