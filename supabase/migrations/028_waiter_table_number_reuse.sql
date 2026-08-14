-- ============================================================
-- Ayeka Bar — free a deactivated table's number for reuse.
--
-- `waiter_tables.number` (migration 019) is `unique`, full stop — across
-- every row, active or not. `deactivateTable()` never deletes a row (orders
-- reference it, and migration 019's own comment says so: "never delete a
-- table, deactivate it"), so a deactivated table's number stays reserved
-- forever. In practice: an owner lays out the room, deletes a few tables
-- while getting the numbers right, and every later attempt to reuse 10, 11,
-- 12… fails with "duplicate key value violates … waiter_tables_number_key" —
-- exactly the crash reported live against production on 2026-08-14.
--
-- THE FIX. Swap the table-wide unique constraint for a PARTIAL unique index
-- that only applies to active rows. Two inactive rows may now share a
-- number; two ACTIVE rows still may not. Deleting a table genuinely frees
-- its number — "delete it, the number goes back into the pool, use it on
-- a new table" — without touching delete semantics at all.
--
-- WHY THIS IS SAFE FOR HISTORY, the thing migration 019's comment exists to
-- protect: `waiter_orders` does not join `waiter_tables.number` live — it
-- snapshots `table_number` and `table_label` onto the order at open time
-- (019, "table_number/table_label are snapshotted so renumbering the floor
-- never rewrites history"). A past order's printed table number was already
-- decided the moment it opened; it does not care what number some
-- unrelated, later table claims.
--
-- Verified against production before writing this file: 25 rows, numbers
-- 1–9/14–21 active, 10–13/101–104 inactive, zero collisions — this
-- constraint swap needs no data cleanup first.
-- ============================================================

alter table public.waiter_tables drop constraint if exists waiter_tables_number_key;

-- Partial: only rows where active = true participate. An inactive row's
-- number is invisible to this index, so a new (or reactivated) row is free
-- to claim it.
create unique index if not exists waiter_tables_active_number_key
  on public.waiter_tables (number)
  where active;

comment on index public.waiter_tables_active_number_key is
  'Table numbers are unique among ACTIVE tables only. A deactivated table''s '
  'number is deliberately reusable — see this migration''s header.';

-- ============================================================
-- Verify
--
--   -- must succeed now (was the reported crash):
--   -- insert a table numbered 10 while another inactive row is also 10
--
--   -- must still fail — two ACTIVE tables cannot share a number:
--   -- update one active table's number to another active table's number
--
--   select conname from pg_constraint
--     where conrelid = 'public.waiter_tables'::regclass and contype = 'u';
--   -- → empty: the old table-wide constraint is gone
--
--   select indexname from pg_indexes
--     where tablename = 'waiter_tables' and indexname = 'waiter_tables_active_number_key';
--   -- → one row
-- ============================================================
