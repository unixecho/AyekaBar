-- ============================================================
-- Ayeka Bar — the real floor: multiple floors, props, table shapes/sizes,
-- Owners/VIP labels, and waiter assignment.
--
-- Spec §5 + v2 deltas (PLAN_STAFF_APP.md §6b). Everything here is additive;
-- nothing the currently-deployed staff app reads is altered or dropped, so
-- this can land in production before the new build ships without breaking it.
--
-- ── Identity helper used by the triggers here and in 023 ────────────────
-- The staff app talks PostgREST directly — there is no API layer to stamp
-- actors server-side. So the DATABASE stamps them: current_staff_id()
-- resolves auth.uid() to a public.staff row, and triggers overwrite whatever
-- the client sent. Under the service role auth.uid() is null and the helper
-- returns null, which lets seeds and owner tooling write freely.
-- ============================================================

create or replace function public.current_staff_id()
returns uuid
language sql
stable
security definer          -- reads public.staff past its own RLS
set search_path = public, pg_temp
as $$
  select id from public.staff where auth_user_id = auth.uid();
$$;

grant execute on function public.current_staff_id() to authenticated;

comment on function public.current_staff_id() is
  'The public.staff.id of the signed-in user, or null (anon / service role). '
  'The trigger-stamped source of truth for every waiter-app actor column.';

-- ---- Floor-manager level (settled 2026-08-12: OP + GM + shift manager) ---
-- Mirrors the access model in src/lib/staff/access.ts. The layout and the
-- Owners/VIP labels are register/admin concerns, not any-waiter concerns.
create or replace function public.is_floor_manager()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff
    where auth_user_id = auth.uid()
      and (role = 'owner' or badge in ('owner', 'general_manager', 'manager'))
  );
$$;

grant execute on function public.is_floor_manager() to authenticated;

comment on function public.is_floor_manager() is
  'May edit the floor layout and set Owners/VIP labels: OP, general manager, or shift manager.';

-- ---- Floors: פנים and חוץ, each its own canvas and layout ----------------
-- The singleton waiter_floor (id=1) is NOT dropped: the deployed app still
-- reads it. It becomes legacy the moment the multi-floor build ships.
create table if not exists public.waiter_floors (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,              -- 'inside' / 'outside'
  name_he     text not null,
  name_en     text,
  name_ar     text,
  canvas_w    integer not null default 560 check (canvas_w between 240 and 4000),
  canvas_h    integer not null default 720 check (canvas_h between 240 and 4000),
  configured  boolean not null default false,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

comment on table public.waiter_floors is
  'Floor plans (inside/outside at minimum). Each carries its own canvas and its own table arrangement.';

-- Seed the two known floors. The inside floor inherits the canvas the owner
-- already configured on the legacy singleton, so the existing layout carries
-- over exactly.
insert into public.waiter_floors (key, name_he, name_en, name_ar, canvas_w, canvas_h, configured, sort_order)
select 'inside', 'פנים', 'Inside', 'الداخل',
       coalesce((select canvas_w from public.waiter_floor where id = 1), 560),
       coalesce((select canvas_h from public.waiter_floor where id = 1), 720),
       coalesce((select configured from public.waiter_floor where id = 1), false),
       0
on conflict (key) do nothing;

insert into public.waiter_floors (key, name_he, name_en, name_ar, sort_order)
values ('outside', 'חוץ', 'Outside', 'الخارج', 1)
on conflict (key) do nothing;

-- ---- Tables: floor, kind, shape, footprint, rotation ---------------------
alter table public.waiter_tables
  add column if not exists floor_id uuid references public.waiter_floors(id),
  add column if not exists kind     text not null default 'regular'
    check (kind in ('regular','large','tall','booth','bar')),
  add column if not exists shape    text not null default 'rect'
    check (shape in ('rect','round')),
  add column if not exists grid_w   integer not null default 1 check (grid_w between 1 and 4),
  add column if not exists grid_h   integer not null default 1 check (grid_h between 1 and 4),
  add column if not exists rotation integer not null default 0
    check (rotation in (0, 90, 180, 270));

comment on column public.waiter_tables.grid_w is
  'Footprint width in magnet-grid cells. A big family table is 2×1 or 2×2; the map draws it that much larger.';
comment on column public.waiter_tables.rotation is
  'Degrees. 90/270 swap the effective footprint (grid_w×grid_h → grid_h×grid_w).';

-- Every existing table already lives on the inside floor except the ones the
-- owner zoned as חוץ.
update public.waiter_tables
set floor_id = (select id from public.waiter_floors where key = case when zone = 'חוץ' then 'outside' else 'inside' end)
where floor_id is null;

-- The bar counter the owner placed (number 101, zone בר) is physically a bar,
-- not a regular table — reflect that in its kind so the map draws it right.
update public.waiter_tables set kind = 'bar', grid_w = 2
where zone = 'בר' and kind = 'regular';

-- ---- Owners / VIP labels + assignment ------------------------------------
alter table public.waiter_tables
  add column if not exists label_kind      text
    check (label_kind is null or label_kind in ('owners','vip')),
  add column if not exists label_set_by    uuid references public.staff(id),
  add column if not exists label_set_at    timestamptz,
  add column if not exists held_by_staff_id uuid references public.staff(id),
  add column if not exists held_since       timestamptz;

comment on column public.waiter_tables.label_kind is
  'Owners / VIP / null. ORTHOGONAL to everything: never assigns a waiter, never creates an order, never blocks the flow (§4, §17.9–10).';
comment on column public.waiter_tables.held_by_staff_id is
  'The waiter currently holding this table. Assignment is a first-class fact — a table can be taken before anything is ordered.';

-- ---- Enforcement trigger --------------------------------------------------
-- RLS is row-level, not column-level, so the column-specific rules live in a
-- trigger. Three rules, in increasing strictness:
--
--   any staff       may take a table FOR THEMSELVES or release any hold
--                   (clearing a colleague's stale hold at 02:00 must not
--                   require a manager). held_by is checked against the
--                   session, so "assign to someone else" or "assign as a
--                   fake identity" cannot be expressed at all.
--   floor managers  may additionally change the Owners/VIP label and edit
--                   the layout: position, kind, shape, footprint, rotation,
--                   floor, number, zone, seats, active — and add new tables.
--   service role    bypasses everything (owner tooling, seeds).
create or replace function public.waiter_tables_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := public.current_staff_id();
begin
  if auth.uid() is null then
    return new;                        -- service role
  end if;

  if tg_op = 'INSERT' then
    if not public.is_floor_manager() then
      raise exception 'only a floor manager may add tables'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.label_kind is distinct from old.label_kind then
    if not public.is_floor_manager() then
      raise exception 'only a floor manager may change the Owners/VIP label'
        using errcode = '42501';
    end if;
    new.label_set_by := me;
    new.label_set_at := now();
  end if;

  if (new.pos_x, new.pos_y, new.kind, new.shape, new.grid_w, new.grid_h,
      new.rotation, new.floor_id, new.number, new.zone, new.seats,
      new.active, new.label)
     is distinct from
     (old.pos_x, old.pos_y, old.kind, old.shape, old.grid_w, old.grid_h,
      old.rotation, old.floor_id, old.number, old.zone, old.seats,
      old.active, old.label)
  then
    if not public.is_floor_manager() then
      raise exception 'only a floor manager may edit the floor layout'
        using errcode = '42501';
    end if;
  end if;

  if new.held_by_staff_id is distinct from old.held_by_staff_id then
    if new.held_by_staff_id is not null and new.held_by_staff_id <> me then
      raise exception 'a table can only be assigned to yourself'
        using errcode = '42501';
    end if;
    new.held_since := case when new.held_by_staff_id is null then null else now() end;
  end if;

  return new;
end;
$$;

drop trigger if exists waiter_tables_guard on public.waiter_tables;
create trigger waiter_tables_guard
  before insert or update on public.waiter_tables
  for each row execute function public.waiter_tables_guard();

-- ---- Props: spacing, walls, plants, stations — and the hostess bar -------
-- Layout furniture that occupies grid cells but takes no orders. The hostess
-- bar is a prop kind, not a special table: landmarks don't have tabs.
create table if not exists public.waiter_floor_props (
  id          uuid primary key default gen_random_uuid(),
  floor_id    uuid not null references public.waiter_floors(id) on delete cascade,
  kind        text not null
    check (kind in ('hostess','wall','divider','plant','spacer','station','custom')),
  label       text,                              -- shown for 'custom', optional otherwise
  pos_x       real,                              -- centre, 0–100 (%), same as tables
  pos_y       real,
  grid_w      integer not null default 1 check (grid_w between 1 and 6),
  grid_h      integer not null default 1 check (grid_h between 1 and 6),
  rotation    integer not null default 0 check (rotation in (0, 90, 180, 270)),
  active      boolean not null default true,     -- deactivate, never delete (house rule)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists waiter_floor_props_floor_idx on public.waiter_floor_props (floor_id) where active;

comment on table public.waiter_floor_props is
  'Non-interactive layout objects. They block magnet-grid cells for realistic spacing but hold no orders.';

-- ---- Layout audit carries the actor and the floor ------------------------
-- waiter_floor_history keeps its full-snapshot model (a snapshot per save is
-- more robust than deltas; the previous→new diff is derivable). It gains the
-- authoritative actor id — the text `actor` column stays as a name snapshot —
-- and which floor the save touched. Snapshots now include kind/shape/
-- grid/rotation/label per table and the full props list (written by the app).
alter table public.waiter_floor_history
  add column if not exists actor_staff_id uuid references public.staff(id),
  add column if not exists floor_id       uuid references public.waiter_floors(id);

create or replace function public.waiter_floor_history_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    new.actor_staff_id := public.current_staff_id();
  end if;
  return new;
end;
$$;

drop trigger if exists waiter_floor_history_stamp on public.waiter_floor_history;
create trigger waiter_floor_history_stamp
  before insert on public.waiter_floor_history
  for each row execute function public.waiter_floor_history_stamp();

-- ---- RLS -----------------------------------------------------------------
alter table public.waiter_floors      enable row level security;
alter table public.waiter_floor_props enable row level security;

-- Reading the floor is every waiter's job; editing it is a floor manager's.
drop policy if exists waiter_floors_read  on public.waiter_floors;
drop policy if exists waiter_floors_write on public.waiter_floors;
create policy waiter_floors_read on public.waiter_floors
  for select to authenticated using (public.is_staff_client());
create policy waiter_floors_write on public.waiter_floors
  for all to authenticated
  using (public.is_floor_manager()) with check (public.is_floor_manager());

drop policy if exists waiter_props_read  on public.waiter_floor_props;
drop policy if exists waiter_props_write on public.waiter_floor_props;
create policy waiter_props_read on public.waiter_floor_props
  for select to authenticated using (public.is_staff_client());
create policy waiter_props_write on public.waiter_floor_props
  for all to authenticated
  using (public.is_floor_manager()) with check (public.is_floor_manager());
