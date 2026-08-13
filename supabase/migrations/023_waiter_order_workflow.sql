-- ============================================================
-- Ayeka Bar — the order workflow: guests as rows, per-item lifecycle,
-- and database-stamped identity on every action.
--
-- Spec §6–§11, §14 (PLAN_STAFF_APP.md). Additive; the deployed app keeps
-- working (it never selects the new columns) until the new build ships.
--
-- THE LIFECYCLE  (§7):   registered → sent → preparing → ready → delivered
--                        (+ voided, terminal)
-- Filing a batch into the e-register IS sending it — the bon prints there,
-- so filing auto-advances the batch's items to 'sent' and nobody confirms
-- receipt (§7 says exactly this). No kitchen display exists, so 'preparing'
-- and 'ready' are waiter-driven (settled 2026-08-12): the waiter marks items
-- as they collect them. The enum supports a future bar/kitchen screen
-- unchanged.
--
-- IDENTITY (§14, non-negotiable #1): the app talks PostgREST directly, so
-- triggers — not clients — stamp who registered, who delivered, who acted.
-- A client-supplied value is overwritten. current_staff_id() is from 022.
-- ============================================================

-- ---- Orders carry their waiter as an id, not just a name -----------------
-- waiter_name stays as a display snapshot (history must survive someone
-- leaving the roster); waiter_staff_id is the authority, trigger-stamped.
alter table public.waiter_orders
  add column if not exists waiter_staff_id uuid references public.staff(id);

create or replace function public.waiter_orders_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := public.current_staff_id();
begin
  if me is not null then
    new.waiter_staff_id := me;
    -- The name snapshot comes from the roster too — not from the client.
    new.waiter_name := coalesce(
      (select coalesce(nullif(trim(display_name), ''),
                       nullif(trim(concat_ws(' ', first_name, last_name)), ''),
                       email)
         from public.staff where id = me),
      new.waiter_name);
  end if;
  return new;
end;
$$;

drop trigger if exists waiter_orders_stamp on public.waiter_orders;
create trigger waiter_orders_stamp
  before insert on public.waiter_orders
  for each row execute function public.waiter_orders_stamp();

-- ---- Guests: rows, not JSONB ---------------------------------------------
-- waiter_orders.seats (jsonb, migration 002) is a lost-update hazard the
-- moment two waiters add a guest concurrently — last write wins and a guest
-- vanishes. Rows don't collide. The jsonb column stays for the old build;
-- the new build reads and writes only this table.
create table if not exists public.waiter_order_guests (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.waiter_orders(id) on delete cascade,
  seq        integer not null,       -- 1,2,3… allocated below, drives "אלמוני 1"
  name       text,                   -- null = anonymous, rendered from seq
  added_by   uuid references public.staff(id),
  added_at   timestamptz not null default now(),
  removed_at timestamptz,            -- soft; their items fall back to table-wide
  unique (order_id, seq)
);

create index if not exists waiter_order_guests_order_idx
  on public.waiter_order_guests (order_id) where removed_at is null;

comment on column public.waiter_order_guests.seq is
  'Server-allocated. Anonymous guests render as אלמוני/Unnamed <seq> — generated, never stored as a name, so renaming and translation both work.';

-- Allocation + identity stamp. Concurrent inserts can still race to the same
-- seq — the unique constraint turns the loser into a 23505 and the client
-- retries once. That beats a lock: contention is two devices on one table.
create or replace function public.waiter_guests_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.seq is null then
    select coalesce(max(seq), 0) + 1 into new.seq
    from public.waiter_order_guests where order_id = new.order_id;
  end if;
  if public.current_staff_id() is not null then
    new.added_by := public.current_staff_id();
  end if;
  return new;
end;
$$;

drop trigger if exists waiter_guests_stamp on public.waiter_order_guests;
create trigger waiter_guests_stamp
  before insert on public.waiter_order_guests
  for each row execute function public.waiter_guests_stamp();

-- ---- Items: lifecycle + attribution + assignment -------------------------
alter table public.waiter_order_items
  add column if not exists status text not null default 'registered'
    check (status in ('registered','sent','preparing','ready','delivered','voided')),
  add column if not exists guest_id      uuid references public.waiter_order_guests(id) on delete set null,
  add column if not exists is_shared     boolean not null default false,
  add column if not exists registered_by uuid references public.staff(id),
  add column if not exists sent_at       timestamptz,
  add column if not exists ready_at      timestamptz,
  add column if not exists delivered_by  uuid references public.staff(id),
  add column if not exists delivered_at  timestamptz,
  add column if not exists voided_by     uuid references public.staff(id),
  add column if not exists voided_at     timestamptz;

create index if not exists waiter_order_items_status_idx
  on public.waiter_order_items (order_id, status);

comment on column public.waiter_order_items.guest_id is
  'Null + is_shared = table-wide. Null + not shared = not yet assigned (allowed, §10). seat_name stays as a display snapshot.';
comment on column public.waiter_order_items.status is
  'registered → sent (auto, on batch filing) → preparing → ready → delivered. voided is the soft delete — rows are never DELETEd once sent (§8, §14).';

-- Stamp who registered on insert; who delivered / voided on the transition.
-- The timestamps ride along so the client cannot backdate anything.
create or replace function public.waiter_items_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := public.current_staff_id();
begin
  if tg_op = 'INSERT' then
    if me is not null then
      new.registered_by := me;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'sent'      and old.sent_at  is null then new.sent_at  := now(); end if;
    if new.status = 'ready'     and old.ready_at is null then new.ready_at := now(); end if;
    if new.status = 'delivered' then
      new.delivered_at := now();
      if me is not null then new.delivered_by := me; end if;
    end if;
    if new.status = 'voided' then
      new.voided_at := now();
      if me is not null then new.voided_by := me; end if;
    end if;
    -- Delivered/voided are terminal for non-managers: un-delivering rewrites
    -- history, which is a correction — and corrections are new events made by
    -- someone accountable, not silent flips.
    if old.status in ('delivered','voided') and auth.uid() is not null
       and not public.is_floor_manager() then
      raise exception 'a % item can only be changed by a floor manager', old.status
        using errcode = '42501';
    end if;
  end if;

  -- registered_by / delivered_by are never client-writable, even unchanged-
  -- status updates (qty edits) must not swap attribution.
  if auth.uid() is not null then
    new.registered_by := old.registered_by;
    if new.status is not distinct from old.status then
      new.delivered_by := old.delivered_by;
      new.delivered_at := old.delivered_at;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists waiter_items_stamp on public.waiter_order_items;
create trigger waiter_items_stamp
  before insert or update on public.waiter_order_items
  for each row execute function public.waiter_items_stamp();

-- ---- Events: the actor is the session, full stop -------------------------
alter table public.waiter_order_events
  add column if not exists actor_staff_id uuid references public.staff(id),
  add column if not exists table_id       uuid;   -- table-scoped events (assignment, labels) may have no order

alter table public.waiter_order_events alter column order_id drop not null;

-- Widen the vocabulary for the new workflow. Dropped and re-added so this
-- stays the single place the list lives (same approach as 019).
alter table public.waiter_order_events
  drop constraint if exists waiter_order_events_event_check;
alter table public.waiter_order_events
  add constraint waiter_order_events_event_check
  check (event in (
    'opened','item_added','qty_changed','item_removed','filed','paid','voided',
    'reopened','note_changed','batch_opened','batch_filed','seat_added','seat_removed',
    'table_assigned','table_released','table_taken_over','label_changed',
    'item_sent','item_ready','item_delivered','item_undelivered',
    'guest_added','guest_renamed','guest_removed','item_reassigned'
  ));

-- An event row must be attached to SOMETHING.
alter table public.waiter_order_events
  drop constraint if exists waiter_order_events_scope_check;
alter table public.waiter_order_events
  add constraint waiter_order_events_scope_check
  check (order_id is not null or table_id is not null);

create or replace function public.waiter_events_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := public.current_staff_id();
begin
  if me is not null then
    new.actor_staff_id := me;
    new.actor := coalesce(
      (select coalesce(nullif(trim(display_name), ''),
                       nullif(trim(concat_ws(' ', first_name, last_name)), ''),
                       email)
         from public.staff where id = me),
      new.actor);
  end if;
  return new;
end;
$$;

drop trigger if exists waiter_events_stamp on public.waiter_order_events;
create trigger waiter_events_stamp
  before insert on public.waiter_order_events
  for each row execute function public.waiter_events_stamp();

-- ---- RLS for the guests table --------------------------------------------
alter table public.waiter_order_guests enable row level security;

drop policy if exists waiter_guests_staff on public.waiter_order_guests;
create policy waiter_guests_staff on public.waiter_order_guests
  for all to authenticated
  using (public.is_staff_client()) with check (public.is_staff_client());
