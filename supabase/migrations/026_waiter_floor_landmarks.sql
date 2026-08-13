-- ============================================================
-- Ayeka Bar — the rest of the room.
--
-- Migration 022 gave the floor plan walls, dividers, plants, spacers, service
-- stations and the hostess bar. That covers *obstacles* — the things a table
-- has to be placed around — but not LANDMARKS: the fixed points staff actually
-- navigate by. "Two tables left of the entrance" and "the four-top by the
-- kitchen pass" are how a floor is described out loud, and neither could be
-- drawn.
--
-- The goal the owner set is that the map be readable at a glance, without
-- reading table numbers. That needs the room's anchors on it:
--
--   entrance   where guests come in — the origin of every "walk me through it"
--   kitchen    the pass; food comes from here
--   wc         guests ask, constantly
--   bar        the counter itself. NOT the same as waiter_tables.kind='bar',
--              which is bar SEATING and holds tabs. The counter is a landmark
--              and holds none — the distinction 022 already drew for the
--              hostess stand ("landmarks don't have tabs").
--   register   where a round gets typed in, which is a real destination in
--              this app's own workflow (RegisterScreen).
--
-- ADDITIVE AND IDEMPOTENT. 022–025 are still local-only at the time of
-- writing; this is a separate file rather than an edit to 022 so a stack that
-- has already applied 022 does not need a reset to pick it up.
-- ============================================================

-- The kind list lives in exactly one place, so it is dropped and re-added
-- rather than appended to — the same approach 019 and 023 take with the event
-- vocabulary. Re-running this can never leave the old narrower check behind.
alter table public.waiter_floor_props
  drop constraint if exists waiter_floor_props_kind_check;

alter table public.waiter_floor_props
  add constraint waiter_floor_props_kind_check
  check (kind in (
    -- 022's obstacles
    'hostess','wall','divider','plant','spacer','station','custom',
    -- landmarks: the fixed points staff navigate by
    'entrance','kitchen','wc','bar','register'
  ));

comment on table public.waiter_floor_props is
  'Non-interactive layout objects: obstacles that block magnet-grid cells for realistic spacing, and landmarks (entrance / kitchen / WC / bar counter / register) that make the map readable without reading table numbers. Neither holds orders.';

comment on column public.waiter_floor_props.kind is
  'Obstacle (wall, divider, plant, spacer, station, hostess, custom) or landmark (entrance, kitchen, wc, bar, register). A landmark is scenery with a name: waiter_tables.kind=''bar'' is bar SEATING and holds tabs, whereas the ''bar'' prop is the counter and holds none.';
