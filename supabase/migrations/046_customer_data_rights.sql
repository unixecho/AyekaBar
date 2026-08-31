-- Step 2 of the security-hardening round: (a) a policy bug found while
-- building the customer self-service data feature, (b) the scaffolding that
-- feature needs, (c) a real retention window for logs that had none.

-- ---------------------------------------------------------------------
-- (a) customers_update_own let a signed-in customer update EVERY column
-- on their own row via a direct, authenticated call to Supabase's REST API
-- — including `points` and `total_visits`. Postgres RLS policies restrict
-- which ROWS a role can touch, not which COLUMNS; this table's UPDATE
-- policy (qual = with_check = auth.uid() = auth_user_id) was correctly
-- scoped to "your own row" but had no column-level limit underneath it, and
-- the table-level GRANT was blanket UPDATE (all columns) to `authenticated`
-- — so nothing in the stack actually stopped:
--   PATCH /rest/v1/customers?id=eq.<your-own-id>  { "points": 999999 }
-- with nothing more than your own real, legitimate session. No API route
-- in this repo does this (every write goes through award_points/
-- redeem_reward/apply_point_adjustment, all now properly locked down —
-- migrations 043/044), but the RLS+grant layer itself allowed it directly.
--
-- Fix: revoke UPDATE entirely from `authenticated` on customers. Editing a
-- customer's own name now goes through PATCH /api/customer/profile (service
-- role, same pattern as every other customer-facing write in this app) —
-- not a direct client-side table update. SELECT stays exactly as it was.
revoke update on public.customers from authenticated;

-- ---------------------------------------------------------------------
-- (b) Customer self-service data rights (delete / edit / export). The
-- delete flow (src/app/api/customer/profile/route.ts DELETE) nulls
-- fraud_log.attempted_by and loyalty_qr_tokens.used_by for the customer
-- (the only two FKs into customers with no ON DELETE action — both
-- nullable by design, see 001/008's own comments) before deleting the
-- customer's auth.users row; visit_logs / reward_redemptions /
-- point_adjustments are all `ON DELETE CASCADE` already (confirmed live
-- against pg_constraint), so nothing else needs handling here. No new SQL
-- needed for the delete path itself — it's plain service-role table
-- operations plus one Admin API call, same shape as every other write in
-- this app.

-- ---------------------------------------------------------------------
-- (c) Retention for the two fields that had none: visit_logs.device_info
-- (a raw User-Agent string, captured automatically on every check-in) and
-- fraud_log (IP address + attempted token, captured automatically on every
-- failed check-in). Different treatment for each, because they're not the
-- same kind of data:
--   - visit_logs itself (points_awarded, visit_timestamp) is the
--     customer's own loyalty history — ongoing product data, not touched.
--     Only device_info (the part that's arguably tracking-adjacent and has
--     no purpose once the visit is old) gets cleared.
--   - fraud_log exists purely as a security/anti-abuse record. Its value
--     doesn't fade at 12 months the way a UA string's does, so it's given
--     longer before deletion outright.
--
-- Defaults (12 / 24 months) are a reasoned starting point, not a legal
-- citation — Israeli law's Amendment 13 requires organizations to define
-- and follow a retention period, not a specific number of months; confirm
-- the actual figure with a lawyer alongside the privacy policy. Both are
-- parameters precisely so that number can change later without touching
-- this function.
create or replace function public.cleanup_expired_logs(
  p_device_info_months integer default 12,
  p_fraud_log_months    integer default 24
)
returns table (device_info_cleared integer, fraud_log_deleted integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device_cleared integer;
  v_fraud_deleted  integer;
begin
  with cleared as (
    update public.visit_logs
    set device_info = null
    where device_info is not null
      and visit_timestamp < now() - make_interval(months => p_device_info_months)
    returning 1
  )
  select count(*) into v_device_cleared from cleared;

  with gone as (
    delete from public.fraud_log
    where attempted_at < now() - make_interval(months => p_fraud_log_months)
    returning 1
  )
  select count(*) into v_fraud_deleted from gone;

  return query select v_device_cleared, v_fraud_deleted;
end;
$function$;

-- Same lesson as 043/044, applied from the start this time: explicitly
-- revoke PUBLIC, not just anon/authenticated — Postgres grants EXECUTE on
-- a new function to PUBLIC by default, and every role inherits it.
revoke execute on function public.cleanup_expired_logs(integer, integer) from public, anon, authenticated;

-- Scheduled below via pg_cron if the extension is available on this
-- project; if the following statements fail, run cleanup_expired_logs()
-- manually / from an external scheduler instead — the function above is
-- what matters, the schedule is just automation on top of it.
