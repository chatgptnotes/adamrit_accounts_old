-- Siddhant Bhowate works the pharmacy till, not Hope's.
--
-- Dr M: "siddhant bhowate, bhowatesiddhant@gmail.com, is a pharmacy cashier,
-- allow list". The allow-list half was already done this morning
-- (20260814330000) — that Gmail signs him in. What is new is WHERE he works,
-- and his full name.
--
-- HIS ROLE IS DELIBERATELY NOT CHANGED TO 'cashier', which is what "pharmacy
-- cashier" invites. Role 'pharmacist' is what grants the Pharmacy screens —
-- canSeePharmacy in App.tsx and the Pharmacy sidebar entry both list
-- pharmacist and neither lists cashier. Making him a cashier would take the
-- pharmacy away from a pharmacy cashier.
--
-- He does not need the role for the cash side either: he already opens Cash
-- Handover through the roster entry added this morning, and that is asserted
-- below rather than assumed.
--
-- WHAT DOES CHANGE is hospital_type, hope → pharmacy. This is the same field
-- that caused this morning's tangle: Farhan runs the pharmacy till, his record
-- said hope, and the Opening Cash tile took the counter from the record — so
-- his Rs 3,220 pharmacy count landed on Hope's counter, blocked Diksha, and
-- was swallowed by Hope's handover. The tile now asks which counter, but the
-- default still comes from here, and a default that is wrong every morning
-- will be wrong on the morning somebody is in a hurry.

DO $apply$
DECLARE v_id UUID; v_n INT;
BEGIN
  SELECT count(*) INTO v_n FROM public."User"
   WHERE lower(btrim(COALESCE(google_email, ''))) = 'bhowatesiddhant@gmail.com';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORT: % accounts hold that Gmail, not 1', v_n;
  END IF;

  SELECT id INTO v_id FROM public."User"
   WHERE lower(btrim(COALESCE(google_email, ''))) = 'bhowatesiddhant@gmail.com';

  UPDATE public."User"
     SET hospital_type = 'pharmacy',
         -- The name on a handover slip and in the cash reports should be the
         -- one his colleagues would recognise.
         full_name = 'Siddhant Bhowate',
         is_active = true
   WHERE id = v_id;
END
$apply$;

DO $verify$
DECLARE v_id UUID; v_role TEXT; v_hosp TEXT; v_name TEXT; v_g TEXT;
BEGIN
  SELECT id, role, hospital_type, full_name, google_email
    INTO v_id, v_role, v_hosp, v_name, v_g
    FROM public."User" WHERE lower(btrim(email)) = 'siddhanth@hope.com';

  IF v_hosp <> 'pharmacy' THEN
    RAISE EXCEPTION 'ABORT: his counter is % rather than pharmacy', v_hosp;
  END IF;
  IF v_name <> 'Siddhant Bhowate' THEN
    RAISE EXCEPTION 'ABORT: his name reads %', v_name;
  END IF;
  IF v_g <> 'bhowatesiddhant@gmail.com' THEN
    RAISE EXCEPTION 'ABORT: his sign-in address changed to %', COALESCE(v_g, 'NULL');
  END IF;

  -- The two things this migration must NOT have cost him.
  IF v_role <> 'pharmacist' THEN
    RAISE EXCEPTION 'ABORT: his role became % — that removes the Pharmacy screens', v_role;
  END IF;
  IF NOT can_use_cash_handover(v_id) THEN
    RAISE EXCEPTION 'ABORT: he lost Cash Handover';
  END IF;

  -- And the address still resolves to exactly him.
  IF (SELECT count(*) FROM public."User"
       WHERE COALESCE(is_active, true)
         AND (lower(btrim(email)) = 'bhowatesiddhant@gmail.com'
              OR lower(btrim(COALESCE(google_email, ''))) = 'bhowatesiddhant@gmail.com')) <> 1
  THEN RAISE EXCEPTION 'ABORT: that Gmail matches more than one active account'; END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
