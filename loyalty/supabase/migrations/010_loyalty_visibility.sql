-- ============================================================
-- Ayeka Bar — Loyalty club portal visibility (owner-controlled)
-- Apply in Supabase SQL Editor after 009_portal_links.sql.
--
-- `loyalty_enabled` (007) controls ACCESS: while it's false the club routes
-- redirect and the portal button renders as a "בקרוב" teaser. That teaser is
-- the announcement, so the owner had no way to run the club quietly or to
-- take the entry point off the portal entirely.
--
-- `loyalty_visible` splits that apart — it controls only whether the loyalty
-- entry appears on the portal at all. The two switches combine into the three
-- states the owner actually wants:
--
--   visible + enabled   -> live button, links to /loyalty
--   visible + disabled  -> "בקרוב" teaser (today's behaviour)
--   hidden              -> no loyalty button on the portal at all
--
-- Hiding is deliberately portal-only: /loyalty itself stays governed by
-- `loyalty_enabled`, so a hidden-but-enabled club is still reachable by
-- direct link or a QR code. That's the soft-launch case.
--
-- Defaults to TRUE so applying this migration changes nothing on its own —
-- the portal keeps showing whatever `loyalty_enabled` already dictated.
--
-- Public read (the signed-out portal decides whether to render the button),
-- service-role write (owner-gated API).
-- ============================================================

insert into public.app_settings (key, value, is_public)
values ('loyalty_visible', 'true'::jsonb, true)
on conflict (key) do update set is_public = true;
