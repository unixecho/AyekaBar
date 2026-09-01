-- ============================================================
-- Ayeka Bar — groundwork for a customer ordering FROM THEIR TABLE.
--
-- ⚠️⚠️  DRAFTED, NOT APPLIED. NOTHING IN THIS APP CALLS ANY OF IT.  ⚠️⚠️
--
-- Same status as 035/036 (the payment ledger): written so the design is
-- concrete and reviewable, held until the feature it serves is actually
-- greenlit and the endpoints exist. Per CLAUDE.md, a migration is applied only
-- on explicit, per-migration approval — this one is not that.
--
-- WHAT IT IS FOR. PLAN_MENU_CART.md ships Phase 1 today: a customer builds an
-- order on their own phone, splits it between named diners, and reads it out
-- to the waiter. Two buttons ship visibly disabled — "שליחה למלצר" and
-- "קריאה למלצר". This file is the data model those two would need, plus the
-- authentication the owner specified for them (2026-09-01):
--
--   The waiter generates a 6-digit code in their own app, standing at the
--   table, and reads it out. The customer types it into the website. THAT is
--   the authentication.
--
-- The full argument for why a staff-issued, table-scoped, short-lived code
-- beats a per-table QR, a typed table number, an SMS OTP or a Google login
-- lives in `src/lib/cart/otp.ts` — including the Twilio-vs-Gmail branch the
-- owner asked about, and why neither is needed for this flow. That file also
-- holds the constants (length, TTL, attempt cap) this SQL must agree with.
-- ⚠️ THEY ARE ONE RULE SPELLED TWICE: change one, change the other. Precedent
-- and cautionary tale: `lib/staff/access.ts` ↔ `is_op()` (migration 016),
-- which exists because exactly that pair once drifted.
--
-- APPLY ORDER: after 047. Depends on 019 (waiter_tables, waiter_orders),
-- 020 (is_staff_client), 034 (waiter_shift_sessions), 041 (staff.active),
-- 045 (check_rate_limit) and pgcrypto (enabled by 000/001).
--
-- SECURITY POSTURE, STATED ONCE AND APPLIED THROUGHOUT
--   • Every table here: RLS ON, and NO policies at all. Nothing reaches these
--     rows through PostgREST, from any role, ever. The only doors are the
--     SECURITY DEFINER functions below.
--   • Every function: `revoke execute ... from public, anon, authenticated`
--     FIRST, then grant back only what genuinely needs it. Migration 044's
--     lesson is not optional here — Postgres grants EXECUTE to the PUBLIC
--     pseudo-role at CREATE FUNCTION time, every real role inherits PUBLIC,
--     and revoking anon/authenticated alone is cosmetic.
--   • The customer-facing entry point (`redeem_table_code`) is granted to
--     NOBODY but service_role. It is reached only through this app's own
--     server route, which applies `checkRateLimit()` first. Exposing it to
--     `anon` would hand the whole internet an unmetered oracle against a
--     6-digit number, and the anon key is printed in every page of the site.
-- ============================================================

-- ---- 1. The code the waiter reads out --------------------------------------

create table if not exists public.waiter_table_codes (
  id           uuid primary key default gen_random_uuid(),
  table_id     uuid not null references public.waiter_tables(id) on delete cascade,
  -- SHA-256 of the six digits, hex. NOT the code itself.
  --
  -- WHY UNSALTED, WHICH IS NORMALLY WRONG. A salt would mean redemption can't
  -- look the row up — the customer types a code and nothing else, so with a
  -- per-row salt the only way to find the match is to scan every live code and
  -- run the KDF against each, which also destroys per-code attempt counting
  -- (you cannot increment the counter of a row you failed to identify). The
  -- attempt counter is the actual defence here, so it wins.
  --   The thing a salt protects against is an offline dictionary attack on a
  -- leaked table. Six digits is 10^6 — trivially reversible either way at
  -- SHA-256 speeds — but the value is single-use, expires in ten minutes, is
  -- scoped to one table, and lives in a table with RLS on and no policies,
  -- reachable only by service_role. Anyone holding a copy of this table
  -- already holds the whole database.
  --   If that ever stops being acceptable: add a pepper from Supabase Vault
  -- (`vault.decrypted_secrets`) into the digest. That keeps the O(1) lookup —
  -- the pepper is the same for every row — while making a leaked table alone
  -- useless. Deliberately not done now: an unapplied migration should not
  -- also introduce a secret-management dependency.
  code_hash    text not null,
  issued_by    uuid references public.staff(id) on delete set null,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  -- Wrong guesses against THIS code. See TABLE_CODE_MAX_ATTEMPTS in otp.ts.
  attempts     integer not null default 0 check (attempts >= 0),
  -- Single use. Set the moment it is exchanged for a session.
  consumed_at  timestamptz
);

-- The redemption lookup, and the issuance collision check, are both this
-- exact predicate. Partial on the live rows only: consumed and expired codes
-- pile up until the cleanup function runs and must never slow this down.
create index if not exists waiter_table_codes_live_idx
  on public.waiter_table_codes (code_hash)
  where consumed_at is null;

create index if not exists waiter_table_codes_table_idx
  on public.waiter_table_codes (table_id, issued_at desc);

comment on table public.waiter_table_codes is
  'Six-digit codes a waiter reads out at a table so the phone in front of them '
  'can prove where it is sitting. Single use, ten-minute life, hashed. '
  'Service-role only — RLS on, no policies. See src/lib/cart/otp.ts.';

-- ---- 2. The session a redeemed code buys -----------------------------------

create table if not exists public.customer_table_sessions (
  id           uuid primary key default gen_random_uuid(),
  table_id     uuid not null references public.waiter_tables(id) on delete cascade,
  -- SHA-256 of a 32-byte random token. The token itself goes to the browser in
  -- an httpOnly, Secure, SameSite=Lax cookie and is never readable by page
  -- script — so an XSS on the menu cannot steal the right to order to a table.
  -- 32 bytes of gen_random_bytes IS unguessable, so no salt question arises:
  -- there is nothing to dictionary-attack.
  token_hash   text not null unique,
  code_id      uuid references public.waiter_table_codes(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  -- LOYALTY HOOK. Null for the anonymous case, which is the normal one — the
  -- whole point of the code flow is that ordering needs no account. Set only
  -- if the customer happens to also be signed in to the club, so that points
  -- can be attributed when the order is IMPORTED and eventually PAID.
  -- ⚠️ Points are never minted here or at submission. A submission is a
  -- request, not a sale. `award_points()` (migration 008) stays the only thing
  -- that mints them, in one transaction, as it does today.
  customer_id  uuid references public.customers(id) on delete set null
);

create index if not exists customer_table_sessions_live_idx
  on public.customer_table_sessions (expires_at)
  where revoked_at is null;

comment on table public.customer_table_sessions is
  'A phone that has proved which table it is at. Three hours, revocable. '
  'The token lives in an httpOnly cookie; only its hash is here.';

-- ---- 3. The submitted cart -------------------------------------------------

create table if not exists public.customer_cart_submissions (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.customer_table_sessions(id) on delete cascade,
  -- Snapshotted alongside the session so a review screen still resolves the
  -- table after the session expires and is cleaned up.
  table_id      uuid references public.waiter_tables(id) on delete set null,
  table_number  integer,

  -- The validated CartSubmission (src/lib/cart/submission.ts). Stored whole
  -- rather than shredded into rows: this is a REQUEST, not an order, and
  -- normalising it would make it look like one. It becomes real rows only when
  -- a human imports it.
  payload       jsonb not null,

  -- Denormalised for the review list, so it renders without opening the blob.
  item_count    integer not null default 0 check (item_count >= 0),
  -- The customer's own arithmetic, kept for comparison. NOT a price to charge:
  -- the importer re-prices every line from the live menu by item_uid.
  total_agorot  integer not null default 0 check (total_agorot >= 0),

  -- pending  → waiting for a waiter to look at it
  -- imported → turned into a real waiter_order (order_id points at it)
  -- rejected → a waiter looked and said no (a duplicate, a joke, a mistake)
  -- expired  → nobody looked at it before the session died
  status        text not null default 'pending'
                check (status in ('pending','imported','rejected','expired')),
  reviewed_by   uuid references public.staff(id) on delete set null,
  reviewed_at   timestamptz,
  order_id      uuid references public.waiter_orders(id) on delete set null,
  customer_id   uuid references public.customers(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists customer_cart_submissions_pending_idx
  on public.customer_cart_submissions (created_at desc)
  where status = 'pending';

create index if not exists customer_cart_submissions_table_idx
  on public.customer_cart_submissions (table_id, created_at desc);

comment on table public.customer_cart_submissions is
  'A cart a customer sent from their phone. NOT AN ORDER. A staff member '
  'reviews it and consciously imports it — see the long note in '
  'src/lib/cart/submission.ts for why a customer tap must never mint a '
  'billable line by itself.';

-- ---- 4. "Come to my table" -------------------------------------------------

create table if not exists public.waiter_table_calls (
  id               uuid primary key default gen_random_uuid(),
  table_id         uuid not null references public.waiter_tables(id) on delete cascade,
  table_number     integer,
  session_id       uuid references public.customer_table_sessions(id) on delete set null,
  -- Deliberately a small vocabulary rather than free text. A waiter glancing
  -- at a wrist needs to know WHICH of three things is being asked for without
  -- reading a sentence, and free text from a customer's phone is also a
  -- content-moderation surface nobody asked for.
  kind             text not null default 'waiter'
                   check (kind in ('waiter','bill','assistance')),
  called_at        timestamptz not null default now(),
  acknowledged_by  uuid references public.staff(id) on delete set null,
  acknowledged_at  timestamptz
);

create index if not exists waiter_table_calls_open_idx
  on public.waiter_table_calls (called_at desc)
  where acknowledged_at is null;

comment on table public.waiter_table_calls is
  'One row per "a customer at table N wants attention". Shaped so the SAME '
  'row serves a phone notification and the smartwatch the owner has floated '
  'buying for staff — venue-scoped, table-scoped, acknowledged by a person, '
  'nothing display-specific in it. That is the only part of the smartwatch '
  'idea this schema needs to not foreclose; the hardware and companion app '
  'are their own project (PLAN_MENU_CART.md §7).';

-- ---- 5. RLS: on, with no policies, on all four -----------------------------
-- Fails closed by construction. Not an oversight — the same deliberate shape
-- as fraud_log, menu_audit, point_adjustments and rate_limits, and the same
-- reason: every legitimate caller comes through a function below or through
-- the service role, never through PostgREST.

alter table public.waiter_table_codes         enable row level security;
alter table public.customer_table_sessions    enable row level security;
alter table public.customer_cart_submissions  enable row level security;
alter table public.waiter_table_calls         enable row level security;

-- ---- 6. Issuing a code (the waiter's side) ---------------------------------
--
-- NOTE ON search_path ON ALL THREE FUNCTIONS BELOW: `public, extensions,
-- pg_temp`, not just `public`. `digest()` and `gen_random_bytes()` come from
-- pgcrypto, and where pgcrypto actually lives differs between databases —
-- Supabase pre-installs it into `extensions`, while migrations 000/001's
-- unqualified `create extension if not exists pgcrypto` would have put it in
-- `public` on a database that did not already have it (a local stack, a
-- branch). Naming both schemas makes these functions work either way. It does
-- not weaken the pinning: the point of a fixed search_path is to exclude
-- schemas an attacker could write to, and `extensions` is not one.

create or replace function public.issue_table_code(p_table_id uuid)
returns table(code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_code    text;
  v_hash    text;
  v_staff   uuid;
  v_expires timestamptz;
  v_tries   integer := 0;
begin
  -- Signed-in staff only. `is_staff_client()` resolves the caller as
  -- `staff WHERE auth_user_id = auth.uid()`, which is also what makes a
  -- soft-deleted person (migration 041 clears auth_user_id) fail here with no
  -- extra check.
  if not public.is_staff_client() then
    raise exception 'not staff' using errcode = '42501';
  end if;

  -- No shift, no ordering. The same gate 038 puts on opening an order and
  -- adding an item — a code is the first step of exactly that, so letting one
  -- be minted outside a shift would route around the gate rather than respect
  -- it.
  if not exists (select 1 from public.waiter_shift_sessions where status = 'active') then
    raise exception 'no active shift' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.waiter_tables t where t.id = p_table_id and t.active) then
    raise exception 'unknown table' using errcode = 'P0002';
  end if;

  select s.id into v_staff from public.staff s where s.auth_user_id = auth.uid();

  -- One live code per table. Issuing a second one invalidates the first:
  -- otherwise a code read out to a party that has since left stays valid for
  -- the party that replaced them.
  update public.waiter_table_codes
     set consumed_at = now()
   where table_id = p_table_id and consumed_at is null;

  v_expires := now() + make_interval(secs => 600);  -- TABLE_CODE_TTL_SECONDS

  loop
    v_tries := v_tries + 1;
    -- Six digits from the CSPRNG, not from random(). `('x' || …)::bit(32)` is
    -- the standard way to get an integer out of gen_random_bytes; the modulo
    -- bias across 2^31 → 10^6 is under one part in 2000 and is irrelevant for
    -- a value protected by an attempt counter rather than by entropy alone.
    v_code := lpad(((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint & 2147483647) % 1000000)::text, 6, '0');
    v_hash := encode(digest(v_code, 'sha256'), 'hex');

    -- Two tables must never hold the same live code, or redemption — which
    -- only sees the digits — could not tell them apart.
    exit when not exists (
      select 1 from public.waiter_table_codes c
       where c.code_hash = v_hash and c.consumed_at is null and c.expires_at > now()
    );
    if v_tries > 20 then
      raise exception 'could not mint a unique code' using errcode = 'P0003';
    end if;
  end loop;

  insert into public.waiter_table_codes (table_id, code_hash, issued_by, expires_at)
  values (p_table_id, v_hash, v_staff, v_expires);

  -- The ONLY moment the plaintext exists outside the waiter's screen.
  return query select v_code, v_expires;
end;
$$;

-- 044's lesson: revoke from PUBLIC explicitly, or the anon/authenticated
-- revoke is cosmetic. Then grant back only `authenticated` — ayeka-staff calls
-- this as a signed-in waiter, and the body re-checks that.
revoke execute on function public.issue_table_code(uuid) from public, anon, authenticated;
grant  execute on function public.issue_table_code(uuid) to authenticated;

comment on function public.issue_table_code(uuid) is
  'Mint the six digits a waiter reads out at a table. Staff-only, '
  'shift-gated, invalidates that table''s previous code. Returns the '
  'plaintext exactly once; only its hash is stored.';

-- ---- 7. Redeeming a code (the customer's side) -----------------------------
--
-- ⚠️ THIS FUNCTION RETURNS A STATUS AND DOES NOT RAISE. That is not a style
-- preference, it is the only shape that works.
--
-- A PL/pgSQL function is one transaction. `raise exception` rolls back
-- EVERYTHING the function did, including the attempt counter it just
-- incremented — so a version of this that raised on a wrong guess would count
-- nothing, and the five-attempt cap would be decoration. The counter is the
-- primary defence against online guessing at a six-digit number, so the
-- function has to commit, which means failures come back as data.
--
-- The caller maps `reason` to an HTTP response. Note that the reasons are
-- deliberately coarse — `bad_code` covers both "no such code" and "a code that
-- lost the single-use race" — so a prober cannot use the difference between
-- them to learn which six-digit numbers are live.

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
  v_row      public.waiter_table_codes;
  v_token    text;
  v_expires  timestamptz;
  v_number   integer;
  v_consumed integer;
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' then
    return query select false, 'bad_code', null::text, null::uuid, null::integer, null::timestamptz;
    return;
  end if;

  -- One indexed lookup — see the note on code_hash for why this is not salted.
  select * into v_row
    from public.waiter_table_codes c
   where c.code_hash = encode(digest(p_code, 'sha256'), 'hex')
     and c.consumed_at is null
   limit 1;

  if v_row.id is null then
    return query select false, 'bad_code', null::text, null::uuid, null::integer, null::timestamptz;
    return;
  end if;

  -- Counted before anything is decided, and it STICKS, because this function
  -- returns rather than raises.
  update public.waiter_table_codes
     set attempts = attempts + 1
   where id = v_row.id;

  if v_row.expires_at <= now() then
    update public.waiter_table_codes set consumed_at = now() where id = v_row.id;
    return query select false, 'expired', null::text, null::uuid, null::integer, null::timestamptz;
    return;
  end if;

  -- TABLE_CODE_MAX_ATTEMPTS. Burn the code rather than merely refusing this
  -- attempt: a code that has been guessed at five times is a code somebody is
  -- working on, and the waiter can mint another in one tap.
  if v_row.attempts + 1 > 5 then
    update public.waiter_table_codes set consumed_at = now() where id = v_row.id;
    return query select false, 'burned', null::text, null::uuid, null::integer, null::timestamptz;
    return;
  end if;

  -- SINGLE USE, ENFORCED BY THE WRITE ITSELF, not by the read above. Two
  -- requests carrying the same correct code can both pass that SELECT; only
  -- one can win this UPDATE, and the loser gets no session. Re-checking
  -- `consumed_at is null` here is what makes that true — without it a
  -- double-tap mints two sessions for one code.
  update public.waiter_table_codes
     set consumed_at = now()
   where id = v_row.id and consumed_at is null;
  get diagnostics v_consumed = row_count;
  if v_consumed = 0 then
    return query select false, 'bad_code', null::text, null::uuid, null::integer, null::timestamptz;
    return;
  end if;

  select t.number into v_number from public.waiter_tables t where t.id = v_row.table_id;

  v_token   := encode(gen_random_bytes(32), 'hex');
  v_expires := now() + make_interval(secs => 10800);  -- TABLE_SESSION_TTL_SECONDS

  insert into public.customer_table_sessions (table_id, token_hash, code_id, expires_at)
  values (v_row.table_id, encode(digest(v_token, 'sha256'), 'hex'), v_row.id, v_expires);

  return query select true, null::text, v_token, v_row.table_id, v_number, v_expires;
end;
$$;

-- NOBODY gets this but service_role (which bypasses grants). It is reached
-- only through this app's own server route, after checkRateLimit(). Handing
-- it to `anon` would publish an unmetered oracle against a six-digit number
-- to anyone holding the anon key — which is every visitor.
revoke execute on function public.redeem_table_code(text) from public, anon, authenticated;

comment on function public.redeem_table_code(text) is
  'Exchange six digits for a table session. SERVICE ROLE ONLY — call it from '
  'the app''s own route, behind checkRateLimit(), never from the browser. '
  'Returns ok/reason rather than raising, because raising would roll back the '
  'attempt counter that is the whole defence. Single use, attempt-capped.';

-- ---- 8. Cleanup ------------------------------------------------------------
-- Manual/occasional, exactly like cleanup_rate_limits() (045) — this project
-- runs no cron. Safe to call repeatedly, safe never to call: everything it
-- deletes is already refused by the predicates above.

create or replace function public.cleanup_table_codes()
returns void
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  delete from public.waiter_table_codes
   where expires_at < now() - interval '1 day';

  -- Sessions are deleted, not merely expired: they are the link between a
  -- phone and a table on a given night, and there is no reason to keep that
  -- association once it can no longer be used. Submissions cascade with them
  -- — a submission whose session is gone is a night that is over. Data
  -- minimisation, the same instinct behind migration 047's log retention.
  delete from public.customer_table_sessions
   where expires_at < now() - interval '7 days';

  delete from public.waiter_table_calls
   where called_at < now() - interval '30 days';
$$;

revoke execute on function public.cleanup_table_codes() from public, anon, authenticated;

-- ---- 9. Audit vocabulary ---------------------------------------------------
-- Widen menu_audit's action CHECK.
--
-- 'menu_cart.update' is this change's own new action — the owner switching the
-- customer-facing cart on or off from the editor.
--
-- ⚠️ 'variant.default' is a PRE-EXISTING BUG being fixed in passing. It has
-- been in `AuditAction` (src/lib/owner/audit.ts) and in AuditLog.tsx's label
-- map since menu versions shipped, but was never added to migration 014's
-- CHECK — so every "set as the main menu" action has been silently dropped by
-- the constraint. `logAudit()` swallows write failures by design ("a missing
-- log line is better than a publish that appears to have failed"), which is
-- why nobody noticed. Same list, stated in full, so this file is a complete
-- statement of the intended end state rather than a diff.
alter table public.menu_audit drop constraint if exists menu_audit_action_check;
alter table public.menu_audit
  add constraint menu_audit_action_check
  check (action in (
    'menu.save',
    'menu.publish',
    'variant.create',
    'variant.update',
    'variant.delete',
    'variant.activate',
    'variant.default',      -- was missing; see above
    'happy_hour.update',
    'menu_cart.update'      -- new here
  ));

-- ---- 10. The switches ------------------------------------------------------
-- `menu_cart_enabled` is the one that matters TODAY: Phase 1 is live, and this
-- row is what lets the owner turn it off without a deploy. Inserted public
-- because the signed-out /menu page reads it. Only `is_public` is touched on
-- conflict, never the value, so re-running this file can never switch a
-- feature back on behind the owner's back.
--
-- The other two ship as explicit `false` rows so the state is a decision on
-- record rather than an absent row that happens to default the right way.
-- Note that the customer UI ALSO refuses to enable those two buttons while
-- PHASE_2_BUILT/PHASE_3_BUILT are false in CartSheet.tsx — flipping these
-- rows alone cannot light up a button whose endpoint does not exist.
insert into public.app_settings (key, value, is_public) values
  ('menu_cart_enabled',      'true'::jsonb,  true),
  ('table_ordering_enabled', 'false'::jsonb, true),
  ('waiter_call_enabled',    'false'::jsonb, true)
on conflict (key) do update set is_public = true;
