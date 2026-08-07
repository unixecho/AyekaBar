-- ============================================================
-- Ayeka Bar — Staff display name (public team page)
-- Apply in Supabase SQL Editor after 011_public_team.sql.
--
-- first_name/last_name are backfilled from the Google profile, which is
-- usually Latin ("Ofir Mintz") on a Hebrew-first site. The owner needs to
-- override how a person is presented publicly — "אופיר מינץ" — without
-- touching the identity fields the invite/claim flow matches on.
--
-- display_name is presentation only:
--   * claim_staff_invite() still writes first_name/last_name from Google
--   * the owner's roster still shows the real name + email for identification
--   * only the public team page prefers display_name
-- Initials on the team page are derived from whichever name is shown, so a
-- Hebrew display name yields Hebrew initials.
-- ============================================================

alter table public.staff
  add column if not exists display_name text;

comment on column public.staff.display_name is
  'Public-facing name override for the team page (e.g. Hebrew spelling). NULL = fall back to first_name + last_name.';

-- Rebuild the public projection to carry it. Still display-only: no email,
-- no auth_user_id. See 011 for the full reasoning.
drop view if exists public.public_staff;
create view public.public_staff as
  select
    id,
    first_name,
    last_name,
    display_name,
    badge,
    role,
    photo_url,
    display_order
  from public.staff
  where show_on_site
    and auth_user_id is not null
    and coalesce(display_name, first_name) is not null;

grant select on public.public_staff to anon, authenticated;

comment on view public.public_staff is
  'Display-only projection of public.staff for the public team page. Contains no contact details or auth identifiers.';
