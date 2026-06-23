-- AyekaBar menu backend schema.
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query) for a fresh project.
--
-- Model: each bar/business is one row in `menus`, identified by a unique `slug`.
-- `draft` is what the owner edits; `published` is what the public menu page reads.
-- Nothing is ever live until "Publish" is pressed in the editor, which copies
-- draft -> published and logs the snapshot in `menu_versions` for rollback.

create extension if not exists pgcrypto; -- gen_random_uuid()

create table public.menus (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,            -- used in the URL / config.js (e.g. "ayeka-bar")
  owner_id      uuid not null references auth.users(id),
  name          jsonb not null default '{}',     -- {he,en,ar}
  badges        jsonb not null default '{}',
  draft         jsonb not null default '{"categories":[]}',
  published     jsonb not null default '{"categories":[]}',
  updated_at    timestamptz not null default now(),
  published_at  timestamptz
);

create table public.menu_versions (
  id            bigint generated always as identity primary key,
  menu_id       uuid not null references public.menus(id) on delete cascade,
  data          jsonb not null,
  published_by  uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

-- Agency staff who may edit ANY business's menu (you, not the bar owners).
create table public.admins (
  user_id  uuid primary key references auth.users(id)
);

alter table public.menus enable row level security;
alter table public.menu_versions enable row level security;
alter table public.admins enable row level security;

-- security definer so the policies below can check admin status without
-- being blocked by admins' own RLS; search_path is pinned to stop hijacking.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Owners see/edit only their own row; admins can see/edit any row.
-- No insert/delete policy is defined on purpose: new businesses are
-- provisioned by you (via the SQL editor / service role), not self-served.
create policy "menus_select_own_or_admin" on public.menus
  for select using (owner_id = auth.uid() or public.is_admin());

create policy "menus_update_own_or_admin" on public.menus
  for update using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

create policy "menu_versions_rw_own_or_admin" on public.menu_versions
  for all using (
    exists (
      select 1 from public.menus m
      where m.id = menu_versions.menu_id
        and (m.owner_id = auth.uid() or public.is_admin())
    )
  );

create policy "admins_select_self" on public.admins
  for select using (user_id = auth.uid());

-- Publishing: copies draft -> published and logs a version row.
-- security invoker (the default) means this runs as the calling user, so the
-- UPDATE below is still gated by the menus_update_own_or_admin policy above —
-- a non-owner calling this RPC simply updates 0 rows and gets an error.
create or replace function public.publish_menu(p_menu_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_published jsonb;
  v_rows int;
begin
  update public.menus
    set published = draft, published_at = now()
    where id = p_menu_id
    returning published into v_published;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'menu not found or not permitted';
  end if;

  insert into public.menu_versions (menu_id, data, published_by)
  values (p_menu_id, v_published, auth.uid());
end;
$$;

grant execute on function public.publish_menu(uuid) to authenticated;

-- Public read surface: only the published columns, never owner_id/draft.
-- Views run with their OWNER's privileges by default in Postgres (unlike
-- normal queries, which run as the calling role) — since this view is
-- created by the table owner, it bypasses the RLS policies above for the
-- handful of columns explicitly selected here. That's intentional: it's how
-- we expose published menus to anonymous customers without ever granting
-- the `anon` role direct table access. Do NOT add `draft` or `owner_id` here.
create view public.public_menus as
  select slug, name, badges, published as menu, published_at
  from public.menus;

grant select on public.public_menus to anon, authenticated;
