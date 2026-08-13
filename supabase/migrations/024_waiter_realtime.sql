-- ============================================================
-- Ayeka Bar — Realtime for the waiter app (§9, §15).
--
-- Multiple waiters on one table means push, not polling: Supabase Realtime
-- streams postgres_changes over a websocket, and it respects RLS — after 020
-- a subscriber must be signed-in staff, and anon sockets receive nothing.
--
-- `replica identity full` is what puts the OLD row in UPDATE payloads.
-- Without it a client sees the new row only and cannot tell what changed —
-- which matters for "table released" (old.held_by tells you whose it was)
-- and for status transitions.
--
-- The publication ADDs are guarded because `alter publication … add table`
-- errors if the table is already a member, and this file must be re-runnable.
-- ============================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'waiter_tables', 'waiter_orders', 'waiter_order_items',
    'waiter_order_batches', 'waiter_order_guests',
    'waiter_floors', 'waiter_floor_props'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

alter table public.waiter_tables       replica identity full;
alter table public.waiter_orders       replica identity full;
alter table public.waiter_order_items  replica identity full;
alter table public.waiter_order_guests replica identity full;
alter table public.waiter_floors       replica identity full;
alter table public.waiter_floor_props  replica identity full;
