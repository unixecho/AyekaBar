-- ============================================================
-- Ayeka Bar — per-waiter map identity: colour and initial.
--
-- Scope item #3: a table that someone has taken shows the assigning waiter's
-- INITIAL in THEIR COLOUR on the floor map (the owner's example: a green "O"
-- for Ofir). Both live on public.staff because this project owns the roster —
-- the staff app reads them, it does not define them.
--
-- WHY COLUMNS AND NOT A HASH
-- Hashing a name to a colour is tempting and wrong: two waiters collide with
-- no way to fix it, and the colour changes if the owner corrects a spelling.
-- A stored column is owner-editable at /owner/dashboard beside the badges, and
-- stays put.
--
-- WHY `initial` IS NULLABLE AND SEPARATE FROM display_name
-- It defaults to the first character of the display name, computed in the
-- client. It exists as a column only so the owner can BREAK A TIE — אורי and
-- אופיר both start with א, and on a busy floor that ambiguity is the whole
-- point of having an initial at all.
--
-- Purely additive: two nullable columns. Nothing reads them until the UI does,
-- so this is safe to apply at any time, production included.
-- ============================================================

alter table public.staff
  add column if not exists colour  text,
  add column if not exists initial text;

comment on column public.staff.colour is
  'Hex colour for this waiter on the floor map, e.g. #34d399. Null = unassigned; the UI falls back to a neutral chip.';

comment on column public.staff.initial is
  'Single-grapheme override for the floor map. Null = derive from display_name. Exists so two waiters sharing a first letter can be told apart.';

-- Guard the format rather than trusting the UI: this value is interpolated
-- into styles, and a free-text colour is how you end up with a broken map or
-- worse. 3- or 6-digit hex only.
alter table public.staff
  drop constraint if exists staff_colour_hex_check;
alter table public.staff
  add constraint staff_colour_hex_check
  check (colour is null or colour ~* '^#[0-9a-f]{3}([0-9a-f]{3})?$');

-- One grapheme. `length()` counts characters, not bytes, so a Hebrew letter
-- and an emoji both measure 1 here.
alter table public.staff
  drop constraint if exists staff_initial_len_check;
alter table public.staff
  add constraint staff_initial_len_check
  check (initial is null or (length(initial) between 1 and 2));

-- Surface them in the diagnostic view, so "why is Ofir's chip grey?" is
-- answerable with the same query that already answers "why can't he get in?".
--
-- DROP then CREATE, not CREATE OR REPLACE: replacing a view may only APPEND
-- columns, and these two belong beside `badge`, not tacked on the end.
-- Dropping is safe here — the view holds no data and carries no grants (it is
-- service-role / SQL-editor only), so nothing depends on it existing
-- continuously.
drop view if exists public.staff_access_levels;

create view public.staff_access_levels as
  select
    s.id,
    s.email,
    s.display_name,
    s.first_name,
    s.last_name,
    s.role,
    s.badge,
    s.colour,
    s.initial,
    case
      when s.role = 'owner' or s.badge = 'owner' then 'op'
      when s.badge = 'general_manager' then 'menu'
      else 'staff'
    end as access_level,
    s.auth_user_id is not null as signed_in_at_least_once
  from public.staff s;

comment on view public.staff_access_levels is
  'Diagnostic: who holds which access level, and their floor-map colour/initial. No grants — service role / SQL editor only.';
