-- ============================================================
-- Ayeka Bar — the staff app's gate becomes the shared Google identity.
--
-- WHAT THIS REPLACES
-- Until now every waiter_* policy called is_staff_client(), whose body compared
-- an `x-staff-key` request header against a row in public.waiter_app_secrets.
-- One secret, shared by everyone on shift, shipped inside the staff app's
-- JavaScript bundle as a build-time Vite variable — it was extracted from the
-- deployed bundle in one command. It stopped drive-by access and nothing more.
--
-- WHAT IT BECOMES
-- The same identity the portal already uses: a Google sign-in against THIS
-- Supabase project, allow-listed by public.staff. Supabase Auth is scoped to
-- the project, not to a deployment — so every app pointing at this database
-- (the portal on ayeka.bar, the staff app on its own Vercel project, a local
-- dev server) authenticates the same users against the same roster. That is
-- exactly why the shared secret has to go: a per-app secret is the one thing
-- that CANNOT be shared between two front ends, while an auth.uid() can.
--
-- Because every policy already calls is_staff_client(), redefining the body
-- re-scopes all of them at once. No policy needed rewriting for the swap
-- itself; they are recreated below only to narrow them from
-- `to anon, authenticated` down to `authenticated`, which is now meaningful.
--
-- ⚠️ THIS IS A CUTOVER, NOT AN ADDITION. The moment it runs, a client that
-- sends the old header stops working. A client must send the SIGNED-IN USER'S
-- access token — not the anon key — in the Authorization header, or auth.uid()
-- is null and it gets nothing. The staff app currently sends
-- `Authorization: Bearer <ANON_KEY>` (ayeka-staff/src/sync.ts, floor.ts), so it
-- must ship Supabase sign-in BEFORE this is applied to production.
--
-- Applied locally first for exactly that reason.
-- ============================================================

-- ---- The swap ------------------------------------------------------------
create or replace function public.is_staff_client()
returns boolean
language sql
stable
security definer          -- reads public.staff past that table's own RLS
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff s
    where s.auth_user_id = auth.uid()
  );
$$;

grant execute on function public.is_staff_client() to authenticated;

comment on function public.is_staff_client() is
  'True for any signed-in member of public.staff. Replaced the shared-secret '
  'header gate on 2026-08-12. Mirrors isStaff() in src/lib/staff/access.ts.';

-- ---- Re-scope the policies onto authenticated only ------------------------
-- Nothing anonymous has any business in here now that a real identity exists.
drop policy if exists waiter_tables_staff       on public.waiter_tables;
drop policy if exists waiter_orders_staff       on public.waiter_orders;
drop policy if exists waiter_order_items_staff  on public.waiter_order_items;
drop policy if exists waiter_batches_staff      on public.waiter_order_batches;
drop policy if exists waiter_floor_staff        on public.waiter_floor;
drop policy if exists waiter_events_read        on public.waiter_order_events;
drop policy if exists waiter_events_insert      on public.waiter_order_events;
drop policy if exists waiter_floor_hist_read    on public.waiter_floor_history;
drop policy if exists waiter_floor_hist_insert  on public.waiter_floor_history;
-- The original wide-open ones from the source migrations, in case this runs on
-- a database that never had ayeka-staff's 004 applied.
drop policy if exists waiter_tables_anon        on public.waiter_tables;
drop policy if exists waiter_orders_anon        on public.waiter_orders;
drop policy if exists waiter_order_items_anon   on public.waiter_order_items;
drop policy if exists waiter_batches_anon       on public.waiter_order_batches;
drop policy if exists waiter_floor_anon         on public.waiter_floor;

create policy waiter_tables_staff on public.waiter_tables
  for all to authenticated
  using (public.is_staff_client()) with check (public.is_staff_client());

create policy waiter_orders_staff on public.waiter_orders
  for all to authenticated
  using (public.is_staff_client()) with check (public.is_staff_client());

create policy waiter_order_items_staff on public.waiter_order_items
  for all to authenticated
  using (public.is_staff_client()) with check (public.is_staff_client());

create policy waiter_batches_staff on public.waiter_order_batches
  for all to authenticated
  using (public.is_staff_client()) with check (public.is_staff_client());

create policy waiter_floor_staff on public.waiter_floor
  for all to authenticated
  using (public.is_staff_client()) with check (public.is_staff_client());

-- Audit logs stay SELECT + INSERT. Still no update, still no delete: the
-- append-only guarantee does not depend on who is calling.
create policy waiter_events_read on public.waiter_order_events
  for select to authenticated using (public.is_staff_client());
create policy waiter_events_insert on public.waiter_order_events
  for insert to authenticated with check (public.is_staff_client());

create policy waiter_floor_hist_read on public.waiter_floor_history
  for select to authenticated using (public.is_staff_client());
create policy waiter_floor_hist_insert on public.waiter_floor_history
  for insert to authenticated with check (public.is_staff_client());

-- ---- The secret is now dead weight, and dangerous weight ----------------
-- Keeping it would leave a working second way in, readable from a JS bundle.
drop table if exists public.waiter_app_secrets;

-- ---- Verify (run after applying) -----------------------------------------
--   Anonymous must get nothing. This must return 42501, NOT 23502 — a
--   not-null violation would mean the write was permitted and only failed
--   validation, which is how the original lockdown gap was missed:
--     curl -X POST "$URL/rest/v1/waiter_orders" \
--          -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--          -H "Content-Type: application/json" -d '{}'
--
--   A signed-in staff member must get rows (send the USER's access_token):
--     curl "$URL/rest/v1/waiter_tables?select=number" \
--          -H "apikey: $ANON" -H "Authorization: Bearer $USER_ACCESS_TOKEN"
--
--   And the portal's tables must still be unreachable from that same token —
--   the isolation runs both ways and is re-checked, never assumed.
