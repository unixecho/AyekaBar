-- ============================================================
-- Ayeka Bar — Temporary menu versions + a movable "main" version
-- Apply in Supabase SQL Editor after 016_access_levels.sql.
--
-- Two additions, both driven by the same night: the cook doesn't show up, the
-- big menu has to shrink NOW, and nobody wants to remember to undo it at 4am.
--
--   1. A version can be made live UNTIL a moment (`active_until`), after which
--      the menu returns to the main version by itself. When the version was a
--      one-off, `expire_action = 'delete'` takes it away entirely.
--
--   2. `is_default` — the version everything falls back to — can now be MOVED
--      to another version, so a permanently-shortened menu can become the main
--      one without retyping it.
--
-- NOTE ON EXPIRY: nothing has to run for a timer to end. `resolveVariant()`
-- (src/lib/menu/variants.ts) simply stops choosing a version once its
-- `active_until` has passed — the same trick the weekly schedule already uses.
-- That means no cron, and no window where a late job leaves last night's menu
-- on the table. reap_expired_variants() below is HOUSEKEEPING, not correctness:
-- it tidies the rows afterwards, and the menu is already right without it.
-- ============================================================

-- ---- 1. columns ----------------------------------------------------------

alter table public.menu_variants
  add column if not exists active_until  timestamptz,
  add column if not exists expire_action text not null default 'revert';

alter table public.menu_variants
  drop constraint if exists menu_variants_expire_action_chk;
alter table public.menu_variants
  add constraint menu_variants_expire_action_chk
  check (expire_action in ('revert', 'delete'));

comment on column public.menu_variants.active_until is
  'While this version is the active one and this instant is in the future, it is live. Once passed, the menu falls back to the main version on its own — no job required.';
comment on column public.menu_variants.expire_action is
  'What becomes of the version once active_until passes: revert (keep it for next time) or delete (it was a one-off).';

-- ---- 2. moving the "main" version ----------------------------------------
--
-- Two statements rather than one `set is_default = (id = ...)`: a single
-- UPDATE touches rows in an arbitrary order, and the moment it sets the new
-- default before clearing the old one it trips menu_variants_one_default.
-- Clearing first passes through "no default" instead, which no index minds and
-- which nothing outside this transaction can observe.

create or replace function public.set_default_variant(p_variant_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_menu_id uuid;
begin
  select menu_id into v_menu_id
  from public.menu_variants where id = p_variant_id;

  if v_menu_id is null then
    raise exception 'variant % not found', p_variant_id;
  end if;

  update public.menu_variants
  set is_default = false, updated_at = now()
  where menu_id = v_menu_id and is_default and id <> p_variant_id;

  -- The main version is the unconditional fallback — the thing every schedule
  -- and every timer returns TO. It therefore cannot itself be on a schedule or
  -- a timer, or there would be moments with nothing left to fall back to.
  update public.menu_variants
  set is_default       = true,
      schedule_enabled = false,
      schedule_days    = '{}',
      schedule_start   = null,
      schedule_end     = null,
      active_until     = null,
      expire_action    = 'revert',
      updated_at       = now()
  where id = p_variant_id;
end;
$$;

comment on function public.set_default_variant(uuid) is
  'Promote a menu version to "main". Clears its schedule/timer and demotes the previous main in one transaction.';

-- ---- 3. housekeeping for finished timers ---------------------------------

create or replace function public.reap_expired_variants(p_menu_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer := 0;
begin
  -- Point any menu whose live version has run out back at its main version.
  -- Done BEFORE the delete below so the pointer moves deliberately rather than
  -- being nulled out as a side effect of the cascade.
  update public.menus m
  set active_variant_id = d.id
  from public.menu_variants v
  join public.menu_variants d
    on d.menu_id = v.menu_id and d.is_default
  where v.id = m.active_variant_id
    and (p_menu_id is null or m.id = p_menu_id)
    and v.active_until is not null
    and v.active_until <= now();

  -- One-off versions: gone once their window closes. The main version is
  -- excluded defensively — it should never carry a timer in the first place.
  with gone as (
    delete from public.menu_variants v
    where (p_menu_id is null or v.menu_id = p_menu_id)
      and not v.is_default
      and v.active_until is not null
      and v.active_until <= now()
      and v.expire_action = 'delete'
    returning 1
  )
  select count(*) into v_deleted from gone;

  -- Everything else just loses its timer and stays on the shelf for next time.
  update public.menu_variants
  set active_until = null, updated_at = now()
  where (p_menu_id is null or menu_id = p_menu_id)
    and active_until is not null
    and active_until <= now();

  return v_deleted;
end;
$$;

comment on function public.reap_expired_variants(uuid) is
  'Tidies versions whose timer has passed. Housekeeping only — the public menu already ignores an expired version without this having run.';

-- Both are security definer, and Postgres grants EXECUTE to PUBLIC by default.
-- Without these revokes any signed-in customer could reshuffle the menu.
revoke all on function public.set_default_variant(uuid) from public;
revoke all on function public.reap_expired_variants(uuid) from public;

-- ---- 4. let the audit log record a change of main version ----------------
-- menu_audit.action is a CHECK list (014), and logAudit() swallows write
-- failures on purpose so a broken log can never fail the owner's actual edit.
-- The two together mean an unlisted action doesn't error — it just silently
-- goes unrecorded. So the list has to grow with the code.

alter table public.menu_audit drop constraint if exists menu_audit_action_check;
alter table public.menu_audit add constraint menu_audit_action_check
  check (action in (
    'menu.save',
    'menu.publish',
    'variant.create',
    'variant.update',
    'variant.delete',
    'variant.activate',
    'variant.default',      -- which version everything falls back to
    'happy_hour.update'
  ));

-- ---- 5. expose the timer to the public menu ------------------------------
-- The menu page decides for itself whether a version has run out, so it needs
-- the deadline. `expire_action` is deliberately NOT exposed: what happens to
-- the row afterwards is the owner's business, not the customer's.

drop view if exists public.public_menu_variants;
create view public.public_menu_variants as
  select
    v.id,
    m.slug,
    v.name,
    v.excluded_uids,
    v.is_default,
    v.sort_order,
    v.schedule_enabled,
    v.schedule_days,
    v.schedule_start,
    v.schedule_end,
    v.active_until,
    (m.active_variant_id = v.id) as is_active
  from public.menu_variants v
  join public.menus m on m.id = v.menu_id;

grant select on public.public_menu_variants to anon, authenticated;

comment on view public.public_menu_variants is
  'Every menu version plus its schedule and temporary deadline, so the public menu can resolve which one applies now. Display fields only.';
