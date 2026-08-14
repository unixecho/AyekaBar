-- ============================================================
-- Ayeka Bar — bartender and cook: access levels, ticket-splitting columns,
-- and the RLS-enforced rule that a cook cannot open orders.
--
-- PLAN_OMS_V2.md items 9–11. `public.staff.badge` already documents
-- 'bartender'/'cook' as expected values (003_staff_management.sql's own
-- column comment) — no schema change to assign the badge itself, only to
-- act on it.
--
-- ⚠️ WHY THIS EXTENDS EXISTING TRIGGERS INSTEAD OF ADDING NEW POLICIES:
-- waiter_orders_staff / waiter_order_items_staff (020_waiter_oauth_gate.sql)
-- are PERMISSIVE `for all` policies already granting every signed-in staff
-- member full read/write on both tables. Postgres RLS policies for the same
-- command on the same table are OR'd together — a second permissive policy
-- can only ADD access, never narrow what an existing one already grants. So
-- "a cook may not open an order" and "a cook may only touch status/claim
-- fields" cannot be expressed as an additional policy; they have to live in
-- the BEFORE-trigger column/row guards this schema already uses for every
-- other fine-grained rule (waiter_tables_guard, the delivered/voided lock
-- in waiter_items_stamp — 022/023). This migration extends those two
-- triggers rather than introducing a third enforcement mechanism.
-- ============================================================

-- ---- Access-level twins, mirroring is_floor_manager()'s own pattern ------
create or replace function public.is_bartender()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff
    where auth_user_id = auth.uid()
      and (role = 'owner' or badge in ('owner', 'general_manager', 'manager', 'bartender'))
  );
$$;

grant execute on function public.is_bartender() to authenticated;

comment on function public.is_bartender() is
  'May work the bartender screen: OP, general manager, shift manager, or bartender. '
  'Mirrors canManageFloor-style layering — someone covering the bar mid-shift should not be locked out. '
  'TS twin: ayeka-staff/src/access.ts.';

create or replace function public.is_cook()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff
    where auth_user_id = auth.uid()
      and (role = 'owner' or badge in ('owner', 'general_manager', 'manager', 'cook'))
  );
$$;

grant execute on function public.is_cook() to authenticated;

comment on function public.is_cook() is
  'May work the cook screen: OP, general manager, shift manager, or cook. '
  'TS twin: ayeka-staff/src/access.ts.';

-- ---- Ticket-splitting + claim columns on order items ----------------------
alter table public.waiter_order_items
  add column if not exists station     text check (station is null or station in ('bar', 'kitchen')),
  add column if not exists claimed_by  uuid references public.staff(id),
  add column if not exists claimed_at  timestamptz;

comment on column public.waiter_order_items.station is
  'Snapshot at registration time of the menu category''s station (bar/kitchen), '
  'set client-side from the category''s configured or default-mapped station — '
  'same snapshot posture as category_title/name_he, so a later menu recategorisation '
  'never rewrites what a bartender or cook already worked. Null on rows registered '
  'before this column existed or for a category with no station meaning.';
comment on column public.waiter_order_items.claimed_by is
  'The bartender/cook who claimed this ticket — distinct from registered_by (the '
  'waiter who took the order) and delivered_by (who served/delivered it, which may '
  'be the bartender directly at a bar tab or the waiter carrying it to a table).';

create index if not exists waiter_order_items_station_idx
  on public.waiter_order_items (station, status) where station is not null;

-- ---- Claim stamping, folded into the existing item trigger -----------------
-- Same shape as delivered_at/delivered_by in 023_waiter_order_workflow.sql:
-- the timestamp and the actor both come from the server, never the client.
create or replace function public.waiter_items_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me       uuid := public.current_staff_id();
  me_badge text;
  me_role  text;
  cook_only boolean := false;
begin
  if tg_op = 'INSERT' then
    if me is not null then
      new.registered_by := me;
    end if;
    return new;
  end if;

  if me is not null then
    select role, badge into me_role, me_badge from public.staff where id = me;
    -- "Cook" here means PURELY a cook — someone whose badge also carries a
    -- higher level (owner/GM/manager/bartender) or whose role is owner is
    -- exempt, matching the role-or-badge layering every other level here uses.
    cook_only := (me_role is distinct from 'owner')
      and me_badge = 'cook';
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
    -- Claiming: the first bar/kitchen-side status transition on a ticket
    -- (registered/sent -> preparing) stamps who picked it up, if nobody has
    -- claimed it yet. A later status change by someone else (a manager
    -- correction) does not re-stamp — claim is "who started it", not "who
    -- last touched it".
    if new.status = 'preparing' and old.claimed_by is null and me is not null then
      new.claimed_by := me;
      new.claimed_at := now();
    end if;
    if old.status in ('delivered','voided') and auth.uid() is not null
       and not public.is_floor_manager() then
      raise exception 'a % item can only be changed by a floor manager', old.status
        using errcode = '42501';
    end if;
  end if;

  -- A cook may claim/advance status and nothing else on an existing line —
  -- not price, qty, notes, options, assignment, or the order it belongs to.
  -- (§11: "cook cannot create orders" — this is the sibling rule, "cook
  -- cannot edit an order beyond the prep lifecycle".)
  if cook_only and auth.uid() is not null then
    if (new.item_uid, new.name_he, new.variant, new.unit_agorot, new.qty, new.note,
        new.category_id, new.order_id, new.guest_id, new.is_shared, new.seat_name,
        new.selected_options)
       is distinct from
       (old.item_uid, old.name_he, old.variant, old.unit_agorot, old.qty, old.note,
        old.category_id, old.order_id, old.guest_id, old.is_shared, old.seat_name,
        old.selected_options)
    then
      raise exception 'a cook may only update an item''s prep status'
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
    -- Claim is likewise never client-set directly — only this trigger's own
    -- "first preparing transition" rule above sets it.
    if new.claimed_by is distinct from old.claimed_by
       and not (new.status = 'preparing' and old.claimed_by is null) then
      new.claimed_by := old.claimed_by;
      new.claimed_at := old.claimed_at;
    end if;
  end if;

  return new;
end;
$$;

-- ---- A cook cannot open an order (§11) -------------------------------------
-- Folded into the existing order-stamp trigger (023) rather than a new one,
-- same reasoning as the item guard above.
create or replace function public.waiter_orders_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me       uuid := public.current_staff_id();
  me_badge text;
  me_role  text;
begin
  if me is not null then
    select role, badge into me_role, me_badge from public.staff where id = me;
    if me_role is distinct from 'owner' and me_badge = 'cook' then
      raise exception 'a cook may not open a table or start an order'
        using errcode = '42501';
    end if;
    new.waiter_staff_id := me;
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

-- Triggers already exist and point at these functions (023) — replacing the
-- function bodies above is enough; no drop/recreate of the triggers needed.

-- ---- Verify (run after applying, against the LOCAL stack first) -----------
--   A cook-badged staff member's insert into waiter_orders must fail 42501.
--   A cook-badged staff member's update to waiter_order_items.status
--   (registered -> preparing) must succeed and stamp claimed_by/claimed_at.
--   The SAME staff member updating unit_agorot or qty must fail 42501.
--   A bartender/manager/GM/owner doing any of the above must be unaffected
--   (cook_only is false for all of them).
