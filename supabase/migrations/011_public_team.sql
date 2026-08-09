-- ============================================================
-- Ayeka Bar — Public team page ("הצוות")
-- Apply in Supabase SQL Editor after 010_loyalty_visibility.sql.
--
-- The site gets a public team page that reads the SAME staff roster the owner
-- already manages at /owner/dashboard — add a person there, set their badge,
-- and the page updates itself. No second list to maintain.
--
-- public.staff holds email + auth_user_id, so it can never be exposed
-- directly. This adds display-only columns and a narrow view
-- (public.public_staff) carrying just the fields a visitor may see, the same
-- pattern public_menus uses for the menu.
-- ============================================================

alter table public.staff
  -- Opt-in per person. Defaults to FALSE so a newly invited staff member is
  -- never published to the public internet by the act of hiring them — the
  -- owner ticks them on deliberately. (Existing team is switched on below,
  -- which is the state the owner asked for.)
  add column if not exists show_on_site  boolean not null default false,
  -- Manual ordering on the public page; NULLs sort last, then owners first.
  add column if not exists display_order integer,
  -- Portrait. NULL renders the generated monogram placeholder in the app.
  add column if not exists photo_url     text;

comment on column public.staff.show_on_site is
  'Does this person appear on the public /team page? Defaults false — publishing a name to the open web is a deliberate act, not a side effect of being hired.';
comment on column public.staff.display_order is
  'Manual sort position on the public team page. NULL sorts last.';
comment on column public.staff.photo_url is
  'Public portrait URL (Supabase Storage). NULL = generated monogram placeholder.';

-- One-time: publish the team that exists right now. New rows added after this
-- migration still default to hidden.
update public.staff
set show_on_site = true
where auth_user_id is not null
  and first_name is not null;

-- ---- public read surface -------------------------------------------------
-- Like public_menus: a view owned by the table owner runs with the owner's
-- privileges, so it bypasses staff's row-level security for exactly the
-- columns named here. That is the point — anonymous visitors must read the
-- team page without any grant on public.staff itself.
--
-- NEVER add email, auth_user_id, invited_at or claimed_at to this view.
-- Pending invites are excluded too: an un-claimed row is just an email
-- address the owner typed, not a person who has agreed to appear.
drop view if exists public.public_staff;
create view public.public_staff as
  select
    id,
    first_name,
    last_name,
    badge,
    role,
    photo_url,
    display_order
  from public.staff
  where show_on_site
    and auth_user_id is not null
    and first_name is not null;

grant select on public.public_staff to anon, authenticated;

comment on view public.public_staff is
  'Display-only projection of public.staff for the public team page. Contains no contact details or auth identifiers.';
