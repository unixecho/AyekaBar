-- ============================================================
-- Ayeka Bar — Access levels (OP / menu editor / staff)
-- Apply in Supabase SQL Editor after 015_menu_access_and_schedule.sql.
--
-- The app previously had exactly one privileged level: staff.role = 'owner'.
-- That forced a choice between handing someone full admin or locking them out
-- of the menu entirely — so a general manager, and even a co-owner carrying
-- only the בעלים badge, could not edit the menu.
--
-- Three levels now, matching src/lib/staff/access.ts. Keep the two in sync:
--
--   OP     role = 'owner'  OR  badge = 'owner'
--          Everything. Ownership of the business implies it, which is why
--          "בעלים" and "הרשאות" are no longer separate switches.
--
--   MENU   OP  OR  badge = 'general_manager'
--          The editor, menu versions and Happy Hour. Nothing else.
--
--   STAFF  any row in public.staff — the check-in QR gateway only.
-- ============================================================

-- ---- OP ------------------------------------------------------------------
create or replace function public.is_op()
returns boolean
language sql
security definer          -- reads public.staff past that table's own RLS
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff
    where auth_user_id = auth.uid()
      and (role = 'owner' or badge = 'owner')
  );
$$;

grant execute on function public.is_op() to authenticated;

comment on function public.is_op() is
  'Full admin. Mirrors isOp() in src/lib/staff/access.ts — change both together.';

-- ---- Menu editor ---------------------------------------------------------
-- Redefined (015 created it as owner-only) to include the general manager,
-- who is trusted with the menu without being handed full admin rights.
create or replace function public.is_menu_editor()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff
    where auth_user_id = auth.uid()
      and (role = 'owner' or badge in ('owner', 'general_manager'))
  );
$$;

grant execute on function public.is_menu_editor() to authenticated;

comment on function public.is_menu_editor() is
  'May edit the menu: OP, or the general manager. Mirrors canEditMenu() in src/lib/staff/access.ts.';

-- The menus policies from 015 already call is_menu_editor(), so redefining it
-- above is enough — the editor, save and publish_menu() all widen with it.
-- menu_variants stays public-read (013) and service-role-write through the
-- owner API, which now guards with requireMenuEditor().

-- ---- Sanity check --------------------------------------------------------
-- Lists everyone and the level they resolve to. Handy when someone reports
-- "it won't let me in" — run it and read the answer rather than guessing.
create or replace view public.staff_access_levels as
  select
    s.id,
    s.email,
    s.display_name,
    s.first_name,
    s.last_name,
    s.role,
    s.badge,
    case
      when s.role = 'owner' or s.badge = 'owner' then 'op'
      when s.badge = 'general_manager' then 'menu'
      else 'staff'
    end as access_level,
    s.auth_user_id is not null as signed_in_at_least_once
  from public.staff s;

comment on view public.staff_access_levels is
  'Diagnostic: who holds which access level. No grants — service role / SQL editor only.';
