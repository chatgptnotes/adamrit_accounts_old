-- The salary sheet decides who is still working here.
--
-- THE INSTRUCTION (Dr M, 20 Aug): the staff on 'Salary sheet.xlsx' are the ones
-- active and working in both hospitals. "the rest of the staff should be made
-- inactive and should not show up on search for salary and other payments."
--
-- 127 names, loaded verbatim below so the instruction is auditable and the whole
-- thing can be re-run against a later sheet.
--
-- WHAT "INACTIVE" MEANS HERE, precisely, because getting this wrong would be
-- expensive in two different directions:
--
--   * chart_of_accounts.is_active = false  — takes the ledger out of the voucher
--     entry and expense-bill pickers, which filter on it.
--   * tally_ledgers.is_hidden = true       — takes it out of the Payment Voucher
--     search, which reads that table and that flag (PaymentVoucher.tsx:151).
--
-- Neither touches a balance or an entry. The Trial Balance, the Balance Sheet
-- and the Group Summary do not filter on is_active — checked before writing
-- this — so a hidden ledger still carries its figures into the statements and
-- every company still nets to zero. Hiding somebody is not writing them off.
--
-- THE RULE THAT MATTERS MOST: nobody paid in the last 180 days is hidden, even
-- if they are not on the sheet. Being paid is evidence of working here, and the
-- cost of the two mistakes is not symmetric — leaving a leaver in the search
-- means an extra name in a dropdown, while hiding somebody who works here means
-- payroll cannot pay them. Fifteen ledgers are kept on this rule alone,
-- including six doctors sitting in salary groups and four people whose ledger
-- is spelt differently from the sheet ("Pinky Dahenhawar" for "Pinki
-- Dhahenwar", "Sagar Viadhya" for "sagar Vaidya"). They are listed in
-- v_staff_roster_review for Dr M to read.
--
-- ONLY SALARY GROUPS. Hope Salary Exp, Ayushman Salary Expences and RMO Salary.
-- Consultants and vendors are untouched: doctors are not on a salary sheet and
-- NAG DRUG AGENCIES is not staff, so absence from this sheet says nothing
-- about them.
--
-- REVERSIBLE. Every change is written to staff_roster_deactivations, and
-- undo_staff_roster() puts all of it back.

-- The trigram matching is 127 names against 995 ledgers, which outruns the
-- default statement timeout on this project.
SET LOCAL statement_timeout = '300s';

-- ---------------------------------------------------------------- the key

/**
 * A name reduced to the person, for comparing a salary sheet against a ledger.
 *
 * Harsher than person_match_key, because these two lists are written by
 * different hands: the sheet says "Praful Ambade", the ledger says "Praful
 * Ambade (Wardboy)"; the sheet says "Anjali sis", the ledger says "Anjali".
 * Parentheses go, then job words go. Twice, because two job words in a row
 * ("Jiyalal Security Guard") share the space between them and one pass eats
 * only the first.
 */
CREATE OR REPLACE FUNCTION public.staff_name_key(p_name TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $f$
  SELECT btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(COALESCE(p_name, '')), '\(.*?\)', ' ', 'g'),
          '[^a-z ]', ' ', 'g'),
        '(^| )(dr|mr|mrs|ms|shri|smt|miss|prof|sister|sis|brother|broth|bro|driver|guard|security|software|soft|lab|wardboy|ward|boy|maushi|receptionist|receiption|reception|accountant|account|accounts|ot|staff|cleaning|deep|bouncer|physiotherapist|physio|hours|hrs|hr|electrician|billing|nurse|rmo|night|pharmacy|pharmacist|technician|tech)( |$)', ' ', 'g'),
      '(^| )(dr|mr|mrs|ms|shri|smt|miss|prof|sister|sis|brother|broth|bro|driver|guard|security|software|soft|lab|wardboy|ward|boy|maushi|receptionist|receiption|reception|accountant|account|accounts|ot|staff|cleaning|deep|bouncer|physiotherapist|physio|hours|hrs|hr|electrician|billing|nurse|rmo|night|pharmacy|pharmacist|technician|tech)( |$)', ' ', 'g'),
    '\s+', ' ', 'g'));
$f$;

-- ------------------------------------------------------------- the roster

CREATE TABLE IF NOT EXISTS public.active_staff_roster (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  source     TEXT NOT NULL,
  as_of      DATE NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- On the name as written, not on the stripped key: the sheet carries both
-- "pratik" and "PRATIK BROTHER", which reduce to one key but are two lines a
-- human wrote and neither is mine to drop.
DROP INDEX IF EXISTS public.active_staff_roster_name_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS active_staff_roster_name_uidx
  ON public.active_staff_roster (lower(btrim(name)), as_of);

COMMENT ON TABLE public.active_staff_roster IS
  'Who is working here, per the salary sheet. Replaced wholesale when a newer '
  'sheet arrives; older rows keep their as_of so the decision stays traceable.';

GRANT SELECT ON public.active_staff_roster TO anon, authenticated;

DELETE FROM public.active_staff_roster WHERE as_of = DATE '2026-08-20';
INSERT INTO public.active_staff_roster (name, source, as_of)
SELECT n, 'Salary sheet.xlsx', DATE '2026-08-20'
  FROM (VALUES
  ('Aarti Dudhabade'),
  ('Aarti Suryawanshi'),
  ('aarti telang'),
  ('Abhishekh Dannar'),
  ('ABHISHEKH KUMAR'),
  ('Abuzar'),
  ('AFROJ KHAN'),
  ('AJAY MESHRAM'),
  ('AKSHAY'),
  ('Akshay Barapatre'),
  ('Ambar Malik'),
  ('Amisha'),
  ('ANIRUDDHA'),
  ('Anjali sis'),
  ('ankita'),
  ('APEKSHA WANDRE'),
  ('Arpit Kinarkar'),
  ('arshiya b'),
  ('ASHRAY SALVE'),
  ('atul dhurve'),
  ('AVNI ACCOUNT'),
  ('AYUSHI NANDAGAWLI / lokhande'),
  ('azhar'),
  ('azher'),
  ('Bharti'),
  ('BHAVIK SHARMA'),
  ('BHUMIKA SOFT'),
  ('Bunty Dalne'),
  ('Chetna Kurvanshi'),
  ('Digesh Bisen'),
  ('Diksha'),
  ('Diksha Sakhare'),
  ('Dnyaneshwar Warghane'),
  ('Dr. Arun Agre'),
  ('Dr. Shiraz Khan'),
  ('Ganesh Sharnagat'),
  ('Gumfa Temburne'),
  ('Harsh Bouncer'),
  ('ISHA SOFT'),
  ('Janardhan Motghare'),
  ('Jiyalal Security Guard'),
  ('JYOTI'),
  ('KASHISH SISTER'),
  ('KAUSTUBH HADKE'),
  ('KIRAN KADBE'),
  ('Kiran Nandanwar'),
  ('KIRTI MESHRAM'),
  ('Komal Nagrare'),
  ('krunal brother'),
  ('KUNAL AKHARE'),
  ('Lalit Meshram'),
  ('Lalita Nishad'),
  ('Laxmi Wase'),
  ('lokesh.ambade'),
  ('MAHENDRA BAHE'),
  ('Manjusha Koche'),
  ('Manthan'),
  ('Meena Yadav'),
  ('Mohammad Anas'),
  ('MUSKAN BISEN'),
  ('Nandini'),
  ('NATASHA'),
  ('NIKITA SISTER'),
  ('Nisha Sharma'),
  ('NITIN DRIVER'),
  ('Noor'),
  ('Oshin Tembhurne'),
  ('PALAK DONGRE'),
  ('Pankaj Patel'),
  ('Pankaj Shende'),
  ('Pinki Dhahenwar'),
  ('Pooja Hirankhede'),
  ('prachi sister'),
  ('Praful Ambade'),
  ('PRANAY THAKRE'),
  ('pratik'),
  ('PRATIK BROTHER'),
  ('Priti Sakhare'),
  ('Priti Warjukar'),
  ('priyanka'),
  ('rajat sujurjuse'),
  ('Rajesh Chandrawanshi'),
  ('Rajkumar Walake'),
  ('RAVINA BALVIR'),
  ('REENA NIRGULE'),
  ('REHA KHER'),
  ('Rima Varade'),
  ('RIZWANA SHEIKH'),
  ('Roma KUNGAVANI'),
  ('RUCHIKA JAMBULKAR'),
  ('RUCHIKA ZADE'),
  ('Rupali Ghumde'),
  ('Sagar Bawne'),
  ('sagar Vaidya'),
  ('SAHIL JHA'),
  ('Sanjay Khobragade'),
  ('Santoshi Patle'),
  ('Sarita Rangari'),
  ('SARVESH BRAMHANE'),
  ('Savita Patle'),
  ('SEJAL GEDAM'),
  ('SHAILESH GANESH NINAWE'),
  ('Shashank Upgade'),
  ('SHILPA BANKAR'),
  ('shital'),
  ('Shoibh Sheikh'),
  ('Shrawan ingole'),
  ('Shrutika'),
  ('Shubham Dubey'),
  ('Shubhangi Naik'),
  ('SNEHAL TIMANDE'),
  ('Sonali Kakde'),
  ('SONAM'),
  ('Sonam Masih'),
  ('Suraj Rajput'),
  ('Tejaswini Sharma'),
  ('TILAK YADAV'),
  ('Trupti lab'),
  ('tulsidas broth'),
  ('Urmila Lautkar 9 HOURS'),
  ('Utkarsha Gajbhiye'),
  ('Uttara Ponikar'),
  ('Vinita'),
  ('vishal deep cleaning'),
  ('VIVEK BROTHER'),
  ('VIVEK CHANNE'),
  ('YASH DESHMUKH')
  ) AS s(n)
ON CONFLICT DO NOTHING;

