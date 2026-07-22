-- ══════════════════════════════════════════════════════════════════════════
--  PHARMACY THRESHOLD NOTIFICATION — LIVE TEST
--  Run this in the Supabase dashboard SQL Editor (project xvkxccqaopbnkvwgyfjv).
--  Fires a REAL Super Admin notification on a genuine eligible admission so it
--  shows up in the tablet notification bell.
--  Safe to run twice — it resets the admission's one-shot sent-flag each run.
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_visit_id text := 'IH26E18032';  -- DHONDBAJI SAHARE · MJPJAY · already > Rs.5000
  v_sale_id  bigint;
  v_before   int;
  v_after    int;
  v_result   jsonb;
begin
  -- ── 1. Latest COMPLETED sale on this admission (the RPC keys off a sale_id) ──
  select sale_id into v_sale_id
    from public.pharmacy_sales
   where visit_id = v_visit_id and payment_status = 'COMPLETED'
   order by sale_id desc
   limit 1;

  if v_sale_id is null then
    raise exception 'No COMPLETED pharmacy sale for visit % — pick another visit_id', v_visit_id;
  end if;

  -- ── 2. Reset the per-admission guard so the alert can re-fire on every run ──
  update public.visits
     set pharmacy_threshold_notification_sent = false,
         pharmacy_threshold_notification_sent_at = null
   where visit_id = v_visit_id;

  select count(*) into v_before from public.notifications
   where notification_type = 'pharmacy_threshold' and visit_id = v_visit_id;

  -- ── 3. Call the exact function the billing flow calls ──
  v_result := public.check_pharmacy_threshold_after_sale(v_sale_id, 'sql-test');

  select count(*) into v_after from public.notifications
   where notification_type = 'pharmacy_threshold' and visit_id = v_visit_id;

  -- ── 4. Report ──
  raise notice 'RPC result : %', v_result;
  raise notice 'Notifications for % : before=%, after=%, added=%',
    v_visit_id, v_before, v_after, v_after - v_before;

  if (v_result->>'sent') = 'true' and v_after > v_before then
    raise notice '✅ PASS — real notification created. Open the Super Admin bell.';
  else
    raise warning '❌ FAIL — reason=%', v_result->>'reason';
  end if;
end $$;

-- ── 5. Verify: the rows just created (one per active super admin) ──
select id, title, recipient_role, recipient_user_id, is_read, created_at
  from public.notifications
 where notification_type = 'pharmacy_threshold' and visit_id = 'IH26E18032'
 order by created_at desc
 limit 10;

-- Cleanup (optional — after checking):
-- delete from public.notifications
--  where notification_type = 'pharmacy_threshold' and visit_id = 'IH26E18032';
