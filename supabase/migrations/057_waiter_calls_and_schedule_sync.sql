-- ============================================================
-- Ayeka Bar — customers calling a waiter from the menu, and the POS reading the
-- shift SCHEDULE.
--
-- ⚠️ NOT YET APPLIED. Apply after 056 (or independently — it does not depend on
--    056). Depends on 019 (waiter_tables), 020 (is_staff_client), 027
--    (schedule_weeks), 034 (waiter_shift_sessions), 041 (staff.active) and 048
--    (waiter_table_calls, already in production). Needs the owner's explicit
--    go-ahead — CLAUDE.md: "Never apply a Supabase migration without explicit,
--    per-migration approval".
--
-- WHAT IT IS FOR (owner, 2026-10-13):
--
--   "make sure the POS System is synced with the Schedule and make
--    announcements for that as well, shift start, shift end … wire up
--    Customers calling Staff on shift from the menu but don't enable it …
--    a customer opens the menu, adds items to their cart and calls a waiter
--    through the menu, each waiter that is on Shift and Shift time is on gets
--    the notification, including general manager or shift manager."
--
-- It adds, and changes nothing that exists:
--   1. two nullable cart-context columns on waiter_table_calls (048);
--   2. waiter_published_shifts_near() — the published schedule around "now",
--      in local wall-clock time (internal; nobody can call it directly);
--   3. waiter_is_call_recipient() — THE RULE for who is told about a call;
--   4. waiter_open_calls() / waiter_ack_call() — what the POS polls and taps;
--   5. waiter_schedule_today() — what the POS reads to announce a shift's
--      start and end (no colleague's identity leaves the database);
--   6. create_table_call() — the customer-facing write, SERVICE ROLE ONLY.
--
-- ── WHY RPCs AND NOT A TABLE GRANT ───────────────────────────────────
-- ayeka-staff's one rule (its CLAUDE.md): it must never be able to read a
-- table it does not own, under any credential it holds. `schedule_weeks`
-- belongs to the portal's scheduler, so the POS gets answers from narrow
-- SECURITY DEFINER functions in the waiter_ namespace instead of a grant — it
-- learns "is this shift mine, and when does it start", not the roster.
--
-- ── THE RECIPIENT RULE (waiter_is_call_recipient) ────────────────────
-- A signed-in, active staff member is told about a customer's call when ALL of:
--   a) the venue's manual shift session is open (waiter_shift_sessions) — the
--      same gate 038 puts on opening an order. No shift, no calls;
--   b) their JOB TITLE is front-of-house: waiter, shift manager ('manager'),
--      general manager, or an owner/OP/dev who can step in. Bartenders and
--      cooks do not walk to tables;
--   c) the SCHEDULE half:
--        • if the venue has published NO shift touching yesterday/today (the bar
--          is not using the scheduler yet — true today) → yes, everyone who
--          passed (a) and (b), otherwise a bar that has not adopted the
--          scheduler could never receive a call;
--        • otherwise → only people assigned to a shift that covers "now", plus
--          30 minutes after its end (staff are still in the room).
--
-- ⚠️ ONE RULE SPELLED TWICE: the schedule half is `onShiftForCalls()` and the
-- title half `isCallRecipientTitle()` in src/lib/shifts/presence.ts and
-- src/lib/waiter/calls.ts; scripts/check-presence.mjs pins their numbers
-- (the 30-minute grace; "touching yesterday/today"). Change one, change the
-- other — the lib/staff/access.ts ↔ is_op() lesson.
--
-- TIME: shift hours are stored as WALL-CLOCK date+time (027), and "now" is
-- compared as Asia/Jerusalem wall-clock too, so a DST night is the length a
-- human reads off the schedule.
-- ============================================================

-- ---- 1. Cart context on the call -------------------------------------------
-- "adds items to their cart and calls a waiter": the call can say how big the
-- table's cart is, so the waiter walks over knowing there is an order coming.
-- Counts only — never the items. Validated and clamped by create_table_call().
alter table public.waiter_table_calls
  add column if not exists cart_items integer
    check (cart_items is null or (cart_items >= 0 and cart_items <= 500)),
  add column if not exists cart_total_agorot integer
    check (cart_total_agorot is null or (cart_total_agorot >= 0 and cart_total_agorot <= 100000000));

-- ---- 2. The published schedule around now (internal) -----------------------
-- Reads the FROZEN published snapshot, never the draft tables — a manager's
-- unpublished edit must not change who is told about a call (the same reasoning
-- as readSchedule() in src/lib/owner/signals.ts).
create or replace function public.waiter_published_shifts_near()
returns table(shift_date date, start_ts timestamp, end_ts timestamp, assignments jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    x.d,
    (x.d + x.st),
    (x.d + x.en) + case when x.en <= x.st then interval '1 day' else interval '0 day' end,
    x.asg
  from (
    select
      (sh->>'date')::date                      as d,
      (sh->>'start')::time                     as st,
      (sh->>'end')::time                       as en,
      coalesce(sh->'assignments', '[]'::jsonb) as asg
    from public.schedule_weeks w
    cross join lateral jsonb_array_elements(coalesce(w.published_snapshot->'shifts', '[]'::jsonb)) sh
    where w.status = 'published'
      -- a week holds seven dates: widen so week_start can never clip a shift
      and w.week_start between ((now() at time zone 'Asia/Jerusalem')::date - 9)
                           and ((now() at time zone 'Asia/Jerusalem')::date + 1)
  ) x
  where x.d between ((now() at time zone 'Asia/Jerusalem')::date - 1)
                and ((now() at time zone 'Asia/Jerusalem')::date + 1);
$$;

-- Internal: reached only through the SECURITY DEFINER functions below, which
-- run as the owner. 044's lesson — revoke from PUBLIC explicitly.
revoke execute on function public.waiter_published_shifts_near() from public, anon, authenticated;

-- ---- 3. Who is told about a call -------------------------------------------
create or replace function public.waiter_is_call_recipient()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff  public.staff%rowtype;
  v_now    timestamp := (now() at time zone 'Asia/Jerusalem');
  v_today  date      := (now() at time zone 'Asia/Jerusalem')::date;
  v_in_use boolean;
begin
  -- A removed person has auth_user_id cleared (041) and so finds no row here;
  -- `active` is belt and braces.
  select * into v_staff from public.staff s where s.auth_user_id = auth.uid() and s.active;
  if not found then
    return false;
  end if;

  -- a) no open shift, no calls
  if not exists (select 1 from public.waiter_shift_sessions where status = 'active') then
    return false;
  end if;

  -- b) job title (mirrors isCallRecipientTitle() in src/lib/waiter/calls.ts)
  if not (
    v_staff.role = 'owner'
    or v_staff.badge in ('owner', 'general_manager', 'manager', 'waiter')
    or lower(coalesce(v_staff.badge, '')) = 'dev'
  ) then
    return false;
  end if;

  -- c) the schedule half (mirrors onShiftForCalls() in presence.ts)
  select exists (
    select 1 from public.waiter_published_shifts_near() p
    where p.shift_date in (v_today - 1, v_today)
  ) into v_in_use;

  if not v_in_use then
    return true;
  end if;

  return exists (
    select 1
    from public.waiter_published_shifts_near() p
    where v_now >= p.start_ts
      and v_now <  p.end_ts + interval '30 minutes'      -- SHIFT_END_GRACE_MINUTES
      and exists (
        select 1 from jsonb_array_elements(p.assignments) a
        where a->>'staffId' = v_staff.id::text
      )
  );
end;
$$;

revoke execute on function public.waiter_is_call_recipient() from public, anon, authenticated;
grant  execute on function public.waiter_is_call_recipient() to authenticated;

comment on function public.waiter_is_call_recipient() is
  'May this signed-in user be told about a customer waiter-call right now? '
  'Open shift + front-of-house title + (no schedule in use OR scheduled on a '
  'shift covering now +30 min). Mirrors onShiftForCalls() / '
  'isCallRecipientTitle() — change them together.';

-- ---- 4. What the POS polls, and what it taps -------------------------------
-- Returns NOTHING (not an error) to a non-recipient, so a bartender's app can
-- call it harmlessly and a customer-facing leak is impossible by construction.
create or replace function public.waiter_open_calls()
returns table(
  id uuid, table_id uuid, table_number integer, kind text,
  called_at timestamptz, cart_items integer, cart_total_agorot integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.waiter_is_call_recipient() then
    return;
  end if;

  return query
    select c.id, c.table_id, c.table_number, c.kind, c.called_at, c.cart_items, c.cart_total_agorot
    from public.waiter_table_calls c
    where c.acknowledged_at is null
      and c.called_at > now() - interval '2 hours'     -- CALL_OPEN_WINDOW_MINUTES
    order by c.called_at;
end;
$$;

revoke execute on function public.waiter_open_calls() from public, anon, authenticated;
grant  execute on function public.waiter_open_calls() to authenticated;

-- First tap wins: the update only matches an unacknowledged row, so two
-- waiters tapping together cannot both "take" it — the loser is told 'taken'.
create or replace function public.waiter_ack_call(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff uuid;
  v_n     integer;
begin
  if not public.waiter_is_call_recipient() then
    return 'forbidden';
  end if;

  select s.id into v_staff from public.staff s where s.auth_user_id = auth.uid();

  update public.waiter_table_calls
     set acknowledged_by = v_staff, acknowledged_at = now()
   where id = p_id and acknowledged_at is null;
  get diagnostics v_n = row_count;

  if v_n = 1 then
    return 'ok';
  end if;
  if exists (select 1 from public.waiter_table_calls where id = p_id) then
    return 'taken';
  end if;
  return 'missing';
end;
$$;

revoke execute on function public.waiter_ack_call(uuid) from public, anon, authenticated;
grant  execute on function public.waiter_ack_call(uuid) to authenticated;

-- ---- 5. What the POS reads to announce a shift's start and end --------------
-- ANY active staff member may read it (every role sees the same announcement),
-- but the answer carries no colleague's identity: per shift it says when it
-- runs, whether the CALLER is on it, and how many people are. `now_local` is
-- the server's wall-clock, so a tablet with a drifting clock still announces at
-- the right moment (the client anchors on it).
create or replace function public.waiter_schedule_today()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff uuid;
  v_now   timestamp := (now() at time zone 'Asia/Jerusalem');
  v_today date      := (now() at time zone 'Asia/Jerusalem')::date;
begin
  select s.id into v_staff from public.staff s where s.auth_user_id = auth.uid() and s.active;
  if v_staff is null then
    return null;
  end if;

  return jsonb_build_object(
    'now_local', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS'),
    'in_use', exists (
      select 1 from public.waiter_published_shifts_near() p where p.shift_date in (v_today - 1, v_today)
    ),
    'shifts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date',   p.shift_date,
          'start',  to_char(p.start_ts, 'HH24:MI'),
          'end',    to_char(p.end_ts,   'HH24:MI'),
          'mine',   exists (select 1 from jsonb_array_elements(p.assignments) a where a->>'staffId' = v_staff::text),
          'people', jsonb_array_length(p.assignments)
        )
        order by p.start_ts
      )
      from public.waiter_published_shifts_near() p
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.waiter_schedule_today() from public, anon, authenticated;
grant  execute on function public.waiter_schedule_today() to authenticated;

-- ---- 6. The customer's call (SERVICE ROLE ONLY) -----------------------------
-- Reached only through POST /api/table/call, behind checkRateLimit() and the
-- owner's `waiter_call_enabled` switch. Granted to NOBODY else, for 048's
-- reason: a function granted to `anon` is an unmetered endpoint for everyone
-- holding the anon key.
--
-- Returns a status rather than raising (so the route can map it to a calm
-- message in the customer's language). `duplicate` is a SUCCESS: a second tap
-- on the same table within three minutes returns the call already open instead
-- of paging every waiter twice.
create or replace function public.create_table_call(
  p_table_number integer,
  p_kind         text,
  p_cart_items   integer,
  p_cart_total   integer
)
returns table(ok boolean, reason text, call_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table    public.waiter_tables%rowtype;
  v_existing uuid;
  v_id       uuid;
begin
  if p_kind is null or p_kind not in ('waiter', 'bill', 'assistance') then
    return query select false, 'bad_kind', null::uuid;
    return;
  end if;

  if p_table_number is null or p_table_number < 1 or p_table_number > 999 then
    return query select false, 'unknown_table', null::uuid;
    return;
  end if;

  select * into v_table from public.waiter_tables t where t.number = p_table_number and t.active;
  if not found then
    return query select false, 'unknown_table', null::uuid;
    return;
  end if;

  if not exists (select 1 from public.waiter_shift_sessions where status = 'active') then
    return query select false, 'no_shift', null::uuid;
    return;
  end if;

  select c.id into v_existing
    from public.waiter_table_calls c
   where c.table_id = v_table.id and c.kind = p_kind
     and c.acknowledged_at is null
     and c.called_at > now() - interval '3 minutes'
   order by c.called_at desc
   limit 1;
  if found then
    return query select true, 'duplicate', v_existing;
    return;
  end if;

  insert into public.waiter_table_calls (table_id, table_number, kind, cart_items, cart_total_agorot)
  values (
    v_table.id, v_table.number, p_kind,
    least(greatest(coalesce(p_cart_items, 0), 0), 500),
    least(greatest(coalesce(p_cart_total, 0), 0), 100000000)
  )
  returning id into v_id;

  return query select true, null::text, v_id;
end;
$$;

revoke execute on function public.create_table_call(integer, text, integer, integer) from public, anon, authenticated;

comment on function public.create_table_call(integer, text, integer, integer) is
  'A customer asks for a waiter/the bill/help at table N. SERVICE ROLE ONLY - '
  'call it from POST /api/table/call, behind checkRateLimit() and the '
  'waiter_call_enabled switch. Needs an open shift; a second tap within three '
  'minutes returns the open call (duplicate) rather than paging twice.';
