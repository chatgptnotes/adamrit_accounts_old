-- Renaming a patient aborted the whole save with
--   duplicate key value violates unique constraint "tally_ledgers_accounting_account_uniq"
--
--   patients.name changes
--     -> trg_create_patient_ledger        upserts the patient's chart_of_accounts row
--          -> sync_chart_account_to_tally_ledger   mirrors it into tally_ledgers  <- threw here
--
-- tally_ledgers has TWO uniqueness rules:
--   tally_ledgers_company_id_name_key        UNIQUE (company_id, name)
--   tally_ledgers_accounting_account_uniq    UNIQUE (company_id, accounting_account_id) partial
--
-- The mirror reached the table through a single INSERT ... ON CONFLICT (company_id, name).
-- One ON CONFLICT can only arbitrate on one index. On a rename the name is new, so the arbiter
-- matches nothing, the INSERT proceeds for real, and it collides on the OTHER index with the row
-- already mirroring that account. 20260730130000 added an update-in-place guard but still fell
-- through to the same unguarded ON CONFLICT, which is why 20260804340000 and 20260807140000 both
-- had to hand-DELETE drifted mirror rows.
--
-- Fix: stop upserting. Resolve the two candidate rows explicitly and branch, so neither index can
-- be violated on any path.
--
-- Nothing is deleted here. payment_obligation_ledgers.ledger_id is
-- REFERENCES tally_ledgers(id) ON DELETE CASCADE (20260512000002:8), and four more columns are
-- ON DELETE SET NULL, so deleting a mirror row to free a name would quietly destroy a director's
-- payment-obligation link. A stale mirror name is recoverable; a cascaded delete is not.

CREATE OR REPLACE FUNCTION public.sync_chart_account_to_tally_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg        UUID;   -- tally_config this iteration mirrors into
  v_mine       UUID;   -- row already mirroring this account in that config
  v_named      UUID;   -- row already holding this name in that config
  v_named_acct UUID;   -- ... and the account it belongs to, NULL if unmapped
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.tally_ledgers
     WHERE accounting_account_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Same fan-out as the INSERT ... SELECT it replaces: one mirror per configured
  -- Tally company belonging to this accounting company.
  FOR v_cfg IN
    SELECT tc.id
      FROM public.tally_config tc
     WHERE tc.accounting_company_id = NEW.company_id
  LOOP
    SELECT tl.id
      INTO v_mine
      FROM public.tally_ledgers tl
     WHERE tl.company_id = v_cfg
       AND tl.accounting_account_id = NEW.id;

    SELECT tl.id, tl.accounting_account_id
      INTO v_named, v_named_acct
      FROM public.tally_ledgers tl
     WHERE tl.company_id = v_cfg
       AND tl.name = NEW.account_name;

    -- Two different rows cannot both end up carrying this name in this company.
    -- Nothing here is ours to merge, so leave both alone and say so. Skipping costs
    -- a stale mirror name; aborting would cost the user their patient edit.
    IF v_mine IS NOT NULL AND v_named IS NOT NULL AND v_mine <> v_named THEN
      RAISE WARNING 'tally mirror: ledger "%" is already taken by account % in company %, account % left unsynced',
        NEW.account_name, COALESCE(v_named_acct::TEXT, 'an unmapped row'), v_cfg, NEW.id;
      CONTINUE;
    END IF;

    IF v_mine IS NOT NULL THEN
      -- Rename in place. closing_balance is deliberately untouched: it is a Tally
      -- sync snapshot and must not be stamped over with an opening balance.
      UPDATE public.tally_ledgers
         SET name                  = NEW.account_name,
             parent_group          = NEW.account_group,
             opening_balance       = COALESCE(NEW.opening_balance, 0),
             is_hidden             = NOT COALESCE(NEW.is_active, true),
             accounting_company_id = NEW.company_id
       WHERE id = v_mine;

    ELSIF v_named IS NOT NULL THEN
      -- A ledger of this name already exists and nothing else claims this account:
      -- adopt it rather than creating a second row with the same name.
      UPDATE public.tally_ledgers
         SET accounting_account_id = NEW.id,
             parent_group          = NEW.account_group,
             opening_balance       = COALESCE(NEW.opening_balance, 0),
             is_hidden             = NOT COALESCE(NEW.is_active, true),
             accounting_company_id = NEW.company_id
       WHERE id = v_named;

    ELSE
      INSERT INTO public.tally_ledgers (
        company_id,
        accounting_company_id,
        accounting_account_id,
        name,
        parent_group,
        opening_balance,
        closing_balance,
        is_hidden,
        is_mapped,
        last_synced_at
      ) VALUES (
        v_cfg,
        NEW.company_id,
        NEW.id,
        NEW.account_name,
        NEW.account_group,
        COALESCE(NEW.opening_balance, 0),
        COALESCE(NEW.opening_balance, 0),
        NOT COALESCE(NEW.is_active, true),
        false,
        NULL
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- The trigger itself is unchanged (AFTER INSERT OR UPDATE OF account_name, account_group,
-- opening_balance, is_active, company_id OR DELETE on chart_of_accounts) - replacing the
-- function is enough, and this lands correctly whichever previous version is deployed.

NOTIFY pgrst, 'reload schema';
