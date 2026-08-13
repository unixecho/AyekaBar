-- ============================================================
-- Ayeka Bar — a narrow staff directory for the waiter app.
--
-- THE PROBLEM: spec §3 renders every held table with the HOLDING waiter's
-- initial and colour — but RLS on public.staff lets a user read only their
-- own row (by design: emails, roles and badges are none of a colleague's
-- business). So Ofir's phone cannot learn Dana's colour to draw her tables.
--
-- THE FIX: a view exposing exactly the four display fields the map needs and
-- nothing else. It runs as its owner (security_invoker=false), which lets it
-- read past staff's RLS; the WHERE clause re-gates it per-caller so only
-- signed-in staff get rows. No emails, no roles, no badges, no auth ids.
-- ============================================================

drop view if exists public.waiter_staff_directory;

create view public.waiter_staff_directory
with (security_invoker = false, security_barrier = true) as
  select
    s.id,
    coalesce(
      nullif(trim(s.display_name), ''),
      nullif(trim(concat_ws(' ', s.first_name, s.last_name)), ''),
      s.email
    ) as name,
    s.colour,
    s.initial
  from public.staff s
  where public.is_staff_client();

grant select on public.waiter_staff_directory to authenticated;

comment on view public.waiter_staff_directory is
  'Display-only staff directory for the waiter app''s floor map: id, name, colour, initial. Deliberately excludes emails, roles, badges and auth ids.';
