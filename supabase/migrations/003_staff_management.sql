-- ============================================================
-- Ayeka Bar — Staff management (badges + display info)
-- Apply in Supabase SQL Editor after 002_staff_roles.sql.
--
-- Model: everyone signs in with Google. A person becomes a customer
-- automatically. The OWNER promotes a person to staff by adding a row here
-- (keyed by their auth user id), assigning an authorization `role`
-- (staff | owner) and a display `badge` (job title). All writes happen
-- through the owner API via the service role; RLS still only lets each user
-- read their OWN row (no recursive owner policy needed).
-- ============================================================

alter table public.staff
  add column if not exists badge      text,          -- job title: waiter, bartender, cook, receptionist, manager, …
  add column if not exists first_name text,
  add column if not exists last_name  text,
  add column if not exists email      text;          -- snapshot from auth at add-time (for the owner's list)

comment on column public.staff.role  is 'Authorization level: staff | owner (gates dashboards in middleware).';
comment on column public.staff.badge is 'Display job title, free text (waiter/bartender/cook/receptionist/manager/…).';

-- Existing "staff_read_own" select policy from 002 still applies. Owner-wide
-- reads/writes go through the service role in /api/owner/staff, which first
-- verifies the caller's own row has role = 'owner'.
