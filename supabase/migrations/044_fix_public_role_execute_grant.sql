-- Correction to 043, found by re-testing live immediately after applying it
-- (exactly the "check for regression always" discipline this round is
-- about) — two of the four functions were STILL callable by anon after
-- `revoke ... from anon, authenticated`, confirmed by an actual anon POST to
-- /rest/v1/rpc/award_points succeeding (got past the auth check to a
-- foreign-key error, meaning the function body ran) and one to
-- log_shift_audit returning 204 (inserted successfully).
--
-- Root cause: Postgres grants EXECUTE on a new function to the PUBLIC
-- pseudo-role automatically at CREATE FUNCTION time, unless that grant is
-- explicitly revoked. Every real Postgres role — including anon and
-- authenticated — implicitly inherits PUBLIC's privileges on top of
-- whatever it's individually granted or denied. award_points() and
-- log_shift_audit() were each created without ever revoking that default
-- PUBLIC grant, so revoking anon/authenticated's own grant in 043 changed
-- nothing: both roles still had EXECUTE via PUBLIC underneath it. Confirmed
-- via has_function_privilege('public', ...) = true for exactly these two,
-- and = false for set_default_variant/reap_expired_variants (043's revoke
-- worked correctly for those two, so — evidently — those two DID already
-- have their PUBLIC grant revoked from the outset, unlike these two).
--
-- Fix: explicitly revoke from PUBLIC as well. Re-running the anon/
-- authenticated revoke here too is a harmless no-op for the two that were
-- already correct — belt and suspenders, and it means this file is a
-- complete, standalone statement of the intended end state for all four,
-- not just a diff against 043.
revoke execute on function public.award_points(text, uuid, text)          from public, anon, authenticated;
revoke execute on function public.log_shift_audit(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.set_default_variant(uuid)               from public, anon, authenticated;
revoke execute on function public.reap_expired_variants(uuid)             from public, anon, authenticated;
