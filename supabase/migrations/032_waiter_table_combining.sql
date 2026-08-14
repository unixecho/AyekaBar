-- ============================================================
-- Ayeka Bar — combining tables into one active order (e.g. 12 + 13 for one
-- large party), and un-combining them back to independent tables.
--
-- PLAN_OMS_V2.md item 7. waiter_orders.table_id/table_number/table_label
-- stay EXACTLY as they are and keep meaning what they already mean — the
-- order's primary table. This migration adds only the EXTRA tables joined
-- onto an existing order; there is deliberately no "is_primary" flag,
-- because the primary table is always just waiter_orders.table_id itself,
-- never a row in this table.
--
-- ⚠️ THIS MIGRATION REPLACES waiter_orders_stamp() AGAIN (030 already did,
-- for the cook guard). Postgres has no way to "append" trigger logic across
-- migrations — the function body below reproduces 030's cook check in full
-- and adds the combining check alongside it. Applying 029→034 in order
-- keeps both rules live; applying this file in isolation without 030 first
-- would silently lose nothing (030's rule is reproduced here), but applying
-- 030 AFTER this file would silently lose the combining check — migrations
-- in this file must stay in numeric order, same as every other trigger
-- extension in this schema.
-- ============================================================

create table if not exists public.waiter_order_tables (
  order_id    uuid not null references public.waiter_orders(id) on delete cascade,
  table_id    uuid not null references public.waiter_tables(id),
  joined_at   timestamptz not null default now(),
  joined_by   uuid references public.staff(id),
  released_at timestamptz,
  primary key (order_id, table_id)
);

create index if not exists waiter_order_tables_active_idx
  on public.waiter_order_tables (table_id) where released_at is null;

comment on table public.waiter_order_tables is
  'Extra tables combined onto an order beyond its own primary waiter_orders.table_id. '
  'A row with released_at null means that table is currently absorbed into order_id''s '
  'tab and must not be opened independently — see waiter_orders_stamp()''s combining check.';

create or replace function public.waiter_order_tables_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    new.joined_by := public.current_staff_id();
  end if;

  -- The table being combined in must not already be independently open...
  if exists (
    select 1 from public.waiter_tables t
    join public.waiter_orders o on o.table_id = t.id
    where t.id = new.table_id and o.status = 'open'
  ) then
    raise exception 'that table already has its own open order — close or combine from there instead'
      using errcode = '42501';
  end if;

  -- ...and must not already be combined into a DIFFERENT order.
  if exists (
    select 1 from public.waiter_order_tables wot
    where wot.table_id = new.table_id
      and wot.released_at is null
      and wot.order_id <> new.order_id
  ) then
    raise exception 'that table is already combined into another order'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists waiter_order_tables_stamp on public.waiter_order_tables;
create trigger waiter_order_tables_stamp
  before insert on public.waiter_order_tables
  for each row execute function public.waiter_order_tables_stamp();

-- ---- A combined table cannot be opened as its own fresh order -------------
-- Extends waiter_orders_stamp() (023, re-extended by 030 for the cook
-- guard) — see this file's header for why the whole body is reproduced.
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
  end if;

  if new.table_id is not null and exists (
    select 1 from public.waiter_order_tables wot
    where wot.table_id = new.table_id and wot.released_at is null
  ) then
    raise exception 'this table is currently combined into another order — separate it first'
      using errcode = '42501';
  end if;

  if me is not null then
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

-- ---- Un-combining: a soft release, same posture as everything else here ---
-- No dedicated function needed — releasing is a plain UPDATE
-- (released_at = now()) through the existing waiter_order_tables_staff
-- policy below; nothing about it needs server-side stamping beyond what the
-- RLS policy already gates.

-- ---- RLS: order-level work, same tier as opening/editing an order ---------
alter table public.waiter_order_tables enable row level security;

drop policy if exists waiter_order_tables_staff on public.waiter_order_tables;
create policy waiter_order_tables_staff on public.waiter_order_tables
  for all to authenticated
  using (public.is_staff_client()) with check (public.is_staff_client());

-- ---- Verify (run after applying, against the LOCAL stack first) -----------
--   Combine table 13 into table 12's order -> succeeds, waiter_order_tables
--   gains one row.
--   Attempt to open a fresh tab directly on table 13 while combined -> 42501.
--   Attempt to combine table 13 into a SECOND order while already combined
--   into the first -> 42501.
--   Release (released_at = now()) -> table 13 opens independently again.
--   A cook attempting any of the above insert paths still gets the 030
--   guard's 42501, unaffected by this file.
