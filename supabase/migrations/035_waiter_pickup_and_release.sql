-- ============================================================
-- Ayeka Bar — two independent, additive fixes from 2026-08-16 live-testing
-- feedback. Neither touches an existing column's meaning or any existing
-- trigger's existing behavior; both are pure additions.
-- ============================================================

-- ---- 1. Real "picked up, not yet served" state -----------------------
-- A waiter's acknowledgement of the ready-alert was, until now, purely
-- client-local (a dismissed overlay, never written to the server) — so a
-- bartender/cook's own queue had no way to know an item had actually been
-- collected: "check the cook page it shows waiting for pickup but I
-- already picked up." A new status VALUE was considered and rejected —
-- `status` stays exactly what it already is (registered/sent/preparing/
-- ready/delivered/voided); these are two new nullable columns instead,
-- same posture claimed_by/claimed_at already established for station
-- claiming (023/030), and delivered_by/delivered_at for the final step.
alter table public.waiter_order_items
  add column if not exists picked_up_at timestamptz,
  add column if not exists picked_up_by uuid references public.staff(id);

comment on column public.waiter_order_items.picked_up_at is
  'Stamped when a waiter marks a ready item collected from the pass — a
   real, server-visible fact so the bartender/cook queue can distinguish
   "still sitting there" from "already taken, not yet served," instead of
   only the collecting waiter''s own device knowing. Distinct from
   delivered_at: this is picked up off the counter; delivered_at is placed
   in front of the customer. Per-item, not per-batch — "we can''t assume
   they picked up the entire order unless they mark so."';

-- Stamped server-side from the session, same actor-column posture every
-- other stamp in this schema takes — a client cannot claim someone else
-- did the collecting.
create or replace function public.waiter_items_pickup_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.picked_up_at is distinct from old.picked_up_at and new.picked_up_at is not null then
    new.picked_up_by := public.current_staff_id();
  end if;
  return new;
end;
$$;

drop trigger if exists waiter_items_pickup_stamp on public.waiter_order_items;
create trigger waiter_items_pickup_stamp
  before update on public.waiter_order_items
  for each row execute function public.waiter_items_pickup_stamp();

-- ---- 2. Auto-release combined tables the moment the ORDER closes -----
-- Found live: table 2 and table 4 stuck "combined" with an already-PAID
-- bar-tab order forever, because RegisterScreen's own pay/close path never
-- had the client-side separateTable() call TableDetail's closeTable() got
-- in the previous round (fixed client-side in the same pass as this
-- migration was drafted) — but a client-side call is only ever as
-- complete as the set of close paths someone remembered to add it to. A
-- trigger on waiter_orders itself is the actual fix: whichever code path
-- closes an order — today's two, or a third nobody's written yet — the
-- release happens, because it isn't a client's job to remember it at all.
create or replace function public.waiter_orders_release_combined()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('paid', 'void') and old.status not in ('paid', 'void') then
    update public.waiter_order_tables
      set released_at = now()
      where order_id = new.id and released_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists waiter_orders_release_combined on public.waiter_orders;
create trigger waiter_orders_release_combined
  after update on public.waiter_orders
  for each row execute function public.waiter_orders_release_combined();

-- ---- Verify (run against the LOCAL stack first) ----------------------------
--   Mark an item's picked_up_at while signed in as staff -> succeeds,
--   picked_up_by is stamped from the session, not from anything the
--   client sent.
--   Combine two tables into an order, then setOrderStatus(..., 'paid') or
--   'void' on that order (either close path) -> both member tables'
--   waiter_order_tables rows get released_at set automatically, with no
--   client-side separateTable() call at all.
--   Combine two tables, leave the order open/filed -> released_at stays
--   null; the combination survives a filed-but-unpaid round exactly as
--   before.
