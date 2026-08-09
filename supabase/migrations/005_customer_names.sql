-- ============================================================
-- Ayeka Bar — Denormalize customer names (from Google profile)
-- Apply in Supabase SQL Editor after 004_point_management.sql.
--
-- customers only stored email; names live in auth.users metadata. Copy them
-- onto the row so the owner's customer list/export can show names without an
-- admin API call per customer. Kept fresh on creation via get_or_create_customer.
-- ============================================================

alter table public.customers
  add column if not exists first_name text,
  add column if not exists last_name  text;

-- Backfill existing customers from Google metadata.
update public.customers c
set first_name = coalesce(
      u.raw_user_meta_data->>'given_name',
      u.raw_user_meta_data->>'full_name',
      u.raw_user_meta_data->>'name'),
    last_name = u.raw_user_meta_data->>'family_name'
from auth.users u
where u.id = c.auth_user_id
  and c.first_name is null and c.last_name is null;

-- Populate names on first login too.
create or replace function public.get_or_create_customer()
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user auth.users%rowtype;
  v_customer public.customers%rowtype;
begin
  select * into v_user from auth.users where id = auth.uid();
  if not found then
    raise exception 'Not authenticated';
  end if;

  select * into v_customer from public.customers where auth_user_id = auth.uid();

  if not found then
    insert into public.customers (auth_user_id, email, first_name, last_name)
    values (
      auth.uid(),
      v_user.email,
      coalesce(v_user.raw_user_meta_data->>'given_name', v_user.raw_user_meta_data->>'full_name', v_user.raw_user_meta_data->>'name'),
      v_user.raw_user_meta_data->>'family_name'
    )
    returning * into v_customer;
  end if;

  return v_customer;
end;
$$;
