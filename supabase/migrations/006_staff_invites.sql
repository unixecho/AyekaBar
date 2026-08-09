-- ============================================================
-- Ayeka Bar — Staff invites (add staff BEFORE their first sign-in)
-- Apply in Supabase SQL Editor after 005_customer_names.sql.
--
-- Until now `staff.auth_user_id` was the primary key and referenced
-- auth.users, so the owner could only add someone who had ALREADY signed in
-- with Google at least once. That's backwards: the owner hires a person and
-- wants to authorize them by email up front.
--
-- New model: a staff row may exist with `auth_user_id = null` — a PENDING
-- INVITE keyed by email. The first time that Google account signs in, the app
-- calls `claim_staff_invite()`, which matches the signed-in user's email to the
-- pending row and links it (auth_user_id + name backfill). From that moment the
-- existing RLS / middleware checks see a normal staff row and the person gets
-- into the staff window of the loyalty club.
-- ============================================================

-- ---- 1. surrogate primary key -------------------------------------------
-- (rows are now addressed by `id`, since auth_user_id can be null)

alter table public.staff
  add column if not exists id uuid not null default gen_random_uuid();

do $$
begin
  -- Drop the old primary key only if it is still the one on auth_user_id.
  if exists (
    select 1
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.staff'::regclass
      and c.contype = 'p'
      and a.attname = 'auth_user_id'
  ) then
    alter table public.staff drop constraint staff_pkey;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.staff'::regclass and contype = 'p'
  ) then
    alter table public.staff add constraint staff_pkey primary key (id);
  end if;
end $$;

-- ---- 2. auth_user_id becomes optional (null = pending invite) ------------

alter table public.staff alter column auth_user_id drop not null;

-- Still at most one staff row per auth user. A unique INDEX (not constraint)
-- is enough for the `on conflict (auth_user_id)` upsert in the owner API, and
-- unlike a primary key it permits many NULLs (many pending invites).
create unique index if not exists staff_auth_user_id_key
  on public.staff (auth_user_id);

-- One invite per email address, case-insensitive.
create unique index if not exists staff_email_lower_key
  on public.staff (lower(email))
  where email is not null;

-- ---- 3. invite bookkeeping ----------------------------------------------

alter table public.staff
  add column if not exists invited_at timestamptz not null default now(),
  add column if not exists claimed_at timestamptz;

-- Rows that already have an account were, by definition, claimed at creation.
update public.staff set claimed_at = coalesce(claimed_at, created_at)
where auth_user_id is not null and claimed_at is null;

comment on column public.staff.auth_user_id is
  'Linked auth user. NULL = pending invite: the owner authorized this email but the person has not signed in with Google yet.';
comment on column public.staff.claimed_at is
  'When the invited Google account first signed in and claimed the row.';

-- ---- 4. claim_staff_invite() --------------------------------------------
-- Called by the app for the SIGNED-IN user (auth callback + middleware).
-- Returns the caller's staff role ('staff' | 'owner') or null if they are not
-- staff. Safe to call on every sign-in: it is a no-op once linked.

create or replace function public.claim_staff_invite()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  auth.users%rowtype;
  v_role  text;
  v_meta  jsonb;
  v_first text;
  v_last  text;
  v_full  text;
begin
  select * into v_user from auth.users where id = auth.uid();
  if not found then
    return null;
  end if;

  -- Already linked → nothing to claim.
  select role into v_role from public.staff where auth_user_id = v_user.id;
  if found then
    return v_role;
  end if;

  if v_user.email is null then
    return null;
  end if;

  -- An invite is matched on the email address alone, and claiming an `owner`
  -- invite hands over full admin — so only ever match an address the identity
  -- provider actually vouched for. Requires BOTH a confirmed email and a real
  -- Google identity, so re-enabling email/password signup in Supabase can
  -- never turn "register an account with the boss's address" into a takeover.
  if v_user.email_confirmed_at is null then
    return null;
  end if;

  if not exists (
    select 1 from auth.identities
    where user_id = v_user.id and provider = 'google'
  ) then
    return null;
  end if;

  -- Name for the owner's roster, from the Google profile.
  v_meta  := coalesce(v_user.raw_user_meta_data, '{}'::jsonb);
  v_first := nullif(v_meta->>'given_name', '');
  v_last  := nullif(v_meta->>'family_name', '');
  if v_first is null and v_last is null then
    v_full := coalesce(nullif(v_meta->>'full_name', ''), nullif(v_meta->>'name', ''));
    if v_full is not null then
      v_first := split_part(v_full, ' ', 1);
      v_last  := nullif(trim(substr(v_full, length(split_part(v_full, ' ', 1)) + 1)), '');
    end if;
  end if;

  update public.staff
  set auth_user_id = v_user.id,
      claimed_at   = now(),
      first_name   = coalesce(first_name, v_first),
      last_name    = coalesce(last_name, v_last),
      email        = coalesce(email, v_user.email)
  where auth_user_id is null
    and lower(email) = lower(v_user.email)
  returning role into v_role;

  return v_role;
end;
$$;

revoke all on function public.claim_staff_invite() from public;
grant execute on function public.claim_staff_invite() to authenticated;

-- The "staff_read_own" policy from 002 still applies: a pending invite is
-- invisible to everyone (auth_user_id is null, so it matches no auth.uid())
-- until it is claimed. The owner reads the full roster via the service role.
