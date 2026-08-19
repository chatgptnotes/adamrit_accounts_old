-- Keep Rs 5,000 in every bank account for emergencies.
--
-- THE INSTRUCTION (19 Aug, Dr M): "Do not make expenses so much that the balance
-- in bank accounts are less than 5000. we need this amount always for
-- emergencies" — and, on whether the software should enforce it: "yes".
--
-- READ THIS BEFORE SWITCHING IT ON. The rule is built and it works. It is also
-- switched OFF, because the balances it would judge are not currently the
-- balances in the bank:
--
--   DRM Hope   Canara Bank Jaripatka        -30,44,341.72
--   DRM Hope   STATE BANK OF INDIA           -7,81,224.16
--   Ayushman   STATE BANK OF INDIA (MURALI)  -2,30,000.00
--   DRM Hope   Saraswat Bank                   -25,650.00
--   Ayushman   Pusad Urban Co-Operative         -6,900.00
--   ...and eight more sitting at exactly 0.00
--
-- A bank account cannot hold minus thirty lakh rupees. Those figures are what
-- the ledger has been told, not what the bank holds: receipts posted elsewhere,
-- opening balances not carried across at the 25-Jul cutover, or entries that
-- live in Tally and never reached voucher_entries. Switching the rule on against
-- them would refuse every payment in the group from the first attempt, and would
-- be refusing on the strength of numbers that are wrong.
--
-- So: the machinery is here, the floor is Rs 5,000, and the switch is off. It
-- becomes useful the day the bank ledgers agree with the bank statements —
-- which is what the Reconciliation screen exists to do. Turn it on with
--
--   UPDATE public.bank_floor_settings SET enforced = true WHERE id;
--
-- PER ACCOUNT, not per group. "the balance in bank accounts" reads as each
-- account, which is the stricter meaning and the one Dr M approved in the
-- cleaned-up sentence. Ayushman alone has nine bank accounts, so the two
-- readings are far apart; if the group total was meant, this is the line to
-- change.

CREATE TABLE IF NOT EXISTS public.bank_floor_settings (
  id         BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  enforced   BOOLEAN NOT NULL DEFAULT false,
  floor_amount NUMERIC(14,2) NOT NULL DEFAULT 5000 CHECK (floor_amount >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.bank_floor_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.bank_floor_settings IS
  'The emergency floor every bank account must keep. enforced=false means the '
  'rule is built but not applied — see 20260819310000 for why it ships off.';

GRANT SELECT ON public.bank_floor_settings TO anon, authenticated;

/** What a ledger holds: its opening balance plus every posted entry. */
CREATE OR REPLACE FUNCTION public.ledger_balance(p_account_id UUID)
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT round(
      COALESCE((SELECT opening_balance
                  * CASE WHEN COALESCE(opening_balance_type, 'DR') = 'DR' THEN 1 ELSE -1 END
                  FROM chart_of_accounts WHERE id = p_account_id), 0)
    + COALESCE((SELECT sum(e.debit_amount) - sum(e.credit_amount)
                  FROM voucher_entries e
                  JOIN vouchers v ON v.id = e.voucher_id AND v.status <> 'CANCELLED'
                 WHERE e.account_id = p_account_id), 0), 2);
$$;

COMMENT ON FUNCTION public.ledger_balance(UUID) IS
  'Opening balance plus posted entries. What the LEDGER says an account holds, '
  'which is not the same thing as what the bank holds until they are reconciled.';

REVOKE ALL ON FUNCTION public.ledger_balance(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ledger_balance(UUID) TO anon, authenticated;

/**
 * The floor, checked at entry.
 *
 * On the credit side of a bank ledger — money leaving — and only then. A receipt
 * into the account is never refused, however low the balance, because refusing
 * money coming in would be absurd.
 */
CREATE OR REPLACE FUNCTION public.require_bank_floor()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_settings RECORD;
  v_account  RECORD;
  v_after    NUMERIC;
BEGIN
  SELECT enforced, floor_amount INTO v_settings FROM bank_floor_settings WHERE id;
  IF NOT COALESCE(v_settings.enforced, false) THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.credit_amount, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT account_name, account_group INTO v_account
    FROM chart_of_accounts WHERE id = NEW.account_id;
  IF lower(COALESCE(v_account.account_group, '')) NOT LIKE '%bank%' THEN
    RETURN NEW;
  END IF;

  v_after := public.ledger_balance(NEW.account_id) - NEW.credit_amount;
  IF v_after < v_settings.floor_amount THEN
    RAISE EXCEPTION
      'This payment would leave % with %, below the Rs % kept for emergencies. Nothing has been saved — pay from another account or reduce the amount.',
      v_account.account_name,
      to_char(v_after, 'FM99,99,99,990.00'),
      to_char(v_settings.floor_amount, 'FM99,99,99,990');
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_require_bank_floor ON public.voucher_entries;
CREATE TRIGGER trg_require_bank_floor
  BEFORE INSERT ON public.voucher_entries
  FOR EACH ROW EXECUTE FUNCTION public.require_bank_floor();

-- ------------------------------------------------------------------ verify

DO $verify$
DECLARE v_on BOOLEAN; v_floor NUMERIC;
BEGIN
  SELECT enforced, floor_amount INTO v_on, v_floor FROM bank_floor_settings WHERE id;
  IF v_on THEN
    RAISE EXCEPTION 'ABORT: the rule must ship switched OFF — the bank ledgers do not yet agree with the banks';
  END IF;
  IF v_floor <> 5000 THEN
    RAISE EXCEPTION 'ABORT: the floor is %, expected 5000', v_floor;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_require_bank_floor' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ABORT: the trigger is not installed';
  END IF;
  -- The balance helper must agree with a hand calculation on one real account.
  PERFORM public.ledger_balance(
    (SELECT id FROM chart_of_accounts
      WHERE is_active AND lower(COALESCE(account_group,'')) LIKE '%bank%' LIMIT 1));
END
$verify$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------- read it
-- Which accounts would refuse a payment the moment the rule is switched on.

SELECT c.company_name,
       a.account_name,
       to_char(public.ledger_balance(a.id), 'FM99,99,99,990.00') AS ledger_balance,
       CASE WHEN public.ledger_balance(a.id) < (SELECT floor_amount FROM public.bank_floor_settings WHERE id)
            THEN 'would block every payment' ELSE 'ok' END AS if_switched_on
  FROM public.chart_of_accounts a
  JOIN public.companies c ON c.id = a.company_id
 WHERE a.is_active AND lower(COALESCE(a.account_group, '')) LIKE '%bank%'
 ORDER BY public.ledger_balance(a.id)
 LIMIT 12;
