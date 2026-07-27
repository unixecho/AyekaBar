-- ============================================================
-- Ayeka Bar — App settings (owner-controlled feature switches)
-- Apply in Supabase SQL Editor after 006_staff_invites.sql.
--
-- First switch: `loyalty_enabled`. The bar is launching with QR codes that
-- lead to the portal only; the loyalty club stays "coming soon" to build
-- anticipation. The owner flips it on from /owner/dashboard when ready —
-- no deploy needed.
--
-- Values are jsonb so future switches can hold more than a boolean.
-- Readable by everyone (the portal needs it before sign-in); writable only
-- through the service role (owner-gated API).
-- ============================================================

create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  -- Readable by anyone (including signed-out visitors)? Defaults to FALSE so a
  -- future setting holding something sensitive is private unless someone
  -- deliberately opts it in. A blanket `using (true)` policy would have leaked
  -- it the moment it was inserted.
  is_public   boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

alter table public.app_settings
  add column if not exists is_public boolean not null default false;

alter table public.app_settings enable row level security;

-- The portal must render the loyalty entry point (or its "coming soon" state)
-- for signed-out visitors, so the switch itself is public — but only rows
-- explicitly marked as such.
drop policy if exists "app_settings_read_all" on public.app_settings;
drop policy if exists "app_settings_read_public" on public.app_settings;
create policy "app_settings_read_public" on public.app_settings
  for select using (is_public);

-- No write policies on purpose — /api/owner/settings writes via service role
-- after verifying the caller is an owner.

insert into public.app_settings (key, value, is_public)
values ('loyalty_enabled', 'false'::jsonb, true)
on conflict (key) do update set is_public = true;

comment on table public.app_settings is
  'Owner-controlled feature switches. Public read, service-role write.';
