-- ============================================================
-- Ayeka Bar — Menu audit log
-- Apply in Supabase SQL Editor after 013_menu_variants_happy_hour.sql.
--
-- "The menu changed" was previously answerable only as a timestamp
-- (menus.published_at). With more than one person holding admin rights, the
-- owner needs WHO — who saved a draft, who published it, who switched which
-- version is on show, and who set a Happy Hour and on what.
--
-- Append-only by construction: no update or delete policy exists, and writes
-- go through the service role from owner-gated API routes. An audit trail that
-- the audited party can edit is not an audit trail.
-- ============================================================

create table if not exists public.menu_audit (
  id          bigint generated always as identity primary key,
  -- Who. Kept as a snapshot (name + email at the time) rather than only a
  -- staff_id, so removing someone later doesn't erase the history of what
  -- they did.
  actor_id      uuid references auth.users(id) on delete set null,
  actor_name    text,
  actor_email   text,

  -- What happened.
  action      text not null check (action in (
    'menu.save',            -- draft saved
    'menu.publish',         -- draft -> published
    'variant.create',
    'variant.update',
    'variant.delete',
    'variant.activate',     -- which version customers see
    'happy_hour.update'     -- window / items / percentage
  )),

  -- Human-readable summary, already localized by the writer, e.g.
  -- "הפעיל את הגרסה: יום שישי" — so the dashboard never has to re-derive it.
  summary     text,
  -- Structured detail for anything the summary can't carry (percentages,
  -- category names, counts).
  detail      jsonb not null default '{}',

  created_at  timestamptz not null default now()
);

create index if not exists menu_audit_created_at_idx
  on public.menu_audit (created_at desc);

alter table public.menu_audit enable row level security;

-- No policies at all: the log is readable only through the owner-gated API on
-- the service role, and writable only the same way. Staff must not be able to
-- read who did what, and nobody may rewrite it.

comment on table public.menu_audit is
  'Append-only record of menu, version and Happy Hour changes. Service-role access only; surfaced via /api/owner/audit.';
