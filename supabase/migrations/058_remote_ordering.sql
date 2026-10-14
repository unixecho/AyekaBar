-- ============================================================
-- Ayeka Bar — REMOTE ORDERING ("the customer orders from their own phone,
-- after a member of staff gives them a code"). Phase 2 of PLAN_MENU_CART.md.
--
-- ⚠️ NOT YET APPLIED. Drafted and tested offline 2026-10-13
--    (scripts/check-migration-058.mjs — real 048 + 057 + this file on an
--    in-memory Postgres). Needs the owner's explicit, per-migration go-ahead —
--    CLAUDE.md: "Never apply a Supabase migration without explicit approval".
--
--    It is SAFE TO APPLY EARLY: nothing reaches any of it until the developer's
--    switch (`table_ordering_enabled`, /owner/dev) is turned on, and that switch
--    ships OFF. Applied or not, the customer sees no change today.
--
-- DEPENDS ON: 048 (waiter_table_codes, customer_table_sessions,
--   customer_cart_submissions — all EMPTY in production, verified 2026-10-13),
--   054 (staff_push_subscriptions), 057 (waiter_is_call_recipient and the
--   schedule readers), 041 (staff.active), 020 (is_staff_client), 034
--   (waiter_shift_sessions).
--
-- ── WHAT THE OWNER ASKED FOR (2026-10-13) ────────────────────────────
--   "Staff who are on shift and logged into the POS will be able to generate a
--    6-digit code which the customer puts into his cart, and that authenticates
--    without sending an SMS. Once the user is authenticated the session needs
--    to be saved and can be RECOVERED via the 6-digit code, and later on a
--    freshly printed QR code will be linked with the 6-digit code and will be
--    the source of authentication. Staff registered to the shift get a push
--    update with vibration and a ding — to the main saved site or to the OMS;
--    if both are logged in, the OMS."
--
-- ── WHAT CHANGES FROM 048, AND WHY ───────────────────────────────────
-- 048 made a code SINGLE-USE: redeeming it burned it and minted one session.
-- "Recoverable" is the opposite requirement — the same digits must work again
-- when a phone dies, a cookie is cleared, or a second person at the table joins
-- — so the model is now three layers, and the middle one is the new idea:
--
--     CODE ROW  = the VISIT.   One per table per party. It is created when the
--                 waiter generates digits, ACTIVATED the first time they are
--                 typed, and lives until staff end it (or three hours pass).
--                 `consumed_at` keeps its 048 column and its index, but it now
--                 means "this visit is over", not "this code was used once".
--     SESSION   = a DEVICE.    Many per visit (capped), each with its own
--                 cookie token. All of them die when the visit ends.
--     SUBMISSION= an order REQUEST, belonging to a session — and therefore to
--                 the visit, so a recovered phone sees what was already sent.
--
-- The QR that is planned for later is a SECOND CREDENTIAL FOR THE SAME VISIT
-- (a 32-byte token, unguessable, whose hash would find the code row exactly as
-- the digits' hash does). That is why nothing about the visit is keyed to the
-- digits: when the QR arrives it is one more way to reach a row that already
-- exists. Deliberately NOT built here — an unused column is a claim nobody
-- tests.
--
-- ── WHAT RECOVERY COSTS IN SECURITY, STATED PLAINLY ──────────────────
-- 048/049's defence was "the code lives ten minutes". A recoverable code lives
-- up to THREE HOURS once activated, so the window a leaked or guessed code is
-- useful in is ~18× longer. What bounds that (and the first three are new):
--   1. RECOVERY NEVER EXTENDS: every session ends when the VISIT ends
--      (activated_at + 3h), however many times the digits are retyped.
--   2. A DEVICE CAP (6 live sessions per visit) — a leaked code cannot be
--      turned into an unlimited number of cookies.
--   3. ROTATE AND END, in one tap on the waiter's screen: new digits for the
--      same party (old digits stop working, devices stay), or end the visit
--      (every device is signed out). Ending is automatic when the POS closes or
--      abandons the table.
--   4. checkRateLimit() on the route in front (per IP) AND the global failure
--      counter 049 required — the only things that bound a spray.
--   5. Every submission is REVIEWED by a human before it is an order, and a
--      visit may hold at most 3 pending submissions, one per 20 seconds. The
--      prize for guessing a code is a pending row a waiter rejects.
-- Residual risk, so it is a decision on record: a sustained, distributed
-- spray over three hours has roughly a 1-in-20 chance of hitting SOME live
-- table's digits on a full night. If abuse ever appears, the tightening is one
-- line — require the table number alongside the digits, which makes a guess
-- 1-in-a-million instead of (live tables)-in-a-million and makes per-table
-- lockout meaningful. Not done now: the owner specified "a 6-digit code".
--
-- ── WHAT IT ADDS ─────────────────────────────────────────────────────
--   1. visit columns on waiter_table_codes;
--   2. issue_table_code() REPLACED (same signature: starts a NEW visit);
--      waiter_rotate_table_code(), waiter_end_table_visit(),
--      waiter_table_visit() — the waiter's side;
--   3. redeem_table_code() REPLACED (same signature) — recoverable;
--   4. table_session_lookup(), table_session_submissions(),
--      create_cart_submission() — the customer's side, SERVICE ROLE ONLY;
--   5. waiter_pending_submissions(), waiter_review_submission() — what the POS
--      polls and taps;
--   6. waiter_staff_is_call_recipient(uuid) + waiter_call_recipient_staff_ids()
--      — 057's recipient rule, factored so the SERVER can ask "who is on shift"
--      for push; waiter_is_call_recipient() now delegates to it (identical
--      behaviour, re-proved by check-migrations-056-057.mjs);
--   7. staff_push_subscriptions.app ('portal' | 'oms') + the POS's own
--      register/unregister RPCs.
--
-- SECURITY POSTURE (048's, unchanged): every function revokes EXECUTE from
-- PUBLIC first (044), then grants back only what it needs; the customer-facing
-- ones go to NOBODY but service_role and are reached only through this app's
-- own routes behind checkRateLimit() and the owner's switch.
--
-- search_path on the functions that use pgcrypto is `public, extensions,
-- pg_temp` for 048's reason: where pgcrypto lives differs between databases.
-- ============================================================

-- ---- 1. A visit, on the code row -------------------------------------------

alter table public.waiter_table_codes
  add column if not exists activated_at  timestamptz,
  add column if not exists visit_ends_at timestamptz,
  add column if not exists rotated_at    timestamptz,
  add column if not exists ended_reason  text
    check (ended_reason is null or ended_reason in ('replaced', 'staff', 'table_closed', 'expired'));

comment on column public.waiter_table_codes.activated_at is
  'First time the digits were typed on a phone. Null = never used; the code then '
  'expires 10 minutes after issue. Once set, the VISIT runs until visit_ends_at.';
comment on column public.waiter_table_codes.visit_ends_at is
  'activated_at + 3 hours (TABLE_SESSION_TTL_SECONDS in otp.ts). Fixed at '
  'activation: retyping the digits (recovery) never moves it.';
comment on column public.waiter_table_codes.consumed_at is
  'Since 058: the visit is OVER (ended by staff, replaced by a newer visit, the '
  'table was closed, or it ran out). It no longer means "used once" — a live '
  'visit''s digits are redeemable many times. Still the column the live index is on.';
comment on column public.waiter_table_codes.attempts is
  'Since 058: how many times these digits were typed correctly (informational). '
  'It no longer burns the code — the device cap does the bounding. Brute force '
  'was never bounded by this counter (migration 049).';

-- The one definition of "is this visit still redeemable?". Used by every
-- function below so the rule cannot be spelled six slightly different ways.
create or replace function public._table_code_is_live(c public.waiter_table_codes)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select c.consumed_at is null
     and case when c.activated_at is null then c.expires_at > now()
              else c.visit_ends_at > now() end;
$$;
revoke execute on function public._table_code_is_live(public.waiter_table_codes) from public, anon, authenticated;

-- Six digits from the CSPRNG, unique among live visits (so redemption, which
-- sees only the digits, can never confuse two tables). 048's expression verbatim.
create or replace function public._mint_table_digits()
returns table(digits text, digest_hex text)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_code  text;
  v_hash  text;
  v_tries integer := 0;
begin
  loop
    v_tries := v_tries + 1;
    v_code := lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint & 2147483647) % 1000000)::text, 6, '0');
    v_hash := encode(digest(v_code, 'sha256'), 'hex');
    exit when not exists (
      select 1 from public.waiter_table_codes c
       where c.code_hash = v_hash and public._table_code_is_live(c)
    );
    if v_tries > 20 then
      raise exception 'could not mint a unique code' using errcode = 'P0003';
    end if;
  end loop;
  return query select v_code, v_hash;
end;
$$;
revoke execute on function public._mint_table_digits() from public, anon, authenticated;

-- Ends a table's live visit (if any), signs every device out of it, and EXPIRES the requests nobody reviewed.
-- Internal: the staff-facing wrappers below decide who may call it. Returns how many requests it expired.
--
-- WHY THE LAST STEP. A request that outlived its visit would stay "pending" on the staff's list for up to two
-- hours — and a table is re-seated in far less. A waiter opening it for the NEW party could then import the
-- PREVIOUS party's order onto the new party's bill, and nothing on screen would say it was stale. 048 already
-- defined the right state for exactly this ('expired': "nobody looked at it before the session died"), so a visit
-- ending — by staff, by a new party's code, by the POS closing the table, by running out — expires what was
-- left. The waiter sees the pending requests in the same sheet as the "end visit" button, and ending is a
-- deliberate two-tap action; closing a table needs everything served. (Rotating the digits for the SAME party
-- does not end the visit, so it expires nothing.)
create or replace function public._end_table_visit(p_table_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expired integer;
begin
  with ended as (
    update public.waiter_table_codes c
       set consumed_at = now(), ended_reason = p_reason
     where c.table_id = p_table_id and c.consumed_at is null
    returning c.id
  ),
  signed_out as (
    update public.customer_table_sessions s
       set revoked_at = now()
     where s.code_id in (select id from ended) and s.revoked_at is null
    returning s.id
  )
  update public.customer_cart_submissions x
     set status = 'expired'
   where x.status = 'pending'
     and x.session_id in (select s.id from public.customer_table_sessions s where s.code_id in (select id from ended));

  get diagnostics v_expired = row_count;
  return v_expired;
end;
$$;
revoke execute on function public._end_table_visit(uuid, text) from public, anon, authenticated;

-- ---- 2. The waiter's side ---------------------------------------------------

-- REPLACES 048's issue_table_code. Same signature and result, so a POS that
-- still calls the old shape keeps working. What changed: it now starts a NEW
-- VISIT — any live one for the table is ended and its devices signed out (the
-- old party must not be able to order to the new party's table) — and the
-- digits it mints stay good for as long as the visit does.
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
begin
  if not public.is_staff_client() then
    raise exception 'not staff' using errcode = '42501';
  end if;
  -- No shift, no ordering (048's reasoning: a code is the first step of
  -- opening an order, and 038 gates that).
  if not exists (select 1 from public.waiter_shift_sessions where status = 'active') then
    raise exception 'no active shift' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.waiter_tables t where t.id = p_table_id and t.active) then
    raise exception 'unknown table' using errcode = 'P0002';
  end if;

  select s.id into v_staff from public.staff s where s.auth_user_id = auth.uid();

  perform public._end_table_visit(p_table_id, 'replaced');

  select m.digits, m.digest_hex into v_digits, v_hash from public._mint_table_digits() m;
  v_expires := now() + make_interval(secs => 600);  -- TABLE_CODE_TTL_SECONDS: first use must be quick

  insert into public.waiter_table_codes (table_id, code_hash, issued_by, expires_at)
  values (p_table_id, v_hash, v_staff, v_expires);

  return query select v_digits, v_expires;
end;
$$;
revoke execute on function public.issue_table_code(uuid) from public, anon, authenticated;
grant  execute on function public.issue_table_code(uuid) to authenticated;
comment on function public.issue_table_code(uuid) is
  'Start a NEW ordering visit for a table and return its digits (once; only the '
  'hash is stored). Ends the table''s previous visit and signs its devices out. '
  'Staff-only, shift-gated. 058: recoverable — see the header of that migration.';

-- Same party, new digits: the old digits stop working, every connected device
-- stays connected. For "the customer forgot it / a stranger overheard it".
create or replace function public.waiter_rotate_table_code(p_table_id uuid)
returns table(code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row    public.waiter_table_codes;
  v_digits text;
  v_hash   text;
begin
  if not public.is_staff_client() then
    raise exception 'not staff' using errcode = '42501';
  end if;
  if not exists (select 1 from public.waiter_shift_sessions where status = 'active') then
    raise exception 'no active shift' using errcode = 'P0001';
  end if;

  select * into v_row
    from public.waiter_table_codes c
   where c.table_id = p_table_id and public._table_code_is_live(c)
   order by c.issued_at desc
   limit 1;
  if v_row.id is null then
    raise exception 'no visit' using errcode = 'P0004';
  end if;

  select m.digits, m.digest_hex into v_digits, v_hash from public._mint_table_digits() m;

  update public.waiter_table_codes c
     set code_hash  = v_hash,
         rotated_at = now(),
         attempts   = 0,
         -- A code nobody has typed yet gets a fresh ten minutes; an activated
         -- visit keeps its fixed end.
         expires_at = case when c.activated_at is null then now() + make_interval(secs => 600) else c.expires_at end
   where c.id = v_row.id;

  return query
    select v_digits,
           case when v_row.activated_at is null then now() + make_interval(secs => 600) else v_row.visit_ends_at end;
end;
$$;
revoke execute on function public.waiter_rotate_table_code(uuid) from public, anon, authenticated;
grant  execute on function public.waiter_rotate_table_code(uuid) to authenticated;

-- The party has left (or the table closed): end the visit, sign every device out.
-- No shift gate — tidying up after a shift must not be impossible.
create or replace function public.waiter_end_table_visit(p_table_id uuid, p_reason text default 'staff')
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_staff_client() then
    raise exception 'not staff' using errcode = '42501';
  end if;
  perform public._end_table_visit(p_table_id, case when p_reason in ('staff', 'table_closed') then p_reason else 'staff' end);
  return true;
end;
$$;
revoke execute on function public.waiter_end_table_visit(uuid, text) from public, anon, authenticated;
grant  execute on function public.waiter_end_table_visit(uuid, text) to authenticated;

-- What the "remote order" sheet on a table shows. Never returns the digits —
-- only their hash exists. Returns a row for any signed-in staff member.
create or replace function public.waiter_table_visit(p_table_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.waiter_table_codes;
begin
  if not public.is_staff_client() then
    return null;
  end if;

  select * into v_row
    from public.waiter_table_codes c
   where c.table_id = p_table_id and public._table_code_is_live(c)
   order by c.issued_at desc
   limit 1;

  return jsonb_build_object(
    'shift_open', exists (select 1 from public.waiter_shift_sessions where status = 'active'),
    'has_visit',  v_row.id is not null,
    'activated',  v_row.activated_at is not null,
    -- until when the digits can still be typed for the FIRST time, or the visit runs
    'ends_at',    case when v_row.id is null then null
                       when v_row.activated_at is null then v_row.expires_at
                       else v_row.visit_ends_at end,
    'devices',    case when v_row.id is null then 0 else (
                    select count(*) from public.customer_table_sessions s
                     where s.code_id = v_row.id and s.revoked_at is null and s.expires_at > now()) end,
    'pending',    (select count(*) from public.customer_cart_submissions x
                    where x.table_id = p_table_id and x.status = 'pending'
                      and x.created_at > now() - interval '2 hours')
  );
end;
$$;
revoke execute on function public.waiter_table_visit(uuid) from public, anon, authenticated;
grant  execute on function public.waiter_table_visit(uuid) to authenticated;

-- ---- 3. The customer's side: redeem (REPLACED — recoverable) ----------------
--
-- STILL RETURNS A STATUS AND NEVER RAISES — 048's reasoning stands: a raise
-- rolls back the work the function did, and failures must come back as data.
--
-- NEW: a live code can be redeemed MANY times (recovery / a second phone).
-- Each success mints a new session token for the SAME visit; the session ends
-- when the visit does. Reasons are deliberately coarse so a prober learns
-- nothing from the difference between "no such code" and "ended".
create or replace function public.redeem_table_code(p_code text)
returns table(
  ok            boolean,
  reason        text,
  session_token text,
  table_id      uuid,
  table_number  integer,
  expires_at    timestamptz
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row     public.waiter_table_codes;
  v_token   text;
  v_ends    timestamptz;
  v_number  integer;
  v_devices integer;
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' then
    return query select false, 'bad_code', null::text, null::uuid, null::integer, null::timestamptz;
    return;
  end if;

  select * into v_row
    from public.waiter_table_codes c
   where c.code_hash = encode(digest(p_code, 'sha256'), 'hex')
     and c.consumed_at is null
   limit 1;

  if v_row.id is null then
    return query select false, 'bad_code', null::text, null::uuid, null::integer, null::timestamptz;
    return;
  end if;

  -- A visit that ran out is closed here, on the first look at it.
  if not public._table_code_is_live(v_row) then
    update public.waiter_table_codes c
       set consumed_at = now(), ended_reason = 'expired'
     where c.id = v_row.id and c.consumed_at is null;
    update public.customer_table_sessions s set revoked_at = now()
     where s.code_id = v_row.id and s.revoked_at is null;
    return query select false, 'expired', null::text, null::uuid, null::integer, null::timestamptz;
    return;
  end if;

  -- DEVICE CAP (TABLE_VISIT_MAX_DEVICES in otp.ts). Does not burn the code.
  select count(*) into v_devices
    from public.customer_table_sessions s
   where s.code_id = v_row.id and s.revoked_at is null and s.expires_at > now();
  if v_devices >= 6 then
    return query select false, 'too_many_devices', null::text, null::uuid, null::integer, null::timestamptz;
    return;
  end if;

  -- ACTIVATE on first use. The write itself decides the race: only one of two
  -- simultaneous first redemptions sets activated_at; both then read the same
  -- visit_ends_at.
  update public.waiter_table_codes c
     set activated_at  = now(),
         visit_ends_at = now() + make_interval(secs => 10800)   -- TABLE_SESSION_TTL_SECONDS
   where c.id = v_row.id and c.activated_at is null;

  update public.waiter_table_codes c
     set attempts = c.attempts + 1
   where c.id = v_row.id;

  select c.visit_ends_at into v_ends from public.waiter_table_codes c where c.id = v_row.id;
  select t.number into v_number from public.waiter_tables t where t.id = v_row.table_id;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.customer_table_sessions (table_id, token_hash, code_id, expires_at)
  values (v_row.table_id, encode(digest(v_token, 'sha256'), 'hex'), v_row.id, v_ends);

  return query select true, null::text, v_token, v_row.table_id, v_number, v_ends;
end;
$$;
revoke execute on function public.redeem_table_code(text) from public, anon, authenticated;
comment on function public.redeem_table_code(text) is
  'Exchange six digits for a table session. SERVICE ROLE ONLY - call it from the '
  'app''s own route, behind checkRateLimit() and the global failure counter. '
  'Returns ok/reason rather than raising. 058: RECOVERABLE - a live visit''s '
  'digits can be typed again (a new device, a cleared cookie); every session '
  'ends when the visit does, and at most 6 devices may be live per visit.';

-- ---- 4. The customer's side: who am I, what did I send, send -----------------

-- Resolves a cookie token. `ok` only when the session is not revoked, has not
-- ended and its VISIT is still live. SERVICE ROLE ONLY.
create or replace function public.table_session_lookup(p_token text)
returns table(
  ok           boolean,
  reason       text,
  session_id   uuid,
  code_id      uuid,
  table_id     uuid,
  table_number integer,
  expires_at   timestamptz,
  shift_open   boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_s public.customer_table_sessions;
  v_c public.waiter_table_codes;
  v_n integer;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return query select false, 'no_session', null::uuid, null::uuid, null::uuid, null::integer, null::timestamptz, null::boolean;
    return;
  end if;

  select * into v_s from public.customer_table_sessions s
   where s.token_hash = encode(digest(p_token, 'sha256'), 'hex');
  if v_s.id is null or v_s.revoked_at is not null then
    return query select false, 'no_session', null::uuid, null::uuid, null::uuid, null::integer, null::timestamptz, null::boolean;
    return;
  end if;
  if v_s.expires_at <= now() then
    return query select false, 'expired', null::uuid, null::uuid, null::uuid, null::integer, null::timestamptz, null::boolean;
    return;
  end if;

  select * into v_c from public.waiter_table_codes c where c.id = v_s.code_id;
  if v_c.id is null or not public._table_code_is_live(v_c) then
    return query select false, 'ended', null::uuid, null::uuid, null::uuid, null::integer, null::timestamptz, null::boolean;
    return;
  end if;

  select t.number into v_n from public.waiter_tables t where t.id = v_s.table_id;
  return query select true, null::text, v_s.id, v_s.code_id, v_s.table_id, v_n, v_s.expires_at,
    exists (select 1 from public.waiter_shift_sessions where status = 'active');
end;
$$;
revoke execute on function public.table_session_lookup(text) from public, anon, authenticated;

-- What this VISIT has already sent (any of its devices), newest first, with no
-- payload — the customer knows what they sent; this says what became of it.
create or replace function public.table_session_submissions(p_token text)
returns table(id uuid, status text, item_count integer, total_agorot integer, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_code uuid;
begin
  select s.code_id into v_code
    from public.customer_table_sessions s
   where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and s.revoked_at is null and s.expires_at > now();
  if v_code is null then
    return;
  end if;

  return query
    select x.id, x.status, x.item_count, x.total_agorot, x.created_at
      from public.customer_cart_submissions x
      join public.customer_table_sessions s on s.id = x.session_id
     where s.code_id = v_code
     order by x.created_at desc
     limit 20;
end;
$$;
revoke execute on function public.table_session_submissions(text) from public, anon, authenticated;

-- The customer sends their cart. NOT AN ORDER: a pending REQUEST a human reviews.
-- The route validated the payload (validateSubmission) and passes the counts it
-- RECOMPUTED; the database still refuses what is out of range, because a route
-- is not the last line of defence for a table.
create or replace function public.create_cart_submission(
  p_token      text,
  p_payload    jsonb,
  p_item_count integer,
  p_total      integer
)
returns table(ok boolean, reason text, submission_id uuid, table_number integer)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_s       record;
  v_pending integer;
  v_last    timestamptz;
  v_id      uuid;
begin
  select * into v_s from public.table_session_lookup(p_token) l;
  if not coalesce(v_s.ok, false) then
    return query select false, coalesce(v_s.reason, 'no_session'), null::uuid, null::integer;
    return;
  end if;

  if not coalesce(v_s.shift_open, false) then
    return query select false, 'no_shift', null::uuid, v_s.table_number;
    return;
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or p_item_count is null or p_item_count < 1 or p_item_count > 60       -- MAX_LINES
     or p_total is null or p_total < 0 or p_total > 100000000
     or octet_length(p_payload::text) > 65536 then
    return query select false, 'bad_request', null::uuid, v_s.table_number;
    return;
  end if;

  -- Per VISIT, across all its devices. A cap, not a queue: three unreviewed
  -- requests means staff have not looked at the last ones yet.
  select count(*), max(x.created_at) into v_pending, v_last
    from public.customer_cart_submissions x
    join public.customer_table_sessions s on s.id = x.session_id
   where s.code_id = v_s.code_id and x.status = 'pending';
  if v_pending >= 3 then                                                     -- VISIT_MAX_PENDING
    return query select false, 'too_many_pending', null::uuid, v_s.table_number;
    return;
  end if;

  select max(x.created_at) into v_last
    from public.customer_cart_submissions x
    join public.customer_table_sessions s on s.id = x.session_id
   where s.code_id = v_s.code_id;
  if v_last is not null and v_last > now() - interval '20 seconds' then      -- SUBMISSION_MIN_GAP_SECONDS
    return query select false, 'too_fast', null::uuid, v_s.table_number;
    return;
  end if;

  insert into public.customer_cart_submissions (session_id, table_id, table_number, payload, item_count, total_agorot)
  values (v_s.session_id, v_s.table_id, v_s.table_number, p_payload, p_item_count, p_total)
  returning id into v_id;

  return query select true, null::text, v_id, v_s.table_number;
end;
$$;
revoke execute on function public.create_cart_submission(text, jsonb, integer, integer) from public, anon, authenticated;
comment on function public.create_cart_submission(text, jsonb, integer, integer) is
  'A customer sends their cart. SERVICE ROLE ONLY - from POST /api/table/order, '
  'behind the owner/dev switch and the rate limits. Creates a PENDING request, '
  'never an order. Needs a live session and an open shift; at most 3 pending per '
  'visit, one per 20 seconds.';

-- ---- 5. What the POS polls and taps -----------------------------------------
-- The SAME people who are told about a waiter call are told about an order
-- (057's rule). Returns nothing — not an error — to anyone else.

create or replace function public.waiter_pending_submissions()
returns table(
  id uuid, table_id uuid, table_number integer, created_at timestamptz,
  item_count integer, total_agorot integer, payload jsonb
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
    select x.id, x.table_id, x.table_number, x.created_at, x.item_count, x.total_agorot, x.payload
      from public.customer_cart_submissions x
     where x.status = 'pending'
       and x.created_at > now() - interval '2 hours'                         -- SUBMISSION_OPEN_WINDOW_MINUTES
     order by x.created_at;
end;
$$;
revoke execute on function public.waiter_pending_submissions() from public, anon, authenticated;
grant  execute on function public.waiter_pending_submissions() to authenticated;

-- First tap wins (057's waiter_ack_call): the update only matches a pending
-- row, so two waiters cannot both import the same order — the loser is told
-- 'taken'. `imported` records the order the lines went onto.
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
  v_n     integer;
begin
  if p_outcome is null or p_outcome not in ('imported', 'rejected') then
    return 'bad_outcome';
  end if;
  if not public.waiter_is_call_recipient() then
    return 'forbidden';
  end if;

  select s.id into v_staff from public.staff s where s.auth_user_id = auth.uid();

  update public.customer_cart_submissions x
     set status = p_outcome, reviewed_by = v_staff, reviewed_at = now(),
         order_id = case when p_outcome = 'imported' then p_order_id else null end
   where x.id = p_id and x.status = 'pending';
  get diagnostics v_n = row_count;

  if v_n = 1 then
    return 'ok';
  end if;
  if exists (select 1 from public.customer_cart_submissions where id = p_id) then
    return 'taken';
  end if;
  return 'missing';
end;
$$;
revoke execute on function public.waiter_review_submission(uuid, text, uuid) from public, anon, authenticated;
grant  execute on function public.waiter_review_submission(uuid, text, uuid) to authenticated;

-- ---- 6. 057's recipient rule, factored so the SERVER can use it -------------
-- Push has to answer "who is on shift RIGHT NOW" without a signed-in caller, so
-- the body of waiter_is_call_recipient() moves into a function that takes the
-- person as an argument. waiter_is_call_recipient() keeps its name, grants and
-- behaviour and now just resolves auth.uid() and delegates — ONE rule, not two.
-- Behaviour is re-proved by scripts/check-migrations-056-057.mjs (92 checks).
--
-- ⚠️ The TS twins are unchanged: onShiftForCalls() / isCallRecipientTitle().

create or replace function public.waiter_staff_is_call_recipient(p_staff_id uuid)
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
  select * into v_staff from public.staff s where s.id = p_staff_id and s.active;
  if not found then
    return false;
  end if;

  -- a) no open shift, no notifications
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
revoke execute on function public.waiter_staff_is_call_recipient(uuid) from public, anon, authenticated;

create or replace function public.waiter_is_call_recipient()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  -- A removed person has auth_user_id cleared (041) and so finds no row here.
  select s.id into v_id from public.staff s where s.auth_user_id = auth.uid() and s.active;
  if v_id is null then
    return false;
  end if;
  return public.waiter_staff_is_call_recipient(v_id);
end;
$$;
revoke execute on function public.waiter_is_call_recipient() from public, anon, authenticated;
grant  execute on function public.waiter_is_call_recipient() to authenticated;

-- Everyone who is a recipient right now. SERVICE ROLE ONLY — it is the list the
-- push sender (lib/push/orders.ts) works from, and nothing else should see it.
create or replace function public.waiter_call_recipient_staff_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id
    from public.staff s
   where s.active and s.auth_user_id is not null
     and public.waiter_staff_is_call_recipient(s.id);
$$;
revoke execute on function public.waiter_call_recipient_staff_ids() from public, anon, authenticated;

-- ---- 7. Push: which APP a subscription belongs to ---------------------------
-- A person can be subscribed in two places: the portal (the "main saved site")
-- and the POS (staff.ayeka.bar, the OMS). The sender picks ONE per person — the
-- OMS if they have a fresh subscription there, else the portal (lib/push/
-- orders-rules.ts holds that rule; it is TypeScript-only, so there is no SQL
-- twin to drift). This column is all the database needs to know.

alter table public.staff_push_subscriptions
  add column if not exists app text not null default 'portal'
    check (app in ('portal', 'oms'));
create index if not exists staff_push_subscriptions_staff_app_idx
  on public.staff_push_subscriptions (staff_id, app);

comment on column public.staff_push_subscriptions.app is
  '"portal" = the Next.js site''s service worker (ayeka.bar); "oms" = the POS '
  '(staff.ayeka.bar). last_seen_at is refreshed each time the POS opens, which '
  'is what "logged in on the POS" means to the sender.';

-- The POS cannot use /api/staff/push (a different origin, so it has no session
-- cookie there) and cannot touch the table (RLS on, grants revoked). It goes
-- through these two, as the signed-in person, exactly like every waiter_ RPC.
create or replace function public.waiter_register_push(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff uuid;
begin
  select s.id into v_staff from public.staff s where s.auth_user_id = auth.uid() and s.active;
  if v_staff is null then
    return false;
  end if;
  -- The portal route's own validation, repeated: https only, bounded, and the
  -- keys must look like keys. An endpoint is a capability URL.
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000
     or p_p256dh is null or length(p_p256dh) not between 10 and 300
     or p_auth   is null or length(p_auth)   not between 8  and 100 then
    return false;
  end if;

  -- endpoint is unique: if another employee used this phone, the row MOVES to
  -- the person signed in now (same as the portal's upsert).
  insert into public.staff_push_subscriptions (staff_id, endpoint, p256dh, auth, user_agent, app, last_seen_at)
  values (v_staff, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200), 'oms', now())
  on conflict (endpoint) do update
    set staff_id = excluded.staff_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, app = 'oms', last_seen_at = now();
  return true;
end;
$$;
revoke execute on function public.waiter_register_push(text, text, text, text) from public, anon, authenticated;
grant  execute on function public.waiter_register_push(text, text, text, text) to authenticated;

create or replace function public.waiter_unregister_push(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff uuid;
begin
  select s.id into v_staff from public.staff s where s.auth_user_id = auth.uid();
  if v_staff is null then
    return false;
  end if;
  delete from public.staff_push_subscriptions
   where endpoint = p_endpoint and staff_id = v_staff and app = 'oms';
  return true;
end;
$$;
revoke execute on function public.waiter_unregister_push(text) from public, anon, authenticated;
grant  execute on function public.waiter_unregister_push(text) to authenticated;

-- ---- 8. Housekeeping --------------------------------------------------------
-- 048's cleanup deletes codes a day after `expires_at` — the FIRST-USE deadline,
-- ten minutes after issue — which for an activated visit is long before it ends.
-- The rule is now "a day after the visit is over", whichever way it ended.
create or replace function public.cleanup_table_codes()
returns void
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  delete from public.waiter_table_codes c
   where greatest(c.expires_at, coalesce(c.visit_ends_at, c.expires_at), coalesce(c.consumed_at, c.expires_at))
         < now() - interval '1 day';

  delete from public.customer_table_sessions
   where expires_at < now() - interval '7 days';

  delete from public.waiter_table_calls
   where called_at < now() - interval '30 days';
$$;
revoke execute on function public.cleanup_table_codes() from public, anon, authenticated;
