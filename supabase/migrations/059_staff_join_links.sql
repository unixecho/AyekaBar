-- ============================================================
-- Ayeka Bar — staff JOIN LINKS (the onboarding wizard's door).
--
-- ⚠️ NOT YET APPLIED. Apply after 058. Depends on public.staff (002/006/041).
--    Needs the owner's explicit go-ahead — see CLAUDE.md "Never apply a
--    Supabase migration without explicit, per-migration approval".
--    Safe to apply early: nothing creates a link until an owner presses
--    "קישור הצטרפות" in /owner/staff, and until then every function here is
--    unreachable from the app.
--
-- WHAT IT IS FOR. "Owners need to have a link to give freshly created employee
-- accounts, and they must link their account with Gmail in order to access the
-- shift system" (owner, 2026-10-14).
--
-- Until now there were two ways onto the roster and neither fitted "I just
-- hired Dana, here's a link":
--   • WITH an email — the owner had to know Dana's Google address in advance,
--     and a typo made a pending invite nobody could claim;
--   • WITHOUT an email ("offline") — a name that can be scheduled but can never
--     sign in, and the only way out was the owner typing an address later.
-- A join link is the third door: the owner creates the person (name + job
-- title, no address needed), presses one button, and sends Dana a link. Dana
-- opens it, signs in with whichever Google account she chooses, confirms, and
-- THAT account becomes the staff row's login — the wizard at /join/<token>.
-- Until she does, the row cannot sign in, so it cannot reach /staff/schedule
-- or anything else behind a staff row: linking a Google account IS the
-- requirement for the shift system, enforced by the same thing that has always
-- enforced it (no staff row with an auth_user_id = no access), not by a second
-- gate that could drift.
--
-- ── SECURITY POSTURE (same shape as 048/050/056/058) ─────────────────────
--   • The link is a bearer secret: 32 random bytes, base64url, minted by the
--     APP. This file only ever sees its SHA-256 — a database dump cannot be
--     turned back into a working link.
--   • RLS ON, ZERO POLICIES, table grants revoked from anon and authenticated.
--   • Every function is EXECUTE-able by service_role ONLY. The claim takes the
--     signed-in user as an ARGUMENT from the server route (which read it from
--     the session) rather than trusting auth.uid() inside a function that any
--     signed-in Google account could otherwise call straight through PostgREST.
--   • A link can NEVER hand over admin. It refuses a row that is role='owner'
--     or badge='owner' (those are invited by email, deliberately), so a leaked
--     link yields at most an ordinary staff login for the one named person.
--   • It is single-use, expires (default 7 days, 30 at most), is revoked by
--     issuing a new one, and is bound to ONE staff row that must still be
--     active and unlinked at the moment of claiming.
--   • Like claim_staff_invite() (006) it only accepts an identity the provider
--     vouched for: a CONFIRMED email on a real GOOGLE identity.
--   • Claiming overwrites staff.email with the verified Google address (the
--     unique-email index makes a collision a clean refusal, not an overwrite of
--     somebody else's row): that address is now how this person is known.
-- ============================================================

create table if not exists public.staff_join_links (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff(id) on delete cascade,

  -- sha256(token) as 64 lowercase hex chars. The token itself is never stored.
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),

  created_by  uuid references public.staff(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,

  used_at     timestamptz,
  -- auth.users id of the Google account that claimed it. No FK on purpose: this
  -- is an audit fact, and it must survive the auth row being deleted.
  used_by     uuid,
  revoked_at  timestamptz,

  check (expires_at > created_at)
);

-- At most one LIVE link per person: issuing a new one revokes the old, and this
-- index is what makes "two live links for Dana" unrepresentable even if two
-- owners press the button at the same instant.
create unique index if not exists staff_join_links_one_live
  on public.staff_join_links (staff_id)
  where used_at is null and revoked_at is null;

create index if not exists staff_join_links_staff_idx
  on public.staff_join_links (staff_id, created_at desc);

comment on table public.staff_join_links is
  'One row per onboarding link an owner generated for a staff row. token_hash is '
  'sha256 of a random secret that exists only in the link itself. RLS on, no '
  'policies, grants revoked — service-role routes only. See migration 059 and '
  'src/lib/staff/join.ts.';

alter table public.staff_join_links enable row level security;
revoke all on table public.staff_join_links from anon, authenticated;

-- ── issue ────────────────────────────────────────────────────────────────
-- Replaces any live link for this person with a new one. The owner can always
-- generate a fresh link (a lost message, an expired link); the old one stops
-- working at that instant.
create or replace function public.staff_join_issue(
  p_staff uuid, p_hash text, p_actor uuid, p_ttl_hours integer default 168
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.staff%rowtype;
  v_ttl integer := least(greatest(coalesce(p_ttl_hours, 168), 1), 720);
  v_exp timestamptz;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_hash');
  end if;

  select * into v_row from public.staff where id = p_staff for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_staff');
  end if;
  if not coalesce(v_row.active, true) then
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;
  if v_row.auth_user_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_linked');
  end if;
  -- Admin is handed over by email invite, never by a link that can be forwarded.
  if v_row.role = 'owner' or v_row.badge = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'owner_role');
  end if;

  update public.staff_join_links
     set revoked_at = now()
   where staff_id = p_staff and used_at is null and revoked_at is null;

  v_exp := now() + make_interval(hours => v_ttl);
  insert into public.staff_join_links (staff_id, token_hash, created_by, expires_at)
  values (p_staff, p_hash, p_actor, v_exp);

  return jsonb_build_object('ok', true, 'expires_at', v_exp);
end;
$$;

-- ── peek (the wizard's first screen) ─────────────────────────────────────
-- Says what state a link is in and, ONLY when it is usable, whose it is — a
-- first name and a job title, so the person can see "this is for me". Never an
-- email, never an id. An unknown token and a malformed one answer identically.
create or replace function public.staff_join_peek(p_hash text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_l public.staff_join_links%rowtype;
  v_s public.staff%rowtype;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'unknown');
  end if;
  select * into v_l from public.staff_join_links where token_hash = p_hash;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if v_l.revoked_at is not null then return jsonb_build_object('status', 'revoked'); end if;
  if v_l.used_at is not null then return jsonb_build_object('status', 'used'); end if;
  if v_l.expires_at <= now() then return jsonb_build_object('status', 'expired'); end if;

  select * into v_s from public.staff where id = v_l.staff_id;
  if not found or not coalesce(v_s.active, true) then
    return jsonb_build_object('status', 'inactive');
  end if;
  if v_s.auth_user_id is not null then
    return jsonb_build_object('status', 'linked');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'first_name', v_s.first_name,
    'badge', v_s.badge,
    'expires_at', v_l.expires_at
  );
end;
$$;

-- ── claim ────────────────────────────────────────────────────────────────
-- Links the Google account `p_user` to the staff row the link names.
-- One transaction; both rows are locked so two phones using the same link at
-- once cannot both win.
create or replace function public.staff_join_claim(p_hash text, p_user uuid) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_u     auth.users%rowtype;
  v_l     public.staff_join_links%rowtype;
  v_s     public.staff%rowtype;
  v_meta  jsonb;
  v_first text;
  v_last  text;
  v_full  text;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  select * into v_u from auth.users where id = p_user;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_user');
  end if;
  -- Same bar as claim_staff_invite(): an address the provider vouched for, on a
  -- real Google identity. (Supabase could be reconfigured to allow other
  -- sign-ins one day; a login link must not silently start accepting them.)
  if v_u.email is null or v_u.email_confirmed_at is null
     or not exists (select 1 from auth.identities where user_id = v_u.id and provider = 'google') then
    return jsonb_build_object('ok', false, 'reason', 'not_google');
  end if;

  select * into v_l from public.staff_join_links where token_hash = p_hash for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  select * into v_s from public.staff where id = v_l.staff_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  -- Already this very person (they got in another way first, or this is a
  -- double-tap / a reload of the last wizard step): success, and the link is
  -- spent. Checked before the link's own state so a refresh never looks like a
  -- failure to someone who is in fact linked.
  if v_s.auth_user_id = p_user then
    update public.staff_join_links
       set used_at = coalesce(used_at, now()), used_by = coalesce(used_by, p_user)
     where id = v_l.id;
    return jsonb_build_object('ok', true, 'already', true, 'staff_id', v_s.id);
  end if;

  if v_l.revoked_at is not null then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;
  if v_l.used_at is not null then return jsonb_build_object('ok', false, 'reason', 'used'); end if;
  if v_l.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;

  if not coalesce(v_s.active, true) then
    return jsonb_build_object('ok', false, 'reason', 'inactive');
  end if;
  if v_s.role = 'owner' or v_s.badge = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'owner_role');
  end if;
  if v_s.auth_user_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end if;

  -- This Google account already belongs to someone on the roster.
  if exists (select 1 from public.staff where auth_user_id = p_user) then
    return jsonb_build_object('ok', false, 'reason', 'already_staff');
  end if;
  -- …or its address is already written on a DIFFERENT row (a second entry the
  -- owner made for the same person). The unique-email index would refuse the
  -- write below anyway; saying so cleanly lets the owner merge the two.
  if exists (select 1 from public.staff where lower(email) = lower(v_u.email) and id <> v_s.id) then
    return jsonb_build_object('ok', false, 'reason', 'email_in_use');
  end if;

  -- Name from the Google profile, for a row whose name was left blank — the
  -- owner's typed name always wins (claim_staff_invite() makes the same rule).
  v_meta  := coalesce(v_u.raw_user_meta_data, '{}'::jsonb);
  v_first := nullif(v_meta->>'given_name', '');
  v_last  := nullif(v_meta->>'family_name', '');
  if v_first is null and v_last is null then
    v_full := coalesce(nullif(v_meta->>'full_name', ''), nullif(v_meta->>'name', ''));
    if v_full is not null then
      v_first := split_part(v_full, ' ', 1);
      v_last  := nullif(trim(substr(v_full, length(split_part(v_full, ' ', 1)) + 1)), '');
    end if;
  end if;

  update public.staff
     set auth_user_id = p_user,
         claimed_at   = now(),
         email        = v_u.email,
         first_name   = coalesce(first_name, v_first),
         last_name    = coalesce(last_name, v_last)
   where id = v_s.id;

  update public.staff_join_links
     set used_at = now(), used_by = p_user
   where id = v_l.id;

  return jsonb_build_object('ok', true, 'already', false, 'staff_id', v_s.id);
end;
$$;

-- ── revoke ───────────────────────────────────────────────────────────────
create or replace function public.staff_join_revoke(p_staff uuid) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  update public.staff_join_links
     set revoked_at = now()
   where staff_id = p_staff and used_at is null and revoked_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- PUBLIC first (044), then anon/authenticated by name (Supabase's default
-- privileges grant them on new functions), then back to service_role only.
revoke execute on function public.staff_join_issue(uuid, text, uuid, integer)  from public, anon, authenticated;
revoke execute on function public.staff_join_peek(text)                        from public, anon, authenticated;
revoke execute on function public.staff_join_claim(text, uuid)                 from public, anon, authenticated;
revoke execute on function public.staff_join_revoke(uuid)                      from public, anon, authenticated;
grant  execute on function public.staff_join_issue(uuid, text, uuid, integer)  to service_role;
grant  execute on function public.staff_join_peek(text)                        to service_role;
grant  execute on function public.staff_join_claim(text, uuid)                 to service_role;
grant  execute on function public.staff_join_revoke(uuid)                      to service_role;
