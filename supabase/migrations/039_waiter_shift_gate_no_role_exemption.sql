-- ============================================================
-- Ayeka Bar — remove the floor-manager exemption from the shift-gate
-- triggers; narrow the CLIENT-side (ayeka-staff) off-shift screen bypass
-- from "floor manager" (OP/GM/shift manager) to "OP/GM only."
--
-- 2026-08-18 live-testing feedback, narrowing 038: "Make sure staff can't
-- interact with tables unless shift is on. Only OP, General Manager or
-- Owner can interact with the tables when the Shift is offline but even
-- they can't send orders out, only see the tables and interact with the
-- system."
--
-- Two changes, both already live on the CLIENT side (ayeka-staff,
-- access.ts's new isShiftOverride() + App.tsx/RegisterScreen's own
-- shiftStatus.isActive checks) as of this same round — this migration is
-- what makes the SERVER agree, since access.ts's own header comment is
-- explicit that a client-side rule without a Postgres twin is a UI
-- convenience, not the actual gate.
--
-- 1. is_floor_manager() (022 — OP, GM, OR shift manager) used to exempt
--    all three from BOTH triggers below. A shift manager no longer gets
--    any exemption at all — narrower than what the owner asked for
--    before, since this round named OP/GM specifically and left shift
--    managers out.
-- 2. OP/GM's own remaining exemption is removed ENTIRELY, not narrowed —
--    "even they can't send orders out." Everyone, regardless of role,
--    needs an active shift to open a new order or advance an item's
--    status. The client still lets OP/GM past the SCREEN-level gate
--    (isShiftOverride) so they can browse the floor and open an existing
--    table read-only; only the actual write is refused here, and refused
--    for every role alike.
--
-- Both trigger FUNCTIONS are replaced (create or replace function) —
-- their names, signatures, and the triggers pointing at them are
-- untouched, so this doesn't need to drop/recreate anything 038 already
-- created. Nothing else about 038 changes: the four-status scope
-- (sent/preparing/ready/delivered) each trigger gates is exactly what it
-- was; see waiter_order_items_require_shift's own comment below for a
-- known, PRE-EXISTING and NOT addressed here, mismatch between that scope
-- and 038's own stated "cleanup is never new work" intent.
-- ============================================================

create or replace function public.waiter_orders_require_shift()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.waiter_shift_sessions where status = 'active')
  then
    raise exception 'no active shift — cannot open a new order' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.waiter_order_items_require_shift()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- NOTE (pre-existing, not changed by this migration): this still gates
  -- ALL FOUR of sent/preparing/ready/delivered, including the "cleanup"
  -- transitions (ready->delivered) 038's own comment says should stay
  -- open ("a table opened during the shift must still be closeable...
  -- cleanup is never new work"). That was already true for every
  -- non-floor-manager caller before this migration — this migration only
  -- removes WHO used to be exempt, it doesn't touch WHICH statuses are
  -- gated. Left as observed, not fixed, here; a future migration narrowing
  -- this trigger to `new.status = 'sent'` specifically (the one genuinely
  -- "new work" transition) is a reasonable follow-up but a separate,
  -- deliberate decision, not a side effect of this one.
  if new.status in ('sent', 'preparing', 'ready', 'delivered')
     and old.status is distinct from new.status
     and not exists (select 1 from public.waiter_shift_sessions where status = 'active')
  then
    raise exception 'no active shift — cannot advance an item' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---- Verify (run against the LOCAL stack first) ----------------------------
--   No active session, signed in as OP/GM (previously exempt) -> openOrder()
--   insert into waiter_orders now ALSO fails 42501 with "no active shift" —
--   this is the actual behavior change; before this migration it succeeded.
--   No active session, signed in as a shift manager (badge='manager') ->
--   same insert now ALSO fails 42501 — previously succeeded via
--   is_floor_manager()'s "or manager" clause, which no longer applies here.
--   No active session, ANY role -> setItemStatus(..., "sent"|"preparing"|
--   "ready"|"delivered") on an existing item fails 42501 for everyone,
--   including OP/GM/shift-manager (previously only a plain waiter/
--   bartender/cook failed this).
--   No active session, ANY role -> voidItem() (-> "voided") and
--   updateItemQty/Note still succeed regardless — untouched by this
--   migration, same as 038.
--   Start a session, repeat every check above -> every write succeeds for
--   every role again, no change from 038's own behavior here.
