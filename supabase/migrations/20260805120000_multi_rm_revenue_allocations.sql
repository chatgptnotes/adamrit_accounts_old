-- A visit may have up to three relationship managers.  The legacy FK/text
-- columns remain the primary-manager compatibility surface for older screens.
BEGIN;

CREATE TABLE IF NOT EXISTS public.visit_relationship_managers (
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  relationship_manager_id UUID NOT NULL REFERENCES public.relationship_managers(id),
  position SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (visit_id, relationship_manager_id),
  UNIQUE (visit_id, position)
);

CREATE TABLE IF NOT EXISTS public.daily_revenue_rm_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revenue_entry_id UUID NOT NULL REFERENCES public.daily_revenue_entries(id) ON DELETE CASCADE,
  relationship_manager_id UUID REFERENCES public.relationship_managers(id),
  position SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 3),
  rm_name TEXT NOT NULL,
  rm_ledger_account_id UUID REFERENCES public.chart_of_accounts(id),
  allocated_cut NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (allocated_cut >= 0),
  approval_id UUID REFERENCES public.approval_queue(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (revenue_entry_id, position),
  UNIQUE (revenue_entry_id, relationship_manager_id)
);

CREATE INDEX IF NOT EXISTS idx_visit_rm_manager ON public.visit_relationship_managers(relationship_manager_id);
CREATE INDEX IF NOT EXISTS idx_revenue_rm_entry ON public.daily_revenue_rm_allocations(revenue_entry_id);
CREATE INDEX IF NOT EXISTS idx_revenue_rm_approval ON public.daily_revenue_rm_allocations(approval_id) WHERE approval_id IS NOT NULL;

ALTER TABLE public.visit_relationship_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_revenue_rm_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS visit_rm_all ON public.visit_relationship_managers;
CREATE POLICY visit_rm_all ON public.visit_relationship_managers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS revenue_rm_all ON public.daily_revenue_rm_allocations;
CREATE POLICY revenue_rm_all ON public.daily_revenue_rm_allocations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visit_relationship_managers TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_revenue_rm_allocations TO anon, authenticated;

INSERT INTO public.visit_relationship_managers(visit_id, relationship_manager_id, position)
SELECT id, relationship_manager_id, 1 FROM public.visits
WHERE relationship_manager_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.daily_revenue_rm_allocations(
  revenue_entry_id, relationship_manager_id, position, rm_name,
  rm_ledger_account_id, allocated_cut, approval_id
)
SELECT e.id, m.id, 1, btrim(e.rm_name), e.rm_ledger_account_id,
       greatest(COALESCE(e.cut,0),0), e.approval_id
FROM public.daily_revenue_entries e
LEFT JOIN public.relationship_managers m
  ON lower(btrim(m.name)) = lower(btrim(e.rm_name))
WHERE btrim(COALESCE(e.rm_name,'')) <> ''
  AND upper(btrim(e.rm_name)) <> 'DIRECT'
ON CONFLICT DO NOTHING;

-- Split a money amount exactly in paise. Earlier positions receive a possible
-- one-paise remainder, making the result deterministic and sum preserving.
CREATE OR REPLACE FUNCTION public.rebalance_daily_revenue_rm_allocations(p_entry_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_total_paise BIGINT; v_count INT;
BEGIN
  SELECT round(greatest(COALESCE(cut,0),0) * 100)::BIGINT INTO v_total_paise
  FROM daily_revenue_entries WHERE id=p_entry_id;
  SELECT count(*) INTO v_count FROM daily_revenue_rm_allocations WHERE revenue_entry_id=p_entry_id;
  IF v_count = 0 THEN RETURN; END IF;
  UPDATE daily_revenue_rm_allocations a SET
    allocated_cut = ((v_total_paise / v_count) + CASE WHEN a.position <= (v_total_paise % v_count) THEN 1 ELSE 0 END)::NUMERIC / 100,
    updated_at = now()
  WHERE a.revenue_entry_id=p_entry_id;
END $$;

CREATE OR REPLACE FUNCTION public.set_visit_relationship_managers(p_visit_id UUID, p_manager_ids UUID[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID; v_pos INT := 0; v_direct_count INT;
BEGIN
  IF COALESCE(array_length(p_manager_ids,1),0) < 1 OR array_length(p_manager_ids,1) > 3 THEN
    RAISE EXCEPTION 'Choose between one and three relationship managers';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_manager_ids) x) <> array_length(p_manager_ids,1) THEN
    RAISE EXCEPTION 'The same relationship manager cannot be selected twice';
  END IF;
  SELECT count(*) INTO v_direct_count FROM relationship_managers m
   WHERE m.id=ANY(p_manager_ids) AND lower(btrim(m.name))='direct';
  IF v_direct_count > 0 AND array_length(p_manager_ids,1) > 1 THEN
    RAISE EXCEPTION 'DIRECT cannot be combined with another relationship manager';
  END IF;
  IF (SELECT count(*) FROM relationship_managers WHERE id=ANY(p_manager_ids)) <> array_length(p_manager_ids,1) THEN
    RAISE EXCEPTION 'One or more relationship managers no longer exist';
  END IF;
  DELETE FROM visit_relationship_managers WHERE visit_id=p_visit_id;
  FOREACH v_id IN ARRAY p_manager_ids LOOP
    v_pos := v_pos + 1;
    INSERT INTO visit_relationship_managers(visit_id,relationship_manager_id,position) VALUES(p_visit_id,v_id,v_pos);
  END LOOP;
  UPDATE visits SET relationship_manager_id=p_manager_ids[1] WHERE id=p_visit_id;
END $$;

CREATE OR REPLACE FUNCTION public.set_daily_revenue_relationship_managers(p_entry_id UUID, p_manager_ids UUID[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID; v_pos INT:=0; v_visit UUID; v_manager RECORD;
BEGIN
  PERFORM 1 FROM daily_revenue_entries WHERE id=p_entry_id AND expense_bill_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This revenue row is missing or already approved'; END IF;
  IF EXISTS(SELECT 1 FROM daily_revenue_rm_allocations WHERE revenue_entry_id=p_entry_id AND approval_id IS NOT NULL) THEN
    RAISE EXCEPTION 'This revenue row already has an approved RM allocation';
  END IF;
  IF COALESCE(array_length(p_manager_ids,1),0) < 1 OR array_length(p_manager_ids,1)>3 THEN
    RAISE EXCEPTION 'Choose between one and three relationship managers';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_manager_ids) x) <> array_length(p_manager_ids,1) THEN
    RAISE EXCEPTION 'The same relationship manager cannot be selected twice';
  END IF;
  IF EXISTS(SELECT 1 FROM relationship_managers WHERE id=ANY(p_manager_ids) AND lower(btrim(name))='direct')
     AND array_length(p_manager_ids,1)>1 THEN RAISE EXCEPTION 'DIRECT cannot be combined with another relationship manager'; END IF;
  DELETE FROM daily_revenue_rm_allocations WHERE revenue_entry_id=p_entry_id;
  FOREACH v_id IN ARRAY p_manager_ids LOOP
    v_pos:=v_pos+1;
    SELECT id,name,ledger_account_id INTO v_manager FROM relationship_managers WHERE id=v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Relationship manager no longer exists'; END IF;
    IF lower(btrim(v_manager.name)) <> 'direct' THEN
      INSERT INTO daily_revenue_rm_allocations(revenue_entry_id,relationship_manager_id,position,rm_name,rm_ledger_account_id)
      VALUES(p_entry_id,v_manager.id,v_pos,v_manager.name,v_manager.ledger_account_id);
    END IF;
  END LOOP;
  SELECT visit_id INTO v_visit FROM daily_revenue_entries WHERE id=p_entry_id;
  UPDATE daily_revenue_entries e SET
    rm_name=(SELECT name FROM relationship_managers WHERE id=p_manager_ids[1]),
    rm_ledger_account_id=(SELECT ledger_account_id FROM relationship_managers WHERE id=p_manager_ids[1]), updated_at=now()
  WHERE id=p_entry_id;
  PERFORM rebalance_daily_revenue_rm_allocations(p_entry_id);
  IF v_visit IS NOT NULL THEN PERFORM set_visit_relationship_managers(v_visit,p_manager_ids); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rebalance_daily_revenue_rm_allocations_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM rebalance_daily_revenue_rm_allocations(NEW.id); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_rebalance_daily_revenue_rm ON public.daily_revenue_entries;
CREATE TRIGGER trg_rebalance_daily_revenue_rm AFTER UPDATE OF cut ON public.daily_revenue_entries
FOR EACH ROW WHEN (OLD.cut IS DISTINCT FROM NEW.cut) EXECUTE FUNCTION public.rebalance_daily_revenue_rm_allocations_trigger();

REVOKE ALL ON FUNCTION public.set_visit_relationship_managers(UUID,UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_daily_revenue_relationship_managers(UUID,UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_visit_relationship_managers(UUID,UUID[]) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_daily_revenue_relationship_managers(UUID,UUID[]) TO anon,authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
