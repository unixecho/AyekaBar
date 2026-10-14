-- ============================================================
-- Ayeka Bar — the PAYSLIP library (תלושי שכר): upload, view, download as a ZIP.
--
-- ⚠️ NOT YET APPLIED. Apply after 059 (or on its own — they are independent).
--    Depends on public.staff (002/006/041).
--    Needs the owner's explicit go-ahead — see CLAUDE.md "Never apply a
--    Supabase migration without explicit, per-migration approval".
--    Safe to apply early: until it is applied the pages show a calm "not set
--    up yet" state, and the staff dashboard's payslips tile stays locked.
--
-- WHAT IT IS FOR. "Implement a viewing port for watching payslips without
-- having to download them individually, also allow for multiple downloads at
-- once as a zip" (owner, 2026-10-14).
--
--   • the OWNER uploads payslips — one file per person per month, usually the
--     accountant's PDF — at /owner/payslips (several at a time), reads
--     everyone's in the in-page viewer, and downloads any selection as a ZIP;
--   • each EMPLOYEE reads only their own at /staff/payslips, the same viewer
--     and the same ZIP.
--
-- ── SECURITY POSTURE (the shape of 050/056/058 — this is more sensitive than
--    any of them: salary is the most private thing the bar holds about a
--    person) ──────────────────────────────────────────────────────────────
--   • RLS ON, ZERO POLICIES, table grants revoked from anon and authenticated.
--     The only doors are this app's service-role routes, and EVERY one of them
--     decides access with one pure function (canReadPayslip in
--     src/lib/payslips/rules.ts, pinned by scripts/check-payslips.mjs): the
--     OWNER (OP) reads any live payslip; anyone else reads only a live payslip
--     whose staff_id is THEIR OWN row, taken from the session — never from the
--     request.
--   • The storage bucket is PRIVATE and has NO storage.objects policies, so no
--     user's token reaches a file through the Storage API; files are streamed
--     by the routes, which re-check on every request. Size and MIME are
--     restricted at the bucket as a backstop to the routes' own magic-byte
--     check (PDF + JPEG/PNG/WebP — never SVG or HTML).
--   • EVERY read and write leaves a row in staff_payslip_events, which the
--     database refuses to change or delete (a trigger — the service role
--     bypasses RLS, so a policy alone would not stop it).
--   • staff_payslips.staff_id is ON DELETE RESTRICT: a person with payslips
--     cannot be hard-deleted. (The app only ever deactivates anyway.)
--
-- A PAYSLIP UPLOADED FOR THE WRONG PERSON is itself a privacy breach, so removal
-- is real: the row stays as a tombstone (who removed it, when) but the FILE is
-- deleted from the bucket. A correction is a NEW row — the same append-only
-- habit as the Z-report archive.
--
-- RETENTION: none is automated, on purpose. Payroll records are legally kept
-- for years and an automatic purge is the wrong default; the owner decides the
-- window deliberately. (A removed employee loses their own sign-in and with it
-- their access to their payslips — the owner can download a ZIP for them.)
-- ============================================================

create table if not exists public.staff_payslips (
  id               uuid primary key default gen_random_uuid(),

  staff_id         uuid not null references public.staff(id) on delete restrict,

  -- The MONTH the payslip is for, stored as the first of the month.
  period           date not null
                   check (extract(day from period) = 1
                          and period >= date '2000-01-01' and period <= date '2100-12-01'),

  -- Path inside the private 'payslips' bucket: <staff id>/<YYYY-MM>/<uuid>.<ext>
  -- ⚠️ ONE RULE SPELLED TWICE with payslipStoragePath() in src/lib/payslips/rules.ts.
  file_path        text not null unique
                   check (file_path ~ '^[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'),
  -- The uploaded file's own name, cleaned — shown in the owner's list and used
  -- nowhere security-relevant. ⚠️ PAYSLIP_NAME_MAX.
  file_name        text not null default '' check (char_length(file_name) <= 200),
  -- ⚠️ ONE RULE SPELLED TWICE with PAYSLIP_MIME / PAYSLIP_MAX_BYTES in rules.ts.
  file_mime        text not null
                   check (file_mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  file_bytes       integer not null check (file_bytes > 0 and file_bytes <= 8388608),

  uploaded_by      uuid references public.staff(id) on delete set null,
  -- Snapshotted, so removing someone from the roster does not erase who filed it.
  uploaded_by_name text not null default '',
  uploaded_at      timestamptz not null default now(),
  note             text not null default '' check (char_length(note) <= 300),

  -- When the EMPLOYEE first opened it (set by the route only for the owner of
  -- the payslip, never for the owner reading it). Lets the owner see "not yet seen".
  employee_first_viewed_at timestamptz,

  -- Removal = tombstone. The row stays; the file is deleted by the route.
  removed_at       timestamptz,
  removed_by       uuid references public.staff(id) on delete set null
);

create index if not exists staff_payslips_staff_idx
  on public.staff_payslips (staff_id, period desc) where removed_at is null;
create index if not exists staff_payslips_period_idx
  on public.staff_payslips (period desc, uploaded_at desc) where removed_at is null;

comment on table public.staff_payslips is
  'One row per uploaded payslip file (per person per month; several allowed — '
  'a correction is a newer row). RLS on, no policies, grants revoked — '
  'service-role routes only. Access rule: canReadPayslip() in '
  'src/lib/payslips/rules.ts. Removal deletes the file and keeps a tombstone.';

alter table public.staff_payslips enable row level security;
revoke all on table public.staff_payslips from anon, authenticated;

-- ---- the access log ---------------------------------------------------------
create table if not exists public.staff_payslip_events (
  id             bigint generated always as identity primary key,
  payslip_id     uuid not null references public.staff_payslips(id) on delete restrict,
  -- Who did it. Null only if that roster row is ever hard-deleted.
  actor_staff_id uuid references public.staff(id) on delete set null,
  kind           text not null check (kind in ('uploaded', 'viewed', 'downloaded', 'zipped', 'removed')),
  at             timestamptz not null default now()
);

create index if not exists staff_payslip_events_payslip_idx
  on public.staff_payslip_events (payslip_id, at desc);

comment on table public.staff_payslip_events is
  'Append-only access log for payslips: uploaded / viewed / downloaded / zipped / removed. '
  'A trigger refuses UPDATE and DELETE (the service role bypasses RLS, so a policy would not).';

alter table public.staff_payslip_events enable row level security;
revoke all on table public.staff_payslip_events from anon, authenticated;

create or replace function public._staff_payslip_events_append_only() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'staff_payslip_events is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists staff_payslip_events_no_change on public.staff_payslip_events;
create trigger staff_payslip_events_no_change
  before update or delete on public.staff_payslip_events
  for each row execute function public._staff_payslip_events_append_only();

revoke execute on function public._staff_payslip_events_append_only() from public, anon, authenticated;

-- ---- the private bucket ----------------------------------------------------
-- on conflict: re-running this file must never flip the bucket public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payslips', 'payslips', false, 8388608,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
