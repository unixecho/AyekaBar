-- ============================================================
-- Ayeka Bar — Shift scheduling.
--
-- ⚠️ NOT APPLIED. This file is the data-model proposal that accompanies the
-- prototype at /owner/schedule. The prototype runs entirely on browser
-- storage; nothing here has touched any database, local or production.
-- Applying it is a separate, explicit decision — see PLAN_SHIFTS.md §Rollout.
--
-- Numbered 027: this was drafted as 026, and a concurrent session landed
-- 026_waiter_floor_landmarks.sql first. Nothing here depends on that file.
--
-- WHAT IT ADDS
-- A venue-scoped scheduling module: who works when, what the safety limits
-- are, a draft the manager builds privately, and a published snapshot the team
-- reads. Nothing existing is altered. `public.staff` is referenced and never
-- modified — the roster stays exactly where it is, which is the contract
-- STAFF_APP.md sets for anything that touches it.
--
-- THREE DESIGN DECISIONS WORTH THE READING TIME
--
-- 1. EVERY ROW CARRIES venue_id, and one venue is seeded. Ayeka Bar is a
--    single bar and does not need multi-tenancy today; the column costs one
--    integer per row and means a second venue is an INSERT rather than a
--    schema migration. The existing tables are deliberately NOT retrofitted —
--    `public.staff` is read by two applications and every auth guard, and
--    widening it is a risk this feature does not need to take.
--
-- 2. TIMES ARE WALL-CLOCK (date + time), NOT timestamptz. "22:00–02:00" is
--    four hours to everyone who reads the schedule, including on the two
--    nights a year Israel changes its clocks. Storing instants would make one
--    of those nights three hours and the other five, and the rest-hours engine
--    would flag a violation nobody committed. `shift_intervals` below converts
--    to comparable absolute minutes, mirroring src/lib/shifts/time.ts.
--
-- 3. PUBLISHING COPIES, IT DOES NOT FLAG. `schedule_weeks.published_snapshot`
--    is a frozen JSONB copy of the week, and staff read that snapshot through
--    a view — never the live rows. It is the same guarantee `menus.published`
--    + `public_menus` already give the menu: "invisible until published" is a
--    property of the data model, not a rule the UI has to remember.
--
-- Mirrors src/lib/shifts/access.ts. `is_schedule_manager()` and
-- `canManageSchedule()` must change together — `is_op()` drifting from
-- `isOp()` is a bug this codebase has already paid for once.
-- ============================================================

-- ── Venues ─────────────────────────────────────────────────────────────

create table if not exists public.venues (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           jsonb not null,                    -- {"he":…,"en":…,"ar":…}
  timezone       text not null default 'Asia/Jerusalem',
  -- 0 = Sunday. Israel's working week; configurable so a clone elsewhere is
  -- not stuck with it.
  week_starts_on smallint not null default 0 check (week_starts_on between 0 and 6),
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

comment on table public.venues is
  'Physical venues. One row today (ayeka-bar); a second bar is an INSERT, not a migration.';

insert into public.venues (slug, name)
values ('ayeka-bar', '{"he":"אייכה בר","en":"Ayeka Bar","ar":"بار أييكا"}'::jsonb)
on conflict (slug) do nothing;

-- ── Settings ───────────────────────────────────────────────────────────
-- Presets, roles and stations are JSONB rather than three more tables: they
-- are short ordered lists, always read together, always rewritten whole by the
-- manager panel, and never joined against. Exactly the call `public.menus`
-- makes about categories and items, for the same reasons.

create table if not exists public.shift_settings (
  venue_id          uuid primary key references public.venues(id) on delete cascade,
  working_days      smallint[] not null default '{0,1,2,3,4,5,6}',
  open_time         time not null default '17:00',
  close_time        time not null default '03:00',
  -- Per-weekday override of the pair above, e.g. {"5":{"open":"15:00","close":"01:00"}}
  -- keyed by weekday (0=Sunday) as a JSON string key. Friday/Saturday running
  -- shorter than the rest of the week is the common case; any day may be
  -- overridden. A day absent from this object uses open_time/close_time —
  -- see hoursForDay() in src/lib/shifts/config.ts, which resolves the exact
  -- same fallback client-side.
  day_hours         jsonb not null default '{}'::jsonb,
  presets           jsonb not null default '[]'::jsonb,
  roles             jsonb not null default '[]'::jsonb,
  stations          jsonb not null default '[]'::jsonb,
  safety            jsonb not null default
    '{"maxWeeklyHours":42,"minRestHours":8,"maxDailyHours":12,"maxConsecutiveDays":6}'::jsonb,
  -- Both OFF for Ayeka Bar. Settings rather than environment variables so a
  -- second venue can differ and so the owner can flip one without a deploy —
  -- the same reasoning as app_settings.loyalty_enabled.
  features          jsonb not null default
    '{"ENABLE_AVAILABILITY_SUBMISSIONS":false,"ENABLE_SHIFT_SWAPS":false}'::jsonb,
  -- Individual staff.id values granted scheduling rights on top of the role
  -- rule. Scheduling is the general manager's job UNTIL it is explicitly
  -- handed to a particular shift manager; "אחראי/ת משמרת" is a title several
  -- people hold and only some of them should be drafting the week.
  --
  -- Stored HERE and not as a public.staff column on purpose: staff is shared
  -- with the waiter app and read by middleware with an explicit column list,
  -- so a new column there means every one of those has to learn about
  -- scheduling. This keeps the blast radius inside the module and makes the
  -- grant per-venue for free.
  schedule_managers uuid[] not null default '{}',
  onboarded_at      timestamptz,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id) on delete set null
);

insert into public.shift_settings (venue_id)
select id from public.venues where slug = 'ayeka-bar'
on conflict (venue_id) do nothing;

-- ── Weeks ──────────────────────────────────────────────────────────────

create table if not exists public.schedule_weeks (
  id                 uuid primary key default gen_random_uuid(),
  venue_id           uuid not null references public.venues(id) on delete cascade,
  week_start         date not null,
  status             text not null default 'draft' check (status in ('draft','published')),
  -- Bumped on every publish. Staff see which version they are looking at, so
  -- "I checked yesterday" is an answerable statement.
  version            integer not null default 0,
  published_at       timestamptz,
  published_by       uuid references auth.users(id) on delete set null,
  day_notes          jsonb not null default '{}'::jsonb,   -- {"2026-08-21": "…"}
  -- The frozen copy the team reads. See design note 3 in the header.
  published_snapshot jsonb,
  created_at         timestamptz not null default now(),
  unique (venue_id, week_start)
);

create index if not exists schedule_weeks_venue_idx
  on public.schedule_weeks (venue_id, week_start desc);

comment on column public.schedule_weeks.published_snapshot is
  'Frozen copy of the week at publish time. Staff read this, never the draft rows.';

-- ── Shifts ─────────────────────────────────────────────────────────────

create table if not exists public.shifts (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.venues(id) on delete cascade,
  week_id       uuid not null references public.schedule_weeks(id) on delete cascade,
  shift_date    date not null,
  start_time    time not null,
  end_time      time not null,
  preset_id     text,                                  -- key into settings.presets
  station_id    text,                                  -- key into settings.stations
  requirements  jsonb not null default '[]'::jsonb,    -- [{roleId,min,max?}]
  note          text not null default '',
  -- An end at or before the start means the shift runs past midnight, which is
  -- the normal case for a bar rather than an error.
  crosses_midnight boolean generated always as (end_time <= start_time) stored,
  duration_minutes integer generated always as (
    ((extract(hour from end_time) * 60 + extract(minute from end_time))
     - (extract(hour from start_time) * 60 + extract(minute from start_time))
     + case when end_time <= start_time then 1440 else 0 end)::int
  ) stored,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null
);

create index if not exists shifts_week_idx on public.shifts (week_id, shift_date);
create index if not exists shifts_venue_date_idx on public.shifts (venue_id, shift_date);

-- ── Assignments ────────────────────────────────────────────────────────

create table if not exists public.shift_assignments (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references public.venues(id) on delete cascade,
  shift_id    uuid not null references public.shifts(id) on delete cascade,
  -- NULLABLE, and the name is snapshotted beside it. The owner can remove
  -- someone from the roster at /owner/dashboard, and that must not fail with a
  -- foreign-key error, nor silently erase who worked last Friday. `on delete
  -- set null` + a name snapshot is the same trade menu_audit already makes for
  -- its actor.
  staff_id    uuid references public.staff(id) on delete set null,
  staff_name  text not null,
  role_id     text not null,                            -- key into settings.roles
  status      text not null default 'assigned' check (status in ('assigned','swap_pending')),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  -- One person cannot hold the same role twice on one shift. They also cannot
  -- hold two DIFFERENT roles on one shift, but that is a judgement the rules
  -- engine reports rather than a constraint — a manager fixing a schedule at
  -- 2am should get a warning, not a database error.
  unique (shift_id, staff_id, role_id)
);

create index if not exists shift_assignments_shift_idx on public.shift_assignments (shift_id);
create index if not exists shift_assignments_staff_idx on public.shift_assignments (staff_id);

-- ── Availability (feature-flagged) ─────────────────────────────────────

create table if not exists public.shift_availability (
  id           uuid primary key default gen_random_uuid(),
  venue_id     uuid not null references public.venues(id) on delete cascade,
  staff_id     uuid not null references public.staff(id) on delete cascade,
  week_start   date not null,
  -- [{date, kind: 'unavailable'|'prefer'|'partial', from?, to?}]
  -- "available" is the absence of a record: the default is that you can work,
  -- and only the exceptions are stored.
  entries      jsonb not null default '[]'::jsonb,
  note         text not null default '',
  status       text not null default 'draft' check (status in ('draft','submitted')),
  submitted_at timestamptz,
  unique (venue_id, staff_id, week_start)
);

-- ── Swaps (feature-flagged) ────────────────────────────────────────────

create table if not exists public.shift_swaps (
  id                uuid primary key default gen_random_uuid(),
  venue_id          uuid not null references public.venues(id) on delete cascade,
  assignment_id     uuid not null references public.shift_assignments(id) on delete cascade,
  from_staff_id     uuid not null references public.staff(id) on delete cascade,
  -- Null while the offer is open to the whole team.
  to_staff_id       uuid references public.staff(id) on delete set null,
  status            text not null default 'open'
                    check (status in ('open','peer_accepted','approved','rejected','cancelled')),
  reason            text not null default '',
  created_at        timestamptz not null default now(),
  peer_responded_at timestamptz,
  decided_at        timestamptz,
  decided_by        uuid references auth.users(id) on delete set null,
  decision_note     text not null default ''
);

create index if not exists shift_swaps_status_idx on public.shift_swaps (venue_id, status, created_at desc);

-- ── Audit ──────────────────────────────────────────────────────────────
-- APPEND ONLY. Select and insert policies only — never an update, never a
-- delete. A correction is a new row. Same rule as waiter_order_events.

create table if not exists public.shift_audit (
  id          bigserial primary key,
  venue_id    uuid not null,
  at          timestamptz not null default now(),
  actor_id    uuid,
  -- Snapshotted, so removing someone from the roster later does not erase what
  -- they did.
  actor_name  text,
  actor_email text,
  action      text not null,
  summary     text not null,
  diff        jsonb not null default '{}'::jsonb
);

create index if not exists shift_audit_venue_idx on public.shift_audit (venue_id, at desc);

comment on table public.shift_audit is
  'APPEND ONLY. Never add an UPDATE or DELETE policy — corrections are new rows.';

-- ── Absolute-minute view ───────────────────────────────────────────────
-- The SQL mirror of intervalOf() in src/lib/shifts/time.ts: whole days since
-- the epoch × 1440 + minutes into the day, so overlap and rest questions are
-- integer comparisons that behave identically in the database and the browser.

create or replace view public.shift_intervals
with (security_invoker = true) as
  select
    s.id            as shift_id,
    s.venue_id,
    s.week_id,
    s.shift_date,
    ((s.shift_date - date '1970-01-01') * 1440
      + extract(hour from s.start_time) * 60
      + extract(minute from s.start_time))::bigint as abs_start_min,
    ((s.shift_date - date '1970-01-01') * 1440
      + extract(hour from s.start_time) * 60
      + extract(minute from s.start_time)
      + s.duration_minutes)::bigint                as abs_end_min,
    s.duration_minutes
  from public.shifts s;

comment on view public.shift_intervals is
  'Wall-clock shifts as absolute minutes. Mirrors intervalOf() in src/lib/shifts/time.ts.';

-- ============================================================
-- Access
-- ============================================================

create or replace function public.is_schedule_manager(p_venue uuid)
returns boolean
language sql
stable
security definer          -- reads public.staff past that table's own RLS
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.staff s
    left join public.shift_settings ss on ss.venue_id = p_venue
    where s.auth_user_id = auth.uid()
      and (
        s.role = 'owner'
        or s.badge in ('owner', 'general_manager')
        or s.id = any (coalesce(ss.schedule_managers, '{}'::uuid[]))
      )
  );
$$;

grant execute on function public.is_schedule_manager(uuid) to authenticated;

comment on function public.is_schedule_manager(uuid) is
  'May draft and publish this venue''s schedule: OP, the general manager, or a '
  'staff.id explicitly listed in shift_settings.schedule_managers. Mirrors '
  'canManageSchedule() in src/lib/shifts/access.ts — change both together.';

/** The signed-in user's own staff.id, for the "my rows only" policies. */
create or replace function public.current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id from public.staff s where s.auth_user_id = auth.uid();
$$;

grant execute on function public.current_staff_id() to authenticated;

-- ============================================================
-- RLS
-- ============================================================

alter table public.venues             enable row level security;
alter table public.shift_settings     enable row level security;
alter table public.schedule_weeks     enable row level security;
alter table public.shifts             enable row level security;
alter table public.shift_assignments  enable row level security;
alter table public.shift_availability enable row level security;
alter table public.shift_swaps        enable row level security;
alter table public.shift_audit        enable row level security;

-- Venues and settings: any signed-in staff member may READ (the staff view
-- needs role names, station names and the feature flags to render at all).
-- Only a schedule manager may write.
drop policy if exists venues_read on public.venues;
create policy venues_read on public.venues
  for select to authenticated using (public.is_staff_client());

drop policy if exists shift_settings_read on public.shift_settings;
create policy shift_settings_read on public.shift_settings
  for select to authenticated using (public.is_staff_client());

drop policy if exists shift_settings_write on public.shift_settings;
create policy shift_settings_write on public.shift_settings
  for all to authenticated
  using (public.is_schedule_manager(venue_id))
  with check (public.is_schedule_manager(venue_id));

-- The draft is manager-only, at the row level. This is the whole "invisible
-- until published" guarantee: an ordinary staff member selecting from these
-- three tables gets zero rows, whatever the client asks for.
drop policy if exists schedule_weeks_manage on public.schedule_weeks;
create policy schedule_weeks_manage on public.schedule_weeks
  for all to authenticated
  using (public.is_schedule_manager(venue_id))
  with check (public.is_schedule_manager(venue_id));

drop policy if exists shifts_manage on public.shifts;
create policy shifts_manage on public.shifts
  for all to authenticated
  using (public.is_schedule_manager(venue_id))
  with check (public.is_schedule_manager(venue_id));

drop policy if exists shift_assignments_manage on public.shift_assignments;
create policy shift_assignments_manage on public.shift_assignments
  for all to authenticated
  using (public.is_schedule_manager(venue_id))
  with check (public.is_schedule_manager(venue_id));

-- Availability: each person owns their own row; managers read the venue's.
drop policy if exists shift_availability_own on public.shift_availability;
create policy shift_availability_own on public.shift_availability
  for all to authenticated
  using (staff_id = public.current_staff_id())
  with check (staff_id = public.current_staff_id());

drop policy if exists shift_availability_manager_read on public.shift_availability;
create policy shift_availability_manager_read on public.shift_availability
  for select to authenticated using (public.is_schedule_manager(venue_id));

-- Swaps: staff see the venue's requests (an open offer is addressed to
-- everyone), may create their own and may accept someone else's. The decision
-- is NOT a policy — it goes through decide_shift_swap() below, because
-- approving is what moves the assignment and that has to be one transaction.
drop policy if exists shift_swaps_read on public.shift_swaps;
create policy shift_swaps_read on public.shift_swaps
  for select to authenticated using (public.is_staff_client());

drop policy if exists shift_swaps_create on public.shift_swaps;
create policy shift_swaps_create on public.shift_swaps
  for insert to authenticated
  with check (from_staff_id = public.current_staff_id() and status = 'open');

drop policy if exists shift_swaps_respond on public.shift_swaps;
create policy shift_swaps_respond on public.shift_swaps
  for update to authenticated
  using (
    -- the person who offered it may cancel…
    from_staff_id = public.current_staff_id()
    -- …and a colleague may take an open offer aimed at them or at everyone
    or (status = 'open' and (to_staff_id is null or to_staff_id = public.current_staff_id()))
  )
  with check (status in ('open', 'peer_accepted', 'cancelled'));

-- Audit: managers read; writes come only from the definer functions below.
drop policy if exists shift_audit_read on public.shift_audit;
create policy shift_audit_read on public.shift_audit
  for select to authenticated using (public.is_schedule_manager(venue_id));

-- ── What staff actually read ───────────────────────────────────────────
-- Published snapshots, and nothing else. Runs as its owner so it can see past
-- schedule_weeks' manager-only policy; the WHERE clause re-gates it per
-- caller. Same construction as waiter_staff_directory and public_menus.

drop view if exists public.published_schedule;

create view public.published_schedule
with (security_invoker = false, security_barrier = true) as
  select
    w.venue_id,
    w.week_start,
    w.version,
    w.published_at,
    w.day_notes,
    w.published_snapshot
  from public.schedule_weeks w
  where w.status = 'published'
    and w.published_snapshot is not null
    and public.is_staff_client();

grant select on public.published_schedule to authenticated;

comment on view public.published_schedule is
  'The only schedule surface ordinary staff can read: published snapshots. '
  'Drafts are unreachable, not merely hidden.';

-- ============================================================
-- Operations that must be atomic
--
-- Publish, copy, clear and swap-approval each do check + write + audit. Doing
-- any of them as read-then-write in a route handler is the defect that broke
-- the redeem endpoint (migration 008): two managers publishing at once, or an
-- edit landing mid-publish, and the team is shown a week that never existed.
-- ============================================================

create or replace function public.log_shift_audit(
  p_venue uuid, p_action text, p_summary text, p_diff jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_email text;
begin
  select coalesce(nullif(trim(s.display_name), ''),
                  nullif(trim(concat_ws(' ', s.first_name, s.last_name)), ''),
                  s.email),
         s.email
    into v_name, v_email
  from public.staff s
  where s.auth_user_id = auth.uid();

  insert into public.shift_audit (venue_id, actor_id, actor_name, actor_email, action, summary, diff)
  values (p_venue, auth.uid(), v_name, v_email, p_action, p_summary, p_diff);
exception when others then
  -- Deliberately swallowed, exactly like logAudit() in lib/owner/audit.ts: a
  -- failed audit write must not roll back the change the manager actually
  -- made. A missing log line beats a publish that appears to have failed.
  null;
end;
$$;

create or replace function public.publish_schedule_week(p_week uuid)
returns public.schedule_weeks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_week public.schedule_weeks;
  v_snapshot jsonb;
begin
  select * into v_week from public.schedule_weeks where id = p_week for update;
  if not found then
    raise exception 'schedule week % not found', p_week using errcode = 'no_data_found';
  end if;
  if not public.is_schedule_manager(v_week.venue_id) then
    raise exception 'not a schedule manager' using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'shifts', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', s.id, 'date', s.shift_date,
        'start', to_char(s.start_time, 'HH24:MI'),
        'end', to_char(s.end_time, 'HH24:MI'),
        'presetId', s.preset_id, 'stationId', s.station_id,
        'requirements', s.requirements, 'note', s.note,
        'assignments', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', a.id, 'staffId', a.staff_id, 'staffName', a.staff_name,
            'roleId', a.role_id, 'status', a.status
          )), '[]'::jsonb)
          from public.shift_assignments a where a.shift_id = s.id
        )
      ) order by s.shift_date, s.start_time
    ), '[]'::jsonb)
  ) into v_snapshot
  from public.shifts s
  where s.week_id = v_week.id;

  update public.schedule_weeks
     set status = 'published',
         version = version + 1,
         published_at = now(),
         published_by = auth.uid(),
         published_snapshot = v_snapshot
   where id = p_week
  returning * into v_week;

  perform public.log_shift_audit(
    v_week.venue_id, 'week.publish',
    format('פורסם סידור לשבוע %s (גרסה %s)', v_week.week_start, v_week.version),
    jsonb_build_object('weekStart', v_week.week_start, 'version', v_week.version)
  );

  return v_week;
end;
$$;

grant execute on function public.publish_schedule_week(uuid) to authenticated;

create or replace function public.unpublish_schedule_week(p_week uuid)
returns public.schedule_weeks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_week public.schedule_weeks;
begin
  select * into v_week from public.schedule_weeks where id = p_week for update;
  if not found or not public.is_schedule_manager(v_week.venue_id) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  update public.schedule_weeks
     set status = 'draft', published_at = null, published_by = null, published_snapshot = null
   where id = p_week
  returning * into v_week;

  perform public.log_shift_audit(
    v_week.venue_id, 'week.unpublish',
    format('השבוע %s הוחזר לטיוטה', v_week.week_start),
    jsonb_build_object('weekStart', v_week.week_start)
  );

  return v_week;
end;
$$;

grant execute on function public.unpublish_schedule_week(uuid) to authenticated;

create or replace function public.copy_schedule_week(p_venue uuid, p_from date, p_to date)
returns public.schedule_weeks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.schedule_weeks;
  v_target public.schedule_weeks;
  v_offset integer := p_to - p_from;
  v_count integer;
begin
  if not public.is_schedule_manager(p_venue) then
    raise exception 'not a schedule manager' using errcode = 'insufficient_privilege';
  end if;

  select * into v_source from public.schedule_weeks
   where venue_id = p_venue and week_start = p_from;
  if not found then
    raise exception 'source week % not found', p_from using errcode = 'no_data_found';
  end if;

  insert into public.schedule_weeks (venue_id, week_start)
  values (p_venue, p_to)
  on conflict (venue_id, week_start) do update set week_start = excluded.week_start
  returning * into v_target;

  -- The target's own draft is replaced, not merged. "Copy last week" onto a
  -- half-built week that then contains both is nobody's intent.
  delete from public.shifts where week_id = v_target.id;

  with copied as (
    insert into public.shifts (
      venue_id, week_id, shift_date, start_time, end_time,
      preset_id, station_id, requirements, note, created_by
    )
    select s.venue_id, v_target.id, s.shift_date + v_offset, s.start_time, s.end_time,
           s.preset_id, s.station_id, s.requirements, s.note, auth.uid()
    from public.shifts s
    where s.week_id = v_source.id
    returning id, shift_date, start_time
  ),
  paired as (
    -- Match copies back to their sources by (date, start), which is unique
    -- enough within a week and avoids threading ids through the INSERT.
    select c.id as new_id, s.id as old_id
    from copied c
    join public.shifts s
      on s.week_id = v_source.id
     and s.shift_date + v_offset = c.shift_date
     and s.start_time = c.start_time
  )
  insert into public.shift_assignments (venue_id, shift_id, staff_id, staff_name, role_id, created_by)
  select p_venue, p.new_id, a.staff_id, a.staff_name, a.role_id, auth.uid()
  from paired p
  join public.shift_assignments a on a.shift_id = p.old_id;

  get diagnostics v_count = row_count;

  perform public.log_shift_audit(
    p_venue, 'week.copy',
    format('הועתק סידור מ-%s ל-%s', p_from, p_to),
    jsonb_build_object('from', p_from, 'to', p_to, 'assignments', v_count)
  );

  return v_target;
end;
$$;

grant execute on function public.copy_schedule_week(uuid, date, date) to authenticated;

create or replace function public.clear_schedule_week(p_week uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_week public.schedule_weeks;
  v_count integer;
begin
  select * into v_week from public.schedule_weeks where id = p_week;
  if not found or not public.is_schedule_manager(v_week.venue_id) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  delete from public.shifts where week_id = p_week;
  get diagnostics v_count = row_count;

  perform public.log_shift_audit(
    v_week.venue_id, 'week.clear',
    format('נוקו %s משמרות מהשבוע %s', v_count, v_week.week_start),
    jsonb_build_object('weekStart', v_week.week_start, 'removed', v_count)
  );

  return v_count;
end;
$$;

grant execute on function public.clear_schedule_week(uuid) to authenticated;

create or replace function public.decide_shift_swap(
  p_swap uuid, p_approve boolean, p_note text default ''
)
returns public.shift_swaps
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_swap public.shift_swaps;
  v_name text;
begin
  select * into v_swap from public.shift_swaps where id = p_swap for update;
  if not found or not public.is_schedule_manager(v_swap.venue_id) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  -- A swap only reaches a manager once a colleague has agreed to take it.
  -- Approving an offer nobody accepted would leave the shift unstaffed.
  if v_swap.status <> 'peer_accepted' or v_swap.to_staff_id is null then
    raise exception 'swap % is not awaiting a decision', p_swap using errcode = 'invalid_parameter_value';
  end if;

  update public.shift_swaps
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_at = now(), decided_by = auth.uid(), decision_note = coalesce(p_note, '')
   where id = p_swap
  returning * into v_swap;

  if p_approve then
    select coalesce(nullif(trim(s.display_name), ''),
                    nullif(trim(concat_ws(' ', s.first_name, s.last_name)), ''),
                    s.email)
      into v_name
    from public.staff s where s.id = v_swap.to_staff_id;

    -- Approval is the ONLY thing that moves the shift. Until now the original
    -- person was still on the hook, which is the entire reason the approval
    -- step exists.
    update public.shift_assignments
       set staff_id = v_swap.to_staff_id, staff_name = coalesce(v_name, staff_name), status = 'assigned'
     where id = v_swap.assignment_id;
  else
    update public.shift_assignments set status = 'assigned' where id = v_swap.assignment_id;
  end if;

  perform public.log_shift_audit(
    v_swap.venue_id,
    case when p_approve then 'swap.approve' else 'swap.reject' end,
    case when p_approve then 'החלפת משמרת אושרה' else 'החלפת משמרת נדחתה' end,
    jsonb_build_object('swapId', p_swap, 'note', p_note)
  );

  return v_swap;
end;
$$;

grant execute on function public.decide_shift_swap(uuid, boolean, text) to authenticated;

-- ── Diagnostic ─────────────────────────────────────────────────────────
-- The scheduling twin of staff_access_levels: run it when someone reports
-- "it won't let me build the schedule" and read the answer rather than
-- guessing. No grants — service role / SQL editor only.

create or replace view public.schedule_access_levels as
  select
    v.slug as venue,
    s.id,
    s.email,
    s.display_name,
    s.role,
    s.badge,
    case
      when s.role = 'owner' or s.badge = 'owner' then 'op'
      when s.badge = 'general_manager' then 'general_manager'
      when s.id = any (coalesce(ss.schedule_managers, '{}'::uuid[])) then 'delegated'
      else 'view_only'
    end as schedule_access
  from public.venues v
  cross join public.staff s
  left join public.shift_settings ss on ss.venue_id = v.id;

comment on view public.schedule_access_levels is
  'Diagnostic: who can manage which venue''s schedule, and why.';

-- ============================================================
-- Verify (run after applying, as an ordinary staff member — NOT the owner)
--
--   -- must return 0 rows: the draft is unreachable, not merely hidden
--   select count(*) from public.shifts;
--   select count(*) from public.schedule_weeks;
--
--   -- must return the published week
--   select week_start, version from public.published_schedule;
--
--   -- must be false for a plain staff member, true for the GM
--   select public.is_schedule_manager(
--     (select id from public.venues where slug = 'ayeka-bar'));
--
-- And re-run scripts/check-isolation.mjs afterwards: the staff app must still
-- be unable to touch anything this migration created.
-- ============================================================
