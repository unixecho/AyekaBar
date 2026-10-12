-- AyekaBar scheduler rollout: migrations 052 + 053 + 054 + 055 as ONE script, in one transaction (all or nothing).
-- Paste into the Supabase SQL editor and run once. Generated from supabase/migrations/05[2-5]_*.sql; those files stay the source of truth.
-- Requires 051 already applied (production is at 051). Safe to re-run: every statement is idempotent.
begin;

-- ===== supabase/migrations/052_scheduling_backbone.sql =====
-- =====================================================================
-- 052_scheduling_backbone.sql — the scheduling database layer, brought up
-- to the model Sarcafe's scheduler runs on.
--
-- Re-runnable (idempotent): every statement is IF NOT EXISTS / OR REPLACE /
-- DROP ... IF EXISTS / guarded, so a retry after a partial failure converges.
--
-- WHY THIS EXISTS
--
--  Migration 027 shipped the scheduler with the browser as the writer: RLS
--  decided who could write, and five SECURITY DEFINER functions authorised
--  through auth.uid(). Sarcafe (which started as a copy of 027) has since
--  moved to a server-authoritative model that fixed a long list of real
--  defects (see docs/STAFF_SCHEDULING.md here, and Sarcafe's copy of it):
--
--   * every state-changing function takes the ACTOR EXPLICITLY (p_actor =
--     staff.id, resolved by the server guard from the session, never from a
--     request body) and is executable by service_role only;
--   * a person can never hold two overlapping shifts — a deferred constraint
--     trigger enforces it even against a bug in a function, with a per-person
--     advisory lock so two managers racing cannot both win;
--   * a PENDING swap or request never touches shift_assignments — only an
--     approval does, and an approval also patches the published snapshot so
--     employees see the change immediately;
--   * deleting an assignment / clearing a week no longer cascade-deletes swap
--     history;
--   * requests ("I would like to work this shift"), swaps (give, exchange and
--     take), an in-app notification inbox, an optimistic-concurrency token on
--     every shift save, and a per-shift "open to requests" switch.
--
--  Single venue: Sarcafe scopes everything by branch_id; here the same column
--  is venue_id (027's own name), and "which venue" is the one seeded row.
--  There is no per-venue staff scoping in this app, so "may view" is simply
--  "is an active staff member".
--
-- THE BRIDGE (section 0) is the part with no Sarcafe equivalent. Production
-- already holds 027-shaped data, so before the new functions can run it:
--   * stores shift times as 'HH:MM' text (027 used `time`) and rewrites the
--     published snapshots from 027's nested/camelCase shape to the flat shape
--     the new functions and the TypeScript both read;
--   * flattens the trilingual role/station/template names to Hebrew text (the
--     scheduler is a Hebrew-only staff screen) and renames template start/end
--     to startTime/endTime, keeping every other field the owner configured;
--   * renames the feature switches to availability / swaps and TURNS THEM ON
--     (027 shipped them off pending this very release);
--   * gives every active person an explicit schedule_members row, switched
--     OFF exactly as 027 treated "no row" — nobody becomes schedulable by
--     this migration — and keeps that true for people added later.
-- Nothing is deleted: the old SQL entry points are dropped (section R) and
-- the old tables only widen.
--
-- Result convention (like Sarcafe's, like pos_*): functions return jsonb
--   { ok: true, ... }  or  { ok: false, reason: '<code>', details: {...} }
-- Expected business refusals are NOT exceptions; the app maps `reason` to
-- plain Hebrew (lib/shifts/messages.ts).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Bridge from 027's shape
-- ---------------------------------------------------------------------

-- 0a. Shift times become wall-clock 'HH:MM' text. `time` could not be compared
--     as plain strings, and 027's generated columns / view hung off it.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'shifts'
                and column_name = 'start_time' and data_type like 'time%') then
    drop view if exists public.shift_intervals;
    alter table public.shifts drop column if exists crosses_midnight;
    alter table public.shifts drop column if exists duration_minutes;
    alter table public.shifts alter column start_time type text using to_char(start_time, 'HH24:MI');
    alter table public.shifts alter column end_time type text using to_char(end_time, 'HH24:MI');
  end if;
end;
$$;

alter table public.shifts add column if not exists updated_at timestamptz not null default now();
alter table public.shifts add column if not exists requests_open boolean not null default false;
alter table public.schedule_weeks add column if not exists updated_at timestamptz not null default now();
alter table public.shift_availability add column if not exists updated_at timestamptz not null default now();

-- Wall-clock HH:MM only. NOT VALID = enforced for every new/updated row without
-- re-scanning anything written before this migration.
alter table public.shifts drop constraint if exists shifts_time_format;
alter table public.shifts add constraint shifts_time_format
  check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') not valid;

-- 0b. Columns the new functions write as NULL ("no note", "no reason", a person
--     whose row was removed) were NOT NULL in 027.
alter table public.shifts alter column note drop not null;
alter table public.shift_assignments alter column staff_name drop not null;
alter table public.shift_assignments alter column role_id drop not null;
alter table public.shift_availability alter column note drop not null;
alter table public.shift_swaps alter column reason drop not null;
alter table public.shift_swaps alter column decision_note drop not null;
alter table public.schedule_members alter column employment_type drop not null;
alter table public.schedule_members alter column employment_type drop default;
alter table public.schedule_members alter column note drop not null;
alter table public.schedule_members alter column note drop default;
alter table public.schedule_members add column if not exists updated_at timestamptz not null default now();

-- 0c. Audit rows: 027 called the columns `at` / `diff`; the new functions (and
--     the screens) say created_at / detail and also record the acting staff id.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shift_audit' and column_name = 'at') then
    alter table public.shift_audit rename column "at" to created_at;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shift_audit' and column_name = 'diff') then
    alter table public.shift_audit rename column diff to detail;
  end if;
end;
$$;
alter table public.shift_audit add column if not exists actor_staff_id uuid;
alter table public.shift_audit alter column summary drop not null;

-- 0d. Published snapshots: 027 stored {shifts:[{id,date,start,end,presetId,…,
--     assignments:[{id,staffId,staffName,roleId,status}]}]}. The new functions and
--     the TypeScript read the flat shape {shifts:[<shifts row>], assignments:[<row>]}
--     (to_jsonb of the real rows, snake_case) that sched_publish_week writes.
--     Only snapshots still in the old shape are converted.
update public.schedule_weeks w
   set published_snapshot = jsonb_build_object(
         'shifts', coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', sh ->> 'id', 'venue_id', w.venue_id, 'week_id', w.id,
                    'shift_date', sh ->> 'date',
                    'start_time', left(coalesce(sh ->> 'start', ''), 5), 'end_time', left(coalesce(sh ->> 'end', ''), 5),
                    'preset_id', sh -> 'presetId', 'station_id', sh -> 'stationId',
                    'requirements', coalesce(sh -> 'requirements', '[]'::jsonb),
                    'requests_open', false, 'note', sh ->> 'note') order by sh ->> 'date', sh ->> 'start')
             from jsonb_array_elements(w.published_snapshot -> 'shifts') sh), '[]'::jsonb),
         'assignments', coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', a ->> 'id', 'venue_id', w.venue_id, 'shift_id', sh ->> 'id',
                    'staff_id', a -> 'staffId', 'staff_name', a -> 'staffName',
                    'role_id', a -> 'roleId', 'status', coalesce(a ->> 'status', 'assigned')))
             from jsonb_array_elements(w.published_snapshot -> 'shifts') sh,
                  jsonb_array_elements(coalesce(sh -> 'assignments', '[]'::jsonb)) a), '[]'::jsonb)),
       updated_at = now()
 where w.published_snapshot is not null
   and jsonb_typeof(w.published_snapshot -> 'shifts') = 'array'
   and not (w.published_snapshot ? 'assignments');

-- 0e. Settings catalogs. Hebrew text names; templates say startTime/endTime;
--     every other field the owner configured (colours, emoji, a template's
--     default staffing, a role's staff badge …) is kept as it is.
update public.shift_settings s
   set roles = coalesce((select jsonb_agg(
         r || jsonb_build_object('name', case when jsonb_typeof(r -> 'name') = 'object'
                                              then coalesce(nullif(r -> 'name' ->> 'he', ''), nullif(r -> 'name' ->> 'en', ''), r ->> 'id')
                                              else r ->> 'name' end))
         from jsonb_array_elements(s.roles) r), '[]'::jsonb)
 where exists (select 1 from jsonb_array_elements(s.roles) r where jsonb_typeof(r -> 'name') = 'object');

update public.shift_settings s
   set stations = coalesce((select jsonb_agg(
         jsonb_strip_nulls(st || jsonb_build_object('name', case when jsonb_typeof(st -> 'name') = 'object'
                                              then coalesce(nullif(st -> 'name' ->> 'he', ''), nullif(st -> 'name' ->> 'en', ''), st ->> 'id')
                                              else st ->> 'name' end)))
         from jsonb_array_elements(s.stations) st), '[]'::jsonb)
 where exists (select 1 from jsonb_array_elements(s.stations) st where jsonb_typeof(st -> 'name') = 'object');

update public.shift_settings s
   set presets = coalesce((select jsonb_agg(
         jsonb_strip_nulls((p - 'start' - 'end') || jsonb_build_object(
           'name', case when jsonb_typeof(p -> 'name') = 'object'
                        then coalesce(nullif(p -> 'name' ->> 'he', ''), nullif(p -> 'name' ->> 'en', ''), p ->> 'id')
                        else p ->> 'name' end,
           'startTime', left(coalesce(p ->> 'startTime', p ->> 'start', '07:00'), 5),
           'endTime', left(coalesce(p ->> 'endTime', p ->> 'end', '15:00'), 5))))
         from jsonb_array_elements(s.presets) p), '[]'::jsonb)
 where exists (select 1 from jsonb_array_elements(s.presets) p where p ? 'start' or jsonb_typeof(p -> 'name') = 'object');

-- 0f. Feature switches: new names, and ON (see the header).
update public.shift_settings
   set features = jsonb_build_object('availability', true, 'swaps', true)
 where features ? 'ENABLE_SHIFT_SWAPS' or features ? 'ENABLE_AVAILABILITY_SUBMISSIONS';
alter table public.shift_settings alter column features set default '{"availability":true,"swaps":true}'::jsonb;

-- 0g. Warning-severity overrides: the engine now speaks error | warning | off.
update public.shift_settings s
   set rule_severity = coalesce((select jsonb_object_agg(k, case v when 'warn' then 'warning' when 'info' then 'warning' else v end)
                                   from jsonb_each_text(s.rule_severity) as e(k, v)), '{}'::jsonb)
 where exists (select 1 from jsonb_each_text(s.rule_severity) as e(k, v) where v in ('warn', 'info'));

-- 0h. Settings that touched the old view of the roster keep working: the
--     schedule_roster / published_schedule views are left exactly as 027 and 041
--     defined them (they read only staff / schedule_members / schedule_weeks).

-- ---------------------------------------------------------------------
-- A. Staff changes log
-- ---------------------------------------------------------------------
-- Staff changes (deactivate, reactivate, delete ...). No FK on purpose: the
-- trail must outlive the row it describes. Append-only for the app (select +
-- insert grants only).
create table if not exists public.staff_audit (
  id              bigint generated always as identity primary key,
  staff_id        uuid,
  staff_name      text,
  actor_staff_id  uuid,
  actor_name      text,
  action          text not null,
  summary         text,
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists staff_audit_staff_idx on public.staff_audit (staff_id, created_at desc);
alter table public.staff_audit enable row level security;
revoke all on public.staff_audit from public, anon, authenticated;
grant select, insert on public.staff_audit to service_role;

-- ---------------------------------------------------------------------
-- B. Shifts / assignments: stricter shape
-- ---------------------------------------------------------------------
-- A pending swap used to flip the live assignment to 'swap_pending'. Pending is
-- now derived from shift_swaps; the schedule itself is left alone until approval.
update public.shift_assignments set status = 'assigned' where status = 'swap_pending';

-- One person once per shift (any role). 027's unique(shift_id, staff_id,
-- role_id) did not stop the same person twice under two roles. Older duplicates
-- carry no extra information: keep the oldest.
delete from public.shift_assignments a
 using public.shift_assignments b
 where a.shift_id = b.shift_id and a.staff_id = b.staff_id and a.staff_id is not null
   and (a.created_at, a.id) > (b.created_at, b.id);
create unique index if not exists shift_assignments_one_per_shift
  on public.shift_assignments (shift_id, staff_id) where staff_id is not null;

-- ---------------------------------------------------------------------
-- C. shift_swaps: keep history, add the exchange + the peer-decline state
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.shift_swaps'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.shift_swaps drop constraint %I', r.conname);
  end loop;
  for r in
    select c.conname from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.conrelid = 'public.shift_swaps'::regclass and c.contype = 'f' and a.attname = 'assignment_id'
  loop
    execute format('alter table public.shift_swaps drop constraint %I', r.conname);
  end loop;
end;
$$;

alter table public.shift_swaps alter column assignment_id drop not null;
alter table public.shift_swaps
  add constraint shift_swaps_assignment_id_fkey
  foreign key (assignment_id) references public.shift_assignments(id) on delete set null;
alter table public.shift_swaps
  add constraint shift_swaps_status_check
  check (status in ('open', 'peer_accepted', 'approved', 'rejected', 'declined', 'cancelled'));

alter table public.shift_swaps
  add column if not exists return_assignment_id uuid references public.shift_assignments(id) on delete set null,
  add column if not exists from_staff_name      text,
  add column if not exists to_staff_name        text,
  add column if not exists terms                jsonb not null default '{}'::jsonb,
  add column if not exists cancel_reason        text,
  add column if not exists decided_by_staff     uuid references public.staff(id) on delete set null,
  add column if not exists updated_at           timestamptz not null default now(),
  -- 'give': started by the person giving a shift away (hand-over or exchange).
  -- 'take': started by the person who WANTS a colleague's shift; the holder answers.
  add column if not exists direction            text not null default 'give';
alter table public.shift_swaps drop constraint if exists shift_swaps_direction_check;
alter table public.shift_swaps add constraint shift_swaps_direction_check check (direction in ('give', 'take'));

-- One live swap per assignment, whichever side of the exchange it is on.
create unique index if not exists shift_swaps_one_active_per_assignment
  on public.shift_swaps (assignment_id) where status in ('open', 'peer_accepted') and assignment_id is not null;
create unique index if not exists shift_swaps_one_active_per_return
  on public.shift_swaps (return_assignment_id) where status in ('open', 'peer_accepted') and return_assignment_id is not null;

-- ---------------------------------------------------------------------
-- D. New tables
-- ---------------------------------------------------------------------
-- "I would like to work this shift." Never touches shift_assignments until a
-- manager approves it. The shift's date/time are snapshotted in `terms` so the
-- request stays readable after the shift is edited or removed.
create table if not exists public.shift_requests (
  id               uuid primary key default gen_random_uuid(),
  venue_id         uuid not null references public.venues(id) on delete cascade,
  shift_id         uuid references public.shifts(id) on delete set null,
  staff_id         uuid not null references public.staff(id) on delete cascade,
  staff_name       text,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  note             text check (note is null or char_length(note) <= 300),
  terms            jsonb not null default '{}'::jsonb,
  decision_note    text,
  decided_at       timestamptz,
  decided_by_staff uuid references public.staff(id) on delete set null,
  cancel_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists shift_requests_one_pending
  on public.shift_requests (shift_id, staff_id) where status = 'pending' and shift_id is not null;
create index if not exists shift_requests_venue_status_idx on public.shift_requests (venue_id, status, created_at desc);
create index if not exists shift_requests_staff_idx on public.shift_requests (staff_id, created_at desc);

-- The in-app inbox. Text is composed (in Hebrew) at write time so a notification
-- still reads correctly after the shift or the person has changed.
create table if not exists public.schedule_notifications (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references public.venues(id) on delete cascade,
  staff_id    uuid not null references public.staff(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  link        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists schedule_notifications_staff_idx on public.schedule_notifications (staff_id, created_at desc);
create index if not exists schedule_notifications_unread_idx on public.schedule_notifications (staff_id) where read_at is null;

alter table public.shift_requests enable row level security;
alter table public.schedule_notifications enable row level security;
-- Service role only: the app reads and writes through requireSchedule*() guards,
-- never from a browser session.
revoke all on public.shift_requests, public.schedule_notifications from public, anon, authenticated;
grant all on public.shift_requests, public.schedule_notifications to service_role;

-- Every write to the schedule goes through the app's server (service role),
-- which authorises first. A browser session holding the anon key must not be
-- able to write around the new rules, whatever the RLS policies say.
revoke insert, update, delete on public.shift_settings, public.schedule_members, public.schedule_weeks,
  public.shifts, public.shift_assignments, public.shift_availability, public.shift_swaps, public.shift_audit from authenticated;
grant all on public.shift_settings, public.schedule_members, public.schedule_weeks, public.shifts,
  public.shift_assignments, public.shift_availability, public.shift_swaps, public.shift_audit, public.venues to service_role;

-- Swaps: 027 let every staff member read every swap and write their own from the
-- browser. A swap one colleague aimed at another is nobody else's business: a
-- browser may read its own swaps, swaps addressed to it, and swaps open to ANYONE.
drop policy if exists shift_swaps_read on public.shift_swaps;
drop policy if exists shift_swaps_create on public.shift_swaps;
drop policy if exists shift_swaps_respond on public.shift_swaps;
drop policy if exists "swap visibility" on public.shift_swaps;
drop policy if exists shift_swaps_visibility on public.shift_swaps;
create policy shift_swaps_visibility on public.shift_swaps
  for select to authenticated using (
    public.is_schedule_manager(venue_id)
    or from_staff_id = public.current_staff_id()
    or to_staff_id = public.current_staff_id()
    or (status = 'open' and to_staff_id is null and public.is_staff_client())
  );

-- ---------------------------------------------------------------------
-- E. Small pure helpers
-- ---------------------------------------------------------------------
-- The one name every screen, audit row and notification uses.
create or replace function public.sched_name(p_staff uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(btrim(s.display_name), ''),
    nullif(btrim(concat_ws(' ', nullif(btrim(s.first_name), ''), nullif(btrim(s.last_name), ''))), ''),
    nullif(btrim(s.email), ''),
    'ללא שם')
  from public.staff s where s.id = p_staff;
$$;

-- "07:00–13:00", isolated (U+2066 … U+2069) so a time range keeps its clock order inside a
-- right-to-left sentence instead of reading "13:00–07:00". The TS twin is isolatedRange().
create or replace function public.sched_range_text(p_start text, p_end text)
returns text
language sql
immutable
as $$
  select chr(8294) || p_start || '–' || p_end || chr(8297);
$$;

-- "יום שלישי 29/9 · 07:00–13:00"   (TS twin: formatShiftLabel — keep in sync, scripts/check-schedule.mjs asserts it)
create or replace function public.sched_fmt(p_date date, p_start text, p_end text)
returns text
language sql
immutable
as $$
  select 'יום ' || (array['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'])[extract(dow from p_date)::int + 1]
         || ' ' || to_char(p_date, 'FMDD/FMMM') || ' · ' || public.sched_range_text(p_start, p_end);
$$;

-- The wall-clock interval a shift occupies. end <= start means "past midnight".
-- Half-open, so a 13:00 end and a 13:00 start do NOT overlap.
create or replace function public.sched_range(p_date date, p_start text, p_end text)
returns tsrange
language sql
stable
as $$
  select tsrange(
    p_date::timestamp + p_start::time,
    p_date::timestamp + p_start::time
      + case when p_end::time <= p_start::time then (p_end::time - p_start::time) + interval '24 hours'
             else (p_end::time - p_start::time) end,
    '[)');
$$;

create or replace function public.sched_tz(p_venue uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select timezone from public.venues where id = p_venue), 'Asia/Jerusalem');
$$;

-- Has this shift already started (in the venue's own clock)?
create or replace function public.sched_is_past(p_venue uuid, p_date date, p_start text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select ((p_date::timestamp + p_start::time) at time zone public.sched_tz(p_venue)) <= now();
$$;

-- Total headcount a shift declares it needs (sum of the per-role minimums).
create or replace function public.sched_needed(p_requirements jsonb)
returns integer
language sql
immutable
as $$
  select coalesce(sum(case when (r.v ->> 'min') ~ '^[0-9]+$' then (r.v ->> 'min')::int else 0 end), 0)::int
    from jsonb_array_elements(case when jsonb_typeof(p_requirements) = 'array' then p_requirements else '[]'::jsonb end) as r(v);
$$;

create or replace function public.sched_fail(p_reason text, p_details jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('ok', false, 'reason', p_reason, 'details', coalesce(p_details, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------
-- F. Authorisation twins of lib/shifts/access.ts, by explicit staff id.
--    KEEP IN SYNC with that file (the bug class 000_core_schema warns about).
-- ---------------------------------------------------------------------
create or replace function public.sched_can_view(p_staff uuid, p_venue uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff s where s.id = p_staff and s.active);
$$;

create or replace function public.sched_can_manage(p_staff uuid, p_venue uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff s
     where s.id = p_staff and s.active
       and (
         s.role = 'owner' or s.badge = 'owner'
         or s.badge = 'general_manager'
         or s.id = any (coalesce((select ss.schedule_managers from public.shift_settings ss where ss.venue_id = p_venue), '{}'::uuid[]))
       ));
$$;

create or replace function public.sched_manager_ids(p_venue uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(s.id), '{}'::uuid[])
    from public.staff s where s.active and public.sched_can_manage(s.id, p_venue);
$$;

-- Owners only (staff management is owner-only in this app).
create or replace function public.sched_is_op(p_staff uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff s where s.id = p_staff and s.active and (s.role = 'owner' or s.badge = 'owner'));
$$;

-- ---------------------------------------------------------------------
-- G. Logging + notifying
-- ---------------------------------------------------------------------
create or replace function public.sched_log(p_venue uuid, p_actor uuid, p_action text, p_summary text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth uuid;
  v_email text;
begin
  select s.auth_user_id, s.email into v_auth, v_email from public.staff s where s.id = p_actor;
  insert into public.shift_audit (venue_id, actor_id, actor_staff_id, actor_name, actor_email, action, summary, detail)
  values (p_venue, v_auth, p_actor, public.sched_name(p_actor), v_email, p_action, p_summary, coalesce(p_detail, '{}'::jsonb));
exception when others then
  -- A failed audit write must never undo the real change it describes.
  null;
end;
$$;

create or replace function public.staff_log(p_actor uuid, p_target uuid, p_action text, p_summary text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.staff_audit (staff_id, staff_name, actor_staff_id, actor_name, action, summary, detail)
  values (p_target, public.sched_name(p_target), p_actor, public.sched_name(p_actor), p_action, p_summary, coalesce(p_detail, '{}'::jsonb));
exception when others then
  null;
end;
$$;

-- In-app notification. Only people who can actually open the app (active, with a
-- linked sign-in) get a row: an unclaimed name-only employee has nowhere to read
-- it. Rows older than 90 days are swept for the people being notified.
create or replace function public.sched_notify(p_venue uuid, p_staff uuid[], p_kind text, p_title text, p_body text, p_link jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_staff is null or array_length(p_staff, 1) is null then
    return;
  end if;
  insert into public.schedule_notifications (venue_id, staff_id, kind, title, body, link)
  select p_venue, s.id, p_kind, p_title, p_body, coalesce(p_link, '{}'::jsonb)
    from public.staff s
   where s.id = any (p_staff) and s.active and s.auth_user_id is not null;
  delete from public.schedule_notifications where staff_id = any (p_staff) and created_at < now() - interval '90 days';
end;
$$;

-- ---------------------------------------------------------------------
-- H. Conflicts: the overlap rule, in one place
-- ---------------------------------------------------------------------
-- Every shift this person already holds that overlaps p_range.
create or replace function public.sched_conflicts(
  p_staff uuid, p_range tsrange, p_ignore_assignments uuid[] default '{}', p_ignore_shift uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'assignmentId', a.id, 'shiftId', s.id, 'venueId', s.venue_id,
           'date', s.shift_date, 'start', s.start_time, 'end', s.end_time,
           'label', public.sched_fmt(s.shift_date, s.start_time, s.end_time)
         ) order by s.shift_date, s.start_time), '[]'::jsonb)
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
   where a.staff_id = p_staff
     and not (a.id = any (coalesce(p_ignore_assignments, '{}'::uuid[])))
     and (p_ignore_shift is null or s.id <> p_ignore_shift)
     and s.shift_date between (lower(p_range)::date - 1) and (upper(p_range)::date + 1)
     and public.sched_range(s.shift_date, s.start_time, s.end_time) && p_range;
$$;

-- Serialises everything that decides "is this person free?" for one person.
create or replace function public.sched_lock_staff(p_staff uuid)
returns void
language sql
as $$
  select pg_advisory_xact_lock(hashtext('sched:staff:' || p_staff::text));
$$;

-- Several people at once, ALWAYS in the same (sorted) order — two decisions that each need the same
-- two people can then never wait on each other in opposite order (a deadlock).
create or replace function public.sched_lock_staff_many(p_staff uuid[])
returns void
language plpgsql
as $$
declare
  v uuid;
begin
  for v in select distinct x from unnest(coalesce(p_staff, '{}'::uuid[])) as x where x is not null order by x loop
    perform public.sched_lock_staff(v);
  end loop;
end;
$$;

-- The backstop. Deferred, so a multi-row change (an exchange swaps two people
-- between two shifts) is judged on the FINAL state, not row by row.
create or replace function public.sched_assignment_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_range tsrange;
begin
  if new.staff_id is null then
    return null;
  end if;
  if not exists (select 1 from public.shift_assignments a where a.id = new.id) then
    return null; -- inserted and removed again within the same transaction
  end if;
  perform public.sched_lock_staff(new.staff_id);
  select public.sched_range(s.shift_date, s.start_time, s.end_time) into v_range from public.shifts s where s.id = new.shift_id;
  if v_range is null then
    return null;
  end if;
  if jsonb_array_length(public.sched_conflicts(new.staff_id, v_range, array[new.id], null)) > 0 then
    raise exception 'sched_overlap';
  end if;
  return null;
end;
$$;

create or replace function public.sched_shift_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r record;
  v_range tsrange;
begin
  if not exists (select 1 from public.shifts x where x.id = new.id) then
    return null;
  end if;
  v_range := public.sched_range(new.shift_date, new.start_time, new.end_time);
  for r in select a.id, a.staff_id from public.shift_assignments a where a.shift_id = new.id and a.staff_id is not null loop
    perform public.sched_lock_staff(r.staff_id);
    if jsonb_array_length(public.sched_conflicts(r.staff_id, v_range, array[r.id], null)) > 0 then
      raise exception 'sched_overlap';
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists shift_assignments_no_overlap on public.shift_assignments;
create constraint trigger shift_assignments_no_overlap
  after insert or update of staff_id, shift_id on public.shift_assignments
  deferrable initially deferred
  for each row execute function public.sched_assignment_guard();

drop trigger if exists shifts_no_overlap on public.shifts;
create constraint trigger shifts_no_overlap
  after update of shift_date, start_time, end_time on public.shifts
  deferrable initially deferred
  for each row execute function public.sched_shift_guard();

-- ---------------------------------------------------------------------
-- I. Published-snapshot patching. Staff read ONLY the frozen snapshot, so an
--    approved swap / request must be written there too, but nothing else the
--    manager has drafted since may leak out with it.
-- ---------------------------------------------------------------------
create or replace function public.sched_in_snapshot(p_week uuid, p_kind text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.schedule_weeks w, jsonb_array_elements(w.published_snapshot -> p_kind) e(v)
     where w.id = p_week and w.status = 'published' and e.v ->> 'id' = p_id::text);
$$;

create or replace function public.sched_snapshot_set_assignee(p_week uuid, p_assignment uuid, p_staff uuid, p_name text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.schedule_weeks w
     set published_snapshot = jsonb_set(
           w.published_snapshot, '{assignments}',
           coalesce((select jsonb_agg(case when e.v ->> 'id' = p_assignment::text
                                           then e.v || jsonb_build_object('staff_id', p_staff, 'staff_name', p_name)
                                           else e.v end)
                       from jsonb_array_elements(w.published_snapshot -> 'assignments') e(v)), '[]'::jsonb))
   where w.id = p_week and w.status = 'published' and w.published_snapshot is not null;
$$;

create or replace function public.sched_snapshot_add_assignment(p_week uuid, p_assignment uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.schedule_weeks w
     set published_snapshot = jsonb_set(
           w.published_snapshot, '{assignments}',
           coalesce(w.published_snapshot -> 'assignments', '[]'::jsonb) || (select to_jsonb(a) from public.shift_assignments a where a.id = p_assignment))
   where w.id = p_week and w.status = 'published' and w.published_snapshot is not null
     and exists (select 1 from jsonb_array_elements(w.published_snapshot -> 'shifts') s(v)
                  where s.v ->> 'id' = (select a.shift_id::text from public.shift_assignments a where a.id = p_assignment))
     and not exists (select 1 from jsonb_array_elements(w.published_snapshot -> 'assignments') x(v) where x.v ->> 'id' = p_assignment::text);
$$;

-- ---------------------------------------------------------------------
-- J. Invalidation: what a schedule change does to open requests / swaps
-- ---------------------------------------------------------------------
create or replace function public.sched_assignment_terms(p_assignment uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'assignmentId', a.id, 'shiftId', s.id, 'weekId', s.week_id, 'venueId', s.venue_id,
           'date', s.shift_date, 'start', s.start_time, 'end', s.end_time, 'presetId', s.preset_id,
           'roleId', a.role_id, 'staffId', a.staff_id,
           'staffName', coalesce(public.sched_name(a.staff_id), a.staff_name),
           'label', public.sched_fmt(s.shift_date, s.start_time, s.end_time))
    from public.shift_assignments a join public.shifts s on s.id = a.shift_id
   where a.id = p_assignment;
$$;

-- Cancel every live swap that involves this assignment (either side) and tell
-- the people it affected. The swap row survives as history.
create or replace function public.sched_cancel_swaps_for_assignment(p_assignment uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select * from public.shift_swaps
     where (assignment_id = p_assignment or return_assignment_id = p_assignment) and status in ('open', 'peer_accepted')
     for update
  loop
    update public.shift_swaps
       set status = 'cancelled', cancel_reason = p_reason, decided_at = now(), updated_at = now()
     where id = r.id;
    n := n + 1;
    perform public.sched_notify(r.venue_id, array_remove(array[r.from_staff_id, r.to_staff_id], null),
      'swap.cancelled', 'בקשת ההחלפה בוטלה',
      p_reason || coalesce(' · ' || (r.terms -> 'from' ->> 'label'), ''), jsonb_build_object('tab', 'requests'));
    if r.status = 'peer_accepted' then
      perform public.sched_notify(r.venue_id, public.sched_manager_ids(r.venue_id),
        'swap.cancelled', 'בקשת החלפה שהמתינה לאישור בוטלה', p_reason, jsonb_build_object('tab', 'requests'));
    end if;
  end loop;
  return n;
end;
$$;

create or replace function public.sched_cancel_requests_for_shifts(p_shifts uuid[], p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select * from public.shift_requests where shift_id = any (p_shifts) and status = 'pending' for update
  loop
    update public.shift_requests
       set status = 'cancelled', cancel_reason = p_reason, decided_at = now(), updated_at = now()
     where id = r.id;
    n := n + 1;
    perform public.sched_notify(r.venue_id, array[r.staff_id], 'request.cancelled', 'הבקשה שלך בוטלה',
      p_reason || coalesce(' · ' || (r.terms ->> 'label'), ''), jsonb_build_object('tab', 'requests'));
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- K. Saving a shift: ONE atomic action for "the sheet's Save button".
--    Times + station + needs + note + exactly who is on it. Either all of it
--    is applied or none of it is.
--    p_assignees: [{ assignmentId?: uuid, staffId: uuid, roleId?: text }]
--      with assignmentId  -> keep that person (role may change)
--      without            -> add that person
--      an existing assignment not listed -> removed
-- ---------------------------------------------------------------------
create or replace function public.sched_save_shift(
  p_actor uuid, p_week_id uuid, p_shift_id uuid,
  p_date date, p_start text, p_end text,
  p_preset_id text, p_station_id text, p_requirements jsonb, p_requests_open boolean, p_note text,
  p_assignees jsonb, p_expected_updated text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week public.schedule_weeks%rowtype;
  v_shift public.shifts%rowtype;
  v_venue uuid;
  v_range tsrange;
  v_time_changed boolean := false;
  v_item jsonb;
  v_staff uuid;
  v_aid uuid;
  v_role text;
  v_keep uuid[] := '{}';
  v_seen uuid[] := '{}';
  v_conflicts jsonb := '[]'::jsonb;
  v_conf jsonb;
  v_new_id uuid;
  v_added text[] := '{}';
  v_removed text[] := '{}';
  v_old_label text;
  v_ex record;
  v_assignment_id uuid;
  v_reqs jsonb := coalesce(p_requirements, '[]'::jsonb);
  v_list jsonb := coalesce(p_assignees, '[]'::jsonb);
begin
  select * into v_week from public.schedule_weeks where id = p_week_id for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  v_venue := v_week.venue_id;
  if not public.sched_can_manage(p_actor, v_venue) then
    return public.sched_fail('forbidden');
  end if;
  if p_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_start = p_end then
    return public.sched_fail('bad_time');
  end if;
  if p_date is null or p_date < v_week.week_start or p_date > v_week.week_start + 6 then
    return public.sched_fail('bad_date');
  end if;
  if jsonb_typeof(v_reqs) <> 'array' or jsonb_typeof(v_list) <> 'array' or jsonb_array_length(v_list) > 60 then
    return public.sched_fail('bad_request');
  end if;
  if p_note is not null and char_length(p_note) > 300 then
    return public.sched_fail('bad_request');
  end if;

  if p_shift_id is not null then
    select * into v_shift from public.shifts where id = p_shift_id for update;
    if not found or v_shift.week_id <> p_week_id then
      return public.sched_fail('not_found');
    end if;
    if p_expected_updated is not null and v_shift.updated_at <> p_expected_updated::timestamptz then
      return public.sched_fail('stale');
    end if;
    v_time_changed := (v_shift.shift_date <> p_date or v_shift.start_time <> p_start or v_shift.end_time <> p_end);
    v_old_label := public.sched_fmt(v_shift.shift_date, v_shift.start_time, v_shift.end_time);
  end if;

  v_range := public.sched_range(p_date, p_start, p_end);

  -- Everyone this save touches is locked first, in a fixed order, so two managers editing different
  -- weeks that share a person cannot deadlock — and so each "is this person free?" answer below is final.
  perform public.sched_lock_staff_many(array(select (e.v ->> 'staffId')::uuid from jsonb_array_elements(v_list) e(v)));

  -- ---- validate the people (no writes yet) ----
  for v_item in select * from jsonb_array_elements(v_list) loop
    v_staff := (v_item ->> 'staffId')::uuid;
    v_aid := nullif(v_item ->> 'assignmentId', '')::uuid;
    if v_staff = any (v_seen) then
      return public.sched_fail('duplicate_person', jsonb_build_object('staffId', v_staff, 'name', public.sched_name(v_staff)));
    end if;
    v_seen := v_seen || v_staff;

    if v_aid is not null then
      -- an existing assignment being kept: must really be on this shift
      if not exists (select 1 from public.shift_assignments a where a.id = v_aid and a.shift_id = p_shift_id) then
        return public.sched_fail('stale');
      end if;
      v_keep := v_keep || v_aid;
    else
      if not exists (select 1 from public.staff s where s.id = v_staff and s.active) then
        return public.sched_fail('inactive_staff', jsonb_build_object('staffId', v_staff, 'name', public.sched_name(v_staff)));
      end if;
      if exists (select 1 from public.schedule_members m where m.venue_id = v_venue and m.staff_id = v_staff and not m.schedulable) then
        return public.sched_fail('not_schedulable', jsonb_build_object('staffId', v_staff, 'name', public.sched_name(v_staff)));
      end if;
    end if;

    if v_aid is null or v_time_changed then
      perform public.sched_lock_staff(v_staff);
      v_conf := public.sched_conflicts(v_staff, v_range, '{}', p_shift_id);
      if jsonb_array_length(v_conf) > 0 then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'staffId', v_staff, 'name', public.sched_name(v_staff), 'with', v_conf -> 0));
      end if;
    end if;
  end loop;
  if jsonb_array_length(v_conflicts) > 0 then
    return public.sched_fail('conflict', jsonb_build_object('conflicts', v_conflicts));
  end if;

  -- ---- write ----
  if p_shift_id is null then
    insert into public.shifts (venue_id, week_id, shift_date, start_time, end_time, preset_id, station_id, requirements, requests_open, note)
    values (v_venue, p_week_id, p_date, p_start, p_end, nullif(p_preset_id, ''), nullif(p_station_id, ''), v_reqs,
            coalesce(p_requests_open, false), nullif(btrim(coalesce(p_note, '')), ''))
    returning id into v_new_id;
  else
    v_new_id := p_shift_id;
    update public.shifts
       set shift_date = p_date, start_time = p_start, end_time = p_end,
           preset_id = nullif(p_preset_id, ''), station_id = nullif(p_station_id, ''),
           requirements = v_reqs, requests_open = coalesce(p_requests_open, false),
           note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
     where id = p_shift_id;

    -- people no longer listed are removed (their open swaps are cancelled first)
    for v_ex in
      select a.id, a.staff_id, a.staff_name from public.shift_assignments a
       where a.shift_id = p_shift_id and not (a.id = any (v_keep))
    loop
      perform public.sched_cancel_swaps_for_assignment(v_ex.id, 'השיבוץ במשמרת הוסר');
      delete from public.shift_assignments where id = v_ex.id;
      v_removed := v_removed || coalesce(public.sched_name(v_ex.staff_id), v_ex.staff_name, 'עובד/ת שהוסר/ה');
    end loop;

    if v_time_changed then
      for v_ex in select a.id from public.shift_assignments a where a.shift_id = p_shift_id loop
        perform public.sched_cancel_swaps_for_assignment(v_ex.id, 'יום או שעות המשמרת השתנו');
      end loop;
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(v_list) loop
    v_staff := (v_item ->> 'staffId')::uuid;
    v_aid := nullif(v_item ->> 'assignmentId', '')::uuid;
    v_role := nullif(btrim(coalesce(v_item ->> 'roleId', '')), '');
    if v_aid is not null then
      update public.shift_assignments set role_id = v_role where id = v_aid and role_id is distinct from v_role;
    else
      insert into public.shift_assignments (venue_id, shift_id, staff_id, staff_name, role_id)
      values (v_venue, v_new_id, v_staff, public.sched_name(v_staff), v_role)
      returning id into v_assignment_id;
      v_added := v_added || public.sched_name(v_staff);
      -- A pending request for exactly this shift is answered by the manager
      -- simply putting the person on it.
      for v_ex in select r.id, r.staff_id from public.shift_requests r
                   where r.shift_id = v_new_id and r.staff_id = v_staff and r.status = 'pending' for update loop
        update public.shift_requests
           set status = 'approved', decided_at = now(), decided_by_staff = p_actor, decision_note = 'שובצ/ה ישירות על ידי המנהל/ת', updated_at = now()
         where id = v_ex.id;
        perform public.sched_notify(v_venue, array[v_staff], 'request.approved', 'הבקשה שלך אושרה',
          public.sched_fmt(p_date, p_start, p_end), jsonb_build_object('tab', 'schedule', 'weekStart', v_week.week_start));
      end loop;
    end if;
  end loop;

  set constraints all immediate;
  set constraints all deferred;

  perform public.sched_log(v_venue, p_actor,
    case when p_shift_id is null then 'shift.create' else 'shift.update' end,
    case when p_shift_id is null
         then 'יצר/ה משמרת: ' || public.sched_fmt(p_date, p_start, p_end)
         else 'עדכן/ה משמרת: ' || coalesce(v_old_label, '') ||
              case when v_time_changed then ' → ' || public.sched_fmt(p_date, p_start, p_end) else '' end end ||
         case when coalesce(array_length(v_added, 1), 0) > 0 then ' · שובצו: ' || array_to_string(v_added, ', ') else '' end ||
         case when coalesce(array_length(v_removed, 1), 0) > 0 then ' · הוסרו: ' || array_to_string(v_removed, ', ') else '' end,
    jsonb_build_object('shiftId', v_new_id, 'weekId', p_week_id, 'added', v_added, 'removed', v_removed));

  return jsonb_build_object('ok', true, 'shiftId', v_new_id, 'created', p_shift_id is null, 'added', v_added, 'removed', v_removed);
exception when others then
  if sqlerrm = 'sched_overlap' then
    return public.sched_fail('conflict');
  end if;
  if sqlstate in ('22P02', '22007', '22008', '22023') then
    return public.sched_fail('bad_request');
  end if;
  raise;
end;
$$;

create or replace function public.sched_delete_shift(p_actor uuid, p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift public.shifts%rowtype;
  v_week public.schedule_weeks%rowtype;
  v_ex record;
  v_people integer;
  v_requests integer;
begin
  select * into v_shift from public.shifts where id = p_shift_id;
  if not found then
    return public.sched_fail('not_found');
  end if;
  select * into v_week from public.schedule_weeks where id = v_shift.week_id for update;
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if not public.sched_can_manage(p_actor, v_shift.venue_id) then
    return public.sched_fail('forbidden');
  end if;

  select count(*) into v_people from public.shift_assignments where shift_id = p_shift_id;
  for v_ex in select a.id from public.shift_assignments a where a.shift_id = p_shift_id loop
    perform public.sched_cancel_swaps_for_assignment(v_ex.id, 'המשמרת בוטלה');
  end loop;
  v_requests := public.sched_cancel_requests_for_shifts(array[p_shift_id], 'המשמרת בוטלה');
  delete from public.shifts where id = p_shift_id;

  perform public.sched_log(v_shift.venue_id, p_actor, 'shift.delete',
    'מחק/ה משמרת: ' || public.sched_fmt(v_shift.shift_date, v_shift.start_time, v_shift.end_time)
      || case when v_people > 0 then ' (היו משובצים ' || v_people || ')' else '' end,
    jsonb_build_object('shiftId', p_shift_id, 'people', v_people));
  return jsonb_build_object('ok', true, 'people', v_people, 'requestsCancelled', v_requests);
end;
$$;

-- Move one person from their shift to another shift of the same venue.
create or replace function public.sched_move_assignment(p_actor uuid, p_assignment uuid, p_to_shift uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.shift_assignments%rowtype;
  v_from public.shifts%rowtype;
  v_to public.shifts%rowtype;
  v_w1 uuid;
  v_w2 uuid;
  v_conf jsonb;
begin
  select * into v_a from public.shift_assignments where id = p_assignment;
  if not found then
    return public.sched_fail('not_found');
  end if;
  select * into v_from from public.shifts where id = v_a.shift_id;
  select * into v_to from public.shifts where id = p_to_shift;
  if v_to.id is null or v_to.venue_id <> v_from.venue_id then
    return public.sched_fail('not_found');
  end if;
  if not public.sched_can_manage(p_actor, v_from.venue_id) then
    return public.sched_fail('forbidden');
  end if;

  -- lock both weeks in a fixed order (no deadlock between two managers)
  v_w1 := least(v_from.week_id, v_to.week_id);
  v_w2 := greatest(v_from.week_id, v_to.week_id);
  perform 1 from public.schedule_weeks where id in (v_w1, v_w2) order by id for update;
  select * into v_a from public.shift_assignments where id = p_assignment for update;
  if not found or v_a.shift_id <> v_from.id then
    return public.sched_fail('stale');
  end if;
  if v_a.staff_id is null then
    return public.sched_fail('bad_request');
  end if;
  if v_to.id = v_from.id then
    return public.sched_fail('bad_request');
  end if;
  if exists (select 1 from public.shift_assignments x where x.shift_id = v_to.id and x.staff_id = v_a.staff_id) then
    return public.sched_fail('already_assigned', jsonb_build_object('name', public.sched_name(v_a.staff_id)));
  end if;
  perform public.sched_lock_staff(v_a.staff_id);
  v_conf := public.sched_conflicts(v_a.staff_id, public.sched_range(v_to.shift_date, v_to.start_time, v_to.end_time), array[v_a.id], null);
  if jsonb_array_length(v_conf) > 0 then
    return public.sched_fail('conflict', jsonb_build_object('conflicts', jsonb_build_array(jsonb_build_object(
      'staffId', v_a.staff_id, 'name', public.sched_name(v_a.staff_id), 'with', v_conf -> 0))));
  end if;

  perform public.sched_cancel_swaps_for_assignment(v_a.id, 'השיבוץ הועבר למשמרת אחרת');
  update public.shift_assignments set shift_id = v_to.id where id = v_a.id;
  update public.shifts set updated_at = now() where id in (v_from.id, v_to.id);

  set constraints all immediate;
  set constraints all deferred;

  perform public.sched_log(v_from.venue_id, p_actor, 'shift.move',
    'העביר/ה את ' || coalesce(public.sched_name(v_a.staff_id), 'עובד/ת') || ' מ' ||
      public.sched_fmt(v_from.shift_date, v_from.start_time, v_from.end_time) || ' אל ' ||
      public.sched_fmt(v_to.shift_date, v_to.start_time, v_to.end_time),
    jsonb_build_object('assignmentId', v_a.id, 'from', v_from.id, 'to', v_to.id));
  return jsonb_build_object('ok', true);
exception when others then
  if sqlerrm = 'sched_overlap' then
    return public.sched_fail('conflict');
  end if;
  raise;
end;
$$;

-- ---------------------------------------------------------------------
-- L. Weeks: publish / unpublish / clear / copy
-- ---------------------------------------------------------------------
create or replace function public.sched_publish_week(p_actor uuid, p_week_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week public.schedule_weeks%rowtype;
  v_snap jsonb;
  v_old jsonb;
  v_update boolean;
  v_notified integer := 0;
  r record;
begin
  select * into v_week from public.schedule_weeks where id = p_week_id for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if not public.sched_can_manage(p_actor, v_week.venue_id) then
    return public.sched_fail('forbidden');
  end if;

  v_old := v_week.published_snapshot;
  v_update := (v_week.status = 'published' and v_old is not null);

  select jsonb_build_object(
    'shifts', coalesce((select jsonb_agg(to_jsonb(s)) from public.shifts s where s.week_id = p_week_id), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(to_jsonb(a)) from public.shift_assignments a
                              where a.shift_id in (select id from public.shifts where week_id = p_week_id)), '[]'::jsonb))
    into v_snap;

  -- Who is affected, and how — told to them in plain words.
  for r in
    with newr as (
      select (a.v ->> 'staff_id')::uuid as staff_id, (s.v ->> 'id')::uuid as shift_id,
             (s.v ->> 'shift_date')::date as d, s.v ->> 'start_time' as st, s.v ->> 'end_time' as en
        from jsonb_array_elements(v_snap -> 'assignments') a(v)
        join jsonb_array_elements(v_snap -> 'shifts') s(v) on s.v ->> 'id' = a.v ->> 'shift_id'
       where a.v ->> 'staff_id' is not null),
    oldr as (
      select (a.v ->> 'staff_id')::uuid as staff_id, (s.v ->> 'id')::uuid as shift_id,
             (s.v ->> 'shift_date')::date as d, s.v ->> 'start_time' as st, s.v ->> 'end_time' as en
        from jsonb_array_elements(case when v_update then v_old -> 'assignments' else '[]'::jsonb end) a(v)
        join jsonb_array_elements(case when v_update then v_old -> 'shifts' else '[]'::jsonb end) s(v) on s.v ->> 'id' = a.v ->> 'shift_id'
       where a.v ->> 'staff_id' is not null),
    diff as (
      select coalesce(n.staff_id, o.staff_id) as staff_id,
             coalesce(n.d, o.d) as d, coalesce(n.st, o.st) as st,
             case when not v_update then 'משמרת: ' || public.sched_fmt(n.d, n.st, n.en)
                  when o.shift_id is null then 'נוספה: ' || public.sched_fmt(n.d, n.st, n.en)
                  when n.shift_id is null then 'הוסרה: ' || public.sched_fmt(o.d, o.st, o.en)
                  else 'השתנתה: ' || public.sched_fmt(n.d, n.st, n.en) || ' (היה ' || public.sched_range_text(o.st, o.en) || ')' end as line
        from newr n full join oldr o on o.staff_id = n.staff_id and o.shift_id = n.shift_id
       where not v_update or o.shift_id is null or n.shift_id is null
          or (o.d, o.st, o.en) is distinct from (n.d, n.st, n.en))
    select staff_id, string_agg(line, E'\n' order by d, st) as lines from diff group by staff_id
  loop
    perform public.sched_notify(v_week.venue_id, array[r.staff_id], 'schedule.published',
      case when v_update then 'הלוח שלך עודכן' else 'פורסם לוח משמרות' end,
      'שבוע ' || to_char(v_week.week_start, 'FMDD/FMMM') || E'\n' || r.lines,
      jsonb_build_object('tab', 'schedule', 'weekStart', v_week.week_start));
    v_notified := v_notified + 1;
  end loop;

  update public.schedule_weeks
     set status = 'published', version = version + 1, published_at = now(),
         published_by = (select auth_user_id from public.staff where id = p_actor),
         published_snapshot = v_snap, updated_at = now()
   where id = p_week_id;

  perform public.sched_log(v_week.venue_id, p_actor, 'schedule.publish',
    case when v_update then 'פרסם/ה עדכון ללוח שבוע ' else 'פרסם/ה את לוח שבוע ' end || to_char(v_week.week_start, 'FMDD/FMMM'),
    jsonb_build_object('weekId', p_week_id, 'notified', v_notified));
  return jsonb_build_object('ok', true, 'version', v_week.version + 1, 'notified', v_notified, 'update', v_update);
end;
$$;

create or replace function public.sched_unpublish_week(p_actor uuid, p_week_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week public.schedule_weeks%rowtype;
  v_ex record;
  v_swaps integer := 0;
  v_reqs integer;
begin
  select * into v_week from public.schedule_weeks where id = p_week_id for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if not public.sched_can_manage(p_actor, v_week.venue_id) then
    return public.sched_fail('forbidden');
  end if;
  for v_ex in select a.id from public.shift_assignments a join public.shifts s on s.id = a.shift_id where s.week_id = p_week_id loop
    v_swaps := v_swaps + public.sched_cancel_swaps_for_assignment(v_ex.id, 'הלוח הוחזר לטיוטה');
  end loop;
  v_reqs := public.sched_cancel_requests_for_shifts(array(select id from public.shifts where week_id = p_week_id), 'הלוח הוחזר לטיוטה');
  update public.schedule_weeks set status = 'draft', updated_at = now() where id = p_week_id;
  perform public.sched_log(v_week.venue_id, p_actor, 'schedule.unpublish',
    'ביטל/ה את פרסום לוח שבוע ' || to_char(v_week.week_start, 'FMDD/FMMM'), jsonb_build_object('weekId', p_week_id));
  return jsonb_build_object('ok', true, 'swapsCancelled', v_swaps, 'requestsCancelled', v_reqs);
end;
$$;

create or replace function public.sched_clear_week(p_actor uuid, p_week_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week public.schedule_weeks%rowtype;
  v_ex record;
  v_count integer;
begin
  select * into v_week from public.schedule_weeks where id = p_week_id for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if not public.sched_can_manage(p_actor, v_week.venue_id) then
    return public.sched_fail('forbidden');
  end if;
  for v_ex in select a.id from public.shift_assignments a join public.shifts s on s.id = a.shift_id where s.week_id = p_week_id loop
    perform public.sched_cancel_swaps_for_assignment(v_ex.id, 'השבוע נוקה');
  end loop;
  perform public.sched_cancel_requests_for_shifts(array(select id from public.shifts where week_id = p_week_id), 'השבוע נוקה');
  select count(*) into v_count from public.shifts where week_id = p_week_id;
  delete from public.shifts where week_id = p_week_id;
  perform public.sched_log(v_week.venue_id, p_actor, 'schedule.clear',
    'ניקה/תה את לוח שבוע ' || to_char(v_week.week_start, 'FMDD/FMMM') || ' (' || v_count || ' משמרות)',
    jsonb_build_object('weekId', p_week_id, 'shifts', v_count));
  return jsonb_build_object('ok', true, 'shifts', v_count);
end;
$$;

-- Copy a week onto another, REPLACING the target's shifts. People who cannot be
-- copied (inactive, not schedulable, or already busy at that time elsewhere) are
-- skipped and reported — never silently double-booked.
create or replace function public.sched_copy_week(p_actor uuid, p_venue uuid, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from public.schedule_weeks%rowtype;
  v_to public.schedule_weeks%rowtype;
  v_offset integer;
  s record;
  a record;
  v_new uuid;
  v_nd date;
  v_shifts integer := 0;
  v_people integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_ex record;
begin
  if not public.sched_can_manage(p_actor, p_venue) then
    return public.sched_fail('forbidden');
  end if;
  if p_from = p_to or extract(dow from p_from) <> 0 or extract(dow from p_to) <> 0 then
    return public.sched_fail('bad_date');
  end if;
  select * into v_from from public.schedule_weeks where venue_id = p_venue and week_start = p_from;
  if not found then
    return public.sched_fail('source_empty');
  end if;
  insert into public.schedule_weeks (venue_id, week_start) values (p_venue, p_to)
  on conflict (venue_id, week_start) do update set updated_at = now();
  select * into v_to from public.schedule_weeks where venue_id = p_venue and week_start = p_to;
  perform 1 from public.schedule_weeks where id in (v_from.id, v_to.id) order by id for update;

  if not exists (select 1 from public.shifts where week_id = v_from.id) then
    return public.sched_fail('source_empty');
  end if;

  perform public.sched_lock_staff_many(array(
    select a2.staff_id from public.shift_assignments a2 join public.shifts s2 on s2.id = a2.shift_id where s2.week_id = v_from.id and a2.staff_id is not null));

  for v_ex in select x.id from public.shift_assignments x join public.shifts sh on sh.id = x.shift_id where sh.week_id = v_to.id loop
    perform public.sched_cancel_swaps_for_assignment(v_ex.id, 'השבוע הוחלף בהעתקה משבוע אחר');
  end loop;
  perform public.sched_cancel_requests_for_shifts(array(select id from public.shifts where week_id = v_to.id), 'השבוע הוחלף בהעתקה משבוע אחר');
  delete from public.shifts where week_id = v_to.id;

  v_offset := p_to - p_from;
  for s in select * from public.shifts where week_id = v_from.id order by shift_date, start_time loop
    v_nd := s.shift_date + v_offset;
    insert into public.shifts (venue_id, week_id, shift_date, start_time, end_time, preset_id, station_id, requirements, note)
    values (p_venue, v_to.id, v_nd, s.start_time, s.end_time, s.preset_id, s.station_id, s.requirements, s.note)
    returning id into v_new;
    v_shifts := v_shifts + 1;
    for a in select * from public.shift_assignments where shift_id = s.id and staff_id is not null order by created_at loop
      if not exists (select 1 from public.staff st where st.id = a.staff_id and st.active)
         or exists (select 1 from public.schedule_members m where m.venue_id = p_venue and m.staff_id = a.staff_id and not m.schedulable) then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('name', coalesce(public.sched_name(a.staff_id), a.staff_name), 'why', 'inactive', 'label', public.sched_fmt(v_nd, s.start_time, s.end_time)));
        continue;
      end if;
      perform public.sched_lock_staff(a.staff_id);
      if jsonb_array_length(public.sched_conflicts(a.staff_id, public.sched_range(v_nd, s.start_time, s.end_time), '{}', v_new)) > 0 then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('name', public.sched_name(a.staff_id), 'why', 'busy', 'label', public.sched_fmt(v_nd, s.start_time, s.end_time)));
        continue;
      end if;
      insert into public.shift_assignments (venue_id, shift_id, staff_id, staff_name, role_id)
      values (p_venue, v_new, a.staff_id, public.sched_name(a.staff_id), a.role_id);
      v_people := v_people + 1;
    end loop;
  end loop;

  set constraints all immediate;
  set constraints all deferred;

  perform public.sched_log(p_venue, p_actor, 'schedule.copy',
    'העתיק/ה לוח משבוע ' || to_char(p_from, 'FMDD/FMMM') || ' אל שבוע ' || to_char(p_to, 'FMDD/FMMM'),
    jsonb_build_object('from', p_from, 'to', p_to, 'shifts', v_shifts, 'people', v_people, 'skipped', v_skipped));
  return jsonb_build_object('ok', true, 'weekId', v_to.id, 'shifts', v_shifts, 'people', v_people, 'skipped', v_skipped);
exception when others then
  if sqlerrm = 'sched_overlap' then
    return public.sched_fail('conflict');
  end if;
  raise;
end;
$$;

-- ---------------------------------------------------------------------
-- M. Per-person scheduling flags (explicit actor, audited, and "absent key =
--    unchanged / null = clear" for every field — the old coalesce() could never
--    clear a default role).
-- ---------------------------------------------------------------------
create or replace function public.sched_set_member(p_actor uuid, p_venue uuid, p_staff uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
begin
  if not public.sched_can_manage(p_actor, p_venue) then
    return public.sched_fail('forbidden');
  end if;
  if not exists (select 1 from public.staff s where s.id = p_staff) or not public.sched_can_view(p_staff, p_venue) then
    return public.sched_fail('not_found');
  end if;
  if jsonb_typeof(p_patch) <> 'object' then
    return public.sched_fail('bad_request');
  end if;
  if (p_patch ? 'maxWeeklyHours') and (p_patch ->> 'maxWeeklyHours') is not null
     and ((p_patch ->> 'maxWeeklyHours') !~ '^[0-9]{1,3}$' or (p_patch ->> 'maxWeeklyHours')::int > 168) then
    return public.sched_fail('bad_request');
  end if;

  select to_jsonb(m) into v_before from public.schedule_members m where m.venue_id = p_venue and m.staff_id = p_staff;

  insert into public.schedule_members (venue_id, staff_id, schedulable, default_role_id, max_weekly_hours, employment_type, sort_order, note, updated_at)
  values (
    p_venue, p_staff,
    coalesce((p_patch ->> 'schedulable')::boolean, true),
    p_patch ->> 'defaultRoleId',
    (p_patch ->> 'maxWeeklyHours')::integer,
    p_patch ->> 'employmentType',
    (p_patch ->> 'sortOrder')::integer,
    p_patch ->> 'note',
    now())
  on conflict (venue_id, staff_id) do update set
    schedulable      = case when p_patch ? 'schedulable'     then coalesce((p_patch ->> 'schedulable')::boolean, true) else schedule_members.schedulable end,
    default_role_id  = case when p_patch ? 'defaultRoleId'   then p_patch ->> 'defaultRoleId'            else schedule_members.default_role_id end,
    max_weekly_hours = case when p_patch ? 'maxWeeklyHours'  then (p_patch ->> 'maxWeeklyHours')::integer else schedule_members.max_weekly_hours end,
    employment_type  = case when p_patch ? 'employmentType'  then p_patch ->> 'employmentType'           else schedule_members.employment_type end,
    sort_order       = case when p_patch ? 'sortOrder'       then (p_patch ->> 'sortOrder')::integer      else schedule_members.sort_order end,
    note             = case when p_patch ? 'note'            then p_patch ->> 'note'                      else schedule_members.note end,
    updated_at       = now();

  perform public.sched_log(p_venue, p_actor, 'member.update',
    'עדכן/ה הגדרות שיבוץ: ' || coalesce(public.sched_name(p_staff), 'איש/אשת צוות'),
    jsonb_build_object('staffId', p_staff, 'before', v_before, 'patch', p_patch));
  return jsonb_build_object('ok', true);
exception when others then
  if sqlstate in ('22P02', '22023') then
    return public.sched_fail('bad_request');
  end if;
  raise;
end;
$$;

-- ---------------------------------------------------------------------
-- N. Shift requests: "I would like to work this shift"
-- ---------------------------------------------------------------------

create or replace function public.sched_cancel_request(p_actor uuid, p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.shift_requests%rowtype;
begin
  select * into v_req from public.shift_requests where id = p_request for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if v_req.staff_id <> p_actor then
    return public.sched_fail('forbidden');
  end if;
  if v_req.status <> 'pending' then
    return public.sched_fail('not_pending');
  end if;
  update public.shift_requests
     set status = 'cancelled', cancel_reason = 'בוטלה על ידי העובד/ת', decided_at = now(), updated_at = now()
   where id = p_request;
  perform public.sched_notify(v_req.venue_id, array_remove(public.sched_manager_ids(v_req.venue_id), p_actor),
    'request.cancelled', public.sched_name(p_actor) || ' ביטל/ה בקשה להצטרף למשמרת', v_req.terms ->> 'label',
    jsonb_build_object('tab', 'requests'));
  perform public.sched_log(v_req.venue_id, p_actor, 'request.cancel',
    'ביטל/ה בקשה להצטרף למשמרת: ' || coalesce(v_req.terms ->> 'label', ''), jsonb_build_object('requestId', p_request));
  return jsonb_build_object('ok', true);
end;
$$;

-- Manager decision. Reject needs nothing. Approve re-checks EVERYTHING against
-- the schedule as it is now:
--   hard stops  (can never be forced): the shift is gone / already started, the
--               person is inactive or already on it, or already busy then;
--   soft issues (need an explicit p_force = true, i.e. the manager saw them):
--               shift already full / already has people, the person marked that
--               day unavailable, the shift's time changed since the request.
create or replace function public.sched_decide_request(p_actor uuid, p_request uuid, p_approve boolean, p_note text, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.shift_requests%rowtype;
  v_shift public.shifts%rowtype;
  v_week public.schedule_weeks%rowtype;
  v_issues jsonb := '[]'::jsonb;
  v_conf jsonb;
  v_needed integer;
  v_assigned integer;
  v_names text;
  v_role text;
  v_new uuid;
  v_label text;
begin
  select * into v_req from public.shift_requests where id = p_request;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if not public.sched_can_manage(p_actor, v_req.venue_id) then
    return public.sched_fail('forbidden');
  end if;
  if v_req.shift_id is not null then
    select * into v_shift from public.shifts where id = v_req.shift_id;
    if found then
      select * into v_week from public.schedule_weeks where id = v_shift.week_id for update;
    end if;
  end if;
  select * into v_req from public.shift_requests where id = p_request for update;
  if v_req.status <> 'pending' then
    return public.sched_fail('not_pending');
  end if;
  if p_note is not null and char_length(p_note) > 300 then
    return public.sched_fail('bad_request');
  end if;

  if not p_approve then
    update public.shift_requests
       set status = 'rejected', decision_note = nullif(btrim(coalesce(p_note, '')), ''), decided_at = now(), decided_by_staff = p_actor, updated_at = now()
     where id = p_request;
    perform public.sched_notify(v_req.venue_id, array[v_req.staff_id], 'request.rejected', 'הבקשה שלך לא אושרה',
      coalesce(v_req.terms ->> 'label', '') || coalesce(E'\n' || nullif(btrim(coalesce(p_note, '')), ''), ''),
      jsonb_build_object('tab', 'requests'));
    perform public.sched_log(v_req.venue_id, p_actor, 'request.reject',
      'דחה/תה בקשה של ' || coalesce(public.sched_name(v_req.staff_id), v_req.staff_name) || ' למשמרת ' || coalesce(v_req.terms ->> 'label', ''),
      jsonb_build_object('requestId', p_request));
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  -- ---- approve ----
  if v_shift.id is null then
    update public.shift_requests set status = 'cancelled', cancel_reason = 'המשמרת בוטלה', decided_at = now(), updated_at = now() where id = p_request;
    return public.sched_fail('shift_gone');
  end if;
  v_label := public.sched_fmt(v_shift.shift_date, v_shift.start_time, v_shift.end_time);
  if public.sched_is_past(v_shift.venue_id, v_shift.shift_date, v_shift.start_time) then
    return public.sched_fail('past');
  end if;
  if not exists (select 1 from public.staff s where s.id = v_req.staff_id and s.active) then
    return public.sched_fail('inactive_staff', jsonb_build_object('name', public.sched_name(v_req.staff_id)));
  end if;
  if exists (select 1 from public.schedule_members m where m.venue_id = v_shift.venue_id and m.staff_id = v_req.staff_id and not m.schedulable) then
    return public.sched_fail('not_schedulable', jsonb_build_object('name', public.sched_name(v_req.staff_id)));
  end if;
  if exists (select 1 from public.shift_assignments a where a.shift_id = v_shift.id and a.staff_id = v_req.staff_id) then
    return public.sched_fail('already_assigned', jsonb_build_object('name', public.sched_name(v_req.staff_id)));
  end if;
  perform public.sched_lock_staff(v_req.staff_id);
  v_conf := public.sched_conflicts(v_req.staff_id, public.sched_range(v_shift.shift_date, v_shift.start_time, v_shift.end_time), '{}', v_shift.id);
  if jsonb_array_length(v_conf) > 0 then
    return public.sched_fail('busy', jsonb_build_object('name', public.sched_name(v_req.staff_id), 'with', v_conf -> 0));
  end if;

  v_needed := public.sched_needed(v_shift.requirements);
  select count(*), string_agg(coalesce(public.sched_name(a.staff_id), a.staff_name, '—'), ', ')
    into v_assigned, v_names from public.shift_assignments a where a.shift_id = v_shift.id;
  if v_needed > 0 and v_assigned >= v_needed then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'full',
      'message', 'המשמרת כבר מאוישת במלואה (' || v_assigned || ' מתוך ' || v_needed || ')'));
  elsif v_needed = 0 and v_assigned > 0 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'occupied',
      'message', 'במשמרת כבר משובצים: ' || v_names));
  end if;
  if exists (
    select 1 from public.shift_availability av, jsonb_array_elements(av.entries) e(v)
     where av.venue_id = v_shift.venue_id and av.staff_id = v_req.staff_id and av.week_start = v_week.week_start
       and e.v ->> 'date' = v_shift.shift_date::text and e.v ->> 'kind' = 'unavailable'
  ) then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'unavailable',
      'message', coalesce(public.sched_name(v_req.staff_id), 'העובד/ת') || ' סימן/ה שאינו/ה זמין/ה ביום הזה'));
  end if;
  if (v_req.terms ->> 'start') is distinct from v_shift.start_time or (v_req.terms ->> 'end') is distinct from v_shift.end_time
     or (v_req.terms ->> 'date') is distinct from v_shift.shift_date::text then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'changed',
      'message', 'המשמרת השתנתה מאז הבקשה (היה ' || coalesce(v_req.terms ->> 'label', '') || ')'));
  end if;
  if jsonb_array_length(v_issues) > 0 and not coalesce(p_force, false) then
    return public.sched_fail('needs_confirmation', jsonb_build_object('issues', v_issues));
  end if;

  select m.default_role_id into v_role from public.schedule_members m where m.venue_id = v_shift.venue_id and m.staff_id = v_req.staff_id;
  if v_role is null then
    select q.v ->> 'roleId' into v_role
      from jsonb_array_elements(case when jsonb_typeof(v_shift.requirements) = 'array' then v_shift.requirements else '[]'::jsonb end) q(v)
     where coalesce(nullif(q.v ->> 'min', '')::int, 0) >
           (select count(*) from public.shift_assignments a where a.shift_id = v_shift.id and a.role_id = q.v ->> 'roleId')
     limit 1;
  end if;

  insert into public.shift_assignments (venue_id, shift_id, staff_id, staff_name, role_id)
  values (v_shift.venue_id, v_shift.id, v_req.staff_id, public.sched_name(v_req.staff_id), v_role)
  returning id into v_new;
  update public.shifts set updated_at = now() where id = v_shift.id;
  perform public.sched_snapshot_add_assignment(v_shift.week_id, v_new);

  update public.shift_requests
     set status = 'approved', decision_note = nullif(btrim(coalesce(p_note, '')), ''), decided_at = now(), decided_by_staff = p_actor, updated_at = now()
   where id = p_request;

  set constraints all immediate;
  set constraints all deferred;

  perform public.sched_notify(v_req.venue_id, array[v_req.staff_id], 'request.approved', 'הבקשה שלך אושרה',
    v_label || coalesce(E'\n' || nullif(btrim(coalesce(p_note, '')), ''), ''),
    jsonb_build_object('tab', 'schedule', 'weekStart', v_week.week_start));
  perform public.sched_log(v_req.venue_id, p_actor, 'request.approve',
    'אישר/ה בקשה של ' || coalesce(public.sched_name(v_req.staff_id), v_req.staff_name) || ' למשמרת ' || v_label,
    jsonb_build_object('requestId', p_request, 'assignmentId', v_new, 'forced', coalesce(p_force, false) and jsonb_array_length(v_issues) > 0));
  return jsonb_build_object('ok', true, 'status', 'approved', 'assignmentId', v_new);
exception when others then
  if sqlerrm = 'sched_overlap' then
    return public.sched_fail('busy', jsonb_build_object('name', public.sched_name(v_req.staff_id)));
  end if;
  raise;
end;
$$;

-- ---------------------------------------------------------------------
-- O. Shift swaps
--    open ──(peer accepts)──> peer_accepted ──(manager approves)──> approved
--      │  \──(peer declines)──> declined          └─(manager rejects)──> rejected
--      └──(requester / manager / schedule change)──> cancelled
--    A swap is either
--      * a hand-over    A gives a shift away, someone takes it     (no return shift)
--      * an exchange    A's shift for one of B's shifts            (return shift)
--    and either aimed at one named person (to_staff_id set) or open to anyone
--    (to_staff_id null until someone volunteers). Nothing in shift_assignments
--    changes until the manager approves.
-- ---------------------------------------------------------------------
create or replace function public.sched_request_swap(p_actor uuid, p_assignment uuid, p_target uuid, p_return uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.shift_assignments%rowtype;
  v_s public.shifts%rowtype;
  v_r public.shift_assignments%rowtype;
  v_rs public.shifts%rowtype;
  v_week public.schedule_weeks%rowtype;
  v_conf jsonb;
  v_id uuid;
  v_terms jsonb;
  v_w1 uuid;
  v_w2 uuid;
begin
  select * into v_a from public.shift_assignments where id = p_assignment;
  if not found then
    return public.sched_fail('not_found');
  end if;
  select * into v_s from public.shifts where id = v_a.shift_id;
  if p_return is not null then
    select * into v_r from public.shift_assignments where id = p_return;
    if not found then
      return public.sched_fail('not_found');
    end if;
    select * into v_rs from public.shifts where id = v_r.shift_id;
    v_w1 := least(v_s.week_id, v_rs.week_id);
    v_w2 := greatest(v_s.week_id, v_rs.week_id);
  else
    v_w1 := v_s.week_id;
    v_w2 := v_s.week_id;
  end if;
  perform 1 from public.schedule_weeks where id in (v_w1, v_w2) order by id for update;
  select * into v_week from public.schedule_weeks where id = v_s.week_id;
  select * into v_a from public.shift_assignments where id = p_assignment for update;
  if not found then
    return public.sched_fail('not_found');
  end if;

  if v_a.staff_id is distinct from p_actor then
    return public.sched_fail('forbidden');
  end if;
  if not public.sched_can_view(p_actor, v_s.venue_id) then
    return public.sched_fail('forbidden');
  end if;
  if p_reason is not null and char_length(p_reason) > 300 then
    return public.sched_fail('bad_request');
  end if;
  if not public.sched_in_snapshot(v_s.week_id, 'assignments', v_a.id) then
    return public.sched_fail('not_published');
  end if;
  if public.sched_is_past(v_s.venue_id, v_s.shift_date, v_s.start_time) then
    return public.sched_fail('past');
  end if;
  if exists (select 1 from public.shift_swaps w where w.status in ('open', 'peer_accepted') and (w.assignment_id = v_a.id or w.return_assignment_id = v_a.id)) then
    return public.sched_fail('duplicate_swap');
  end if;

  if p_target is not null then
    if p_target = p_actor then
      return public.sched_fail('bad_target');
    end if;
    if not exists (select 1 from public.staff s where s.id = p_target and s.active) or not public.sched_can_view(p_target, v_s.venue_id) then
      return public.sched_fail('bad_target');
    end if;
    if exists (select 1 from public.schedule_members m where m.venue_id = v_s.venue_id and m.staff_id = p_target and not m.schedulable) then
      return public.sched_fail('target_not_schedulable', jsonb_build_object('name', public.sched_name(p_target)));
    end if;
    if exists (select 1 from public.shift_assignments x where x.shift_id = v_s.id and x.staff_id = p_target) then
      return public.sched_fail('target_already_on_shift', jsonb_build_object('name', public.sched_name(p_target)));
    end if;
    perform public.sched_lock_staff(p_target);
    v_conf := public.sched_conflicts(p_target, public.sched_range(v_s.shift_date, v_s.start_time, v_s.end_time),
                                     case when p_return is null then '{}'::uuid[] else array[p_return] end, null);
    if jsonb_array_length(v_conf) > 0 then
      return public.sched_fail('target_busy', jsonb_build_object('name', public.sched_name(p_target), 'with', v_conf -> 0));
    end if;
  end if;

  if p_return is not null then
    if p_target is null or v_r.staff_id is distinct from p_target or v_r.id = v_a.id then
      return public.sched_fail('bad_request');
    end if;
    if v_rs.venue_id <> v_s.venue_id then
      return public.sched_fail('bad_request');
    end if;
    if not public.sched_in_snapshot(v_rs.week_id, 'assignments', v_r.id) then
      return public.sched_fail('not_published');
    end if;
    if public.sched_is_past(v_rs.venue_id, v_rs.shift_date, v_rs.start_time) then
      return public.sched_fail('past');
    end if;
    if exists (select 1 from public.shift_swaps w where w.status in ('open', 'peer_accepted') and (w.assignment_id = v_r.id or w.return_assignment_id = v_r.id)) then
      return public.sched_fail('duplicate_swap');
    end if;
    if exists (select 1 from public.shift_assignments x where x.shift_id = v_rs.id and x.staff_id = p_actor) then
      return public.sched_fail('already_assigned', jsonb_build_object('name', public.sched_name(p_actor)));
    end if;
    perform public.sched_lock_staff(p_actor);
    v_conf := public.sched_conflicts(p_actor, public.sched_range(v_rs.shift_date, v_rs.start_time, v_rs.end_time), array[v_a.id], null);
    if jsonb_array_length(v_conf) > 0 then
      return public.sched_fail('actor_busy', jsonb_build_object('with', v_conf -> 0));
    end if;
  end if;

  v_terms := jsonb_build_object('from', public.sched_assignment_terms(v_a.id),
                                'to', case when p_return is null then null else public.sched_assignment_terms(v_r.id) end);
  insert into public.shift_swaps (venue_id, assignment_id, return_assignment_id, from_staff_id, to_staff_id, from_staff_name, to_staff_name, status, reason, terms)
  values (v_s.venue_id, v_a.id, p_return, p_actor, p_target, public.sched_name(p_actor),
          case when p_target is null then null else public.sched_name(p_target) end, 'open',
          nullif(btrim(coalesce(p_reason, '')), ''), v_terms)
  returning id into v_id;

  if p_target is not null then
    perform public.sched_notify(v_s.venue_id, array[p_target], 'swap.request',
      public.sched_name(p_actor) || ' מבקש/ת להחליף איתך משמרת',
      case when p_return is null
           then public.sched_name(p_actor) || ' מבקש/ת שתיקח/י את ' || (v_terms -> 'from' ->> 'label')
           else public.sched_name(p_actor) || ' נותן/ת: ' || (v_terms -> 'from' ->> 'label') || E'\n' || 'ומקבל/ת ממך: ' || (v_terms -> 'to' ->> 'label') end,
      jsonb_build_object('tab', 'requests', 'weekStart', v_week.week_start));
  end if;
  perform public.sched_log(v_s.venue_id, p_actor, 'swap.request',
    'ביקש/ה החלפת משמרת: ' || (v_terms -> 'from' ->> 'label') ||
      case when p_target is not null then ' (עם ' || public.sched_name(p_target) || ')' else ' (פתוח לכולם)' end,
    jsonb_build_object('swapId', v_id));
  return jsonb_build_object('ok', true, 'swapId', v_id);
exception when unique_violation then
  return public.sched_fail('duplicate_swap');
end;
$$;

-- The other side answers. A named person accepts/declines; for an open swap any
-- colleague may volunteer (and nobody "declines" an open offer — they just don't).
-- A decline or a volunteer: the other side answers. For a 'give' a named person accepts or
-- declines, and for an open offer any colleague may volunteer. For a 'take' only the person
-- who holds the shift answers, and it is the TAKER (to_staff) who must be free for it.
create or replace function public.sched_respond_swap(p_actor uuid, p_swap uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sw public.shift_swaps%rowtype;
  v_a public.shift_assignments%rowtype;
  v_s public.shifts%rowtype;
  v_conf jsonb;
  v_taker uuid;
begin
  select * into v_sw from public.shift_swaps where id = p_swap;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if v_sw.assignment_id is not null then
    perform 1 from public.schedule_weeks w join public.shifts s on s.week_id = w.id
      join public.shift_assignments a on a.shift_id = s.id where a.id = v_sw.assignment_id for update of w;
  end if;
  select * into v_sw from public.shift_swaps where id = p_swap for update;
  if v_sw.status <> 'open' then
    return public.sched_fail('not_pending');
  end if;
  if not public.sched_can_view(p_actor, v_sw.venue_id) then
    return public.sched_fail('forbidden');
  end if;
  if v_sw.direction = 'take' then
    if p_actor is distinct from v_sw.from_staff_id then
      return public.sched_fail('forbidden');
    end if;
  else
    if p_actor = v_sw.from_staff_id then
      return public.sched_fail('forbidden');
    end if;
    if v_sw.to_staff_id is not null and v_sw.to_staff_id <> p_actor then
      return public.sched_fail('forbidden');
    end if;
  end if;

  if not p_accept then
    if v_sw.direction = 'give' and v_sw.to_staff_id is null then
      return public.sched_fail('forbidden');
    end if;
    update public.shift_swaps set status = 'declined', peer_responded_at = now(), updated_at = now() where id = p_swap;
    if v_sw.direction = 'take' then
      perform public.sched_notify(v_sw.venue_id, array[v_sw.to_staff_id], 'swap.declined',
        public.sched_name(p_actor) || ' לא יכול/ה למסור לך את המשמרת', v_sw.terms -> 'from' ->> 'label', jsonb_build_object('tab', 'requests'));
      perform public.sched_log(v_sw.venue_id, p_actor, 'swap.decline', 'סירב/ה למסור משמרת ל' || coalesce(v_sw.to_staff_name, ''), jsonb_build_object('swapId', p_swap));
    else
      perform public.sched_notify(v_sw.venue_id, array[v_sw.from_staff_id], 'swap.declined',
        public.sched_name(p_actor) || ' לא יכול/ה להחליף', v_sw.terms -> 'from' ->> 'label', jsonb_build_object('tab', 'requests'));
      perform public.sched_log(v_sw.venue_id, p_actor, 'swap.decline', 'סירב/ה להחלפת משמרת עם ' || coalesce(v_sw.from_staff_name, ''), jsonb_build_object('swapId', p_swap));
    end if;
    return jsonb_build_object('ok', true, 'status', 'declined');
  end if;

  -- accept: the schedule must still be what was offered
  select * into v_a from public.shift_assignments where id = v_sw.assignment_id;
  if not found or v_a.staff_id is distinct from v_sw.from_staff_id then
    update public.shift_swaps set status = 'cancelled', cancel_reason = 'השיבוץ השתנה', decided_at = now(), updated_at = now() where id = p_swap;
    return public.sched_fail('assignment_changed');
  end if;
  select * into v_s from public.shifts where id = v_a.shift_id;
  if public.sched_is_past(v_s.venue_id, v_s.shift_date, v_s.start_time) then
    return public.sched_fail('past');
  end if;

  -- whoever ends up with the shift has to be free for it
  v_taker := case when v_sw.direction = 'take' then v_sw.to_staff_id else p_actor end;
  if v_sw.direction = 'take' and not exists (select 1 from public.staff x where x.id = v_taker and x.active) then
    return public.sched_fail('inactive_staff', jsonb_build_object('name', public.sched_name(v_taker)));
  end if;
  if exists (select 1 from public.shift_assignments x where x.shift_id = v_s.id and x.staff_id = v_taker) then
    return public.sched_fail('already_assigned', case when v_sw.direction = 'take' then jsonb_build_object('name', public.sched_name(v_taker)) else '{}'::jsonb end);
  end if;
  if exists (select 1 from public.schedule_members m where m.venue_id = v_s.venue_id and m.staff_id = v_taker and not m.schedulable) then
    return public.sched_fail('not_schedulable', case when v_sw.direction = 'take' then jsonb_build_object('name', public.sched_name(v_taker)) else '{}'::jsonb end);
  end if;
  perform public.sched_lock_staff(v_taker);
  v_conf := public.sched_conflicts(v_taker, public.sched_range(v_s.shift_date, v_s.start_time, v_s.end_time),
                                   case when v_sw.return_assignment_id is null then '{}'::uuid[] else array[v_sw.return_assignment_id] end, null);
  if jsonb_array_length(v_conf) > 0 then
    return public.sched_fail('busy', case when v_sw.direction = 'take'
      then jsonb_build_object('name', public.sched_name(v_taker), 'with', v_conf -> 0)
      else jsonb_build_object('with', v_conf -> 0) end);
  end if;

  if v_sw.direction = 'take' then
    update public.shift_swaps set status = 'peer_accepted', peer_responded_at = now(), updated_at = now() where id = p_swap;
    perform public.sched_notify(v_sw.venue_id, array[v_sw.to_staff_id], 'swap.accepted',
      public.sched_name(p_actor) || ' מסכים/ה למסור לך את המשמרת', 'ממתין לאישור המנהל/ת · ' || (v_sw.terms -> 'from' ->> 'label'), jsonb_build_object('tab', 'requests'));
    perform public.sched_notify(v_sw.venue_id, public.sched_manager_ids(v_sw.venue_id),
      'swap.awaiting', 'בקשת החלפה ממתינה לאישורך',
      coalesce(v_sw.from_staff_name, '') || ' ↔ ' || coalesce(v_sw.to_staff_name, '') || E'\n' || (v_sw.terms -> 'from' ->> 'label'),
      jsonb_build_object('tab', 'requests'));
    perform public.sched_log(v_sw.venue_id, p_actor, 'swap.accept', 'הסכים/ה למסור משמרת ל' || coalesce(v_sw.to_staff_name, ''), jsonb_build_object('swapId', p_swap));
    return jsonb_build_object('ok', true, 'status', 'peer_accepted');
  end if;

  update public.shift_swaps
     set status = 'peer_accepted', to_staff_id = p_actor, to_staff_name = public.sched_name(p_actor), peer_responded_at = now(), updated_at = now()
   where id = p_swap;
  perform public.sched_notify(v_sw.venue_id, array[v_sw.from_staff_id], 'swap.accepted',
    public.sched_name(p_actor) || ' מסכים/ה להחלפה', 'ממתין לאישור המנהל/ת · ' || (v_sw.terms -> 'from' ->> 'label'), jsonb_build_object('tab', 'requests'));
  perform public.sched_notify(v_sw.venue_id, public.sched_manager_ids(v_sw.venue_id),
    'swap.awaiting', 'בקשת החלפה ממתינה לאישורך',
    coalesce(v_sw.from_staff_name, '') || ' ↔ ' || public.sched_name(p_actor) || E'\n' || (v_sw.terms -> 'from' ->> 'label'),
    jsonb_build_object('tab', 'requests'));
  perform public.sched_log(v_sw.venue_id, p_actor, 'swap.accept', 'הסכים/ה להחלפת משמרת עם ' || coalesce(v_sw.from_staff_name, ''), jsonb_build_object('swapId', p_swap));
  return jsonb_build_object('ok', true, 'status', 'peer_accepted');
end;
$$;


create or replace function public.sched_decide_swap(p_actor uuid, p_swap uuid, p_approve boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sw public.shift_swaps%rowtype;
  v_a public.shift_assignments%rowtype;
  v_r public.shift_assignments%rowtype;
  v_s public.shifts%rowtype;
  v_rs public.shifts%rowtype;
  v_conf jsonb;
  v_w1 uuid;
  v_w2 uuid;
  v_to_name text;
  v_from_name text;
begin
  select * into v_sw from public.shift_swaps where id = p_swap;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if not public.sched_can_manage(p_actor, v_sw.venue_id) then
    return public.sched_fail('forbidden');
  end if;
  if p_note is not null and char_length(p_note) > 300 then
    return public.sched_fail('bad_request');
  end if;

  if v_sw.assignment_id is not null then
    select * into v_a from public.shift_assignments where id = v_sw.assignment_id;
    select * into v_s from public.shifts where id = v_a.shift_id;
  end if;
  if v_sw.return_assignment_id is not null then
    select * into v_r from public.shift_assignments where id = v_sw.return_assignment_id;
    select * into v_rs from public.shifts where id = v_r.shift_id;
  end if;
  v_w1 := least(v_s.week_id, coalesce(v_rs.week_id, v_s.week_id));
  v_w2 := greatest(v_s.week_id, coalesce(v_rs.week_id, v_s.week_id));
  if v_w1 is not null then
    perform 1 from public.schedule_weeks where id in (v_w1, v_w2) order by id for update;
  end if;
  select * into v_sw from public.shift_swaps where id = p_swap for update;
  if v_sw.status <> 'peer_accepted' then
    return public.sched_fail('not_pending');
  end if;

  if not p_approve then
    update public.shift_swaps
       set status = 'rejected', decision_note = nullif(btrim(coalesce(p_note, '')), ''), decided_at = now(), decided_by_staff = p_actor, updated_at = now()
     where id = p_swap;
    perform public.sched_notify(v_sw.venue_id, array_remove(array[v_sw.from_staff_id, v_sw.to_staff_id], null), 'swap.rejected',
      'ההחלפה לא אושרה', coalesce(v_sw.terms -> 'from' ->> 'label', '') || coalesce(E'\n' || nullif(btrim(coalesce(p_note, '')), ''), ''),
      jsonb_build_object('tab', 'requests'));
    perform public.sched_log(v_sw.venue_id, p_actor, 'swap.reject',
      'דחה/תה החלפה בין ' || coalesce(v_sw.from_staff_name, '') || ' ל' || coalesce(v_sw.to_staff_name, ''), jsonb_build_object('swapId', p_swap));
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  -- ---- approve: re-validate against the schedule as it is NOW ----
  if v_a.id is null or v_a.staff_id is distinct from v_sw.from_staff_id
     or (v_sw.return_assignment_id is not null and (v_r.id is null or v_r.staff_id is distinct from v_sw.to_staff_id)) then
    return public.sched_fail('assignment_changed');
  end if;
  if v_sw.to_staff_id is null then
    return public.sched_fail('bad_request');
  end if;
  if public.sched_is_past(v_s.venue_id, v_s.shift_date, v_s.start_time)
     or (v_rs.id is not null and public.sched_is_past(v_rs.venue_id, v_rs.shift_date, v_rs.start_time)) then
    return public.sched_fail('past');
  end if;
  if not exists (select 1 from public.staff x where x.id = v_sw.from_staff_id and x.active)
     or not exists (select 1 from public.staff x where x.id = v_sw.to_staff_id and x.active) then
    return public.sched_fail('inactive_staff');
  end if;
  if exists (select 1 from public.shift_assignments x where x.shift_id = v_s.id and x.staff_id = v_sw.to_staff_id and x.id is distinct from v_r.id) then
    return public.sched_fail('already_assigned', jsonb_build_object('name', public.sched_name(v_sw.to_staff_id)));
  end if;
  if v_rs.id is not null and exists (select 1 from public.shift_assignments x where x.shift_id = v_rs.id and x.staff_id = v_sw.from_staff_id and x.id <> v_a.id) then
    return public.sched_fail('already_assigned', jsonb_build_object('name', public.sched_name(v_sw.from_staff_id)));
  end if;

  perform public.sched_lock_staff_many(array[v_sw.to_staff_id, v_sw.from_staff_id]);
  v_conf := public.sched_conflicts(v_sw.to_staff_id, public.sched_range(v_s.shift_date, v_s.start_time, v_s.end_time),
                                   case when v_r.id is null then '{}'::uuid[] else array[v_r.id] end, null);
  if jsonb_array_length(v_conf) > 0 then
    return public.sched_fail('conflict', jsonb_build_object('conflicts', jsonb_build_array(jsonb_build_object(
      'staffId', v_sw.to_staff_id, 'name', public.sched_name(v_sw.to_staff_id), 'with', v_conf -> 0))));
  end if;
  if v_rs.id is not null then
    v_conf := public.sched_conflicts(v_sw.from_staff_id, public.sched_range(v_rs.shift_date, v_rs.start_time, v_rs.end_time), array[v_a.id], null);
    if jsonb_array_length(v_conf) > 0 then
      return public.sched_fail('conflict', jsonb_build_object('conflicts', jsonb_build_array(jsonb_build_object(
        'staffId', v_sw.from_staff_id, 'name', public.sched_name(v_sw.from_staff_id), 'with', v_conf -> 0))));
    end if;
  end if;

  v_to_name := public.sched_name(v_sw.to_staff_id);
  v_from_name := public.sched_name(v_sw.from_staff_id);
  update public.shift_assignments set staff_id = v_sw.to_staff_id, staff_name = v_to_name where id = v_a.id;
  perform public.sched_snapshot_set_assignee(v_s.week_id, v_a.id, v_sw.to_staff_id, v_to_name);
  update public.shifts set updated_at = now() where id = v_s.id;
  if v_r.id is not null then
    update public.shift_assignments set staff_id = v_sw.from_staff_id, staff_name = v_from_name where id = v_r.id;
    perform public.sched_snapshot_set_assignee(v_rs.week_id, v_r.id, v_sw.from_staff_id, v_from_name);
    update public.shifts set updated_at = now() where id = v_rs.id;
  end if;

  update public.shift_swaps
     set status = 'approved', decision_note = nullif(btrim(coalesce(p_note, '')), ''), decided_at = now(), decided_by_staff = p_actor,
         from_staff_name = v_from_name, to_staff_name = v_to_name, updated_at = now()
   where id = p_swap;

  set constraints all immediate;
  set constraints all deferred;

  perform public.sched_notify(v_sw.venue_id, array[v_sw.from_staff_id, v_sw.to_staff_id], 'swap.approved', 'ההחלפה אושרה',
    case when v_r.id is null
         then v_to_name || ' לוקח/ת את ' || (v_sw.terms -> 'from' ->> 'label')
         else v_from_name || ' עובד/ת ב' || (v_sw.terms -> 'to' ->> 'label') || E'\n' || v_to_name || ' עובד/ת ב' || (v_sw.terms -> 'from' ->> 'label') end ||
      coalesce(E'\n' || nullif(btrim(coalesce(p_note, '')), ''), ''),
    jsonb_build_object('tab', 'schedule', 'weekStart', (select week_start from public.schedule_weeks where id = v_s.week_id)));
  perform public.sched_log(v_sw.venue_id, p_actor, 'swap.approve',
    'אישר/ה החלפה בין ' || v_from_name || ' ל' || v_to_name || ': ' || (v_sw.terms -> 'from' ->> 'label'),
    jsonb_build_object('swapId', p_swap, 'assignmentId', v_a.id, 'returnAssignmentId', v_r.id));
  return jsonb_build_object('ok', true, 'status', 'approved');
exception when others then
  if sqlerrm = 'sched_overlap' then
    return public.sched_fail('conflict');
  end if;
  raise;
end;
$$;

-- Withdraw: whoever STARTED the request (the giver of a 'give', the asker of a 'take'), or a manager.
create or replace function public.sched_cancel_swap(p_actor uuid, p_swap uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sw public.shift_swaps%rowtype;
  v_initiator uuid;
begin
  select * into v_sw from public.shift_swaps where id = p_swap for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  v_initiator := case when v_sw.direction = 'take' then v_sw.to_staff_id else v_sw.from_staff_id end;
  if v_initiator is distinct from p_actor and not public.sched_can_manage(p_actor, v_sw.venue_id) then
    return public.sched_fail('forbidden');
  end if;
  if v_sw.status not in ('open', 'peer_accepted') then
    return public.sched_fail('not_pending');
  end if;
  update public.shift_swaps
     set status = 'cancelled', cancel_reason = case when v_initiator is not distinct from p_actor then 'בוטלה על ידי מי שביקש/ה' else 'בוטלה על ידי המנהל/ת' end,
         decided_at = now(), updated_at = now()
   where id = p_swap;
  perform public.sched_notify(v_sw.venue_id,
    array_remove(array[v_sw.from_staff_id, v_sw.to_staff_id], p_actor), 'swap.cancelled', 'בקשת ההחלפה בוטלה',
    v_sw.terms -> 'from' ->> 'label', jsonb_build_object('tab', 'requests'));
  if v_sw.status = 'peer_accepted' then
    perform public.sched_notify(v_sw.venue_id, array_remove(public.sched_manager_ids(v_sw.venue_id), p_actor),
      'swap.cancelled', 'בקשת החלפה שהמתינה לאישור בוטלה', v_sw.terms -> 'from' ->> 'label', jsonb_build_object('tab', 'requests'));
  end if;
  perform public.sched_log(v_sw.venue_id, p_actor, 'swap.cancel', 'ביטל/ה בקשת החלפה: ' || coalesce(v_sw.terms -> 'from' ->> 'label', ''), jsonb_build_object('swapId', p_swap));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Ask a colleague for their shift (no shift offered in return)
-- ---------------------------------------------------------------------
create or replace function public.sched_request_take(p_actor uuid, p_assignment uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a public.shift_assignments%rowtype;
  v_s public.shifts%rowtype;
  v_week public.schedule_weeks%rowtype;
  v_conf jsonb;
  v_id uuid;
  v_terms jsonb;
begin
  select * into v_a from public.shift_assignments where id = p_assignment;
  if not found then
    return public.sched_fail('not_found');
  end if;
  select * into v_s from public.shifts where id = v_a.shift_id;
  perform 1 from public.schedule_weeks where id = v_s.week_id for update;
  select * into v_week from public.schedule_weeks where id = v_s.week_id;
  select * into v_a from public.shift_assignments where id = p_assignment for update;
  if not found then
    return public.sched_fail('not_found');
  end if;

  if v_a.staff_id is null or v_a.staff_id = p_actor then
    return public.sched_fail('bad_target');
  end if;
  if not public.sched_can_view(p_actor, v_s.venue_id) then
    return public.sched_fail('forbidden');
  end if;
  if not exists (select 1 from public.staff s where s.id = v_a.staff_id and s.active) then
    return public.sched_fail('bad_target');
  end if;
  if p_reason is not null and char_length(p_reason) > 300 then
    return public.sched_fail('bad_request');
  end if;
  if not public.sched_in_snapshot(v_s.week_id, 'assignments', v_a.id) then
    return public.sched_fail('not_published');
  end if;
  if public.sched_is_past(v_s.venue_id, v_s.shift_date, v_s.start_time) then
    return public.sched_fail('past');
  end if;
  if exists (select 1 from public.shift_swaps w where w.status in ('open', 'peer_accepted') and (w.assignment_id = v_a.id or w.return_assignment_id = v_a.id)) then
    return public.sched_fail('duplicate_swap');
  end if;
  if exists (select 1 from public.schedule_members m where m.venue_id = v_s.venue_id and m.staff_id = p_actor and not m.schedulable) then
    return public.sched_fail('not_schedulable');
  end if;
  if exists (select 1 from public.shift_assignments x where x.shift_id = v_s.id and x.staff_id = p_actor) then
    return public.sched_fail('already_assigned');
  end if;

  perform public.sched_lock_staff(p_actor);
  v_conf := public.sched_conflicts(p_actor, public.sched_range(v_s.shift_date, v_s.start_time, v_s.end_time), '{}'::uuid[], null);
  if jsonb_array_length(v_conf) > 0 then
    return public.sched_fail('busy', jsonb_build_object('with', v_conf -> 0));
  end if;

  v_terms := jsonb_build_object('from', public.sched_assignment_terms(v_a.id), 'to', null);
  insert into public.shift_swaps (venue_id, assignment_id, return_assignment_id, from_staff_id, to_staff_id, from_staff_name, to_staff_name, status, reason, terms, direction)
  values (v_s.venue_id, v_a.id, null, v_a.staff_id, p_actor, public.sched_name(v_a.staff_id), public.sched_name(p_actor), 'open',
          nullif(btrim(coalesce(p_reason, '')), ''), v_terms, 'take')
  returning id into v_id;

  perform public.sched_notify(v_s.venue_id, array[v_a.staff_id], 'swap.request',
    public.sched_name(p_actor) || ' מבקש/ת לקחת ממך משמרת',
    (v_terms -> 'from' ->> 'label') || E'\n' || 'בלי משמרת בתמורה. אפשר להסכים או לסרב בלשונית הבקשות.',
    jsonb_build_object('tab', 'requests', 'weekStart', v_week.week_start));
  perform public.sched_log(v_s.venue_id, p_actor, 'swap.request',
    'ביקש/ה לקחת את המשמרת של ' || public.sched_name(v_a.staff_id) || ': ' || (v_terms -> 'from' ->> 'label'),
    jsonb_build_object('swapId', v_id, 'direction', 'take'));
  return jsonb_build_object('ok', true, 'swapId', v_id);
exception when unique_violation then
  return public.sched_fail('duplicate_swap');
end;
$$;


-- ---------------------------------------------------------------------
-- P. Notifications read state
-- ---------------------------------------------------------------------
create or replace function public.sched_mark_read(p_actor uuid, p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.schedule_notifications
     set read_at = now()
   where staff_id = p_actor and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------
-- Q. Staff lifecycle: deactivate / reactivate / delete, with the schedule kept
--    consistent and the history preserved.
-- ---------------------------------------------------------------------
-- Future shifts this person is still on (assignments are never deleted just
-- because someone left — past ones are history).
create or replace function public.sched_staff_future_count(p_staff uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
    join public.venues b on b.id = s.venue_id
   where a.staff_id = p_staff
     and ((s.shift_date::timestamp + s.start_time::time) at time zone coalesce(b.timezone, 'Asia/Jerusalem')) > now();
$$;

create or replace function public.sched_set_staff_active(p_actor uuid, p_staff uuid, p_active boolean, p_remove_future boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.staff%rowtype;
  v_future integer;
  v_removed integer := 0;
  v_ex record;
  v_cancelled integer := 0;
begin
  if not public.sched_is_op(p_actor) then
    return public.sched_fail('forbidden');
  end if;
  select * into v_target from public.staff where id = p_staff for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if v_target.active = p_active then
    return jsonb_build_object('ok', true, 'unchanged', true);
  end if;

  if not p_active then
    if p_staff = p_actor then
      return public.sched_fail('self');
    end if;
    if (v_target.role = 'owner' or v_target.badge = 'owner')
       and not exists (select 1 from public.staff o where o.id <> p_staff and o.active and (o.role = 'owner' or o.badge = 'owner')) then
      return public.sched_fail('last_owner');
    end if;
  end if;

  if not p_active then
    v_future := public.sched_staff_future_count(p_staff);
    -- open requests / swaps of someone who left cannot be answered any more
    for v_ex in select id from public.shift_swaps where status in ('open', 'peer_accepted') and (from_staff_id = p_staff or to_staff_id = p_staff) loop
      update public.shift_swaps set status = 'cancelled', cancel_reason = 'העובד/ת אינו/ה פעיל/ה', decided_at = now(), updated_at = now() where id = v_ex.id;
      v_cancelled := v_cancelled + 1;
    end loop;
    update public.shift_requests
       set status = 'cancelled', cancel_reason = 'העובד/ת אינו/ה פעיל/ה', decided_at = now(), updated_at = now()
     where staff_id = p_staff and status = 'pending';
    if p_remove_future then
      for v_ex in
        select a.id, s.id as shift_id from public.shift_assignments a
          join public.shifts s on s.id = a.shift_id
          join public.venues b on b.id = s.venue_id
         where a.staff_id = p_staff
           and ((s.shift_date::timestamp + s.start_time::time) at time zone coalesce(b.timezone, 'Asia/Jerusalem')) > now()
      loop
        perform public.sched_cancel_swaps_for_assignment(v_ex.id, 'העובד/ת הוסר/ה מהלוח');
        delete from public.shift_assignments where id = v_ex.id;
        update public.shifts set updated_at = now() where id = v_ex.shift_id;
        v_removed := v_removed + 1;
      end loop;
    end if;
    -- Deactivation also unlinks the sign-in (every access check keys on auth_user_id),
    -- so a removed person's own Google login cannot silently re-admit them.
    update public.staff set active = false, auth_user_id = null where id = p_staff;
  else
    update public.staff set active = true where id = p_staff;
  end if;

  perform public.staff_log(p_actor, p_staff, case when p_active then 'staff.reactivate' else 'staff.deactivate' end,
    case when p_active then 'הפעיל/ה מחדש את ' else 'השבית/ה את ' end || public.sched_name(p_staff)
      || case when not p_active and v_removed > 0 then ' והסיר/ה אותו/ה מ-' || v_removed || ' משמרות עתידיות' else '' end,
    jsonb_build_object('removedFutureShifts', v_removed, 'futureShifts', v_future));
  return jsonb_build_object('ok', true, 'removedFuture', v_removed, 'futureLeft', coalesce(v_future, 0) - v_removed, 'cancelled', v_cancelled);
end;
$$;

-- "Does this person have any history?" — any row anywhere that points at them
-- other than pure configuration. Derived from the foreign keys themselves, so a
-- table added later is covered automatically.
create or replace function public.staff_has_history(p_staff uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_exists boolean;
begin
  if exists (select 1 from public.staff s where s.id = p_staff and (s.claimed_at is not null or s.auth_user_id is not null)) then
    return true; -- they have signed in: that is history in itself
  end if;
  for r in
    select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'f' and c.confrelid = 'public.staff'::regclass
       and c.conrelid <> 'public.staff'::regclass and array_length(c.conkey, 1) = 1
       and c.conrelid::regclass::text not in
           ('schedule_members', 'shift_availability', 'schedule_notifications', 'staff_push_subscriptions',
            'public.schedule_members', 'public.shift_availability', 'public.schedule_notifications', 'public.staff_push_subscriptions')
  loop
    execute format('select exists (select 1 from %s where %I = $1)', r.tbl, r.col) into v_exists using p_staff;
    if v_exists then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

create or replace function public.sched_delete_staff(p_actor uuid, p_staff uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.staff%rowtype;
  v_name text;
begin
  if not public.sched_is_op(p_actor) then
    return public.sched_fail('forbidden');
  end if;
  select * into v_target from public.staff where id = p_staff for update;
  if not found then
    return public.sched_fail('not_found');
  end if;
  if p_staff = p_actor then
    return public.sched_fail('self');
  end if;
  if (v_target.role = 'owner' or v_target.badge = 'owner') then
    return public.sched_fail('is_owner');
  end if;
  if public.staff_has_history(p_staff) then
    return public.sched_fail('has_history');
  end if;
  v_name := public.sched_name(p_staff);
  perform public.staff_log(p_actor, p_staff, 'staff.delete', 'מחק/ה את ' || v_name || ' (לא הייתה היסטוריה)', jsonb_build_object('email', v_target.email));
  delete from public.staff where id = p_staff;
  return jsonb_build_object('ok', true, 'name', v_name);
exception when foreign_key_violation then
  return public.sched_fail('has_history');
end;
$$;


-- ---------------------------------------------------------------------
-- R. Retire 027's entry points. They authorised through auth.uid() and were
--    executable by every signed-in browser; leaving them callable would let any
--    scheduling manager's own session publish, clear or approve a swap WITHOUT
--    any of the checks above. Nothing in the application calls them any more.
-- ---------------------------------------------------------------------
drop function if exists public.publish_schedule_week(uuid);
drop function if exists public.unpublish_schedule_week(uuid);
drop function if exists public.clear_schedule_week(uuid);
drop function if exists public.copy_schedule_week(uuid, date, date);
drop function if exists public.set_schedule_member(uuid, uuid, jsonb);
drop function if exists public.decide_shift_swap(uuid, boolean, text);
drop function if exists public.log_shift_audit(uuid, text, text, jsonb);

-- ---------------------------------------------------------------------
-- T. Who is on the roster, by default
--    027's rule was "no schedule_members row = not schedulable": nobody is
--    rostered until the owner switches them on. Every check above reads the
--    other way round (a row with schedulable = false refuses), so that rule is
--    kept by making sure EVERY active person has a row. Existing people are
--    given one now, switched off unless the owner already chose; people added
--    later get one from the trigger below. Whatever the owner decided stays.
-- ---------------------------------------------------------------------
insert into public.schedule_members (venue_id, staff_id, schedulable, updated_at)
select v.id, s.id, false, now()
  from public.venues v
  cross join public.staff s
 where v.active and s.active
on conflict (venue_id, staff_id) do nothing;

create or replace function public.schedule_member_defaults_after_staff_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active then
    insert into public.schedule_members (venue_id, staff_id, schedulable, updated_at)
    select v.id, new.id, false, now()
      from public.venues v
     where v.active
    on conflict (venue_id, staff_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists schedule_member_defaults_staff on public.staff;
create trigger schedule_member_defaults_staff
  after insert or update of active on public.staff
  for each row execute function public.schedule_member_defaults_after_staff_write();

create or replace function public.schedule_member_defaults_after_venue_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active then
    insert into public.schedule_members (venue_id, staff_id, schedulable, updated_at)
    select new.id, s.id, false, now()
      from public.staff s
     where s.active
    on conflict (venue_id, staff_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists schedule_member_defaults_venue on public.venues;
create trigger schedule_member_defaults_venue
  after insert or update of active on public.venues
  for each row execute function public.schedule_member_defaults_after_venue_write();

revoke all on function public.schedule_member_defaults_after_staff_write() from public, anon, authenticated;
revoke all on function public.schedule_member_defaults_after_venue_write() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- S. Grants: every new function is for the SERVER only (service_role).
-- ---------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'sched\_%' or p.proname in ('staff_log', 'staff_has_history'))
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('revoke all on function %s from anon', f.sig);
    execute format('revoke all on function %s from authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------
do $$
declare
  n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and (p.proname like 'sched\_%' or p.proname in ('staff_log', 'staff_has_history'))
     and (has_function_privilege('public', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'));
  if n > 0 then
    raise exception 'verify: % sched_* function(s) are executable by public/anon/authenticated', n;
  end if;
  if has_table_privilege('authenticated', 'public.shifts', 'insert')
     or has_table_privilege('authenticated', 'public.shift_assignments', 'insert')
     or has_table_privilege('authenticated', 'public.shift_swaps', 'update') then
    raise exception 'verify: a browser role can still write the schedule directly';
  end if;
  if has_table_privilege('authenticated', 'public.shift_requests', 'select')
     or has_table_privilege('anon', 'public.schedule_notifications', 'select') then
    raise exception 'verify: a browser role can read requests / notifications directly';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'shifts' and column_name in ('start_time', 'end_time') and data_type <> 'text') then
    raise exception 'verify: shift times are not text';
  end if;
end;
$$;


-- ===== supabase/migrations/053_schedule_planning_fair_fill.sql =====
-- =====================================================================
-- 053_schedule_planning_fair_fill.sql — weekly planning, on top of 052.
--
-- The owner's week: prepare an empty week from the shift templates -> collect
-- the team's requests and availability until Tuesday midnight (Asia/Jerusalem,
-- DST-correct) -> approve requests and assign by hand -> complete the gaps
-- fairly -> publish. Requests and availability are enforced HERE, not just by
-- disabled buttons. Manual choices are always authoritative.
--
-- Only the server's service role may call these functions.
--
-- (Adapted from Sarcafe's 20261008134738 + the per-shift request switch of
--  20261009120000; the request function below is the single final version, with
--  no wrapper and no overload.)
-- =====================================================================

-- Weekly planning: requests close after Tuesday in Jerusalem; manual choices
-- remain authoritative. Only the server service role may invoke these RPCs.

create or replace function public.sched_request_deadline(p_week date)
returns date language sql immutable set search_path = public as $$
  select p_week - extract(dow from p_week)::integer - 5;
$$;

create or replace function public.sched_requests_open(p_week date, p_at timestamptz default now())
returns boolean language sql stable set search_path = public as $$
  select (p_at at time zone 'Asia/Jerusalem')::date <= public.sched_request_deadline(p_week);
$$;

create or replace function public.sched_submit_availability(
  p_actor uuid, p_venue uuid, p_week_start date, p_entries jsonb, p_note text, p_status text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entry jsonb; v_old public.shift_availability%rowtype;
begin
  if not public.sched_can_view(p_actor, p_venue) then return public.sched_fail('forbidden'); end if;
  if extract(dow from p_week_start) <> 0 then return public.sched_fail('bad_date'); end if;
  if not public.sched_requests_open(p_week_start) then return public.sched_fail('requests_closed'); end if;
  if p_status not in ('draft', 'submitted') or jsonb_typeof(p_entries) <> 'array'
    or jsonb_array_length(p_entries) > 7 or char_length(coalesce(p_note, '')) > 300 then
    return public.sched_fail('bad_request');
  end if;
  if exists (select 1 from public.shift_settings where venue_id = p_venue and not coalesce((features->>'availability')::boolean, true)) then
    return public.sched_fail('bad_request');
  end if;
  if (select count(distinct e->>'date') from jsonb_array_elements(p_entries) e) <> jsonb_array_length(p_entries) then
    return public.sched_fail('bad_request');
  end if;
  for v_entry in select * from jsonb_array_elements(p_entries) loop
    if not coalesce(v_entry->>'date' ~ '^\d{4}-\d{2}-\d{2}$', false)
      or (v_entry->>'date')::date not between p_week_start and p_week_start + 6 then
      return public.sched_fail('bad_date');
    end if;
    if not coalesce(v_entry->>'kind' in ('unavailable', 'prefer', 'partial'), false) then
      return public.sched_fail('bad_request');
    end if;
    if v_entry->>'kind' = 'partial' and (
      not coalesce(v_entry->>'from' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false)
      or not coalesce(v_entry->>'to' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false)
      or v_entry->>'from' = v_entry->>'to'
    ) then return public.sched_fail('bad_time'); end if;
  end loop;
  -- The same week lock as request decisions and automatic filling. Submission
  -- and manager notification commit together, never as separate network writes.
  insert into public.schedule_weeks (venue_id, week_start) values (p_venue, p_week_start)
    on conflict (venue_id, week_start) do nothing;
  perform 1 from public.schedule_weeks where venue_id = p_venue and week_start = p_week_start for update;
  select * into v_old from public.shift_availability where venue_id = p_venue and staff_id = p_actor and week_start = p_week_start;
  insert into public.shift_availability (venue_id, staff_id, week_start, entries, note, status, updated_at)
    values (p_venue, p_actor, p_week_start, p_entries, nullif(btrim(coalesce(p_note, '')), ''), p_status, now())
    on conflict (venue_id, staff_id, week_start) do update
      set entries = excluded.entries, note = excluded.note, status = excluded.status, updated_at = now();
  if p_status = 'submitted' and (v_old.id is null or v_old.entries is distinct from p_entries
    or v_old.note is distinct from nullif(btrim(coalesce(p_note, '')), '') or v_old.status <> 'submitted') then
    perform public.sched_notify(p_venue, array_remove(public.sched_manager_ids(p_venue), p_actor),
      'availability.submitted', public.sched_name(p_actor) || ' הגיש/ה בקשות וזמינות',
      'לשבוע שמתחיל ב-' || to_char(p_week_start, 'FMDD/FMMM'), jsonb_build_object('tab', 'requests', 'weekStart', p_week_start));
  end if;
  return jsonb_build_object('ok', true);
exception when invalid_datetime_format or datetime_field_overflow then return public.sched_fail('bad_date');
end;
$$;

-- Automatic fill is conservative; a manager can deliberately override all soft
-- constraints in the existing shift editor. No availability submission means
-- available. Draft availability is never treated as submitted preference.
create or replace function public.sched_fill_eligible(
  p_staff uuid, p_shift uuid, p_week_start date, p_safety jsonb, p_cap integer
)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare s public.shifts%rowtype; v_range tsrange; v_hours numeric; v_daily numeric; v_entry jsonb; v_streak integer;
begin
  select * into s from public.shifts where id = p_shift;
  v_range := public.sched_range(s.shift_date, s.start_time, s.end_time);
  v_hours := extract(epoch from upper(v_range) - lower(v_range)) / 3600;
  if exists (select 1 from public.shift_assignments where shift_id = p_shift and staff_id = p_staff) then return false; end if;
  if jsonb_array_length(public.sched_conflicts(p_staff, v_range)) > 0 then return false; end if;
  select e into v_entry from public.shift_availability av, jsonb_array_elements(av.entries) e
    where av.venue_id = s.venue_id and av.staff_id = p_staff and av.week_start = p_week_start
      and av.status = 'submitted' and e->>'date' = s.shift_date::text limit 1;
  if v_entry->>'kind' = 'unavailable' then return false; end if;
  if v_entry->>'kind' = 'partial' and not (
    v_range <@ public.sched_range(s.shift_date, v_entry->>'from', v_entry->>'to')
  ) then return false; end if;
  if v_hours + coalesce((select sum(extract(epoch from upper(public.sched_range(x.shift_date, x.start_time, x.end_time))
      - lower(public.sched_range(x.shift_date, x.start_time, x.end_time))) / 3600)
    from public.shift_assignments a join public.shifts x on x.id = a.shift_id
    where a.staff_id = p_staff and x.shift_date between p_week_start and p_week_start + 6), 0)
    > coalesce(p_cap::numeric, (p_safety->>'maxWeeklyHours')::numeric, 42) then return false; end if;
  select coalesce(sum(extract(epoch from upper(public.sched_range(x.shift_date, x.start_time, x.end_time))
    - lower(public.sched_range(x.shift_date, x.start_time, x.end_time))) / 3600), 0) into v_daily
    from public.shift_assignments a join public.shifts x on x.id = a.shift_id where a.staff_id = p_staff and x.shift_date = s.shift_date;
  if v_daily + v_hours > coalesce((p_safety->>'maxDailyHours')::numeric, 10) then return false; end if;
  if exists (
    select 1 from public.shift_assignments a join public.shifts x on x.id = a.shift_id
    cross join lateral (select public.sched_range(x.shift_date, x.start_time, x.end_time) r) t
    where a.staff_id = p_staff and x.shift_date between s.shift_date - 2 and s.shift_date + 2 and (
      (upper(t.r) <= lower(v_range) and lower(v_range) - upper(t.r) < make_interval(mins => round(coalesce((p_safety->>'minRestHours')::numeric, 10) * 60)::integer))
      or (lower(t.r) >= upper(v_range) and lower(t.r) - upper(v_range) < make_interval(mins => round(coalesce((p_safety->>'minRestHours')::numeric, 10) * 60)::integer))
    )
  ) then return false; end if;
  select coalesce(max(n), 0) into v_streak from (
    select count(*) n from (
      select d, d - row_number() over (order by d)::integer island from (
        select s.shift_date d union select x.shift_date from public.shift_assignments a join public.shifts x on x.id = a.shift_id
          where a.staff_id = p_staff and x.shift_date between s.shift_date - 14 and s.shift_date + 14
      ) dates
    ) islands group by island
  ) streaks;
  return v_streak <= coalesce((p_safety->>'maxConsecutiveDays')::integer, 6);
end;
$$;

create or replace function public.sched_fill_week(p_actor uuid, p_week uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.schedule_weeks%rowtype; cfg public.shift_settings%rowtype; s record; slot record;
  v_staff uuid; v_added integer := 0; v_missing jsonb := '[]'::jsonb; v_range tsrange;
begin
  select * into w from public.schedule_weeks where id = p_week for update;
  if not found then return public.sched_fail('not_found'); end if;
  if not public.sched_can_manage(p_actor, w.venue_id) then return public.sched_fail('forbidden'); end if;
  if public.sched_requests_open(w.week_start) then return public.sched_fail('planning_open'); end if;
  if exists (select 1 from public.shift_requests r join public.shifts x on x.id = r.shift_id where x.week_id = p_week and r.status = 'pending') then
    return public.sched_fail('requests_pending');
  end if;
  select * into cfg from public.shift_settings where venue_id = w.venue_id;
  -- Fixed lock order protects against overlapping allocations in another week.
  perform public.sched_lock_staff_many(array(select st.id from public.staff st
    where st.active and public.sched_can_view(st.id, w.venue_id)));
  -- Allocate Saturday first so ordinary shifts cannot exhaust somebody's hour cap
  -- before their turn for a premium opportunity. Explicit assignments never move.
  for s in select * from public.shifts where week_id = p_week
    order by (extract(dow from shift_date) = 6) desc, shift_date, start_time, id for update loop
    if public.sched_is_past(s.venue_id, s.shift_date, s.start_time) then continue; end if;
    v_range := public.sched_range(s.shift_date, s.start_time, s.end_time);
    for slot in
      select r->>'roleId' role_id, (r->>'min')::integer needed
        from jsonb_array_elements(s.requirements) r where coalesce((r->>'min')::integer, 0) > 0
      union all select null::text, 1 where jsonb_array_length(s.requirements) = 0
    loop
      while (select count(*) from public.shift_assignments a where a.shift_id = s.id
        and (slot.role_id is null or a.role_id = slot.role_id)) < slot.needed loop
        select st.id into v_staff from public.staff st
          left join public.schedule_members m on m.venue_id = w.venue_id and m.staff_id = st.id
          where st.active and public.sched_can_view(st.id, w.venue_id) and coalesce(m.schedulable, true)
            and (slot.role_id is null or m.default_role_id is null or m.default_role_id = slot.role_id)
            and public.sched_fill_eligible(st.id, s.id, w.week_start, cfg.safety, m.max_weekly_hours)
          order by
            -- Saturday wage label is a product rule (150%), never payroll math.
            case when extract(dow from s.shift_date) = 6 then coalesce((
              select sum(extract(epoch from upper(public.sched_range(x.shift_date, x.start_time, x.end_time))
                - lower(public.sched_range(x.shift_date, x.start_time, x.end_time))))
              from public.shift_assignments a join public.shifts x on x.id = a.shift_id join public.schedule_weeks h on h.id = x.week_id
              where a.staff_id = st.id and x.venue_id = w.venue_id and extract(dow from x.shift_date) = 6
                and x.shift_date between w.week_start - 84 and w.week_start + 6
                and (h.status = 'published' or h.id = p_week)
            ), 0) else 0 end,
            coalesce((select sum(extract(epoch from upper(public.sched_range(x.shift_date, x.start_time, x.end_time))
              - lower(public.sched_range(x.shift_date, x.start_time, x.end_time)))) from public.shift_assignments a join public.shifts x on x.id = a.shift_id
              where a.staff_id = st.id and x.shift_date between w.week_start and w.week_start + 6), 0),
            case when exists (select 1 from public.shift_availability av, jsonb_array_elements(av.entries) e
              where av.staff_id = st.id and av.venue_id = w.venue_id and av.week_start = w.week_start and av.status = 'submitted'
                and e->>'date' = s.shift_date::text and e->>'kind' = 'prefer') then 0 else 1 end,
            md5(st.id::text || w.week_start::text), st.id
          limit 1;
        if v_staff is null then
          v_missing := v_missing || jsonb_build_array(jsonb_build_object('shiftId', s.id, 'roleId', slot.role_id,
            'label', public.sched_fmt(s.shift_date, s.start_time, s.end_time), 'reason', 'no_eligible_staff'));
          exit;
        end if;
        insert into public.shift_assignments (venue_id, shift_id, staff_id, staff_name, role_id)
          values (w.venue_id, s.id, v_staff, public.sched_name(v_staff), slot.role_id);
        update public.shifts set updated_at = now() where id = s.id;
        v_added := v_added + 1;
      end loop;
    end loop;
  end loop;
  set constraints all immediate;
  set constraints all deferred;
  perform public.sched_log(w.venue_id, p_actor, 'schedule.fill', 'השלים/ה אוטומטית ' || v_added || ' שיבוצים',
    jsonb_build_object('weekId', p_week, 'added', v_added, 'remaining', v_missing, 'saturdayHistoryWeeks', 12));
  return jsonb_build_object('ok', true, 'added', v_added, 'remaining', v_missing);
end;
$$;

revoke all on function public.sched_request_deadline(date) from public, anon, authenticated;
revoke all on function public.sched_requests_open(date, timestamptz) from public, anon, authenticated;
revoke all on function public.sched_submit_availability(uuid, uuid, date, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.sched_fill_eligible(uuid, uuid, date, jsonb, integer) from public, anon, authenticated;
revoke all on function public.sched_fill_week(uuid, uuid) from public, anon, authenticated;
grant execute on function public.sched_request_deadline(date), public.sched_requests_open(date, timestamptz),
  public.sched_submit_availability(uuid, uuid, date, jsonb, text, text), public.sched_fill_eligible(uuid, uuid, date, jsonb, integer),
  public.sched_fill_week(uuid, uuid) to service_role;

-- The owner can offer an empty week before collecting employee preferences.
-- Existing manually created shifts and every assignment stay intact.
create or replace function public.sched_prepare_week(p_actor uuid, p_week uuid, p_presets jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.schedule_weeks%rowtype; cfg public.shift_settings%rowtype; v_day integer; v_date date;
  v_preset jsonb; v_added integer := 0; v_role text;
begin
  select * into w from public.schedule_weeks where id = p_week for update;
  if not found then return public.sched_fail('not_found'); end if;
  if not public.sched_can_manage(p_actor, w.venue_id) then return public.sched_fail('forbidden'); end if;
  if jsonb_typeof(p_presets) <> 'array' or jsonb_array_length(p_presets) > 20 then return public.sched_fail('bad_request'); end if;
  for v_preset in select * from jsonb_array_elements(p_presets) loop
    if not coalesce(v_preset->>'startTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false)
      or not coalesce(v_preset->>'endTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false)
      or v_preset->>'startTime' = v_preset->>'endTime' then return public.sched_fail('bad_time'); end if;
  end loop;
  select * into cfg from public.shift_settings where venue_id = w.venue_id;
  for v_day in 0..6 loop
    if not (v_day = any(coalesce(cfg.working_days, '{0,1,2,3,4,5,6}'::smallint[]))) then continue; end if;
    v_date := w.week_start + v_day;
    for v_preset in select * from jsonb_array_elements(p_presets) loop
      if public.sched_is_past(w.venue_id, v_date, v_preset->>'startTime') then continue; end if;
      if exists (select 1 from public.shifts x where x.week_id = p_week and x.shift_date = v_date and (
        (x.start_time = v_preset->>'startTime' and x.end_time = v_preset->>'endTime')
        or (v_preset->>'id' is not null and x.preset_id = v_preset->>'id')
      )) then continue; end if;
      v_role := nullif(v_preset->>'roleId', '');
      insert into public.shifts (venue_id, week_id, shift_date, start_time, end_time, preset_id, station_id, requirements)
        values (w.venue_id, p_week, v_date, v_preset->>'startTime', v_preset->>'endTime',
          nullif(v_preset->>'id', ''), nullif(v_preset->>'stationId', ''),
          case when jsonb_typeof(v_preset->'requirements') = 'array' and jsonb_array_length(v_preset->'requirements') > 0
                 then v_preset->'requirements'
               when v_role is null then '[]'::jsonb
               else jsonb_build_array(jsonb_build_object('roleId', v_role, 'min', 1)) end);
      v_added := v_added + 1;
    end loop;
  end loop;
  perform public.sched_log(w.venue_id, p_actor, 'schedule.prepare', 'הכין/ה ' || v_added || ' משמרות לבקשות העובדים',
    jsonb_build_object('weekId', p_week, 'added', v_added));
  return jsonb_build_object('ok', true, 'added', v_added);
end;
$$;
revoke all on function public.sched_prepare_week(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sched_prepare_week(uuid, uuid, jsonb) to service_role;


-- ---------------------------------------------------------------------
-- "I would like to work this shift"
--
-- One entry point for both moments an employee can ask:
--   * DRAFT week   — the manager has laid out the shift choices and collects
--                    requests until the Tuesday deadline; the employee sees the
--                    shift (date, hours, template) and nothing else about it.
--   * PUBLISHED week — only a shift the owner explicitly opened ("requests_open")
--                    may be asked for, and what the employee is judged against
--                    is the FROZEN snapshot they were shown, not whatever the
--                    manager has drafted since.
-- Every integrity check of the original request flow is kept.
-- ---------------------------------------------------------------------
create or replace function public.sched_request_shift(p_actor uuid, p_shift uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift public.shifts%rowtype;
  v_week public.schedule_weeks%rowtype;
  v_published jsonb;
  v_date date;
  v_start text;
  v_end text;
  v_requirements jsonb;
  v_requests_open boolean;
  v_conf jsonb;
  v_needed integer;
  v_assigned integer;
  v_id uuid;
  v_label text;
begin
  select * into v_shift from public.shifts where id = p_shift;
  if not found then
    return public.sched_fail('not_found');
  end if;

  select * into v_week from public.schedule_weeks where id = v_shift.week_id for update;
  select * into v_shift from public.shifts where id = p_shift for update;
  if not found then
    return public.sched_fail('not_found');
  end if;

  if not public.sched_can_view(p_actor, v_shift.venue_id) then
    return public.sched_fail('forbidden');
  end if;
  if p_note is not null and char_length(p_note) > 300 then
    return public.sched_fail('bad_request');
  end if;

  if v_week.status = 'draft' then
    if not public.sched_requests_open(v_week.week_start) then
      return public.sched_fail('requests_closed');
    end if;
    v_date := v_shift.shift_date;
    v_start := v_shift.start_time;
    v_end := v_shift.end_time;
    v_requirements := v_shift.requirements;
    v_requests_open := v_shift.requests_open;
  elsif v_week.status = 'published' then
    select e.v into v_published
      from jsonb_array_elements(coalesce(v_week.published_snapshot -> 'shifts', '[]'::jsonb)) e(v)
     where e.v ->> 'id' = p_shift::text;
    if v_published is null then
      return public.sched_fail('not_published');
    end if;
    v_date := (v_published ->> 'shift_date')::date;
    v_start := v_published ->> 'start_time';
    v_end := v_published ->> 'end_time';
    v_requirements := coalesce(v_published -> 'requirements', '[]'::jsonb);
    v_requests_open := coalesce((v_published ->> 'requests_open')::boolean, false);
  else
    return public.sched_fail('not_published');
  end if;

  if not coalesce(v_requests_open, false) then
    return public.sched_fail('requests_not_open');
  end if;
  if public.sched_is_past(v_shift.venue_id, v_date, v_start) then
    return public.sched_fail('past');
  end if;
  if exists (select 1 from public.schedule_members m where m.venue_id = v_shift.venue_id and m.staff_id = p_actor and not m.schedulable) then
    return public.sched_fail('not_schedulable');
  end if;

  if v_week.status = 'published' then
    if exists (
      select 1 from jsonb_array_elements(coalesce(v_week.published_snapshot -> 'assignments', '[]'::jsonb)) a(v)
       where a.v ->> 'shift_id' = p_shift::text and a.v ->> 'staff_id' = p_actor::text
    ) then
      return public.sched_fail('already_assigned');
    end if;
  elsif exists (select 1 from public.shift_assignments a where a.shift_id = p_shift and a.staff_id = p_actor) then
    return public.sched_fail('already_assigned');
  end if;

  if exists (select 1 from public.shift_requests r where r.shift_id = p_shift and r.staff_id = p_actor and r.status = 'pending') then
    return public.sched_fail('duplicate_request');
  end if;

  v_needed := public.sched_needed(v_requirements);
  if v_week.status = 'published' then
    select count(*) into v_assigned
      from jsonb_array_elements(coalesce(v_week.published_snapshot -> 'assignments', '[]'::jsonb)) a(v)
     where a.v ->> 'shift_id' = p_shift::text;
  else
    select count(*) into v_assigned from public.shift_assignments where shift_id = p_shift;
  end if;
  if v_week.status = 'published' and v_needed > 0 and v_assigned >= v_needed then
    return public.sched_fail('shift_full', jsonb_build_object('needed', v_needed, 'assigned', v_assigned));
  end if;

  perform public.sched_lock_staff(p_actor);
  v_conf := public.sched_conflicts(p_actor, public.sched_range(v_date, v_start, v_end), '{}', p_shift);
  if jsonb_array_length(v_conf) > 0 then
    return public.sched_fail('busy', jsonb_build_object('with', v_conf -> 0));
  end if;
  -- contradictory: another PENDING request of theirs at the same time
  if exists (
    select 1 from public.shift_requests r
     where r.staff_id = p_actor and r.status = 'pending' and r.shift_id <> p_shift
       and public.sched_range((r.terms ->> 'date')::date, r.terms ->> 'start', r.terms ->> 'end')
           && public.sched_range(v_date, v_start, v_end)
  ) then
    return public.sched_fail('overlapping_request');
  end if;
  -- they said they cannot work that day
  if exists (
    select 1 from public.shift_availability av, jsonb_array_elements(av.entries) e(v)
     where av.venue_id = v_shift.venue_id and av.staff_id = p_actor and av.week_start = v_week.week_start and av.status = 'submitted'
       and e.v ->> 'date' = v_date::text and e.v ->> 'kind' = 'unavailable'
  ) then
    return public.sched_fail('unavailable_day', jsonb_build_object('date', v_date));
  end if;

  v_label := public.sched_fmt(v_date, v_start, v_end);
  insert into public.shift_requests (venue_id, shift_id, staff_id, staff_name, note, terms)
  values (v_shift.venue_id, p_shift, p_actor, public.sched_name(p_actor), nullif(btrim(coalesce(p_note, '')), ''),
          jsonb_build_object('shiftId', p_shift, 'weekId', v_shift.week_id, 'date', v_date, 'start', v_start, 'end', v_end, 'label', v_label))
  returning id into v_id;

  perform public.sched_notify(v_shift.venue_id, array_remove(public.sched_manager_ids(v_shift.venue_id), p_actor),
    'request.new', public.sched_name(p_actor) || ' מבקש/ת להצטרף למשמרת', v_label,
    jsonb_build_object('tab', 'requests', 'shiftId', p_shift, 'weekStart', v_week.week_start));
  perform public.sched_log(v_shift.venue_id, p_actor, 'request.create',
    'ביקש/ה להצטרף למשמרת: ' || v_label, jsonb_build_object('requestId', v_id, 'shiftId', p_shift));
  return jsonb_build_object('ok', true, 'requestId', v_id);
exception when unique_violation then
  return public.sched_fail('duplicate_request');
end;
$$;

revoke all on function public.sched_request_shift(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.sched_request_shift(uuid, uuid, text) to service_role;

do $$
declare
  n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname like 'sched\_%'
     and (has_function_privilege('public', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'));
  if n > 0 then
    raise exception 'verify: % sched_* function(s) are executable by public/anon/authenticated', n;
  end if;
end;
$$;


-- ===== supabase/migrations/054_staff_push_notifications.sql =====
-- 054_staff_push_notifications.sql — Web Push to the installed home-screen app (Sarcafe's staff push, adapted).
--
-- Staff push notifications (Web Push to the installed home-screen app).
--
-- A staff member's subscription belongs to a PERSON, so the same phone keeps receiving
-- their shift alerts (a swap asked of them, a published week, a request answered, a shift
-- about to start ...) for as long as they stay signed in on it.
--
-- How a notification becomes a push, without touching the 20+ places that already write to
-- the in-app inbox: every inbox row (schedule_notifications) is also an outbox row. The app
-- claims rows whose push_sent_at is null, sends them, and stamps them. Rows made by
-- sched_notify() (swaps, requests, publishing, hours sync) and rows the app writes itself
-- (shift reminders) therefore travel the same road.
--
-- Everything here is service-role only, like the rest of the scheduling tables.

-- ---------------------------------------------------------------------
-- A. One row per browser/phone, owned by one person
-- ---------------------------------------------------------------------
-- endpoint is unique on its own: a push endpoint identifies one browser profile, so when
-- another employee signs in on the same phone the row moves to them (the app upserts).
create table if not exists public.staff_push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references public.staff(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists staff_push_subscriptions_staff_idx on public.staff_push_subscriptions (staff_id);

alter table public.staff_push_subscriptions enable row level security;
revoke all on public.staff_push_subscriptions from public, anon, authenticated;
grant all on public.staff_push_subscriptions to service_role;

-- ---------------------------------------------------------------------
-- B. The inbox doubles as the outbox
-- ---------------------------------------------------------------------
-- push_sent_at: null = not yet pushed. Rows that exist when this runs were already seen in
-- the app, so they are stamped once and never pushed (otherwise the first run would buzz
-- every phone with weeks of old news). The guard keeps a re-run from re-stamping new rows.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'schedule_notifications' and column_name = 'push_sent_at') then
    alter table public.schedule_notifications add column push_sent_at timestamptz;
    update public.schedule_notifications set push_sent_at = now();
  end if;
end
$$;

-- dedupe_key: lets a timed reminder be written at most once per person ("shift-soon:<assignment>").
-- Null for ordinary notifications (nulls never collide in a unique index).
alter table public.schedule_notifications add column if not exists dedupe_key text;
create unique index if not exists schedule_notifications_dedupe_idx on public.schedule_notifications (staff_id, dedupe_key);
create index if not exists schedule_notifications_push_pending_idx on public.schedule_notifications (created_at) where push_sent_at is null;

-- ---------------------------------------------------------------------
-- C. "I am giving up this shift — anyone who is free can have it"
-- ---------------------------------------------------------------------
-- An offer to a NAMED colleague already notifies them (sched_request_swap). An offer open to
-- everyone notified nobody, so it sat unseen until someone happened to open the requests tab.
-- A trigger tells every colleague who could actually take it, whichever function created the
-- swap. A failure here must never block the swap itself.
create or replace function public.sched_notify_open_swap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift uuid;
  v_week date;
  v_who uuid[];
begin
  if new.direction is distinct from 'give' or new.to_staff_id is not null or new.status is distinct from 'open' then
    return new;
  end if;
  select s.id, w.week_start into v_shift, v_week
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
    join public.schedule_weeks w on w.id = s.week_id
   where a.id = new.assignment_id;
  if v_shift is null then
    return new;
  end if;
  select coalesce(array_agg(st.id), '{}'::uuid[]) into v_who
    from public.staff st
   where st.active
     and st.id <> new.from_staff_id
     and public.sched_can_view(st.id, new.venue_id)
     and not exists (select 1 from public.schedule_members m where m.venue_id = new.venue_id and m.staff_id = st.id and not m.schedulable)
     and not exists (select 1 from public.shift_assignments x where x.shift_id = v_shift and x.staff_id = st.id);
  perform public.sched_notify(new.venue_id, v_who, 'swap.open',
    coalesce(new.from_staff_name, 'עובד/ת') || ' מוסר/ת משמרת',
    coalesce(new.terms -> 'from' ->> 'label', '') || E'\n' || 'מי שפנוי/ה יכול/ה לקחת אותה בלשונית הבקשות.',
    jsonb_build_object('tab', 'requests', 'weekStart', v_week));
  return new;
exception when others then
  return new;
end;
$$;

revoke all on function public.sched_notify_open_swap() from public, anon, authenticated;
grant execute on function public.sched_notify_open_swap() to service_role;

drop trigger if exists shift_swaps_notify_open on public.shift_swaps;
create trigger shift_swaps_notify_open
  after insert on public.shift_swaps
  for each row execute function public.sched_notify_open_swap();


-- ===== supabase/migrations/055_staff_push_scheduler.sql =====
-- 055_staff_push_scheduler.sql — the timed run, driven by Supabase itself (Sarcafe's, adapted).
--
-- Staff push: the scheduler, run by Supabase itself (pg_cron + pg_net), so the timed alerts
-- (a shift about to start) and any push the request path missed go out every
-- couple of minutes without Vercel cron (the Hobby plan only allows daily ones).
--
-- Every two minutes pg_cron calls staff_push_tick(), which asks the app's /api/cron/staff-push
-- to run. Where the app lives is NOT in this file: it is the Vault secret `staff_push_url`
-- (https://<your domain>), set once by the owner (docs/STAFF_PUSH.md). Until it is set the
-- tick does nothing, harmlessly. The call is authenticated with a random secret generated here and kept in Supabase
-- Vault; the app checks it with staff_push_verify_cron() (the secret never leaves the database,
-- is never in the repo, and needs no Vercel environment variable). CRON_SECRET still works too.
--
-- Everything that needs pg_cron / pg_net / Vault is guarded: where they do not exist (the local
-- PGlite test database) the functions are created but the schedule is skipped with a notice.
-- Functions are service_role only like the rest; pg_cron runs as the database owner.

-- ---------------------------------------------------------------------
-- A. Functions
-- ---------------------------------------------------------------------
create or replace function public.staff_push_verify_cron(p_secret text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_secret is null or char_length(p_secret) < 32 then
    return false;
  end if;
  return exists (select 1 from vault.decrypted_secrets where name = 'staff_push_cron' and decrypted_secret = p_secret);
exception when others then
  return false;
end;
$$;

-- What pg_cron runs. A missing secret or an unreachable app must never raise: the next tick tries again.
create or replace function public.staff_push_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_url text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'staff_push_cron';
  select rtrim(decrypted_secret, '/') into v_url from vault.decrypted_secrets where name = 'staff_push_url';
  if v_secret is null or v_url is null or v_url !~ '^https://' then
    return;
  end if;
  perform net.http_get(
    url := v_url || '/api/cron/staff-push',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 25000
  );
exception when others then
  null;
end;
$$;

-- For the developer panel: is the schedule there, and did the last run reach the app?
create or replace function public.staff_push_cron_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_run record;
  v_http record;
begin
  begin
    select jobid, schedule, active into v_job from cron.job where jobname = 'staff-push';
    if v_job.jobid is not null then
      select status, start_time into v_run from cron.job_run_details where jobid = v_job.jobid order by start_time desc limit 1;
    end if;
    select status_code, error_msg, created into v_http from net._http_response order by created desc limit 1;
  exception when others then
    return jsonb_build_object('available', false);
  end;
  return jsonb_build_object(
    'available', true,
    'urlConfigured', exists (select 1 from vault.decrypted_secrets where name = 'staff_push_url'),
    'scheduled', v_job.jobid is not null,
    'schedule', v_job.schedule,
    'active', v_job.active,
    'lastRunAt', v_run.start_time,
    'lastRunStatus', v_run.status,
    'lastHttpStatus', v_http.status_code,
    'lastHttpAt', v_http.created,
    'lastHttpError', v_http.error_msg
  );
end;
$$;

revoke all on function public.staff_push_verify_cron(text) from public, anon, authenticated;
revoke all on function public.staff_push_tick() from public, anon, authenticated;
revoke all on function public.staff_push_cron_status() from public, anon, authenticated;
grant execute on function public.staff_push_verify_cron(text) to service_role;
grant execute on function public.staff_push_tick() to service_role;
grant execute on function public.staff_push_cron_status() to service_role;

-- ---------------------------------------------------------------------
-- B. The schedule (only where Supabase's scheduler, HTTP client and Vault exist)
-- ---------------------------------------------------------------------
do $schedule$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or not exists (select 1 from pg_available_extensions where name = 'supabase_vault') then
    raise notice 'staff push scheduler skipped: pg_cron, pg_net or Vault is not available in this database';
    return;
  end if;

  create extension if not exists pg_net with schema extensions;
  create extension if not exists pg_cron;

  if not exists (select 1 from vault.decrypted_secrets where name = 'staff_push_cron') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'staff_push_cron',
      'Bearer secret pg_cron sends to /api/cron/staff-push; verified by staff_push_verify_cron()'
    );
  end if;

  -- Same name = replace, so re-running this migration never creates a second job.
  perform cron.schedule('staff-push', '*/2 * * * *', 'select public.staff_push_tick()');
end
$schedule$;

commit;
