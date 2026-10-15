-- 062 — a phone number on the staff row (2026-10-15).
--
-- WHY: the onboarding wizard (/join/<token>) now has a "details" step — first and last name, a phone number, a colour and an
-- emoji (owner's ask). Everything but the phone already has a column: `colour` and `initial` (migration 021, the person's
-- floor-map identity — the emoji is stored in `initial`) and `first_name` / `last_name`. This adds the phone.
--
-- WHAT IT DOES: one nullable text column and a format CHECK. Nothing else — no policy, no grant, no view, no function.
--   • Israeli local `0XXXXXXXX` / `0XXXXXXXXX`, or `+` followed by 8–15 digits. ⚠️ ONE RULE SPELLED TWICE with
--     PHONE_RE in src/lib/staff/profile.ts; scripts/check-profile.mjs compares the two.
--
-- WHO CAN READ IT: no one new. `staff` is read by a signed-in person only for their own row and by the owner through the
-- service role (/owner/staff shows it to OP); the public team view (`public_staff`, 011/012) and the diagnostic views select
-- explicit columns, so the phone is in none of them. A phone number is personal data held on our side: it belongs in the
-- privacy policy that is still to be written (HANDOFF — the owner's inputs).
--
-- SAFE TO APPLY EARLY / LATE: every code path that touches the phone degrades to "not saved yet" while the column is
-- missing (`profile` route probes for it), so the app works before and after. Rollback: `alter table public.staff drop
-- column phone;` (loses only the numbers entered since).

alter table public.staff add column if not exists phone text;

alter table public.staff drop constraint if exists staff_phone_format_check;
alter table public.staff
  add constraint staff_phone_format_check
  check (phone is null or phone ~ '^(0[0-9]{8,9}|\+[0-9]{8,15})$');

comment on column public.staff.phone is
  'The person''s own phone number, entered in the onboarding wizard. Israeli local 0XXXXXXXX(X) or +<8-15 digits>. Null = not given. Visible to the owner on /owner/staff only.';
