-- Staff are deactivated, never deleted — same pattern waiter_tables already
-- uses (migration 028), for the same reason: historical orders/events still
-- point at a staff row (registered_by, claimed_by, delivered_by, voided_by,
-- picked_up_by, actor_staff_id, waiter_staff_id, started_by, ended_by,
-- held_by_staff_id, label_set_by, added_by, generated_by, joined_by — most
-- as ON DELETE NO ACTION), so a hard DELETE on any staff row with real
-- history fails outright. That IS the "can't delete cjgaming/eden/
-- unknownsouly0" bug — all three carry real order history from OMS testing.
--
-- Root-caused 2026-08-30, confirmed against production: those three rows
-- have 38+ waiter_order_events rows alone (registered_by/claimed_by/
-- voided_by/picked_up_by across waiter_order_items, plus waiter_orders.
-- waiter_staff_id and waiter_order_guests.added_by). DELETE just returned a
-- generic "מחיקה נכשלה" with no indication why.

alter table public.staff
  add column active boolean not null default true;

-- The public team page must never keep showing someone who's been removed.
create or replace view public.public_staff as
  select id, first_name, last_name, display_name, badge, role, photo_url, display_order
  from public.staff
  where show_on_site and auth_user_id is not null and active
    and coalesce(display_name, first_name) is not null;

-- The live shift scheduler's assignable roster must not offer a removed
-- person for a future shift. Identical to the prior view otherwise — only
-- `AND s.active` is new.
create or replace view public.schedule_roster as
  select
    v.id as venue_id,
    s.id as staff_id,
    coalesce(
      nullif(trim(s.display_name), ''),
      nullif(trim(concat_ws(' ', s.first_name, s.last_name)), ''),
      s.email
    ) as name,
    s.initial,
    s.colour,
    s.badge,
    s.role,
    (s.auth_user_id is null) as pending,
    coalesce(sm.schedulable, false) as schedulable,
    sm.default_role_id,
    sm.max_weekly_hours,
    sm.employment_type,
    sm.sort_order,
    sm.note
  from venues v
  cross join staff s
  left join schedule_members sm on sm.venue_id = v.id and sm.staff_id = s.id
  where is_staff_client() and s.active;

-- Diagnostic views the owner queries by hand (CLAUDE.md: "who resolves to
-- what") — "who currently has access" should mean current staff, not
-- everyone who ever existed. Identical otherwise — only the active filter
-- is new.
create or replace view public.staff_access_levels as
  select
    id, email, display_name, first_name, last_name, role, badge, colour, initial,
    case
      when role = 'owner' or badge = 'owner' then 'op'
      when badge = 'general_manager' then 'menu'
      else 'staff'
    end as access_level,
    (auth_user_id is not null) as signed_in_at_least_once
  from staff s
  where active;

create or replace view public.schedule_access_levels as
  select
    v.slug as venue,
    s.id, s.email, s.display_name, s.role, s.badge,
    case
      when s.role = 'owner' or s.badge = 'owner' then 'op'
      when s.badge = 'general_manager' then 'general_manager'
      when s.id = any(coalesce(ss.schedule_managers, '{}'::uuid[])) then 'delegated'
      else 'view_only'
    end as schedule_access
  from venues v
  cross join staff s
  left join shift_settings ss on ss.venue_id = v.id
  where s.active;

-- waiter_staff_directory (migration 025) is DELIBERATELY left untouched — it
-- resolves a name/colour for HISTORICAL attribution in the OMS event feed
-- (who registered/claimed/delivered an old order). Filtering it to active
-- staff would silently blank out that history the moment someone is
-- deactivated, which is exactly the loss this whole feature exists to avoid.

-- ── Access revocation ────────────────────────────────────────────────
-- Deactivating someone must actually revoke their access, not just hide
-- them from the roster UI. is_op()/is_menu_editor()/is_floor_manager()/
-- is_schedule_manager()/is_staff_client(), the API guard.ts helpers, and
-- every /owner/* page's own server-side re-check all resolve "who is the
-- signed-in user" the SAME way: `select ... from staff where auth_user_id =
-- auth.uid()` (or the Postgres equivalent). Rather than touching all of
-- those call sites (a wide, easy-to-miss surface — CLAUDE.md's own "change
-- both together" TS/SQL rule exists because exactly this kind of drift
-- already happened once), the DELETE route (below, application code) will
-- also null out `auth_user_id` on deactivation. That lookup then finds NO
-- staff row for that session, which every one of those functions already
-- treats as "not staff" — the exact same code path a never-yet-signed-in
-- pending invite already takes, reused rather than duplicated.
--
-- The one place that has to change here: claim_staff_invite() links a
-- pending invite (auth_user_id is null) to a Google account purely by email
-- match, with no idea an invite could be "a deactivated person, not a new
-- one." Without this fix, someone removed today could sign in again
-- tomorrow with the same Google account and get silently re-linked and
-- therefore re-admitted — access revocation undone by the very person it
-- was revoked from, with no action from the owner. Restoring someone is a
-- deliberate owner action (PATCH active:true); a Google sign-in must never
-- be able to do it on its own.
create or replace function public.claim_staff_invite()
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user  auth.users%rowtype;
  v_role  text;
  v_meta  jsonb;
  v_first text;
  v_last  text;
  v_full  text;
begin
  select * into v_user from auth.users where id = auth.uid();
  if not found then
    return null;
  end if;

  -- Already linked → nothing to claim.
  select role into v_role from public.staff where auth_user_id = v_user.id;
  if found then
    return v_role;
  end if;

  if v_user.email is null then
    return null;
  end if;

  -- An invite is matched on the email address alone, and claiming an `owner`
  -- invite hands over full admin — so only ever match an address the identity
  -- provider actually vouched for. Requires BOTH a confirmed email and a real
  -- Google identity, so re-enabling email/password signup in Supabase can
  -- never turn "register an account with the boss's address" into a takeover.
  if v_user.email_confirmed_at is null then
    return null;
  end if;

  if not exists (
    select 1 from auth.identities
    where user_id = v_user.id and provider = 'google'
  ) then
    return null;
  end if;

  -- Name for the owner's roster, from the Google profile.
  v_meta  := coalesce(v_user.raw_user_meta_data, '{}'::jsonb);
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
  set auth_user_id = v_user.id,
      claimed_at   = now(),
      first_name   = coalesce(first_name, v_first),
      last_name    = coalesce(last_name, v_last),
      email        = coalesce(email, v_user.email)
  where auth_user_id is null
    and active               -- ← the only change: never re-link a removed person
    and lower(email) = lower(v_user.email)
  returning role into v_role;

  return v_role;
end;
$function$;
