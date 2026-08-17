-- ============================================================
-- Ayeka Bar — shift-gated OMS access + per-station clock-in audit.
--
-- 2026-08-16 live-testing feedback: "when shift is off orders can't come
-- out. Waiters can't send orders, bartender and cook can't receive. Add a
-- status bar to the page of waiters, bartender and cook." Johnathan's own
-- follow-up on strictness: "Hard block. Waiters can't even access tables,
-- the kitchen and bartender aren't in shift when shift is inactive. also
-- make a sign in option for bartenders and cooks and log their sign ins
-- with the shift timeline and make sure there's a full audit for it."
-- This is the roadmap item PLAN_OMS_V2.md/STAFF_APP.md already flagged and
-- deferred: "later we will sync shift with the Order Management System so
-- it can't be operational outside shift hours" — now being built.
--
-- Two independent, additive pieces. Neither touches an existing column's
-- meaning or an existing trigger's behavior.
-- ============================================================

-- ---- 1. A narrow, any-staff-readable shift status -------------------------
-- waiter_shift_sessions itself stays OP-only (016/034's own posture — it's
-- financial-shaped once a report lands on it). Every waiter/bartender/cook
-- needs to know ONLY "is a shift on right now, and since when" to render the
-- status bar and gate the app — this function is that narrow slice, callable
-- by any signed-in staff regardless of their access tier, same posture
-- current_staff_id() already takes for "my own identity" reads.
create or replace function public.current_shift_status()
returns table(is_active boolean, started_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists(select 1 from public.waiter_shift_sessions s where s.status = 'active'),
    (select s.started_at from public.waiter_shift_sessions s where s.status = 'active' limit 1);
$$;

grant execute on function public.current_shift_status() to authenticated;

comment on function public.current_shift_status() is
  'Any signed-in staff may call this — deliberately narrower than reading '
  'waiter_shift_sessions directly (OP-only), which stays financial-shaped. '
  'Read by ayeka-staff''s App.tsx to render the status bar and gate table/'
  'station access while no shift is active.';

-- ---- 2. Per-station clock-in audit -----------------------------------------
-- "a sign in option for bartenders and cooks... log their sign ins with the
-- shift timeline... a full audit." Distinct from waiter_shift_sessions
-- (one venue-wide operating period, OP starts/ends it) and from Google
-- sign-in (identity, not presence) — this is "I'm the one working the bar
-- tonight," which the venue-wide session alone can't answer once more than
-- one bartender/cook rotates through a shift. Append-only, same posture as
-- waiter_order_events/waiter_floor_history — a correction is a new row,
-- never an UPDATE/DELETE, so the audit trail can't be quietly edited.
create table if not exists public.waiter_station_checkins (
  id                uuid primary key default gen_random_uuid(),
  -- Best-effort link to whichever session was active at the moment of the
  -- event — nullable because a check-OUT can legitimately happen after the
  -- owner already ended the shift (closing out shouldn't be blocked by the
  -- session having just closed underneath it).
  shift_session_id  uuid references public.waiter_shift_sessions(id),
  staff_id          uuid not null references public.staff(id),
  station           text not null check (station in ('bar', 'kitchen')),
  event             text not null check (event in ('check_in', 'check_out')),
  at                timestamptz not null default now()
);

comment on table public.waiter_station_checkins is
  'Append-only: a bartender/cook clocking in/out of their station this '
  'shift. staff_id is stamped server-side by the trigger below, never '
  'client-supplied. No UPDATE/DELETE policy, ever.';

create index if not exists waiter_station_checkins_staff_idx
  on public.waiter_station_checkins (staff_id, at desc);
create index if not exists waiter_station_checkins_session_idx
  on public.waiter_station_checkins (shift_session_id, at desc);

create or replace function public.waiter_station_checkins_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.staff_id := public.current_staff_id();
  return new;
end;
$$;

drop trigger if exists waiter_station_checkins_stamp on public.waiter_station_checkins;
create trigger waiter_station_checkins_stamp
  before insert on public.waiter_station_checkins
  for each row execute function public.waiter_station_checkins_stamp();

alter table public.waiter_station_checkins enable row level security;

-- Any signed-in staff may log their OWN check-in/out (staff_id is stamped
-- by the trigger above, not trusted from the client — the check below
-- gates WHO may insert at all, not which staff_id lands in the row).
drop policy if exists waiter_station_checkins_insert on public.waiter_station_checkins;
create policy waiter_station_checkins_insert on public.waiter_station_checkins
  for insert to authenticated
  with check (public.is_staff_client());

-- Read: your own rows, or every row if you're OP (the actual "full audit").
drop policy if exists waiter_station_checkins_select on public.waiter_station_checkins;
create policy waiter_station_checkins_select on public.waiter_station_checkins
  for select to authenticated
  using (staff_id = public.current_staff_id() or public.is_op());

-- No update/delete policy — append-only, same as waiter_order_events.

-- ---- 3. Hard, DB-level enforcement (defense in depth) ----------------------
-- ayeka-staff's App.tsx already replaces Tables/FloorMap/StationScreen with
-- an off-shift screen for anyone who isn't a floor manager while no shift
-- is active — "waiters can't even access tables." But access.ts's own
-- header comment is explicit that every access rule here has a Postgres
-- twin, because a client-side check is a UI convenience, not the actual
-- gate; a direct REST call bypasses it entirely. These two triggers are
-- that twin — reusing is_floor_manager() (022) rather than inventing a new
-- exemption, so OP/GM/shift-manager stay unaffected everywhere they
-- already are.
--
-- Scoped narrowly to the two writes that actually matter: opening a NEW
-- tab, and moving a line FORWARD through the kitchen/bar pipeline.
-- Deliberately NOT blocked: viewing an already-open order, editing its
-- qty/note/assignment, voiding a line, or paying/closing it out — a table
-- opened during the shift must still be closeable if the owner ends the
-- shift before every table has settled, and cleanup is never "new work."
create or replace function public.waiter_orders_require_shift()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_floor_manager()
     and not exists (select 1 from public.waiter_shift_sessions where status = 'active')
  then
    raise exception 'no active shift — cannot open a new order' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists waiter_orders_require_shift on public.waiter_orders;
create trigger waiter_orders_require_shift
  before insert on public.waiter_orders
  for each row execute function public.waiter_orders_require_shift();

create or replace function public.waiter_order_items_require_shift()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('sent', 'preparing', 'ready', 'delivered')
     and old.status is distinct from new.status
     and not public.is_floor_manager()
     and not exists (select 1 from public.waiter_shift_sessions where status = 'active')
  then
    raise exception 'no active shift — cannot advance an item' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists waiter_order_items_require_shift on public.waiter_order_items;
create trigger waiter_order_items_require_shift
  before update on public.waiter_order_items
  for each row execute function public.waiter_order_items_require_shift();

-- ---- Verify (run against the LOCAL stack first) ----------------------------
--   No active session -> current_shift_status() returns one row,
--   is_active=false, started_at=null, callable by a plain waiter/bartender/
--   cook token (not just OP).
--   OP starts a session -> is_active flips true, started_at matches.
--   A bartender inserts {station:'bar', event:'check_in'} -> succeeds,
--   staff_id in the stored row is THEIR OWN staff.id regardless of what
--   (if anything) the client sent for it.
--   That same bartender can SELECT their own check-in rows; a second,
--   different bartender cannot see the first one's rows; OP can see both.
--   Any UPDATE or DELETE attempt on waiter_station_checkins, from ANY
--   role including OP -> no policy permits it, fails closed.
--   No active session, signed in as a plain waiter -> openOrder() insert
--   into waiter_orders fails 42501 with the "no active shift" message;
--   the same insert signed in as OP/GM/shift-manager still succeeds.
--   No active session -> setItemStatus(..., "sent"|"preparing"|"ready"|
--   "delivered") on an existing item fails 42501 for a plain waiter/
--   bartender/cook; voidItem() (-> "voided") and updateItemQty/Note still
--   succeed regardless of shift status.
--   Start a session, repeat both checks -> both writes succeed for
--   everyone again.
