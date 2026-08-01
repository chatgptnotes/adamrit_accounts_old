-- Letterhead lines for the Tally-style voucher print. Nothing else writes to
-- `companies`, so the addresses are seeded here; a company left NULL simply
-- prints its name with nothing under it.
alter table public.companies
  add column if not exists address_line1 text,
  add column if not exists address_line2 text;

update public.companies
   set address_line1 = 'Shreewardhan Complex, 3rd Floor, Ramdaspeth, Nagpur',
       address_line2 = 'Kamptee Road, Teka Naka, Nagpur'
 where company_name ilike '%drm hope%';
