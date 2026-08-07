-- ============================================================
-- Ayeka Bar — Fix menu edit access + scheduled menu versions
-- Apply in Supabase SQL Editor after 014_menu_audit.sql.
-- ============================================================

-- ---- 1. THE BUG: two disconnected permission systems ---------------------
--
-- `public.staff.role` is what the app checks: middleware, requireOwner() and
-- every /owner/* page gate on role = 'owner'.
--
-- `public.menus` RLS (000_menus_schema.sql) checks something else entirely —
-- `owner_id = auth.uid()`, a single auth user id baked into the row, plus a
-- `public.admins` table the app has no UI for and never writes to.
--
-- So a second owner (or a general manager granted admin rights) passes every
-- gate, reaches /owner/editor, and then MenuEditor's `select ... .single()`
-- returns ZERO rows because RLS doesn't know about them. The editor shows its
-- load-error state. Saving and publishing would have failed the same way —
-- publish_menu() is security invoker, so it runs under these same policies.
--
-- Fix: make the menu policies read the SAME roster the rest of the app uses.

create or replace function public.is_menu_editor()
returns boolean
language sql
security definer          -- so it can read public.staff past that table's RLS
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff
    where auth_user_id = auth.uid()
      and role = 'owner'
  );
$$;

grant execute on function public.is_menu_editor() to authenticated;

comment on function public.is_menu_editor() is
  'True when the caller holds admin rights in public.staff. The single source of truth for menu access — keep it aligned with requireOwner().';

-- `owner_id = auth.uid()` is KEPT as a fallback on purpose: if the staff table
-- were ever wrong or emptied, the original owner must still be able to get in.
drop policy if exists "menus_select_own_or_admin" on public.menus;
create policy "menus_select_own_or_admin" on public.menus
  for select using (
    owner_id = auth.uid() or public.is_admin() or public.is_menu_editor()
  );

drop policy if exists "menus_update_own_or_admin" on public.menus;
create policy "menus_update_own_or_admin" on public.menus
  for update using (
    owner_id = auth.uid() or public.is_admin() or public.is_menu_editor()
  )
  with check (
    owner_id = auth.uid() or public.is_admin() or public.is_menu_editor()
  );

drop policy if exists "menu_versions_rw_own_or_admin" on public.menu_versions;
create policy "menu_versions_rw_own_or_admin" on public.menu_versions
  for all using (
    exists (
      select 1 from public.menus m
      where m.id = menu_versions.menu_id
        and (m.owner_id = auth.uid() or public.is_admin() or public.is_menu_editor())
    )
  );

-- ---- 2. Scheduled menu versions ------------------------------------------
--
-- "יום שישי" should apply on Friday for a few hours and then revert to normal
-- by itself. A schedule is a set of weekdays plus a time window, evaluated in
-- BAR-local time (Asia/Jerusalem) — never the visitor's device clock.
--
-- Weekdays follow JS getDay(): 0 = Sunday … 5 = Friday, 6 = Saturday.
-- `schedule_end` <= `schedule_start` means the window crosses midnight.

alter table public.menu_variants
  add column if not exists schedule_enabled boolean not null default false,
  add column if not exists schedule_days    smallint[] not null default '{}',
  add column if not exists schedule_start   text,
  add column if not exists schedule_end     text;

comment on column public.menu_variants.schedule_enabled is
  'When true this version applies automatically during its window, and the menu reverts to the default outside it.';
comment on column public.menu_variants.schedule_days is
  'Weekdays the schedule runs on, JS getDay() convention (0=Sunday, 5=Friday). Empty = every day.';

-- ---- 3. Public read surface for resolving the schedule -------------------
-- The menu page has to decide which version applies RIGHT NOW, so it needs all
-- of them plus their schedules. Display fields only — no owner ids, no draft.

drop view if exists public.public_menu_variants;
create view public.public_menu_variants as
  select
    v.id,
    m.slug,
    v.name,
    v.excluded_uids,
    v.is_default,
    v.sort_order,
    v.schedule_enabled,
    v.schedule_days,
    v.schedule_start,
    v.schedule_end,
    (m.active_variant_id = v.id) as is_active
  from public.menu_variants v
  join public.menus m on m.id = v.menu_id;

grant select on public.public_menu_variants to anon, authenticated;

comment on view public.public_menu_variants is
  'Every menu version plus its schedule, so the public menu can resolve which one applies now. Display fields only.';
