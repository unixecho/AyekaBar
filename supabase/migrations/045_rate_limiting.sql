-- Generic, table-backed rate limiter. Written because this app runs on
-- Vercel serverless functions (Fluid Compute reuses instances but does not
-- guarantee a single shared instance across concurrent requests) — an
-- in-memory counter (a plain JS Map/object) is unreliable here: two
-- concurrent requests can land on two different warm instances with two
-- separate counters, silently doubling the real limit. Postgres, which
-- every request already talks to, is the one place state is actually
-- shared. Fixed-window counting (not sliding-window) — simpler, one row per
-- key, and precise enough to stop scripted abuse; it is not trying to be a
-- production-grade token bucket.
--
-- No RLS policy is added on purpose — same posture as fraud_log/menu_audit/
-- point_adjustments (migration 001/014/008): service-role only, reached
-- exclusively through check_rate_limit() below, never queried directly by
-- the client.
create table if not exists public.rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        integer not null default 0
);
alter table public.rate_limits enable row level security;

-- p_key should already encode both WHO (ip or customer/staff id) and WHAT
-- (the route) — e.g. 'checkin:ip:1.2.3.4' — so one caller hammering one
-- endpoint can't burn another endpoint's budget. Returns true = allowed,
-- false = over the limit for the current window. The upsert is atomic, so
-- two concurrent requests for the same key can't both read-then-write past
-- the limit (the classic bug a naive SELECT-then-UPDATE would have).
create or replace function public.check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
  set count        = case when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
                           then 1
                           else public.rate_limits.count + 1
                      end,
      window_start = case when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
                           then now()
                           else public.rate_limits.window_start
                      end
  returning count into v_count;

  return v_count <= p_max;
end;
$function$;

-- Only this app's own backend calls this (always via the service-role
-- client — see src/lib/rate-limit.ts) — never the browser directly, so
-- there is no legitimate anon/authenticated caller. Same lesson as
-- migrations 043/044: a freshly created function gets an implicit EXECUTE
-- grant to PUBLIC unless revoked, and PUBLIC leaks straight through to
-- every other role — so revoke PUBLIC explicitly, not just anon/
-- authenticated, or the "fix" is cosmetic.
revoke execute on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;

-- Old rows are harmless (a handful of bytes each) but there's no reason to
-- keep them past a day — nothing reads a rate_limits row after its window
-- has closed. Manual/occasional, not a cron job (this project has none —
-- see CLAUDE.md); safe to call repeatedly, and safe to skip entirely.
create or replace function public.cleanup_rate_limits()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from public.rate_limits where window_start < now() - interval '1 day';
$function$;
revoke execute on function public.cleanup_rate_limits() from public, anon, authenticated;
