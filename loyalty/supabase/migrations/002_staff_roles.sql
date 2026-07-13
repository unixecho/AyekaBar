-- ============================================================
-- Ayeka Bar Loyalty System — Staff allowlist (authorization)
-- Apply in Supabase SQL Editor or via Supabase CLI.
--
-- With Google sign-in open to any Google account, authentication
-- alone no longer implies staff. Middleware requires a row here
-- before allowing /staff/* and /owner/* dashboards.
-- ============================================================

create table if not exists public.staff (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('staff','owner')),
  created_at timestamptz not null default now()
);

alter table public.staff enable row level security;

-- Users may only see their own staff row (middleware checks via the
-- user's own session). Inserts/updates go through the dashboard or
-- service role only — no write policies on purpose.
create policy "staff_read_own" on public.staff
  for select using (auth.uid() = auth_user_id);

-- Seed the owner (find the uid in Supabase Dashboard → Auth → Users):
-- insert into public.staff (auth_user_id, role) values ('<uid>', 'owner');

-- Seed additional staff:
-- insert into public.staff (auth_user_id, role) values ('<uid>', 'staff');
