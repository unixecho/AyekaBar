-- ============================================================
-- Ayeka Bar — Owner point management (audit + atomic adjust + stats)
-- Apply in Supabase SQL Editor after 003_staff_management.sql.
--
-- Manual point changes go through apply_point_adjustment(), which updates the
-- balance and writes an audit row atomically. Both helper functions are
-- service-role only (called from the owner-gated /api/owner/customers route),
-- never exposed to anon/authenticated.
-- ============================================================

create table if not exists public.point_adjustments (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  delta        integer not null,
  reason       text,
  adjusted_by  uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
create index if not exists idx_point_adjustments_customer
  on public.point_adjustments(customer_id, created_at desc);

alter table public.point_adjustments enable row level security;
-- No policies: service-role access only.

-- Atomic manual adjustment: clamp at 0, log the audit row, return new balance.
create or replace function public.apply_point_adjustment(
  p_customer_id uuid, p_delta int, p_reason text, p_actor uuid
) returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_total int;
begin
  update public.customers
    set points = greatest(0, points + p_delta)
    where id = p_customer_id
    returning points into v_total;
  if not found then raise exception 'customer not found'; end if;

  insert into public.point_adjustments (customer_id, delta, reason, adjusted_by)
  values (p_customer_id, p_delta, p_reason, p_actor);

  return v_total;
end;
$$;
revoke execute on function public.apply_point_adjustment(uuid, int, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_point_adjustment(uuid, int, text, uuid) to service_role;

-- Dashboard overview stats.
create or replace function public.loyalty_overview()
returns jsonb
language sql security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'customers',          (select count(*) from public.customers),
    'points_outstanding', (select coalesce(sum(points), 0) from public.customers),
    'visits_today',       (select count(*) from public.visit_logs where visit_timestamp >= date_trunc('day', now())),
    'new_this_week',      (select count(*) from public.customers where created_at >= now() - interval '7 days')
  );
$$;
revoke execute on function public.loyalty_overview() from public, anon, authenticated;
grant execute on function public.loyalty_overview() to service_role;
