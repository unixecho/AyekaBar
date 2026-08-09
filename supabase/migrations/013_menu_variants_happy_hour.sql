-- ============================================================
-- Ayeka Bar — Menu variants + happy hour
-- Apply in Supabase SQL Editor after 012_staff_display_name.sql.
--
-- TWO independent features, deliberately not merged:
--
--   VARIANT     = which items are on the menu   ("רגיל" / "יום שישי")
--   HAPPY HOUR  = what those items cost, and when
--
-- A Friday afternoon is both at once. Keeping them separate means switching
-- to the short Friday menu cannot silently cancel the afternoon prices.
--
-- NOTE the name: `menu_versions` already exists (000_menus_schema.sql) and is
-- the publish HISTORY — snapshots for rollback. These are named, owner-facing
-- menu variants. Different thing, hence `menu_variants`.
-- ============================================================

-- ---- 1. variants ---------------------------------------------------------

create table if not exists public.menu_variants (
  id            uuid primary key default gen_random_uuid(),
  menu_id       uuid not null references public.menus(id) on delete cascade,
  name          jsonb not null default '{}',            -- {he,en,ar}
  -- Item uids this variant HIDES. Storing exclusions rather than inclusions
  -- means a newly added item shows up everywhere by default — it can never go
  -- missing from a variant the owner forgot to re-open.
  excluded_uids text[] not null default '{}',
  -- The full menu. Cannot be deleted; always shows every item.
  is_default    boolean not null default false,
  sort_order    integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists menu_variants_menu_id_idx on public.menu_variants (menu_id);

-- At most one default per menu.
create unique index if not exists menu_variants_one_default
  on public.menu_variants (menu_id) where is_default;

-- Which variant the public menu is currently showing.
alter table public.menus
  add column if not exists active_variant_id uuid references public.menu_variants(id) on delete set null;

alter table public.menu_variants enable row level security;

-- Public read: the menu page must resolve the active variant while signed out.
-- Writes go through the owner-gated API on the service role, like every other
-- owner surface — no write policy here on purpose.
drop policy if exists "menu_variants_read_all" on public.menu_variants;
create policy "menu_variants_read_all" on public.menu_variants
  for select using (true);

grant select on public.menu_variants to anon, authenticated;

-- Seed the default "רגיל" variant for the existing menu, and make it active.
insert into public.menu_variants (menu_id, name, excluded_uids, is_default, sort_order)
select m.id,
       jsonb_build_object('he', 'רגיל', 'en', 'Regular', 'ar', 'عادي'),
       '{}'::text[],
       true,
       0
from public.menus m
where not exists (
  select 1 from public.menu_variants v where v.menu_id = m.id and v.is_default
);

update public.menus m
set active_variant_id = v.id
from public.menu_variants v
where v.menu_id = m.id and v.is_default and m.active_variant_id is null;

-- ---- 2. happy hour -------------------------------------------------------
-- Lives in app_settings like the other owner switches (007). One JSONB blob:
--
--   { "enabled": false,
--     "start": "11:00",            -- bar-local (Asia/Jerusalem)
--     "end":   "23:59",            -- <= start means it wraps past midnight
--     "rules": [ { "scope":"category", "id":"cat-xyz", "percent":20 },
--                { "scope":"item",     "id":"a1b2c3d4e5", "percent":50 } ] }
--
-- Public-read: the menu applies the discount client-side so it flips at the
-- right minute without waiting for a cache cycle.

insert into public.app_settings (key, value, is_public)
values (
  'happy_hour',
  jsonb_build_object(
    'enabled', false,
    'start', '11:00',
    'end', '23:59',
    'rules', '[]'::jsonb
  ),
  true
)
on conflict (key) do update set is_public = true;

-- ---- 3. expose the active variant to the public menu ---------------------
-- public_menus is the anonymous read surface (000). It gains the active
-- variant's exclusion list so the menu page can filter without ever being
-- granted access to public.menus itself.
drop view if exists public.public_menus;
create view public.public_menus as
  select
    m.slug,
    m.name,
    m.badges,
    m.published as menu,
    m.published_at,
    v.id            as variant_id,
    v.name          as variant_name,
    coalesce(v.excluded_uids, '{}'::text[]) as variant_excluded_uids
  from public.menus m
  left join public.menu_variants v on v.id = m.active_variant_id;

grant select on public.public_menus to anon, authenticated;

comment on view public.public_menus is
  'Published menu + the active variant''s exclusions. Never exposes draft or owner_id.';
