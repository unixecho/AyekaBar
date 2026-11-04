-- 063: security hardening from the 2026-11-03 audit. Tested by scripts/check-migration-063.mjs.
--
-- Nothing was exposed before this: anonymous and stranger reads, writes and deletes were all refused by RLS on the live
-- database. This adds a second layer, so that one forgotten policy on a future table cannot expose it, and closes three
-- narrower gaps (employees deleting order rows, a points race, loose helper functions).
--
-- BEHAVIOUR CHANGE: a request with the anon key to a closed table now answers 401 instead of an empty 200.
-- FROM NOW ON: a new table or function is closed to anon by default, so a genuinely public one needs its own GRANT.

begin;

-- ── 1. anon keeps only what a signed-out visitor actually reads ─────────────
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select on public.app_settings, public.menu_variants, public.rewards to anon;
grant select on public.public_menus, public.public_menu_variants to anon;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
-- PUBLIC's EXECUTE is a built-in default, which only the form with no schema can remove. A schema-level revoke silently
-- leaves it in place (found by scripts/check-migration-063.mjs). authenticated keeps its own explicit schema-level grant.
alter default privileges revoke execute on functions from public;

-- ── 2. authenticated (ANY Google account) loses writes that no policy allows ─
-- TRUNCATE is the one that matters in principle: RLS does not apply to it.
revoke truncate, references, trigger on all tables in schema public from authenticated;

revoke all on public.customer_cart_submissions, public.customer_table_sessions, public.fraud_log,
  public.loyalty_qr_tokens, public.menu_audit, public.point_adjustments, public.rate_limits,
  public.waiter_table_calls, public.waiter_table_codes
  from authenticated;

revoke insert, update, delete on public.admins, public.app_settings, public.customers, public.menu_variants,
  public.reward_redemptions, public.rewards, public.staff, public.venues, public.visit_logs
  from authenticated;

revoke insert, delete on public.menus from authenticated;

-- ── 3. the till's history cannot be deleted from a browser ──────────────────
-- Policies give every employee ALL on these, so a cook with devtools could delete a bill. Neither the POS nor the portal
-- ever deletes these rows through a signed-in client (voids are soft, tables are deactivated).
revoke delete on public.waiter_orders, public.waiter_order_items, public.waiter_order_guests,
  public.waiter_order_batches, public.waiter_order_tables, public.waiter_order_events,
  public.waiter_pool_sessions, public.waiter_tables, public.waiter_floor, public.waiter_floor_history,
  public.waiter_shift_reports, public.waiter_shift_sessions, public.waiter_station_checkins
  from authenticated;

-- ── 4. functions ────────────────────────────────────────────────────────────
-- Trigger functions were callable by name. Firing a trigger does not check EXECUTE, so this changes nothing for them.
do $$
declare f text; p regprocedure;
begin
  foreach f in array array[
    'rls_auto_enable()', 'waiter_events_stamp()', 'waiter_floor_history_stamp()', 'waiter_guests_stamp()',
    'waiter_items_pickup_stamp()', 'waiter_items_stamp()', 'waiter_order_items_require_shift()',
    'waiter_order_tables_stamp()', 'waiter_orders_release_combined()', 'waiter_orders_require_shift()',
    'waiter_orders_stamp()', 'waiter_pool_sessions_guard()', 'waiter_pool_sessions_require_shift()',
    'waiter_shift_reports_stamp()', 'waiter_shift_sessions_stamp()', 'waiter_station_checkins_stamp()',
    'waiter_tables_guard()'
  ] loop
    p := to_regprocedure('public.' || f);
    if p is not null then
      execute format('revoke all on function %s from public, anon, authenticated', p);
    end if;
  end loop;

  -- Signed-in helpers: closed to anon. They reached authenticated through PUBLIC, so it is granted explicitly first.
  foreach f in array array[
    'claim_staff_invite()', 'current_shift_status()', 'current_staff_id()', 'get_or_create_customer()',
    'is_admin()', 'is_bartender()', 'is_cook()', 'is_floor_manager()', 'is_menu_editor()', 'is_op()',
    'is_schedule_manager(uuid)', 'is_staff_client()', 'publish_menu(uuid)'
  ] loop
    p := to_regprocedure('public.' || f);
    if p is not null then
      execute format('grant execute on function %s to authenticated, service_role', p);
      execute format('revoke all on function %s from public, anon', p);
    end if;
  end loop;

  -- Service-only helpers with no search_path of their own (not SECURITY DEFINER, so a tidy-up rather than a hole).
  foreach f in array array[
    'sched_range(date,text,text)', 'sched_range_text(text,text)', 'sched_needed(jsonb)', 'sched_fail(text,jsonb)',
    'sched_fmt(date,text,text)', 'sched_lock_staff(uuid)', 'sched_lock_staff_many(uuid[])'
  ] loop
    p := to_regprocedure('public.' || f);
    if p is not null then
      execute format('alter function %s set search_path = public, pg_temp', p);
    end if;
  end loop;
end $$;

-- The staff views are gated by is_staff_client(). The barrier stops a cheap filter running ahead of that gate.
alter view public.schedule_roster set (security_barrier = true);

-- ── 5. award_points: one QR code, one point ─────────────────────────────────
-- It read the token, then wrote it, with no lock, so two simultaneous scans could both pass the "already used" and
-- "24 hours" checks. The customer is locked first and the token second, which also keeps the order consistent.
create or replace function public.award_points(p_token text, p_customer_id uuid, p_device_info text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_token_row  public.loyalty_qr_tokens%rowtype;
  v_last_visit timestamptz;
  v_total      integer;
begin
  perform 1 from public.customers where id = p_customer_id for update;

  -- 1. Look up the token
  select * into v_token_row
  from public.loyalty_qr_tokens
  where token = p_token
  for update;

  if not found then
    insert into public.fraud_log (attempted_by, reason, token_attempted)
    values (p_customer_id, 'token_not_found', p_token);
    return jsonb_build_object('success', false, 'error', 'token_not_found');
  end if;

  -- 2. Check expiry
  if v_token_row.expires_at < now() then
    insert into public.fraud_log (attempted_by, reason, token_attempted)
    values (p_customer_id, 'expired_token', p_token);
    return jsonb_build_object('success', false, 'error', 'expired_token');
  end if;

  -- 3. Check already used
  if v_token_row.used then
    insert into public.fraud_log (attempted_by, reason, token_attempted)
    values (p_customer_id, 'token_already_used', p_token);
    return jsonb_build_object('success', false, 'error', 'token_already_used');
  end if;

  -- 4. Check 24h cooldown for this customer
  select visit_timestamp into v_last_visit
  from public.visit_logs
  where customer_id = p_customer_id
  order by visit_timestamp desc
  limit 1;

  if v_last_visit is not null and v_last_visit > now() - interval '24 hours' then
    insert into public.fraud_log (attempted_by, reason, token_attempted)
    values (p_customer_id, 'cooldown_active', p_token);
    return jsonb_build_object('success', false, 'error', 'cooldown_active');
  end if;

  -- 5. All checks passed — award points atomically
  update public.loyalty_qr_tokens
  set used = true, used_by = p_customer_id, used_at = now()
  where id = v_token_row.id;

  insert into public.visit_logs (customer_id, business_id, points_awarded, redeemed_qr_token, device_info)
  values (p_customer_id, v_token_row.business_id, 1, p_token, p_device_info);

  update public.customers
  set points = points + 1,
      total_visits = total_visits + 1,
      last_visit_at = now()
  where id = p_customer_id
  returning points into v_total;

  return jsonb_build_object(
    'success', true,
    'points_awarded', 1,
    'total_points', v_total
  );
end;
$function$;

revoke all on function public.award_points(text, uuid, text) from public, anon, authenticated;
grant execute on function public.award_points(text, uuid, text) to service_role;

commit;
