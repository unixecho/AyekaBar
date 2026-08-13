-- ═══════════════════════════════════════════════════════════════════════
-- LOCAL DEVELOPMENT ONLY.
--
-- The Supabase CLI runs this after migrations on `supabase start` /
-- `supabase db reset` (config.toml → [db.seed]). It is NEVER applied to a
-- hosted project — nothing here reaches production, by construction.
--
-- WHY IT EXISTS
-- A hosted Supabase project ships with broad table grants to anon /
-- authenticated / service_role and relies on ROW LEVEL SECURITY as the real
-- access control. The local Postgres image does not reproduce those grants
-- for tables created by our migrations, so every table came up with
-- TRUNCATE/REFERENCES/TRIGGER and no SELECT/INSERT/UPDATE/DELETE — which
-- makes even the service role hit `42501 permission denied`, something that
-- never happens against the live project.
--
-- Verified before writing this: `service_role` had no DML on ANY of the 18
-- tables/views locally, while the same code path works fine in production.
-- So this closes a local-only gap; it does not change the security model.
-- RLS remains exactly as the migrations define it — grants are the coarse
-- gate, RLS is the fine one, which is precisely how the hosted project works.
--
-- If a policy ever passes locally but fails in production, suspect RLS, not
-- this file — this file only makes local match hosted.
-- ═══════════════════════════════════════════════════════════════════════

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines  in schema public to anon, authenticated, service_role;

-- Anything created after this file runs (a later migration during a reset,
-- or a table made by hand in Studio) inherits the same treatment.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on routines to anon, authenticated, service_role;
