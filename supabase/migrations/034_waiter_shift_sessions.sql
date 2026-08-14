-- ============================================================
-- Ayeka Bar — shift sessions and the end-of-shift report.
--
-- PLAN_OMS_V2.md item 13 (new, not in the original 12-item brief; added
-- 2026-08-14). NOT a roster/scheduling feature — deliberately decoupled
-- from src/lib/shifts/ (the week-builder at /owner/schedule), which is
-- still a browser-storage prototype with no applied migration (027) and
-- no live concept of a shift actually starting or ending. A "shift
-- session" here is simply: someone tapped Start, someone tapped End, and
-- everything that happened on waiter_* tables in between gets summarised.
-- If/when 027 ships, an optional shift_id can link a session to a real
-- roster row — additive, not required for this to work today.
--
-- Gated at is_op() (016_access_levels.sql, already live in production) —
-- same tier as /owner/audit's menu changelog. This is financial-shaped
-- data (revenue, per-staff performance); floor-manager-wide access is
-- wider than it needs to be here.
-- ============================================================

create table if not exists public.waiter_shift_sessions (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  started_by  uuid references public.staff(id),
  ended_at    timestamptz,
  ended_by    uuid references public.staff(id),
  status      text not null default 'active'
              check (status in ('active', 'closed')),
  -- Denormalised copy of the latest waiter_shift_reports row for this
  -- session, so a "past shifts" list needs no join. waiter_shift_reports
  -- stays the source of truth and the append point if a report is ever
  -- regenerated (a late correction) — this column is overwritten then,
  -- the report table gains a new row instead.
  report      jsonb
);

comment on table public.waiter_shift_sessions is
  'One real operating period: Start Shift -> ... -> End Shift & Generate Report. '
  'Independent of src/lib/shifts/ roster planning — see this file''s header.';

create unique index if not exists waiter_shift_sessions_one_active
  on public.waiter_shift_sessions ((true)) where status = 'active';

comment on index public.waiter_shift_sessions_one_active is
  'At most one active session at a time — "End Shift" must close the current '
  'one before a new one can start, so reports never straddle two open sessions.';

create table if not exists public.waiter_shift_reports (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.waiter_shift_sessions(id),
  generated_at timestamptz not null default now(),
  generated_by uuid references public.staff(id),
  -- Aggregate snapshot: revenue/covers/items by category+station, a
  -- per-staff breakdown (registered/delivered/claimed counts and totals),
  -- pool-session revenue, void count, channel breakdown (table / bar tab /
  -- quick purchase). Shape intentionally not fixed in SQL — built from
  -- whatever items 1-12 actually expose once they're live, computed
  -- application-side from waiter_orders/waiter_order_items/
  -- waiter_order_events in [session.started_at, session.ended_at], then
  -- written here once as a stable, dated snapshot. Never recomputed live:
  -- an order can be corrected after the fact, and a report that silently
  -- changes its own past numbers is worse than one that's static.
  data         jsonb not null
);

create index if not exists waiter_shift_reports_session_idx
  on public.waiter_shift_reports (session_id, generated_at desc);

comment on table public.waiter_shift_reports is
  'APPEND ONLY per session — a regenerated report is a new row, never an '
  'overwrite, same posture as waiter_order_events. Never add UPDATE/DELETE.';

-- ---- Stamping: started_by/ended_by from the session, not the client -------
create or replace function public.waiter_shift_sessions_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := public.current_staff_id();
begin
  if tg_op = 'INSERT' then
    if me is not null then new.started_by := me; end if;
    return new;
  end if;

  if new.status = 'closed' and old.status = 'active' then
    new.ended_at := coalesce(new.ended_at, now());
    if me is not null then new.ended_by := me; end if;
  end if;

  -- started_by is a one-time fact, never client-editable after insert.
  new.started_by := old.started_by;
  new.started_at := old.started_at;

  return new;
end;
$$;

drop trigger if exists waiter_shift_sessions_stamp on public.waiter_shift_sessions;
create trigger waiter_shift_sessions_stamp
  before insert or update on public.waiter_shift_sessions
  for each row execute function public.waiter_shift_sessions_stamp();

create or replace function public.waiter_shift_reports_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    new.generated_by := public.current_staff_id();
  end if;
  return new;
end;
$$;

drop trigger if exists waiter_shift_reports_stamp on public.waiter_shift_reports;
create trigger waiter_shift_reports_stamp
  before insert on public.waiter_shift_reports
  for each row execute function public.waiter_shift_reports_stamp();

-- ---- RLS: OP only, same tier as the menu changelog at /owner/audit --------
alter table public.waiter_shift_sessions enable row level security;
alter table public.waiter_shift_reports  enable row level security;

drop policy if exists waiter_shift_sessions_op on public.waiter_shift_sessions;
create policy waiter_shift_sessions_op on public.waiter_shift_sessions
  for all to authenticated
  using (public.is_op()) with check (public.is_op());

drop policy if exists waiter_shift_reports_read  on public.waiter_shift_reports;
drop policy if exists waiter_shift_reports_write on public.waiter_shift_reports;
create policy waiter_shift_reports_read on public.waiter_shift_reports
  for select to authenticated using (public.is_op());
create policy waiter_shift_reports_write on public.waiter_shift_reports
  for insert to authenticated with check (public.is_op());
-- No update/delete policy, ever — see the append-only comment above.

-- ---- Verify (run after applying, against the LOCAL stack first) -----------
--   OP can insert a session, close it, insert a report row -> succeeds.
--   A non-OP staff member (plain waiter/bartender/cook) attempting any of
--   the above -> 42501.
--   A second INSERT while a session is already 'active' -> unique index
--   violation (23505), not silently allowed.
--   An UPDATE or DELETE attempt on waiter_shift_reports from ANY role,
--   including OP -> no policy permits it, fails closed.
