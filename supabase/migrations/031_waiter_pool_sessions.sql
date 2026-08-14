-- ============================================================
-- Ayeka Bar — snooker/pool table sessions and the waiter's queue view.
--
-- PLAN_OMS_V2.md item 5. Resolved 2026-08-14: "pool" and "snooker" are the
-- same one physical table (no table_id column — see the plan's own note on
-- why), and only waiters schedule it for now — no customer self-service
-- booking, so this stays gated at plain staff level like any other order
-- action, not a new access tier.
-- ============================================================

create table if not exists public.waiter_pool_sessions (
  id            uuid primary key default gen_random_uuid(),
  -- Billing link — the session rides on a real order line so it still goes
  -- through the register like anything else. Nullable because a session can
  -- be queued before the waiter has decided which table/order it bills to.
  order_id      uuid references public.waiter_orders(id) on delete set null,
  order_item_id uuid references public.waiter_order_items(id) on delete set null,
  label         text,                 -- customer/guest display name, snapshot
  session_count integer not null check (session_count > 0),
  starts_at     timestamptz,          -- null while queued, set when it actually begins
  ends_at       timestamptz,          -- starts_at + 30min * session_count, stamped alongside starts_at
  status        text not null default 'queued'
                check (status in ('queued', 'active', 'done', 'cancelled')),
  created_by    uuid references public.staff(id),
  created_at    timestamptz not null default now()
);

create index if not exists waiter_pool_sessions_queue_idx
  on public.waiter_pool_sessions (status, starts_at) where status in ('queued', 'active');

comment on table public.waiter_pool_sessions is
  'One 30-minute snooker/pool session, or a queued request for one or more. '
  'A single physical table today — see PLAN_OMS_V2.md item 5 if that changes.';
comment on column public.waiter_pool_sessions.session_count is
  'Consecutive 30-minute sessions requested together. ends_at = starts_at + 30min * session_count.';

-- ---- starts_at/ends_at are a matched pair, and status flows one way -------
create or replace function public.waiter_pool_sessions_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'active' and new.starts_at is null then
    new.starts_at := now();
  end if;
  if new.starts_at is not null and new.ends_at is null then
    new.ends_at := new.starts_at + (new.session_count * interval '30 minutes');
  end if;
  if auth.uid() is not null and tg_op = 'INSERT' then
    new.created_by := public.current_staff_id();
  end if;
  return new;
end;
$$;

drop trigger if exists waiter_pool_sessions_guard on public.waiter_pool_sessions;
create trigger waiter_pool_sessions_guard
  before insert or update on public.waiter_pool_sessions
  for each row execute function public.waiter_pool_sessions_guard();

-- ---- RLS: any signed-in staff member, same level as ordinary order work ---
alter table public.waiter_pool_sessions enable row level security;

drop policy if exists waiter_pool_sessions_staff on public.waiter_pool_sessions;
create policy waiter_pool_sessions_staff on public.waiter_pool_sessions
  for all to authenticated
  using (public.is_staff_client()) with check (public.is_staff_client());

-- Realtime, so the queue view updates live the way the floor map already
-- does (024_waiter_realtime.sql set the precedent).
alter publication supabase_realtime add table public.waiter_pool_sessions;
alter table public.waiter_pool_sessions replica identity full;
