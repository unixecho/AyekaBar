-- ============================================================
-- Ayeka Bar — pool/snooker queue: shift-gated the same as tables, and
-- linkable to a phone number and/or a real table.
--
-- 2026-08-19 live-testing feedback: "The pool system needs the same logic,
-- and also needs to be either hooked to a phone number or table or both."
--
-- Two independent, additive pieces, same posture as every migration in
-- this repo: neither touches an existing column's meaning.
-- ============================================================

-- ---- 1. Link a session to a phone number and/or a real floor table ------
-- Both nullable and independent — "either... or... or both." `table_id`
-- is a REAL foreign key (unlike waiter_order_events.order_id, which
-- famously wasn't one — see ayeka-staff's sync.ts fetchEventFeed's own
-- 2026-08-18 comment for that whole story), so PostgREST can embed
-- waiter_tables(number,label) directly instead of a second manual lookup.
alter table public.waiter_pool_sessions
  add column if not exists phone text,
  add column if not exists table_id uuid references public.waiter_tables(id) on delete set null;

comment on column public.waiter_pool_sessions.phone is
  'Optional contact number for the group waiting — a walk-in with no '
  'table of their own. Free text, not validated: whatever a waiter reads '
  'off a phone screen.';
comment on column public.waiter_pool_sessions.table_id is
  'Optional link to the floor table the group is sitting at while they '
  'wait. ON DELETE SET NULL, same posture as waiter_orders.table_id — a '
  'later floor edit that removes a table must never take a queue entry '
  'down with it.';

-- ---- 2. Hard, DB-level shift enforcement (defense in depth) -------------
-- Same rule migration 039 just applied to tables: queueing a NEW session
-- and starting one ("handed over the equipment, started the timer" — the
-- moment work actually begins) both require an active shift, for every
-- role, no exemption. Completing/cancelling stay open regardless — same
-- "cleanup is never new work" distinction 038/039 already draw for orders.
create or replace function public.waiter_pool_sessions_require_shift()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' or (new.status = 'active' and old.status is distinct from new.status))
     and not exists (select 1 from public.waiter_shift_sessions where status = 'active')
  then
    raise exception 'no active shift — cannot queue or start a pool session' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists waiter_pool_sessions_require_shift on public.waiter_pool_sessions;
create trigger waiter_pool_sessions_require_shift
  before insert or update on public.waiter_pool_sessions
  for each row execute function public.waiter_pool_sessions_require_shift();

-- ---- Verify (run against the LOCAL stack first) ----------------------------
--   New phone/table_id columns readable/writable through the existing
--   waiter_pool_sessions RLS policy (is_staff_client(), for=all) — no
--   policy change needed, the column grant follows the table grant.
--   No active session -> queuePoolSession() insert fails 42501 with "no
--   active shift — cannot queue or start a pool session", for every role.
--   No active session -> startPoolSession() (queued -> active) on an
--   existing row fails 42501 the same way.
--   No active session -> completePoolSession()/cancelPoolSession() still
--   succeed regardless — untouched by this migration.
--   Start a session, repeat every check above -> every write succeeds
--   again, for everyone.
--   `waiter_pool_sessions?select=...,waiter_tables(number,label)` embed
--   resolves correctly for a row with table_id set, null for one without.
