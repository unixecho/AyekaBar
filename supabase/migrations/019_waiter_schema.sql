-- ============================================================
-- Ayeka Bar — the staff ordering app's schema, brought into this project.
--
-- WHY THIS EXISTS
-- The waiter_* tables were created from the ayeka-staff repo's own migrations
-- (001_waiter_orders / 002_batches_and_seats / 003_floor_plan) and therefore
-- existed in the DATABASE but not in this project's migration history. That
-- meant a fresh database built from this repo — a local stack, a branch, a
-- rebuild — came up without them, while production had them. This file closes
-- that gap so the two converge.
--
-- ON PRODUCTION THIS IS A NO-OP. Every statement is `if not exists`, and the
-- tables are already there. Nothing is dropped, nothing is re-seeded.
--
-- ⚠️ WHAT IS DELIBERATELY NOT HERE: policies.
-- The source migrations created wide-open `for all to anon, authenticated
-- using (true)` policies, which ayeka-staff's 004 later replaced with a
-- shared-secret gate. Copying the originals verbatim would RE-CREATE the open
-- policies and silently undo that lockdown on production. So this file creates
-- the tables with RLS enabled and NO policies — which fails closed — and
-- migration 020 installs the real ones.
--
-- Between 019 and 020 a fresh database therefore has waiter_* tables that
-- nobody can read or write. That is the correct failure mode, and it is why
-- these are two files and not one.
-- ============================================================

-- ── Floor plan ─────────────────────────────────────────────────────────
-- pos_x / pos_y are percentages of the canvas, so the layout survives a
-- resize and renders identically on a phone and a tablet.
create table if not exists public.waiter_tables (
  id           uuid primary key default gen_random_uuid(),
  number       integer not null unique,           -- the number printed on the table
  label        text,                              -- "בר", "חוץ 3" — optional override
  zone         text,                              -- "פנים" / "חוץ" / "בר"
  seats        integer check (seats is null or seats > 0),
  pos_x        real,                              -- floor-plan X, 0–100 (%)
  pos_y        real,                              -- floor-plan Y, 0–100 (%)
  active       boolean not null default true,     -- never delete a table, deactivate it
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.waiter_tables is
  'Physical tables. Deactivate rather than delete so historical orders keep resolving.';

-- ── Orders ─────────────────────────────────────────────────────────────
-- One row per open tab. table_number/table_label are snapshotted so
-- renumbering the floor never rewrites history.
create table if not exists public.waiter_orders (
  id             uuid primary key default gen_random_uuid(),
  table_id       uuid references public.waiter_tables(id) on delete set null,
  table_number   integer,
  table_label    text,
  waiter_name    text not null,
  -- open → filed (typed into the register) → paid. void is terminal.
  status         text not null default 'open'
                 check (status in ('open','filed','paid','void')),
  opened_at      timestamptz not null default now(),
  filed_at       timestamptz,
  paid_at        timestamptz,
  closed_at      timestamptz,
  -- Money is integer agorot (1 ₪ = 100 agorot). No floats, ever.
  total_agorot   integer not null default 0 check (total_agorot >= 0),
  note           text,
  -- Named guests, e.g. [{"id":"a1","name":"דנה"}] (from 002).
  seats          jsonb not null default '[]'::jsonb
);

create index if not exists waiter_orders_status_idx on public.waiter_orders (status, opened_at desc);
create index if not exists waiter_orders_table_idx  on public.waiter_orders (table_id);

comment on column public.waiter_orders.total_agorot is
  'Integer agorot. Denormalised from the items for fast list rendering.';

-- ── Order items ────────────────────────────────────────────────────────
-- Name and price are snapshotted: the menu is edited in the portal, and an
-- order must always show what was actually sold at that moment.
create table if not exists public.waiter_order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.waiter_orders(id) on delete cascade,
  item_uid         text not null,                 -- menu item uid from public_menus
  name_he          text not null,
  name_en          text,
  variant          text,                          -- "כוס" / "קנקן" / "" when single-price
  unit_agorot      integer not null check (unit_agorot >= 0),
  qty              integer not null check (qty > 0),
  note             text,
  category_id      text,
  category_title   text,
  created_at       timestamptz not null default now(),
  batch_no         integer not null default 1,
  seat_name        text                           -- null = table-wide / shared
);

create index if not exists waiter_order_items_order_idx on public.waiter_order_items (order_id);
create index if not exists waiter_order_items_batch_idx on public.waiter_order_items (order_id, batch_no);

comment on column public.waiter_order_items.seat_name is
  'Snapshot of the guest name. Null means the item belongs to the table, not a person.';

-- ── Ordering rounds ────────────────────────────────────────────────────
-- Customers order in rounds. A round is typed into the register and then
-- LOCKS — its lines can never change, or the app and the register would
-- disagree.
create table if not exists public.waiter_order_batches (
  order_id   uuid not null references public.waiter_orders(id) on delete cascade,
  batch_no   integer not null,
  opened_at  timestamptz not null default now(),
  filed_at   timestamptz,
  primary key (order_id, batch_no)
);

-- ── Append-only audit log ──────────────────────────────────────────────
-- The whole point of moving off paper: knowing who ordered what, when.
-- INSERT only. No UPDATE or DELETE policy is ever granted — a correction is a
-- new event, never an edit.
create table if not exists public.waiter_order_events (
  id         bigserial primary key,
  order_id   uuid not null,          -- intentionally not FK: the log outlives its order
  event      text not null,
  actor      text,                   -- waiter name (becomes a snapshot in 020)
  payload    jsonb,
  at         timestamptz not null default now()
);

create index if not exists waiter_order_events_order_idx on public.waiter_order_events (order_id, at);

comment on table public.waiter_order_events is
  'APPEND ONLY. Never add an UPDATE or DELETE policy — corrections are new rows.';

-- The event vocabulary, stated once. Dropped and re-added so this file is the
-- single place the list lives, and re-running it can never leave the old
-- narrower constraint in place on a database that already had one.
alter table public.waiter_order_events
  drop constraint if exists waiter_order_events_event_check;
alter table public.waiter_order_events
  add constraint waiter_order_events_event_check
  check (event in (
    'opened','item_added','qty_changed','item_removed','filed','paid','voided',
    'reopened','note_changed','batch_opened','batch_filed','seat_added','seat_removed'
  ));

-- ── The canvas the tables sit on ───────────────────────────────────────
-- One row. `id` is pinned so an upsert can never create a second floor.
create table if not exists public.waiter_floor (
  id          integer primary key default 1 check (id = 1),
  canvas_w    integer not null default 560 check (canvas_w between 240 and 4000),
  canvas_h    integer not null default 720 check (canvas_h between 240 and 4000),
  -- Flips true once every table has been placed; until then the app falls
  -- back to the plain list picker.
  configured  boolean not null default false,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

insert into public.waiter_floor (id) values (1) on conflict (id) do nothing;

-- APPEND ONLY, same rule as the order events. Rearranging the floor is a real
-- act with real consequences (a waiter looks for table 7 where it used to be),
-- so it is recorded, not overwritten.
create table if not exists public.waiter_floor_history (
  id          bigserial primary key,
  actor       text,
  canvas_w    integer,
  canvas_h    integer,
  layout      jsonb not null,        -- full snapshot, not a delta
  at          timestamptz not null default now()
);

comment on table public.waiter_floor_history is
  'APPEND ONLY. One row per save of the floor plan. Never add UPDATE/DELETE.';

-- ── RLS on, policies deliberately absent (see the header) ──────────────
alter table public.waiter_tables        enable row level security;
alter table public.waiter_orders        enable row level security;
alter table public.waiter_order_items   enable row level security;
alter table public.waiter_order_batches enable row level security;
alter table public.waiter_order_events  enable row level security;
alter table public.waiter_floor         enable row level security;
alter table public.waiter_floor_history enable row level security;

-- NOTE: the starter floor from the source migration (tables 1–12 + bar 101) is
-- deliberately NOT seeded here. Production already holds the real layout the
-- owner arranged, and seeding invented rows would collide with it on
-- waiter_tables.number. A local database gets the real floor from
-- scripts/seed-local.mjs instead.
