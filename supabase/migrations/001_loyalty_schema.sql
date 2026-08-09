-- ============================================================
-- Ayeka Bar Loyalty System — Database Schema
-- Apply this in Supabase SQL Editor or via Supabase CLI
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists public.customers (
  id               uuid primary key default gen_random_uuid(),
  auth_user_id     uuid unique references auth.users(id) on delete cascade,
  email            text,
  phone            text,
  points           integer not null default 0,
  total_visits     integer not null default 0,
  created_at       timestamptz not null default now(),
  last_visit_at    timestamptz
);

create table if not exists public.visit_logs (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid not null references public.customers(id) on delete cascade,
  business_id         uuid not null,
  points_awarded      integer not null default 1,
  visit_timestamp     timestamptz not null default now(),
  redeemed_qr_token   text unique not null,
  device_info         text,
  table_number        text
);

create table if not exists public.loyalty_qr_tokens (
  id           uuid primary key default gen_random_uuid(),
  token        text unique not null,
  business_id  uuid not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used         boolean not null default false,
  used_by      uuid references public.customers(id),
  used_at      timestamptz
);

create table if not exists public.rewards (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null,
  reward_name      text not null,
  reward_name_he   text,
  required_points  integer not null,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create table if not exists public.reward_redemptions (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.customers(id) on delete cascade,
  reward_id        uuid not null references public.rewards(id),
  points_deducted  integer not null,
  redeemed_at      timestamptz not null default now()
);

create table if not exists public.fraud_log (
  id                uuid primary key default gen_random_uuid(),
  attempted_by      uuid references public.customers(id),
  reason            text not null,
  token_attempted   text,
  attempted_at      timestamptz not null default now(),
  ip_address        text
);

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_customers_auth_user_id on public.customers(auth_user_id);
create index if not exists idx_visit_logs_customer_id on public.visit_logs(customer_id);
create index if not exists idx_visit_logs_visit_timestamp on public.visit_logs(visit_timestamp desc);
create index if not exists idx_loyalty_qr_tokens_expires_at on public.loyalty_qr_tokens(expires_at);
create index if not exists idx_rewards_business_id on public.rewards(business_id);
create index if not exists idx_reward_redemptions_customer_id on public.reward_redemptions(customer_id);
create index if not exists idx_fraud_log_attempted_at on public.fraud_log(attempted_at desc);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.customers enable row level security;
alter table public.visit_logs enable row level security;
alter table public.loyalty_qr_tokens enable row level security;
alter table public.rewards enable row level security;
alter table public.reward_redemptions enable row level security;
alter table public.fraud_log enable row level security;

-- customers: users can read and update their own row
create policy "customers_select_own" on public.customers
  for select using (auth.uid() = auth_user_id);

create policy "customers_update_own" on public.customers
  for update using (auth.uid() = auth_user_id);

-- visit_logs: users can read their own logs
create policy "visit_logs_select_own" on public.visit_logs
  for select using (
    customer_id in (
      select id from public.customers where auth_user_id = auth.uid()
    )
  );

-- loyalty_qr_tokens: no direct user access (service_role only via API routes)
-- No policies = deny all for non-service roles

-- rewards: anyone can read active rewards
create policy "rewards_select_active" on public.rewards
  for select using (active = true);

-- reward_redemptions: users can read their own
create policy "reward_redemptions_select_own" on public.reward_redemptions
  for select using (
    customer_id in (
      select id from public.customers where auth_user_id = auth.uid()
    )
  );

-- fraud_log: no user access (service_role only)
-- No policies = deny all for non-service roles

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- get_or_create_customer: called after magic link login
-- Creates customer record if it doesn't exist
create or replace function public.get_or_create_customer()
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user auth.users%rowtype;
  v_customer public.customers%rowtype;
begin
  -- Get the current user
  select * into v_user from auth.users where id = auth.uid();
  if not found then
    raise exception 'Not authenticated';
  end if;

  -- Try to find existing customer
  select * into v_customer from public.customers where auth_user_id = auth.uid();

  -- Create if not found
  if not found then
    insert into public.customers (auth_user_id, email)
    values (auth.uid(), v_user.email)
    returning * into v_customer;
  end if;

  return v_customer;
end;
$$;

-- award_points: validates QR token and awards points
-- Called by the checkin API route via service role
create or replace function public.award_points(
  p_token        text,
  p_customer_id  uuid,
  p_device_info  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_row  public.loyalty_qr_tokens%rowtype;
  v_last_visit timestamptz;
  v_total      integer;
begin
  -- 1. Look up the token
  select * into v_token_row
  from public.loyalty_qr_tokens
  where token = p_token;

  if not found then
    insert into public.fraud_log (attempted_by, reason, token_attempted)
    values (p_customer_id, 'token_not_found', p_token);
    return jsonb_build_object('success', false, 'error', 'token_not_found');
  end if;

  -- 2. Check expiry
  if v_token_row.expires_at < now() then
    insert into public.fraud_log (attempted_by, reason, token_attempted)
    values (p_customer_id, 'expired_token', p_token);
    return jsonb_build_object('success', false, 'error', 'expired_token');
  end if;

  -- 3. Check already used
  if v_token_row.used then
    insert into public.fraud_log (attempted_by, reason, token_attempted)
    values (p_customer_id, 'token_already_used', p_token);
    return jsonb_build_object('success', false, 'error', 'token_already_used');
  end if;

  -- 4. Check 24h cooldown for this customer
  select visit_timestamp into v_last_visit
  from public.visit_logs
  where customer_id = p_customer_id
  order by visit_timestamp desc
  limit 1;

  if v_last_visit is not null and v_last_visit > now() - interval '24 hours' then
    insert into public.fraud_log (attempted_by, reason, token_attempted)
    values (p_customer_id, 'cooldown_active', p_token);
    return jsonb_build_object('success', false, 'error', 'cooldown_active');
  end if;

  -- 5. All checks passed — award points atomically
  update public.loyalty_qr_tokens
  set used = true, used_by = p_customer_id, used_at = now()
  where id = v_token_row.id;

  insert into public.visit_logs (customer_id, business_id, points_awarded, redeemed_qr_token, device_info)
  values (p_customer_id, v_token_row.business_id, 1, p_token, p_device_info);

  update public.customers
  set points = points + 1,
      total_visits = total_visits + 1,
      last_visit_at = now()
  where id = p_customer_id
  returning points into v_total;

  return jsonb_build_object(
    'success', true,
    'points_awarded', 1,
    'total_points', v_total
  );
end;
$$;

-- ============================================================
-- SEED DATA — Ayeka Bar rewards
-- ============================================================

insert into public.rewards (business_id, reward_name, reward_name_he, required_points, active)
values
  ('00000000-0000-0000-0000-000000000001', 'Free Beer',       'כוס בירה חינם',     10, true),
  ('00000000-0000-0000-0000-000000000001', 'Free Appetizer',  'מנה ראשונה חינם',   20, true),
  ('00000000-0000-0000-0000-000000000001', 'House Cocktail',  'קוקטייל הבית',      30, true),
  ('00000000-0000-0000-0000-000000000001', 'VIP Reward',      'פרס VIP',           50, true)
on conflict do nothing;
