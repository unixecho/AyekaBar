-- ============================================================
-- Ayeka Bar — bartender direct orders: bar tabs (existing kind='bar'
-- tables, no new concept) and quick purchase (a table-less order channel).
--
-- PLAN_OMS_V2.md item 10. Bar tabs need NO schema change — waiter_tables
-- .kind = 'bar' already means "bar seating that holds a tab"
-- (022_waiter_floor_model.sql's own comment), so this migration is only
-- for quick purchase: an order with no table at all, a distinction the
-- schema could already represent (table_id is nullable) but the app has
-- never exercised.
-- ============================================================

alter table public.waiter_orders
  add column if not exists channel text not null default 'table'
    check (channel in ('table', 'quick_purchase')),
  add column if not exists bon_at  timestamptz;

comment on column public.waiter_orders.channel is
  '''table'' = the existing waiter/table flow. ''quick_purchase'' = a walk-up '
  'bar purchase with no table at all (soft drink, one cocktail) — payment is '
  'taken before preparation starts, unlike the table flow where filing a '
  'batch happens independent of payment timing.';
comment on column public.waiter_orders.bon_at is
  'When the order''s bon "printed" — a state transition, not a printer '
  'integration (no physical printer exists yet; the app behaves as though '
  'one fired, exactly like table orders already treat filed_at as "printed '
  'at the register" without ever talking to that register). For channel = '
  '''table'' this mirrors filed_at; for ''quick_purchase'', which has no '
  'register filing step, this is the flow''s own explicit bon marker.';

-- Quick-purchase orders skip the table entirely, so the existing NOT NULL
-- constraint that assumes every order eventually gets a real table number
-- must not block them. table_id/table_number/table_label are all already
-- nullable (019_waiter_schema.sql) — nothing to relax here.

-- ---- Verify (run after applying, against the LOCAL stack first) ----------
--   Insert a waiter_orders row with channel='quick_purchase' and no
--   table_id/table_number/table_label -> succeeds (all three already
--   nullable).
--   Existing table-flow inserts, which never set channel, default to
--   'table' and are unaffected.
