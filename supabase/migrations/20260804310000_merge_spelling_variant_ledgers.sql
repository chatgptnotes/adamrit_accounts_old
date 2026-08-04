-- Merge the spelling-variant ledgers Ruby approved (4-Aug PDF review).
--
-- 23 of the 26 suspected groups from "Suspected Duplicate Ledgers
-- 4-Aug-2026.pdf" — everything except the Swapnil Kale / Swapnil Kamble
-- pairs (possibly two different people) and the Medicine 12%/18% GST pair.
--
-- Each group is pinned by ledger id, so exactly what was reviewed is what
-- merges. The survivor is chosen per group by the audited policy — most
-- transactions, then a Tally opening balance, then the older row — and the
-- others fold into it via merge_ledger() (transactions, references and
-- opening balances move; losers stay as inactive "(merged …)" stubs).
--
-- Run in the Supabase dashboard SQL Editor. Safe to run twice.

BEGIN;

DO $$
DECLARE
  grp    uuid[];
  member uuid;
  v_survivor uuid;
  v_merged   integer := 0;
  groups CONSTANT uuid[][] := ARRAY[
  -- Dr. Ashnwin Chinchkhede [TL5a9cc009vfu3n] / DR. ASHWIN CHICHKHEDE [TL5a9cc01t88p1n]
    ARRAY['538171cf-ffd7-49cd-a7ea-f4263fe7e413', 'bb7e1a8a-e335-4995-9fd6-f6e803c69c8a'],
  -- Ashvini Burade [TL5a9cc00pm5pku] / Ashwini Burade [TL5a9cc011eqeyh]
    ARRAY['4ce70872-6273-416d-866e-7745c9db4879', 'd0d1b9ce-c33a-40d6-89c4-82949c8815ba'],
  -- Bhupendra Balapure [TL5a9cc00hg6ngm] / Bhupendra Belapure [TL5a9cc0133ziqa]
    ARRAY['dba0f87b-a42d-4914-9e27-add3753ef8d1', '1c06d75d-1af3-4f09-849e-a5f7ace50783'],
  -- Dr. Rashika Akulwar [TL5a9cc016p6jsj] / Dr. Rasika Akulwar [TL5a9cc013ensgl]
    ARRAY['28e7e061-ac24-4211-8df3-a62aea223ab7', 'b44136c3-238a-45c9-a283-605bc90c8649'],
  -- DR RUPESH BHANGDE [TL5a9cc00ixuaa1] / DR RUPESH BHANGE [TL5a9cc00spkuh5]
    ARRAY['ae9f5845-9e90-459d-ab13-02c56a32ef45', '7a285e2a-299a-41b2-97fb-67454b2dbac9'],
  -- Shri Vithal Ads [TL5a9cc01qfuxun] / Shri Vitthal Ads [TL5a9cc00x1z6er]
    ARRAY['8daa84f7-3121-48c5-a802-3c390f617519', 'dc005a19-65a3-46d3-b33f-b764bc6d5e93'],
  -- Dr. Rasika Akulwar [TLd718b113ensgl] / Rasika  Akulwar [TLd718b11a834r1]
    ARRAY['0de89a2e-ea6a-43e6-8edf-0f99c533c65d', '3e3f5d99-e6b0-481c-8daf-ada3d4cdf7ec'],
  -- Shri Computer [TLd718b10pq3uso] / Computer [TLd718b11nrg5a0]
    ARRAY['b89c4dd4-fb04-46c5-a8f1-aea3015b4c5e', 'ec3a6287-4055-4e27-a60d-ee1e3890f678'],
  -- Air Conditioner [TLd718b105ylf7d] / Air Conditioner (AC) [TLd718b10lglx88]
    ARRAY['650aace2-f33e-4f36-8f3c-6f63b63c6347', '46c8384d-997a-46aa-89fc-b03bb0502e07'],
  -- Dr. Ashnwin Chinchkhede [TLd718b109vfu3n] / DR. ASHWIN CHICHKHEDE [TLd718b11t88p1n]
    ARRAY['1d030375-e580-408c-a3c6-65d611f3713d', 'af295133-19c9-47e5-a3da-67e6c9931aea'],
  -- Ashvini Burade [TLd718b10pm5pku] / Ashwini Burade [TLd718b111eqeyh]
    ARRAY['37555c9f-7660-432e-b8db-41c6c03f3fb9', 'd4f141f1-da30-47fe-8753-94cb91528b26'],
  -- Bhupendra Balapure [TLd718b10hg6ngm] / Bhupendra Belapure [TLd718b1133ziqa]
    ARRAY['12daad9c-2eb5-4322-8c31-f04e80612be8', '34aaca5e-3acd-43c5-888b-85523a3947d7'],
  -- Dr. Rashika Akulwar [TLd718b116p6jsj] / Dr. Rasika Akulwar [TLd718b113ensgl]
    ARRAY['ce03e860-1cc1-43c9-a142-c95be69c43ac', '0de89a2e-ea6a-43e6-8edf-0f99c533c65d'],
  -- Dr. Rashika Akulwar [TLd718b116p6jsj] / Rasika  Akulwar [TLd718b11a834r1]
    ARRAY['ce03e860-1cc1-43c9-a142-c95be69c43ac', '3e3f5d99-e6b0-481c-8daf-ada3d4cdf7ec'],
  -- Shri Vithal Ads [TLd718b11qfuxun] / Shri Vitthal Ads [TLd718b10x1z6er]
    ARRAY['50996b31-6ff0-4816-8b9d-85c0b7b1d662', '5a285674-7606-43f7-a535-5caee48acf06'],
  -- Dr. Ashnwin Chinchkhede [DRMFRESH_000433] / DR. ASHWIN CHICHKHEDE [DRMFRESH_000434]
    ARRAY['5343e7eb-028c-4ccf-b717-27d7efddc759', '2b0791fe-6786-42cc-a129-03d8614537cf'],
  -- Bhupendra Balapure [DRMFRESH_000268] / Bhupendra Belapure [DRMFRESH_000269]
    ARRAY['e69d8974-15e7-4a7d-9e30-b14fc0aad0d0', 'd253a256-5af5-4ba3-a511-a1e490d4be05'],
  -- Center Point Hotel [DRMFRESH_000299] / CENTRE POINT HOTEL [DRMFRESH_000302]
    ARRAY['d41b300d-708d-4182-b7ad-c6e0b2765cfc', '016384bb-d62d-4bd6-803e-246dad3a5ff1'],
  -- ICICI Lombard General Insurance [1445] / ICICI Lomberd General Insurance [DRMFRESH_000714]
    ARRAY['e7e4fef2-5786-4b74-806e-b2e9b5bea994', 'bf588076-dcf1-4f65-8a25-fd138ffda516'],
  -- Pradhan Mantri Janaaroghya Yojana (PMJAY) [DRMFRESH_001183] / Pradhan Mantri Jan Arogya Yojana (PMJAY) [1411]
    ARRAY['18573197-56da-455e-9bda-d8702065bb6c', '6c1d0115-30e5-4b15-8e6f-5c015abb8157'],
  -- Priyanka Tembhurn (Maushi) [DRMFRESH_001249] / PRIYANKA TEMBURNE (MAUSHI) [DRMFRESH_001250]
    ARRAY['a477c1ee-4e87-4de1-b051-d5c94e03ddf0', '7dfabd01-b1ef-4794-8d9d-4e00a44b6c68'],
  -- South East Central Railway (SECR) [DRMFRESH_001640] / South Eastern Central Railway (SECR) [1431]
    ARRAY['749e0034-e6ca-4cc3-a67c-016530fe6e8b', '693556a3-4d91-43ff-8126-23a523d9165e'],
  -- Tds Receivable AY 23-24 [DRMFRESH_001727] / Tds Receivable F Y 23-24 [DRMFRESH_001728]
    ARRAY['3cbfe8c1-c4e5-48bb-8f17-d557648d027f', '4461fecc-b862-43a3-b1d0-27f3fd74d8b6']  ];
BEGIN
  FOR i IN 1 .. array_length(groups, 1) LOOP
    grp := ARRAY(SELECT groups[i][j] FROM generate_subscripts(groups, 2) j WHERE groups[i][j] IS NOT NULL);

    SELECT a.id INTO v_survivor
      FROM public.chart_of_accounts a
      LEFT JOIN LATERAL (
        SELECT count(*) AS entries FROM public.voucher_entries e WHERE e.account_id = a.id
      ) tx ON true
     WHERE a.id = ANY(grp) AND a.is_active
     ORDER BY tx.entries DESC,
              (COALESCE(a.opening_balance, 0) <> 0) DESC,
              a.created_at ASC NULLS LAST,
              a.account_code ASC
     LIMIT 1;
    CONTINUE WHEN v_survivor IS NULL;   -- whole group already merged

    FOREACH member IN ARRAY grp LOOP
      IF member <> v_survivor
         AND EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE id = member AND is_active) THEN
        PERFORM public.merge_ledger(member, v_survivor);
        v_merged := v_merged + 1;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Merged % spelling-variant ledger(s)', v_merged;
END $$;

-- The approved names, after: expect one active ledger per party per company.
SELECT c.company_name, a.account_name, a.account_code, a.is_active
  FROM public.chart_of_accounts a
  LEFT JOIN public.companies c ON c.id = a.company_id
 WHERE a.account_name ~* 'chichkhede|chinchkhede|burade|b[ae]lapure|akulwar|bhang[d]?e|vit+hal ads|centre? point hotel|lomb[ae]rd|priyanka temb|central railway|jan[a]*ar[o]*g|shri computer|air conditioner|tds receivable'
 ORDER BY c.company_name, a.account_name;

COMMIT;
