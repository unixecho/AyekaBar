-- ============================================================
-- Ayeka Bar — Atomic reward redemption
-- Apply in Supabase SQL Editor after 007_app_settings.sql.
--
-- /api/rewards/redeem used to do this in the API layer:
--
--     read customer.points          -- e.g. 30
--     if points >= required …       -- passes
--     update customers set points = <read value> - required
--
-- Two requests fired at the same time both read 30, both pass the check, and
-- both write 30 - 30 = 0 — the customer gets two rewards for one balance. The
-- non-atomic write also clobbered any points awarded in between, and a failed
-- `reward_redemptions` insert left the points already deducted with no record.
--
-- This function does the check, the deduction and the audit row in one
-- transaction. The `points >= required` predicate lives in the UPDATE's WHERE
-- clause, so concurrent redemptions serialize on the customer row and the
-- loser simply matches no rows.
-- ============================================================

create or replace function public.redeem_reward(
  p_customer_id  uuid,
  p_reward_id    uuid,
  p_business_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reward    public.rewards%rowtype;
  v_remaining integer;
begin
  select * into v_reward
  from public.rewards
  where id = p_reward_id and business_id = p_business_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'reward_not_found');
  end if;

  if not v_reward.active then
    return jsonb_build_object('success', false, 'error', 'reward_inactive');
  end if;

  update public.customers
     set points = points - v_reward.required_points
   where id = p_customer_id
     and points >= v_reward.required_points
  returning points into v_remaining;

  if not found then
    return jsonb_build_object(
      'success',   false,
      'error',     'insufficient_points',
      'required',  v_reward.required_points,
      'available', coalesce((select points from public.customers where id = p_customer_id), 0)
    );
  end if;

  insert into public.reward_redemptions (customer_id, reward_id, points_deducted)
  values (p_customer_id, p_reward_id, v_reward.required_points);

  return jsonb_build_object(
    'success',          true,
    'reward_name',      v_reward.reward_name,
    'reward_name_he',   v_reward.reward_name_he,
    'points_deducted',  v_reward.required_points,
    'remaining_points', v_remaining
  );
end;
$$;

-- Service-role only: it is called from the API route after that route has
-- resolved the customer from the caller's own session. Never let a client
-- call it directly — p_customer_id would be attacker-controlled.
revoke execute on function public.redeem_reward(uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.redeem_reward(uuid, uuid, uuid) to service_role;
