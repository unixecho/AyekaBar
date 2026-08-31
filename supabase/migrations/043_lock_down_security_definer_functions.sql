-- Follow-up to 042: swept every SECURITY DEFINER FUNCTION in the schema (not
-- just the views) for the same shape of bug — anon/authenticated able to
-- call something that trusts its input with no internal permission check,
-- when the only real caller is this app's own service-role backend.
--
-- Checked all 41 SECURITY DEFINER functions in public. Full pg_get_functiondef
-- read on each candidate. Result: four were reachable by anon/authenticated
-- with no legitimate reason to be — every real caller (grepped both repos'
-- .rpc(...) call sites) goes through a service-role client, or (for
-- log_shift_audit) is an internal call from inside another already-gated
-- SECURITY DEFINER function, which runs as that function's owner regardless
-- of log_shift_audit's own grants. Revoking anon/authenticated EXECUTE here
-- changes nothing about how the app actually calls any of these four — it
-- only closes the direct-RPC bypass around them. This is the same pattern
-- `apply_point_adjustment`, `redeem_reward` and `loyalty_overview` already
-- correctly used (they never had a public grant in the first place).
--
--  - award_points(p_token, p_customer_id, p_device_info): took the customer
--    to credit as a bare parameter with no check that the caller IS that
--    customer. Called only from src/app/api/loyalty/checkin/route.ts via
--    serviceClient — a direct anon call could award (or, via repeated
--    attempts, help fingerprint) another customer's account.
--  - set_default_variant(p_variant_id): took a menu-variant id with no
--    permission check at all — anyone could flip which version of the menu
--    is "live" for real customers. Called only from
--    src/app/api/owner/menu-variants/route.ts (requireMenuEditor) via
--    auth.service.
--  - reap_expired_variants(p_menu_id): same — no permission check. Lower
--    real-world impact (it only ever processes variants whose own timer has
--    already elapsed, so it can't be used to jump the gun on anything), but
--    no reason to leave it open either. Called only from the same
--    menu-variants route via auth.service.
--  - log_shift_audit(p_venue, p_action, p_summary, p_diff): no permission
--    check — anyone could insert fabricated rows into shift_audit, an
--    append-only table this codebase otherwise treats as a trustworthy
--    record (every other append-only table's own migration says "never add
--    an UPDATE or DELETE policy" for exactly this reason). Not called
--    directly by any client anywhere (confirmed: zero .rpc('log_shift_audit'
--    ...) call sites in src/); per src/lib/shifts/dispatch-write.ts's own
--    comment, it is only ever invoked from inside clear_schedule_week(),
--    copy_schedule_week(), decide_shift_swap(), publish_schedule_week() and
--    unpublish_schedule_week() — all five already gate on
--    is_schedule_manager() before reaching it.

revoke execute on function public.award_points(text, uuid, text)      from anon, authenticated;
revoke execute on function public.set_default_variant(uuid)           from anon, authenticated;
revoke execute on function public.reap_expired_variants(uuid)         from anon, authenticated;
revoke execute on function public.log_shift_audit(uuid, text, text, jsonb) from anon, authenticated;
