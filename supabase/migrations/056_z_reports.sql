-- ============================================================
-- Ayeka Bar — the daily Z report (end-of-day till closing slip).
--
-- ⚠️ NOT YET APPLIED. Apply after 051. Depends on 019/041 (public.staff).
--    Needs the owner's explicit go-ahead — see CLAUDE.md "Never apply a
--    Supabase migration without explicit, per-migration approval".
--
-- WHAT IT IS FOR. "Add a place in the Owner's dashboard for a Daily Z report
-- and give the Shift Manager or General manager that is set for the shift a
-- place in the Dashboard to upload the Z report … only allowed and only
-- showing after 23:00 Israeli time" (owner, 2026-10-13).
--
--   • the shift/general manager photographs or scans the till's Z slip and
--     uploads it from /staff/z-report (POST /api/zreport);
--   • the owner reads the archive at /owner/z-reports.
--
-- The 23:00 gate, the business-day rollover and "who is set for the shift" are
-- all enforced by the API route against the SERVER's clock
-- (src/lib/zreport/rules.ts, pinned by scripts/check-presence.mjs). They are
-- deliberately NOT triggers here: the rule is a business judgement the owner
-- may change (strict 23:00–23:59 vs. 23:00–06:00), and a constant in
-- rules.ts is a one-line change where a trigger is a migration.
--
-- ── SECURITY POSTURE (same shape as 048/050) ─────────────────────────
--   • RLS ON, ZERO POLICIES, and the table grants revoked from anon and
--     authenticated. The only doors are this app's service-role routes:
--     POST /api/zreport (a signed-in manager, window-gated) and
--     GET /api/owner/z-reports[/file] (requireOwner()).
--   • The storage bucket is PRIVATE and has NO storage.objects policies, so
--     nothing reaches a file through the Storage API with a user's token; the
--     owner's page streams it through the route, which re-checks OP.
--   • The bucket itself restricts size and MIME as a backstop to the route's
--     own magic-byte check. SVG and HTML are not in the list on purpose — a
--     script-capable file in a trusted admin origin is the one thing here
--     worth being strict about.
--
-- A CORRECTION IS A NEW ROW. Re-uploading for the same business date adds a
-- row and the newest one is "current"; the earlier file and its uploader
-- stay (the same append-only habit as waiter_order_events / shift_audit). No
-- update or delete path exists in the app.
--
-- RETENTION: none is automated, on purpose. A till's closing slip is an
-- accounting record; Israeli bookkeeping rules expect it kept for years, and
-- an automatic purge is the wrong default for a record the owner may need in
-- an audit. If the owner wants a retention window, decide it deliberately.
-- ============================================================

create table if not exists public.z_reports (
  id               uuid primary key default gen_random_uuid(),

  -- The BUSINESS day (Asia/Jerusalem) this slip closes. A night that runs past
  -- midnight is filed under the date it began — see zWindow() in rules.ts.
  business_date    date not null,

  uploaded_by      uuid references public.staff(id) on delete set null,
  -- Snapshotted, so removing someone from the roster later does not erase who
  -- filed the report (same trade shift_assignments.staff_name makes).
  uploaded_by_name text not null default '',
  uploaded_at      timestamptz not null default now(),

  -- Path inside the private 'z-reports' bucket: <business_date>/<uuid>.<ext>
  file_path        text not null unique
                   check (file_path ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'),
  -- ⚠️ ONE RULE SPELLED TWICE with Z_ALLOWED_MIME / Z_MAX_BYTES in
  -- src/lib/zreport/rules.ts.
  file_mime        text not null
                   check (file_mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  file_bytes       integer not null check (file_bytes > 0 and file_bytes <= 8388608),

  -- Optional, typed beside the file: the grand total printed on the slip, so
  -- the owner's list can show a number without opening every photo. A
  -- convenience, not a ledger — the FILE is the record. Integer agorot, like
  -- every money column in this database.
  total_agorot     integer check (total_agorot is null or (total_agorot >= 0 and total_agorot <= 100000000)),
  note             text not null default '' check (char_length(note) <= 500)
);

create index if not exists z_reports_date_idx
  on public.z_reports (business_date desc, uploaded_at desc);

comment on table public.z_reports is
  'One row per uploaded Z-report file. APPEND ONLY: a correction is a newer '
  'row for the same business_date. RLS on, no policies, grants revoked — '
  'service-role routes only. See src/lib/zreport/rules.ts.';

alter table public.z_reports enable row level security;
revoke all on table public.z_reports from anon, authenticated;

-- ---- The private bucket ----------------------------------------------------
-- on conflict: re-running this file must never flip the bucket public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'z-reports', 'z-reports', false, 8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
