-- ============================================================
-- Ayeka Bar — correction to 048. APPLIED to production 2026-09-01.
--
-- Comment-only. It changes no behaviour, no schema and no grant; it fixes a
-- claim that was wrong in a security-relevant way, which is worth its own
-- migration precisely because the next person to read 048 would otherwise
-- inherit the wrong mental model.
--
-- FOUND BY EXERCISING THE FUNCTION, NOT BY RE-READING IT — the same
-- "verify, don't assume" discipline that produced 044.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────
-- 048 said the per-code `attempts` counter was "the whole defence" against
-- online guessing, and that raising an exception would have destroyed it.
-- The second half is true. The first half cannot be, and the structure makes
-- it obvious once a wrong guess is traced through:
--
--   redemption looks a code up by SHA-256 of its digits
--     → a WRONG code hashes to something that matches NO ROW
--       → there is no row whose counter could be incremented
--
-- So `attempts` only ever rises when the CORRECT code is supplied — which
-- happens once, after which the code is consumed. In practice the column is
-- always 0 or 1, and the five-attempt cap can essentially never fire from
-- brute force.
--
-- ── WHAT IS KEPT, AND WHY ────────────────────────────────────────────
-- The code is not wrong; the claim was. `attempts` and its cap stay exactly
-- as they are, because what they DO buy is real, just smaller than claimed:
-- they bound a REPLAY burst against a code that leaked (overheard across the
-- bar, photographed over a shoulder) inside its ten-minute window, and they
-- record that a code was used.
--
-- ── WHERE THE DEFENCE ACTUALLY LIVES ─────────────────────────────────
--   1. The 10-minute TTL and single use — the window is tiny.
--   2. Very few live codes at once (one per occupied table), so a random
--      six-digit guess has roughly a 1-in-200,000 chance of hitting anything.
--   3. checkRateLimit() on the route in front of this (10 per IP per 5 min).
--      This is the ONLY thing bounding a spray, and Phase 2 must not ship
--      without it.
--   4. Every submission is reviewed by a human before it becomes an order,
--      so the prize for winning that lottery is a pending row a waiter
--      rejects.
--
-- ⚠️ PHASE-2 REQUIREMENT, recorded so it is not rediscovered late: the route
-- must ALSO keep a GLOBAL failed-redemption counter (a second
-- check_rate_limit key, not per-IP), because a distributed sprayer defeats a
-- per-IP limit and per-code counting cannot substitute for it.
--
-- The TypeScript twin (`src/lib/cart/otp.ts`) carries the same correction.
-- ============================================================

comment on function public.redeem_table_code(text) is
  'Exchange six digits for a table session. SERVICE ROLE ONLY - call it from '
  'the app''s own route, behind checkRateLimit(), never from the browser. '
  'Returns ok/reason rather than raising, because raising would roll back the '
  'attempt counter. NOTE: that per-code counter bounds a REPLAY burst against '
  'a leaked code, NOT brute force - a wrong guess matches no row, so no '
  'counter can rise. Brute force is bounded by the 10-minute TTL, the tiny '
  'set of live codes, the route''s rate limit, and human review of every '
  'submission. See migration 049 for the full argument.';

comment on column public.waiter_table_codes.attempts is
  'Redemption attempts against THIS code. Rises only on a correct-but-'
  'unusable submission (expired, or a replay), because a wrong guess hashes '
  'to no row. Bounds a leaked-code replay burst; it is NOT a brute-force '
  'defence - see migration 049.';
