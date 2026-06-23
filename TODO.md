# TODO

## UI bug — category chip slider not centered as a group
`menu.html` — `.chips` (around line 181) / `centerChip()` (around line 597).

Reference of the wanted look: a competitor's chip row where the whole group of
category chips sits centered in the viewport when they all fit without
scrolling (screenshot supplied 2026-06-23, "sarcafe" example).

Root cause: `centerChip()` calls `scrollIntoView({inline:"center"})` on only
the *active* chip. When the chips overflow (Ayeka Bar has ~19 categories,
so they normally do) that's correct. But when a chip row is short enough to
fit the viewport with no scrolling, this still nudges just the active chip to
the exact center, leaving the other chips trailing to one side instead of the
whole row reading as a centered group — plus `.chips` always carries
`padding: 6px 50% 12px` (huge side padding reserved for scroll-to-edge), which
fights a clean centered layout when there's nothing to scroll.

Fix direction: after rendering chips, check
`chips.scrollWidth <= chips.clientWidth + 1`. If true, add a `.fits` class
that sets `justify-content: center` and overrides the 50% padding down to a
small fixed value (e.g. 14px), and skip the `scrollIntoView` call (nothing to
scroll). Keep the existing overflow behavior unchanged for the normal
(scrolling) case.

## Editor security / backend migration (Supabase)
Code is scaffolded (`supabase/schema.sql`, `supabase/seed.sql`, `config.js`,
`login.html`, updated `editor.html` + `menu.html`). Remaining manual steps to
go live:

1. Create a free Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Authentication -> Users -> add the bar owner's account (email + password,
   or just their email if relying on magic-link only).
4. Copy that user's UUID into `supabase/seed.sql` (`OWNER_USER_ID`), then run
   `supabase/seed.sql` to load the current Ayeka Bar menu as the initial
   draft/published content.
5. Fill in `config.js` with the project's URL + anon key (Project Settings ->
   API). These are safe to commit — they're not secrets, RLS does the real
   access control.
6. Add the agency's own account to the `admins` table if it should be able to
   edit menus on behalf of paying-extra customers.
7. Deploy (GitHub Pages still works — everything is static + client-side
   Supabase calls, no server needed). Test: log in at `login.html`, edit in
   `editor.html`, confirm "Publish" updates what `menu.html` shows.
8. Once confirmed working, the static fallback path in `menu.html` (loading
   `menu-data.js` if Supabase is unreachable) can stay as a safety net — no
   action needed there.
