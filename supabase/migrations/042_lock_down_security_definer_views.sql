-- Lock down the anon/authenticated grants on every SECURITY DEFINER view in
-- the public schema. Root-caused 2026-08-31 during a privacy-policy
-- data-mapping pass, then dug into further once flagged as the first
-- security-hardening task: each of these 8 views was granted BLANKET
-- privileges (SELECT *and* INSERT/UPDATE/DELETE/TRUNCATE) to anon and
-- authenticated — almost certainly from Supabase's "expose to API" default,
-- which grants full CRUD unless a view/table is explicitly narrowed to
-- SELECT at creation time. Nobody meant to hand out write access here; it
-- was never used, and until this migration it was live.
--
-- Four of the eight (public_staff, staff_access_levels,
-- waiter_staff_directory, published_schedule) are simple enough — one base
-- table, no joins/aggregates — that Postgres treats them as *automatically
-- updatable* views (confirmed live via information_schema.views:
-- is_updatable / is_insertable_into = YES for all four). Combined with
-- SECURITY DEFINER (the view runs with its OWNER's privileges, bypassing
-- the underlying table's RLS entirely, instead of the caller's) and the
-- blanket grant, two of them were a live, UNAUTHENTICATED write hole:
--
--   PATCH /rest/v1/staff_access_levels?id=eq.<any-active-staff-id>
--   { "role": "owner" }
--
-- ...with no Authorization header beyond the public anon key (the one
-- embedded in every page of the site), would UPDATE the real public.staff
-- row and grant that person full OP/owner access to the entire platform —
-- the id itself was harvestable from that same view's own (equally
-- unauthenticated) SELECT. public_staff carries the identical `role` column
-- and the identical exposure for the smaller set of rows with
-- show_on_site = true. waiter_staff_directory and published_schedule are
-- the same shape but gated by is_staff_client() in their own WHERE clause,
-- so the write there is reachable by any SIGNED-IN staff member (not a true
-- anonymous caller) — still an unintended cross-account write: defacing a
-- colleague's floor-map colour, or silently rewriting another venue's
-- already-published shift schedule, bypassing is_schedule_manager()
-- entirely.
--
-- None of the 8 views are referenced by this repo's own application code
-- (grepped, zero matches) — CLAUDE.md documents staff_access_levels /
-- schedule_access_levels as manual SQL-editor diagnostics only. Anyone
-- using the Supabase SQL Editor connects as `postgres` (or an equivalent
-- BYPASSRLS role), which ignores these grants entirely, same as it ignores
-- RLS — none of this changes how a developer inspects the data by hand.
--
-- Fix: revoke everything from anon/authenticated on all 8, then re-grant
-- ONLY the read access each view actually needs — no view here should have
-- ever had more than SELECT, and three of them (the pure dev diagnostics
-- plus the dead team-page leftover) don't need anon/authenticated access at
-- all. staff_access_levels and schedule_access_levels also drop SECURITY
-- DEFINER entirely (→ security invoker) since their only legitimate caller
-- already bypasses RLS as `postgres` regardless — the other six keep
-- SECURITY DEFINER because it is structurally required for their real job
-- (showing one staff member the *other* staff members' names/schedule,
-- which the restrictive `staff_read_own` RLS policy on `staff` would
-- otherwise block).

-- 1) Pure developer diagnostics — no app code, no product surface. No
--    anon/authenticated grant at all.
revoke all on public.staff_access_levels    from anon, authenticated;
revoke all on public.schedule_access_levels from anon, authenticated;

-- 2) Dead feature leftover — backed a public "team page" that was removed
--    from the UI without its grant being reverted (HANDOFF.md, migrations
--    011/012). No anon/authenticated grant while nothing renders it. If the
--    team page comes back, re-grant SELECT ONLY to anon at that point —
--    don't restore it pre-emptively, and never re-grant INSERT/UPDATE/
--    DELETE/TRUNCATE.
revoke all on public.public_staff from anon, authenticated;

-- 3) Real staff-facing surfaces — keep exactly the SELECT they're built
--    for (their own WHERE clause already requires is_staff_client(), so a
--    true anon caller always got an empty array here anyway; that read
--    behaviour is unchanged). Only strip the write grants nothing should
--    ever have had.
revoke insert, update, delete, truncate on public.waiter_staff_directory from anon, authenticated;
revoke insert, update, delete, truncate on public.schedule_roster        from anon, authenticated;
revoke insert, update, delete, truncate on public.published_schedule     from anon, authenticated;

-- 4) Genuinely public menu content — keep SELECT for everyone. Postgres
--    already refuses writes against these two (neither is a simply-
--    updatable view — is_updatable = NO), so this is hygiene, not a
--    behaviour change: no reason to leave a write grant sitting on a view
--    that implies one is possible.
revoke insert, update, delete, truncate on public.public_menus         from anon, authenticated;
revoke insert, update, delete, truncate on public.public_menu_variants from anon, authenticated;

-- 5) Belt-and-suspenders for the two pure developer diagnostics: drop
--    SECURITY DEFINER entirely. A developer using the Supabase SQL Editor
--    connects as `postgres`, which bypasses RLS on its own — SECURITY
--    DEFINER was never actually required for that manual/admin use, and
--    removing it resolves Supabase's own security_definer_view advisory
--    for both views outright, on top of the grant fix above.
alter view public.staff_access_levels    set (security_invoker = true);
alter view public.schedule_access_levels set (security_invoker = true);
