-- ============================================================
-- Ayeka Bar — TABLE OWNERSHIP FOR CUSTOMER REQUESTS, and the activity feed
-- hearing about them.  (Follows 057 waiter calls + 058 remote ordering.)
--
-- ⚠️ NOT YET APPLIED. Drafted and tested offline 2026-10-15
--    (scripts/check-migration-061.mjs — the real 048/049/057/058/061 on an
--    in-memory Postgres; scripts/verify-056-057-on-scheduler.mjs runs it on the
--    real 000→060 chain). Needs the owner's explicit, per-migration go-ahead.
--    It is safe to apply any time: it replaces functions the POS already calls
--    (same names, extra columns) and nothing in production depends on a column
--    count.
--
-- ── WHAT WENT WRONG (found 2026-10-15, on production, by the owner's own test) ──
-- A customer connected to table 1 with a waiter's code and sent an order. The
-- request WAS in the database (status `pending`, two items, ₪82) — and the POS
-- showed "no requests", and nobody was pushed. The cause was 057's recipient
-- rule, which 058 reused for orders: "open shift + front-of-house title + (no
-- schedule in use OR assigned to a shift covering now ±30 min)". A published
-- schedule existed (last night's), the person who generated the code was not on
-- it, and it was 10:57 in the morning — so the one person who had LINKED the
-- table was not allowed to see the table's own request. The rule answered
-- "who is rostered", when the question a customer's phone is asking is "who is
-- looking after MY table".
--
-- ── WHAT THE OWNER ASKED FOR (2026-10-15) ────────────────────────────────
--   • When a waiter links customers to a table, the table is CLAIMED by that
--     waiter automatically, and the activity feed says the table was chained
--     to customers.
--   • The customer's session knows its table AND its waiter — so the "call a
--     waiter" window must not ask for a table number, and shows the waiter's
--     name.
--   • Orders and calls reach that waiter with a push; every event that needs a
--     push gets one.
--   • "The whole flow never stops": if the table's waiter does not react, the
--     others on shift must be able to take it.
--
-- ── THE NEW RULE, in one paragraph ───────────────────────────────────────
-- waiter_staff_can_handle_table(staff, table, since) — may THIS person see and
-- take a customer's request (an order or a call) for THIS table?
--   a shift must be open (always) and the person must be active; then
--   1. the table's WAITER (held_by_staff_id) always can — no roster check:
--      linking the table was their own act;
--   2. management (owner / general manager / shift manager / dev) always can —
--      oversight, and the owner's account is not on the roster;
--   3. anyone else can only if 057's rule says they are on shift, AND either
--      the table has no waiter, or the request has waited ESCALATION_SECONDS
--      (90) without being taken — a dead phone must not strand a customer.
-- The portal pushes the table's waiter first and, after the same 90 seconds, the
-- rest (src/lib/push/orders.ts) — the two numbers are pinned together by
-- scripts/check-remote-ordering.mjs.
--
-- ── WHAT IT ADDS ─────────────────────────────────────────────────────────
--   1. activity-feed vocabulary: table_chained, customer_connected,
--      customer_order, customer_call;
--   2. waiter_table_holder(), waiter_staff_can_handle_table();
--   3. issue_table_code() REPLACED: claims the table for the caller and writes
--      the `table_chained` event;
--   4. AFTER INSERT triggers write the feed events for a customer connecting, a
--      request and a call (so every insert path is covered, not one function);
--   5. waiter_pending_submissions(), waiter_open_calls() REPLACED (the new rule,
--      plus who the table's waiter is); waiter_review_submission(),
--      waiter_ack_call(), waiter_table_visit() REPLACED (the new rule);
--   6. table_session_waiter() — the waiter's first name for the customer's phone;
--   7. create_table_call() REPLACED and create_table_call_for_session() added —
--      a connected phone calls without typing a table, and the answer says who
--      to push.
--
-- SECURITY POSTURE (048's, unchanged): every function revokes EXECUTE from PUBLIC
-- first (044); the customer-facing ones go to nobody but service_role. The two
-- helpers that take an arbitrary staff id are not executable by signed-in users
-- (they would be an oracle for "is X on shift").
-- ============================================================

-- ---- 1. The feed's vocabulary -------------------------------------------------
-- 023's list, as it stands in production, plus four. Dropped and re-added so this
-- stays the single place the list lives (the 019/023 approach).
alter table public.waiter_order_events
  drop constraint if exists waiter_order_events_event_check;
alter table public.waiter_order_events
  add constraint waiter_order_events_event_check
  check (event in (
    'opened','item_added','qty_changed','item_removed','filed','paid','voided',
    'reopened','note_changed','batch_opened','batch_filed','seat_added','seat_removed',
    'table_assigned','table_released','table_taken_over','label_changed',
    'item_sent','item_ready','item_delivered','item_undelivered',
    'guest_added','guest_renamed','guest_removed','item_reassigned',
    -- 061:
    'table_chained','customer_connected','customer_order','customer_call'
  ));

-- ---- 2. Who looks after a table -----------------------------------------------

-- The table's waiter, if there is one who can actually be told: an active person
-- with a login, while a shift is open. Null otherwise (the caller then falls back
-- to the roster rule). SERVICE ROLE ONLY — the portal's push sender asks it.
create or replace function public.waiter_table_holder(p_table_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id
    from public.waiter_tables t
    join public.staff s on s.id = t.held_by_staff_id
   where t.id = p_table_id
     and s.active and s.auth_user_id is not null
     and exists (select 1 from public.waiter_shift_sessions where status = 'active');
$$;
revoke execute on function public.waiter_table_holder(uuid) from public, anon, authenticated;
comment on function public.waiter_table_holder(uuid) is
  'The waiter holding this table, when they are active, have a login and a shift is open. '
  'SERVICE ROLE ONLY (the push sender). Null = nobody in particular: fall back to the roster rule.';

-- May this person see and take a customer's request for this table? See the header.
-- `p_since` is when the request was made (the escalation clock). Internal.
create or replace function public.waiter_staff_can_handle_table(p_staff_id uuid, p_table_id uuid, p_since timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff  public.staff%rowtype;
  v_holder uuid;
begin
  select * into v_staff from public.staff s where s.id = p_staff_id and s.active and s.auth_user_id is not null;
  if not found then
    return false;
  end if;
  if not exists (select 1 from public.waiter_shift_sessions where status = 'active') then
    return false;
  end if;

  v_holder := public.waiter_table_holder(p_table_id);

  -- 1. the table's own waiter
  if v_holder is not null and v_holder = p_staff_id then
    return true;
  end if;

  -- 2. management oversight. ⚠️ ONE RULE SPELLED TWICE with 057's title half
  --    (isCallRecipientTitle) minus 'waiter': keep both in step.
  if v_staff.role = 'owner'
     or v_staff.badge in ('owner', 'general_manager', 'manager')
     or lower(coalesce(v_staff.badge, '')) = 'dev' then
    return true;
  end if;

  -- 3. everyone else: on shift by 057's rule, and either the table has nobody or
  --    the request has waited long enough that the waiter may not be looking.
  if not public.waiter_staff_is_call_recipient(p_staff_id) then
    return false;
  end if;
  if v_holder is null then
    return true;
  end if;
  return p_since <= now() - make_interval(secs => 90);            -- ESCALATION_SECONDS
end;
$$;
revoke execute on function public.waiter_staff_can_handle_table(uuid, uuid, timestamptz) from public, anon, authenticated;

-- A first name a customer may be shown: first_name, else display_name. Never an
-- email, never a surname.
create or replace function public._staff_first_name(p_staff_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(nullif(trim(s.first_name), ''), nullif(trim(s.display_name), ''))
    from public.staff s where s.id = p_staff_id;
$$;
revoke execute on function public._staff_first_name(uuid) from public, anon, authenticated;

-- ---- 3. Linking a table to customers CLAIMS it --------------------------------
-- REPLACES 058's issue_table_code (same signature and result). New: the caller
-- becomes the table's waiter ("the user logged in claims the table
-- automatically") and the activity feed hears about it. A waiter who takes over a
-- table that someone else was holding is recorded as such in the event.
--
-- The claim goes through the SAME trigger a tap does (waiter_tables_guard, 022):
-- it lets a signed-in person set held_by to THEMSELVES and nothing else, so this
-- cannot assign a table to a colleague.
create or replace function public.issue_table_code(p_table_id uuid)
returns table(code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_staff   uuid;
  v_digits  text;
  v_hash    text;
  v_expires timestamptz;
  v_number  integer;
  v_prev    uuid;
begin
  if not public.is_staff_client() then
    raise exception 'not staff' using errcode = '42501';
  end if;
  if not exists (select 1 from public.waiter_shift_sessions where status = 'active') then
    raise exception 'no active shift' using errcode = 'P0001';
  end if;
  select t.number, t.held_by_staff_id into v_number, v_prev
    from public.waiter_tables t where t.id = p_table_id and t.active;
  if not found then
    raise exception 'unknown table' using errcode = 'P0002';
  end if;

  select s.id into v_staff from public.staff s where s.auth_user_id = auth.uid();

  perform public._end_table_visit(p_table_id, 'replaced');

  select m.digits, m.digest_hex into v_digits, v_hash from public._mint_table_digits() m;
  v_expires := now() + make_interval(secs => 600);  -- TABLE_CODE_TTL_SECONDS: first use must be quick

  insert into public.waiter_table_codes (table_id, code_hash, issued_by, expires_at)
  values (p_table_id, v_hash, v_staff, v_expires);

  -- The claim. A no-op (and no event noise from the trigger) when they already hold it.
  if v_prev is distinct from v_staff then
    update public.waiter_tables t set held_by_staff_id = v_staff where t.id = p_table_id;
  end if;

  -- The activity feed. The actor is stamped from the session by waiter_events_stamp.
  insert into public.waiter_order_events (table_id, event, payload)
  values (p_table_id, 'table_chained',
          jsonb_build_object('table', v_number, 'taken_over', v_prev is not null and v_prev <> v_staff));

  return query select v_digits, v_expires;
end;
$$;
revoke execute on function public.issue_table_code(uuid) from public, anon, authenticated;
grant  execute on function public.issue_table_code(uuid) to authenticated;
comment on function public.issue_table_code(uuid) is
  'Start a NEW ordering visit for a table and return its digits (once; only the '
  'hash is stored). Ends the table''s previous visit, CLAIMS the table for the caller and '
  'writes a table_chained event to the activity feed (061). Staff-only, shift-gated.';

-- ---- 4. The activity feed hears about customers -------------------------------
-- AFTER INSERT triggers rather than lines inside three functions: every path that
-- creates the row is covered, and the functions stay as tested. SECURITY DEFINER
-- because the rows are inserted by service_role / definer functions and the feed
-- table's own writer policy is for signed-in staff.

create or replace function public._feed_customer_connected()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  select count(*) into v_n from public.customer_table_sessions s
   where s.code_id is not distinct from new.code_id and s.revoked_at is null;
  insert into public.waiter_order_events (table_id, event, actor, payload)
  values (new.table_id, 'customer_connected', 'לקוח', jsonb_build_object('devices', v_n));
  return new;
exception when others then
  return new;   -- the feed is best-effort: it must never undo a customer's connection
end;
$$;
revoke execute on function public._feed_customer_connected() from public, anon, authenticated;
drop trigger if exists feed_customer_connected on public.customer_table_sessions;
create trigger feed_customer_connected
  after insert on public.customer_table_sessions
  for each row execute function public._feed_customer_connected();

create or replace function public._feed_customer_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.table_id is null then
    return new;   -- the feed row must hang off a table (the scope CHECK)
  end if;
  insert into public.waiter_order_events (table_id, event, actor, payload)
  values (new.table_id, 'customer_order', 'לקוח',
          jsonb_build_object('items', new.item_count, 'total_agorot', new.total_agorot, 'submission', new.id));
  return new;
exception when others then
  return new;   -- best-effort: a feed problem must never lose a customer's order
end;
$$;
revoke execute on function public._feed_customer_order() from public, anon, authenticated;
drop trigger if exists feed_customer_order on public.customer_cart_submissions;
create trigger feed_customer_order
  after insert on public.customer_cart_submissions
  for each row execute function public._feed_customer_order();

create or replace function public._feed_customer_call()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.waiter_order_events (table_id, event, actor, payload)
  values (new.table_id, 'customer_call', 'לקוח', jsonb_build_object('kind', new.kind, 'call', new.id));
  return new;
exception when others then
  return new;   -- best-effort: a feed problem must never lose a customer's call
end;
$$;
revoke execute on function public._feed_customer_call() from public, anon, authenticated;
drop trigger if exists feed_customer_call on public.waiter_table_calls;
create trigger feed_customer_call
  after insert on public.waiter_table_calls
  for each row execute function public._feed_customer_call();

-- ---- 5. What the POS polls and taps (REPLACED — the new rule) ------------------
-- Return types grow (who the table's waiter is), so these are dropped and
-- re-created; the grants are re-stated. A POS that has not been updated reads
-- the rows it knows and ignores the extra columns.

drop function if exists public.waiter_pending_submissions();
create function public.waiter_pending_submissions()
returns table(
  id uuid, table_id uuid, table_number integer, created_at timestamptz,
  item_count integer, total_agorot integer, payload jsonb,
  holder_id uuid, holder_name text, mine boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid;
begin
  select s.id into v_me from public.staff s where s.auth_user_id = auth.uid() and s.active;
  if v_me is null then
    return;
  end if;
  return query
    select x.id, x.table_id, x.table_number, x.created_at, x.item_count, x.total_agorot, x.payload,
           h.id, public._staff_first_name(h.id), (h.id is not distinct from v_me)
      from public.customer_cart_submissions x
      left join public.waiter_tables t on t.id = x.table_id
      left join public.staff h on h.id = t.held_by_staff_id and h.active
     where x.status = 'pending'
       and x.created_at > now() - interval '2 hours'                         -- SUBMISSION_OPEN_WINDOW_MINUTES
       and public.waiter_staff_can_handle_table(v_me, x.table_id, x.created_at)
     order by x.created_at;
end;
$$;
revoke execute on function public.waiter_pending_submissions() from public, anon, authenticated;
grant  execute on function public.waiter_pending_submissions() to authenticated;

drop function if exists public.waiter_open_calls();
create function public.waiter_open_calls()
returns table(
  id uuid, table_id uuid, table_number integer, kind text,
  called_at timestamptz, cart_items integer, cart_total_agorot integer,
  holder_id uuid, holder_name text, mine boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid;
begin
  select s.id into v_me from public.staff s where s.auth_user_id = auth.uid() and s.active;
  if v_me is null then
    return;
  end if;
  return query
    select c.id, c.table_id, c.table_number, c.kind, c.called_at, c.cart_items, c.cart_total_agorot,
           h.id, public._staff_first_name(h.id), (h.id is not distinct from v_me)
      from public.waiter_table_calls c
      left join public.waiter_tables t on t.id = c.table_id
      left join public.staff h on h.id = t.held_by_staff_id and h.active
     where c.acknowledged_at is null
       and c.called_at > now() - interval '2 hours'                          -- CALL_OPEN_WINDOW_MINUTES
       and public.waiter_staff_can_handle_table(v_me, c.table_id, c.called_at)
     order by c.called_at;
end;
$$;
revoke execute on function public.waiter_open_calls() from public, anon, authenticated;
grant  execute on function public.waiter_open_calls() to authenticated;

-- First tap wins (unchanged); only WHO may tap changed.
create or replace function public.waiter_review_submission(
  p_id uuid, p_outcome text, p_order_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff uuid;
  v_row   record;
  v_n     integer;
begin
  if p_outcome is null or p_outcome not in ('imported', 'rejected') then
    return 'bad_outcome';
  end if;
  select s.id into v_staff from public.staff s where s.auth_user_id = auth.uid() and s.active;
  if v_staff is null then
    return 'forbidden';
  end if;

  select x.table_id, x.created_at into v_row from public.customer_cart_submissions x where x.id = p_id;
  if not found then
    return 'missing';
  end if;
  if not public.waiter_staff_can_handle_table(v_staff, v_row.table_id, v_row.created_at) then
    return 'forbidden';
  end if;

  update public.customer_cart_submissions x
     set status = p_outcome, reviewed_by = v_staff, reviewed_at = now(),
         order_id = case when p_outcome = 'imported' then p_order_id else null end
   where x.id = p_id and x.status = 'pending';
  get diagnostics v_n = row_count;

  if v_n = 1 then
    return 'ok';
  end if;
  return 'taken';
end;
$$;
revoke execute on function public.waiter_review_submission(uuid, text, uuid) from public, anon, authenticated;
grant  execute on function public.waiter_review_submission(uuid, text, uuid) to authenticated;

create or replace function public.waiter_ack_call(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff uuid;
  v_row   record;
  v_n     integer;
begin
  select s.id into v_staff from public.staff s where s.auth_user_id = auth.uid() and s.active;
  if v_staff is null then
    return 'forbidden';
  end if;

  select c.table_id, c.called_at into v_row from public.waiter_table_calls c where c.id = p_id;
  if not found then
    return 'missing';
  end if;
  if not public.waiter_staff_can_handle_table(v_staff, v_row.table_id, v_row.called_at) then
    return 'forbidden';
  end if;

  update public.waiter_table_calls
     set acknowledged_by = v_staff, acknowledged_at = now()
   where id = p_id and acknowledged_at is null;
  get diagnostics v_n = row_count;

  if v_n = 1 then
    return 'ok';
  end if;
  return 'taken';
end;
$$;
revoke execute on function public.waiter_ack_call(uuid) from public, anon, authenticated;
grant  execute on function public.waiter_ack_call(uuid) to authenticated;

-- The table sheet's status. 058's fields, plus who looks after the table.
create or replace function public.waiter_table_visit(p_table_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row    public.waiter_table_codes;
  v_me     uuid;
  v_holder uuid;
begin
  if not public.is_staff_client() then
    return null;
  end if;
  select s.id into v_me from public.staff s where s.auth_user_id = auth.uid();
  select t.held_by_staff_id into v_holder from public.waiter_tables t where t.id = p_table_id;

  select * into v_row
    from public.waiter_table_codes c
   where c.table_id = p_table_id and public._table_code_is_live(c)
   order by c.issued_at desc
   limit 1;

  return jsonb_build_object(
    'shift_open', exists (select 1 from public.waiter_shift_sessions where status = 'active'),
    'has_visit',  v_row.id is not null,
    'activated',  v_row.activated_at is not null,
    'ends_at',    case when v_row.id is null then null
                       when v_row.activated_at is null then v_row.expires_at
                       else v_row.visit_ends_at end,
    'devices',    case when v_row.id is null then 0 else (
                    select count(*) from public.customer_table_sessions s
                     where s.code_id = v_row.id and s.revoked_at is null and s.expires_at > now()) end,
    'pending',    (select count(*) from public.customer_cart_submissions x
                    where x.table_id = p_table_id and x.status = 'pending'
                      and x.created_at > now() - interval '2 hours'),
    'holder_id',   v_holder,
    'holder_name', public._staff_first_name(v_holder),
    'mine',        v_holder is not null and v_holder is not distinct from v_me
  );
end;
$$;
revoke execute on function public.waiter_table_visit(uuid) from public, anon, authenticated;
grant  execute on function public.waiter_table_visit(uuid) to authenticated;

-- ---- 6. The customer's phone learns its waiter --------------------------------
-- SERVICE ROLE ONLY. The first name of whoever looks after the session's table
-- now (the table's holder), else whoever generated the visit's code. Null if
-- neither is a live person. Never a surname, never an email.
create or replace function public.table_session_waiter(p_token text)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_s public.customer_table_sessions;
  v_who uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into v_s from public.customer_table_sessions s
   where s.token_hash = encode(digest(p_token, 'sha256'), 'hex')
     and s.revoked_at is null and s.expires_at > now();
  if v_s.id is null then
    return null;
  end if;

  select t.held_by_staff_id into v_who
    from public.waiter_tables t
    join public.staff s on s.id = t.held_by_staff_id and s.active
   where t.id = v_s.table_id;
  if v_who is null then
    select c.issued_by into v_who
      from public.waiter_table_codes c
      join public.staff s on s.id = c.issued_by and s.active
     where c.id = v_s.code_id;
  end if;
  return public._staff_first_name(v_who);
end;
$$;
revoke execute on function public.table_session_waiter(text) from public, anon, authenticated;

-- ---- 7. Calls: a connected phone does not type a table -------------------------
-- 057's create_table_call() returned (ok, reason, call_id). The route now also
-- needs WHICH table and WHO to push, so the return type grows — hence drop +
-- create. The insert itself is factored so the two public entry points cannot
-- drift apart.

drop function if exists public.create_table_call(integer, text, integer, integer);

create or replace function public._insert_table_call(
  p_table_id uuid, p_session_id uuid, p_kind text, p_cart_items integer, p_cart_total integer
)
returns table(ok boolean, reason text, call_id uuid, table_id uuid, table_number integer, holder_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table    public.waiter_tables%rowtype;
  v_existing uuid;
  v_id       uuid;
  v_holder   uuid;
begin
  if p_kind is null or p_kind not in ('waiter', 'bill', 'assistance') then
    return query select false, 'bad_kind', null::uuid, null::uuid, null::integer, null::uuid;
    return;
  end if;

  select * into v_table from public.waiter_tables t where t.id = p_table_id and t.active;
  if not found then
    return query select false, 'unknown_table', null::uuid, null::uuid, null::integer, null::uuid;
    return;
  end if;

  if not exists (select 1 from public.waiter_shift_sessions where status = 'active') then
    return query select false, 'no_shift', null::uuid, v_table.id, v_table.number, null::uuid;
    return;
  end if;

  v_holder := public.waiter_table_holder(v_table.id);

  select c.id into v_existing
    from public.waiter_table_calls c
   where c.table_id = v_table.id and c.kind = p_kind
     and c.acknowledged_at is null
     and c.called_at > now() - interval '3 minutes'
   order by c.called_at desc
   limit 1;
  if found then
    return query select true, 'duplicate', v_existing, v_table.id, v_table.number, v_holder;
    return;
  end if;

  insert into public.waiter_table_calls (table_id, table_number, session_id, kind, cart_items, cart_total_agorot)
  values (
    v_table.id, v_table.number, p_session_id, p_kind,
    least(greatest(coalesce(p_cart_items, 0), 0), 500),
    least(greatest(coalesce(p_cart_total, 0), 0), 100000000)
  )
  returning id into v_id;

  return query select true, null::text, v_id, v_table.id, v_table.number, v_holder;
end;
$$;
revoke execute on function public._insert_table_call(uuid, uuid, text, integer, integer) from public, anon, authenticated;

-- A customer who is NOT connected types the number printed on the table (057's
-- behaviour, unchanged apart from the extra columns).
create or replace function public.create_table_call(
  p_table_number integer, p_kind text, p_cart_items integer, p_cart_total integer
)
returns table(ok boolean, reason text, call_id uuid, table_id uuid, table_number integer, holder_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_kind is null or p_kind not in ('waiter', 'bill', 'assistance') then
    return query select false, 'bad_kind', null::uuid, null::uuid, null::integer, null::uuid;
    return;
  end if;
  if p_table_number is null or p_table_number < 1 or p_table_number > 999 then
    return query select false, 'unknown_table', null::uuid, null::uuid, null::integer, null::uuid;
    return;
  end if;
  select t.id into v_id from public.waiter_tables t where t.number = p_table_number and t.active;
  if v_id is null then
    return query select false, 'unknown_table', null::uuid, null::uuid, null::integer, null::uuid;
    return;
  end if;
  return query select * from public._insert_table_call(v_id, null, p_kind, p_cart_items, p_cart_total);
end;
$$;
revoke execute on function public.create_table_call(integer, text, integer, integer) from public, anon, authenticated;
comment on function public.create_table_call(integer, text, integer, integer) is
  'A customer at table N (typed) asks for a waiter/the bill/help. SERVICE ROLE ONLY - '
  'POST /api/table/call, behind checkRateLimit() and the waiter_call_enabled switch. '
  'Needs an open shift; a second tap within three minutes returns the open call (duplicate). '
  '061: also returns the table and the table''s waiter, for the push.';

-- A CONNECTED phone: the table comes from the session, never from the request.
create or replace function public.create_table_call_for_session(
  p_token text, p_kind text, p_cart_items integer, p_cart_total integer
)
returns table(ok boolean, reason text, call_id uuid, table_id uuid, table_number integer, holder_id uuid)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_s record;
begin
  select * into v_s from public.table_session_lookup(p_token) l;
  if not coalesce(v_s.ok, false) then
    return query select false, coalesce(v_s.reason, 'no_session'), null::uuid, null::uuid, null::integer, null::uuid;
    return;
  end if;
  return query select * from public._insert_table_call(v_s.table_id, v_s.session_id, p_kind, p_cart_items, p_cart_total);
end;
$$;
revoke execute on function public.create_table_call_for_session(text, text, integer, integer) from public, anon, authenticated;
comment on function public.create_table_call_for_session(text, text, integer, integer) is
  'A connected phone asks for a waiter/the bill/help. SERVICE ROLE ONLY - POST /api/table/call '
  'with the table-session cookie. The table is the SESSION''s; nothing in the request names one.';
