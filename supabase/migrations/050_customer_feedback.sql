-- ============================================================
-- Ayeka Bar — the customer feedback box (PLAN_CUSTOMER_FEEDBACK.md).
--
-- ⚠️ NOT YET APPLIED. Apply after 049. Depends on 001 (customers), 007
--    (app_settings), 045 (check_rate_limit — the API route in front of this
--    table calls it) and 047 (pg_cron, for the retention job at the bottom).
--
-- WHAT IT IS FOR. "an option for customers to give us feedback whether it's
-- for the business side or the technical-website part" (2026-09-01). One
-- table, written by a PUBLIC, UNAUTHENTICATED endpoint — which is the whole
-- point (a suggestion box behind a Google login collects nothing) and also
-- the reason every paragraph below is about containment.
--
-- ── SECURITY POSTURE, STATED ONCE ────────────────────────────────────
--   • RLS ON, ZERO POLICIES. Same shape as fraud_log, menu_audit,
--     point_adjustments, rate_limits and all four of migration 048's tables.
--     Nothing reaches these rows through PostgREST from any role, ever. The
--     only doors are this app's own service-role routes: POST /api/feedback
--     (public, rate-limited, validated) and GET/PATCH /api/owner/feedback
--     (requireOwner()).
--   • THE TABLE GRANTS ARE REVOKED TOO, not just left to RLS. Supabase's
--     default privileges hand `anon` and `authenticated` ALL on every new
--     table in `public`, so a table created here starts out granted-but-
--     RLS-blocked. That is one lock, not two. Revoking the grant means a
--     policy added later by accident — the realistic failure mode, since a
--     policy is the thing somebody adds while debugging — still cannot open
--     the table on its own. PLAYBOOK.md §1.5: default-deny, then open
--     exactly what is needed. Nothing here needs anything.
--   • NO SECURITY DEFINER FUNCTION IS ADDED FOR THE WRITE PATH. There is no
--     `submit_feedback()` for `anon` to call, because a function granted to
--     `anon` is an endpoint published to everyone holding the anon key —
--     which is every visitor — with no rate limiting in front of it. The
--     write goes through the app's own route so `checkRateLimit()` runs
--     first. Same reasoning migration 048 gives for keeping
--     `redeem_table_code` service-role-only.
--   • NO IP ADDRESS IS STORED. fraud_log keeps one because it exists to
--     investigate abuse of a points system; a suggestion box does not. The
--     rate limiter needs the IP, and it already has it — hashed into a
--     `rate_limits` key that ages out in a day (045). Storing it a second
--     time here would create a permanent record of who complained about
--     what, which is exactly the thing that makes people not complain.
--
-- ── THE COLUMN-LEVEL CHECKS ARE NOT DECORATION ───────────────────────
-- Every length/vocabulary rule below is ALSO enforced in
-- src/lib/feedback/types.ts and applied by src/lib/feedback/validate.ts,
-- which is what actually returns a useful message to a customer in their own
-- language. The SQL copy is the backstop for the case the app
-- layer is bypassed or a future route forgets — the same two-layer habit
-- PLAYBOOK.md §1 opens with. ⚠️ THEY ARE ONE RULE SPELLED TWICE: change
-- one, change the other. `scripts/check-feedback.mjs` asserts the TS
-- constants still say what this file says.
-- ============================================================

-- ---- 1. The table ----------------------------------------------------------

create table if not exists public.customer_feedback (
  id            uuid primary key default gen_random_uuid(),

  -- Two buckets, chosen by the customer before they type. They are not the
  -- same kind of problem and must not be triaged together: a slow pour is a
  -- service question for the floor, a broken button is a bug for whoever
  -- maintains the site.
  category      text not null check (category in ('business','technical')),

  -- MAX_MESSAGE_LEN / MIN_MESSAGE_LEN in src/lib/feedback/types.ts.
  message       text not null check (
                  length(message) between 2 and 1000
                ),

  -- Optional, and never asked for as a condition of submitting. 254 is the
  -- RFC 5321 maximum for a full address.
  contact_email text check (contact_email is null or length(contact_email) <= 254),

  -- WHICH PAGE THEY WERE ON — a same-origin PATH, never a full URL.
  -- "the menu is broken" is worth much more as "the menu is broken on
  -- /menu#cocktails". The app layer refuses anything that does not start
  -- with a single '/' precisely so this column can never hold an off-site
  -- destination that the owner might then click out of the inbox; the CHECK
  -- here repeats that rule rather than trusting the caller.
  page_url      text check (
                  page_url is null
                  or (page_url ~ '^/' and page_url !~ '^//' and length(page_url) <= 300)
                ),

  -- Set only when the visitor already happened to be signed in. `set null`,
  -- NOT cascade: if someone later deletes their loyalty account (a real,
  -- working flow — /api/customer/profile DELETE), the feedback should
  -- survive as anonymous input. The message was never "about" their account.
  -- Note this also means the delete flow needs no new code — auth.users →
  -- customers is ON DELETE CASCADE, and the cascade lands here as a null.
  customer_id   uuid references public.customers(id) on delete set null,

  status        text not null default 'new' check (status in ('new','read','resolved')),
  -- `on delete set null` rather than the plan's bare reference: without an
  -- action, deleting the auth user who resolved a row would be BLOCKED by
  -- this constraint. Attribution is worth keeping, but not at the price of
  -- making an account undeletable.
  resolved_by   uuid references auth.users(id) on delete set null,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- The inbox's default view, and the dashboard signal's count: unread first,
-- newest first. Partial, because 'new' is the only status either one asks
-- for and resolved rows accumulate forever.
create index if not exists customer_feedback_new_idx
  on public.customer_feedback (created_at desc)
  where status = 'new';

-- The full list, filtered by category or not.
create index if not exists customer_feedback_recent_idx
  on public.customer_feedback (created_at desc);

comment on table public.customer_feedback is
  'Customer suggestions and bug reports from the portal. Written by a public '
  'unauthenticated endpoint (POST /api/feedback, rate-limited); read only by '
  'the owner inbox. RLS on, no policies, no table grants — service role only. '
  'No IP is stored on purpose. See PLAN_CUSTOMER_FEEDBACK.md.';

-- ---- 2. RLS on, no policies, and the grants revoked as well ----------------

alter table public.customer_feedback enable row level security;

-- Belt AND braces — see the posture note at the top for why the grant is
-- revoked rather than left to RLS alone. PUBLIC is named explicitly out of
-- habit learned in migration 044, even though tables (unlike functions) get
-- no implicit PUBLIC grant.
revoke all on public.customer_feedback from public, anon, authenticated;

-- ---- 3. Retention ----------------------------------------------------------
-- PLAYBOOK.md §1.4: a table holding personal data gets a retention decision
-- at design time, not "later". Two different windows, because the row holds
-- two different kinds of thing — the same split migration 046 makes between
-- visit_logs.device_info and fraud_log:
--
--   • contact_email is the identifying part, and it is useful for exactly as
--     long as the owner might still reply. After that it is a stored email
--     address with no purpose, so it is CLEARED while the feedback itself
--     stays readable.
--   • The feedback itself is business content the owner may legitimately want
--     to look back on — so it gets a longer window before deletion outright,
--     rather than being treated as a log.
--
-- Both are parameters so the numbers can change without touching the
-- function. The defaults (12 / 24 months) are a reasoned starting point, not
-- a legal citation — Amendment 13 requires a defined, followed retention
-- period, not a specific number of months.
create or replace function public.cleanup_customer_feedback(
  p_email_months  integer default 12,
  p_delete_months integer default 24
)
returns table (emails_cleared integer, rows_deleted integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cleared integer;
  v_deleted integer;
begin
  with cleared as (
    update public.customer_feedback
       set contact_email = null
     where contact_email is not null
       and created_at < now() - make_interval(months => p_email_months)
    returning 1
  )
  select count(*) into v_cleared from cleared;

  with gone as (
    delete from public.customer_feedback
     where created_at < now() - make_interval(months => p_delete_months)
    returning 1
  )
  select count(*) into v_deleted from gone;

  return query select v_cleared, v_deleted;
end;
$function$;

-- 044's lesson, applied from the start: PUBLIC explicitly, or the
-- anon/authenticated revoke is cosmetic.
revoke execute on function public.cleanup_customer_feedback(integer, integer)
  from public, anon, authenticated;

-- Its own nightly job rather than folding the call into 047's
-- 'nightly-log-cleanup' command: two jobs fail independently, and a
-- pg_cron command holding two statements makes "which half errored" a
-- question you have to go read cron.job_run_details to answer.
-- unschedule-then-schedule keeps this migration re-runnable.
select cron.unschedule(jobid) from cron.job where jobname = 'nightly-feedback-cleanup';
select cron.schedule(
  'nightly-feedback-cleanup',
  '15 3 * * *',
  $$select public.cleanup_customer_feedback();$$
);

-- ---- 4. The off switch -----------------------------------------------------
-- Not in the plan; added because the plan's §4 decision to ship WITHOUT a
-- CAPTCHA is only defensible if the owner has some lever other than "wait
-- for a deploy" when a spam script finds the endpoint. Rate limiting is the
-- security boundary; this is the operational one.
--
-- Public read (the signed-out portal decides whether to render the button)
-- and, like every other switch inserted by a migration here, only `is_public`
-- is touched on conflict — re-running this file can never turn a feature back
-- on behind the owner's back.
insert into public.app_settings (key, value, is_public) values
  ('customer_feedback_enabled', 'true'::jsonb, true)
on conflict (key) do update set is_public = true;
