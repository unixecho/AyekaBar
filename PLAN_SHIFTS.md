# PLAN_SHIFTS.md — shift scheduling (prototype + decision record)

> **Read Part II first (bottom of this file, planned 2026-08-20).** It is the
> live plan: real data, owner-configurable shift types, a schedulable flag per
> staff member, warning-noise control, and packaging the module for a second
> customer. Part I below is the 2026-08-13 prototype and is still accurate as a
> description of what is currently deployed — it is superseded, not deleted,
> because Part II's decisions build directly on D1–D7.

**Status of Part I: prototype and plan only, 2026-08-13.** Nothing is committed, nothing
is deployed, and **no migration has been applied to any database — local or
production**. The prototype runs entirely on browser `localStorage`.

This is the open initiative `CLAUDE_CODEX_COLLABORATION.md` names ("Next
initiative: staff scheduling (prototype phase)"). Read that file's working
agreement and `STAFF_APP.md` before touching anything here.

---

## 1. What was built

| Surface | Route | Who |
|---|---|---|
| Manager: week builder, warnings, requests, settings, log | `/owner/schedule` | OP, general manager, delegates |
| Printable sheet | `/owner/schedule/print?week=YYYY-MM-DD` | same |
| Employee: published shifts, availability, swaps | `/staff/schedule` | any `public.staff` row |

Reachable from the owner dashboard (🗓️ סידור עבודה) and the staff dashboard
(🗓️ המשמרות שלי).

```
src/lib/shifts/          types · time · config · access · rules · store · adapter · mock · guard · i18n
src/components/shifts/   ShiftsProvider · ScheduleWorkspace · StaffWorkspace · WeekGrid · ShiftSheet
                         OnboardingFlow · ManagerPanel · RequestsPanel · WarningsPanel · AuditTrail
                         AvailabilityPortal · PrintView · SegmentedControl · SheetShell · NumberSlider
                         LangSwitch · shifts.css
src/app/owner/schedule/  page · loading · print/page
src/app/staff/schedule/  page
supabase/migrations/027_shift_scheduling.sql     ← written, NOT applied
scripts/check-shift-rules.mjs                    ← 90 logic checks, all passing
```

Touched outside the module, minimally: `src/middleware.ts` (two additive
lines), the two dashboards (one link each), `.claude/launch.json` (a second dev
config on port 3001).

---

## 2. Decisions

### D1 — It lives in this repo

`/owner/schedule` + `/staff/schedule`, not in `ayeka-staff`. The 2026-08-12
direction change cancelled merging the **waiter UI** into `/staff`, but kept
"this project owns the schema, `public.staff`, and the owner-side screens".
Scheduling is exactly that: it is a roster feature, and the roster is here.

### D2 — Who may run the schedule

```
OP  (role='owner' or badge='owner')
OR  badge = 'general_manager'
OR  staff.id ∈ shift_settings.schedule_managers
```

Johnathan's answer was *"that's the general manager's job until it's explicitly
given to the shift manager"*. So the badge rule stops at general manager, and
an **explicit per-person delegation list** carries the exception. Not a badge
rule, because "אחראי/ת משמרת" is a title several people hold and only some of
them should be drafting the week.

**The grant is stored in `shift_settings`, not as a `public.staff` column.**
`public.staff` is read by middleware (with an explicit column list), both
guards, the waiter app's `is_staff_client()` and `waiter_staff_directory`.
A new column there means all of them have to learn about scheduling, and a
`select('role, badge, schedule_manager')` shipped before its migration takes
the entire owner panel down. Keeping it in the venue's own settings confines
the blast radius and makes the grant per-venue for free.

Existing levels are **unchanged**: `isOp`, `canEditMenu`, `isStaff` and their
SQL twins are untouched. `canManageSchedule()` is additive, in
`src/lib/shifts/access.ts`, mirrored by `is_schedule_manager(venue)` in 027.
**Change those two together.**

### D3 — `venue_id` on the new tables only

Every new row carries `venue_id`; one venue is seeded (`ayeka-bar`); a second
bar is an `INSERT`. Existing tables are **not** retrofitted — `public.staff`
is shared with a second application and every auth guard, and widening it is a
risk this feature does not need to take. Cloning the module for another venue
is: copy `src/lib/shifts` + `src/components/shifts`, seed a `venues` row.

### D4 — Prototype on mock data, migration unapplied

The UI is real; the data is `localStorage`. One interface (`ShiftsDataSource`)
separates them, and `ACTION_ROUTES` in `adapter.ts` already names the server
surface each action will travel over.

### D5 — Wall-clock, not instants

A shift is `date + start + end` in local time. "22:00–02:00" is four hours to
everyone reading the sheet, including on the two nights a year Israel changes
its clocks; storing `timestamptz` would make one of those nights three hours
and the other five, and the rest engine would flag a violation nobody
committed. `shift_intervals` (SQL) mirrors `intervalOf()` (TS) exactly.

### D6 — Publishing copies, it does not flag

`schedule_weeks.published_snapshot` is a frozen JSONB copy; staff read it
through the `published_schedule` view and can never reach the draft rows (RLS
on `schedule_weeks` / `shifts` / `shift_assignments` is manager-only). Same
guarantee `menus.published` + `public_menus` give the menu. The check suite
asserts it directly: *"a later draft edit does not change what was published"*.

### D7 — The engine warns, it never blocks

Publishing a week with errors asks for confirmation and then does it. A tool
that refuses at 2am gets replaced by a WhatsApp photo of a whiteboard, which
is the thing this replaces.

---

## 3. Data model (migration 027, unapplied)

| Table | Holds |
|---|---|
| `venues` | slug, trilingual name, timezone, week start |
| `shift_settings` | working days, hours, presets/roles/stations (JSONB), safety, feature flags, `schedule_managers[]`, `onboarded_at` |
| `schedule_weeks` | one row per venue-week: status, version, day notes, `published_snapshot` |
| `shifts` | date + start/end, preset, station, `requirements` JSONB, note, generated `crosses_midnight` / `duration_minutes` |
| `shift_assignments` | shift × staff × role, `staff_name` snapshot, `assigned`/`swap_pending` |
| `shift_availability` | per staff per week, entries JSONB, draft/submitted |
| `shift_swaps` | assignment, from/to, `open → peer_accepted → approved\|rejected\|cancelled` |
| `shift_audit` | append-only: actor snapshot, action, summary, diff |

Views: `shift_intervals` (absolute minutes), `published_schedule` (what staff
read), `schedule_access_levels` (diagnostic, twin of `staff_access_levels`).

RPCs — the four operations that must be one transaction, for the reason
migration 008 exists: `publish_schedule_week`, `unpublish_schedule_week`,
`copy_schedule_week`, `clear_schedule_week`, `decide_shift_swap`.

**Presets/roles/stations are JSONB, not tables.** Short ordered lists, always
read together, always rewritten whole, never joined — the same call
`public.menus` makes about categories and items.

**`shift_assignments.staff_id` is nullable with `on delete set null` plus a
`staff_name` snapshot.** The owner can remove someone at `/owner/dashboard`;
that must not fail with a foreign-key error, nor silently erase who worked last
Friday. Same trade `menu_audit` makes for its actor.

---

## 4. The rules engine

`src/lib/shifts/rules.ts` — one pure function, `evaluate(snapshot) → Warning[]`.
No clock, no network, no React, which is why the same code runs in the builder
on every keystroke and in `scripts/check-shift-rules.mjs`.

| Code | Severity | Fires when |
|---|---|---|
| `overlap` | error | one person on two intersecting shifts |
| `duplicate` | error | same person twice on one shift |
| `min_rest` | error | gap < `minRestHours` — the clopening guard |
| `max_weekly_hours` | error | over the configured week cap |
| `missing_role` | error | fewer than `min` of a required role |
| `inactive_staff` | error | assignment references someone off the roster |
| `max_daily_hours` | warn | single shift over the cap |
| `max_consecutive_days` | warn | too many days in a row |
| `over_role_max` | warn | more than `max` of a role |
| `unassigned_shift` | warn | nobody on it at all |
| `unavailable` / `partial_conflict` | warn | contradicts a submitted availability (flag-gated) |
| `non_working_day` | warn | on a day the venue is closed |
| `outside_hours` | info | outside the advertised operating window |

Two properties worth keeping:

- **Cross-week rest.** The snapshot carries `neighbouring` shifts from the
  weeks either side, so a Saturday close → Sunday open is caught. Those shifts
  feed rest and overlap only — counting them toward the weekly quota would bill
  Sunday for last week's Saturday. Both are asserted in the suite.
- **Nothing is hard-coded.** Every threshold comes from `settings.safety`.

---

## 5. Feature flags

Both **off** for Ayeka Bar, per the brief, stored per venue (not env vars) so a
second venue can differ and the manager can flip one without a deploy — how
`app_settings.loyalty_enabled` already works.

- `ENABLE_AVAILABILITY_SUBMISSIONS` — the employee submission portal, and the
  manager's read of it. Off ⇒ the rules engine ignores availability entirely.
- `ENABLE_SHIFT_SWAPS` — peer-to-peer offers plus manager approval. Off ⇒ no
  swap affordances anywhere.

With a flag off the panel still shows the feature with an `OFF` chip and says
where the switch is, rather than vanishing.

**Notifications: none, by design.** No Resend, no Twilio, no email. Publishing
updates the live view and that is the whole delivery mechanism.

---

## 6. Print / PDF

`/owner/schedule/print` renders the same `WeekGrid` component as the screen —
one renderer, so the paper cannot disagree with the app, and the paper is what
gets taped to the wall. `shifts.css` inverts it to ink-on-white, forces seven
columns in A4 landscape, prevents a day breaking across pages, keeps the
identity colours with `print-color-adjust`, and hides everything marked
`.sh-noprint`.

**A draft prints with a boxed "טיוטה" stamp.** A printed draft that looks like
a printed schedule is the most dangerous artefact this system could produce.

**No PDF library.** The browser's own print-to-PDF is smaller, sharper,
selectable, already lays out Hebrew, and costs zero kilobytes.

---

## 7. What the prototype does NOT do

1. **No server writes.** Everything is `localStorage`. Closing the tab in a
   different browser shows a different schedule.
2. **The server gate is coarse.** `requireScheduleViewer()` currently checks
   "is on the roster"; the manage-vs-view split is computed client-side because
   `shift_settings` does not exist yet. **This is the one line that must change
   when 027 lands** — it is marked in `src/lib/shifts/guard.ts`.
3. **No API routes.** `ACTION_ROUTES` names them; none are written.
4. **Preset times are edited through the setup flow**, not inline in the panel.
5. **Availability is submitted for one week at a time** (the week after the one
   on screen), not an open horizon.
6. **The "view as" picker on `/staff/schedule`** is a prototype affordance —
   the signed-in account is not in the demo roster. It disappears with the mock.

---

## 8. Rollout, when approved

1. Apply **027 to the local stack only**. Run `scripts/check-isolation.mjs` —
   the staff app must still be unable to touch anything new.
2. Run the verification block at the foot of 027 **as an ordinary staff member**:
   `shifts` and `schedule_weeks` must return **zero rows**, `published_schedule`
   must return the published week.
3. Write `/api/shifts/*` per `ACTION_ROUTES`, each guarded by a schedule-manager
   check — never a bare `getUser()`. The five atomic operations call their RPC.
4. Write `SupabaseShiftsSource implements ShiftsDataSource`; swap the one line
   in `ShiftsProvider`. Delete nothing — the mock stays useful for demos.
5. Tighten `requireScheduleViewer()` (gap #2 above).
6. Seed real presets/roles/stations with the owner in the room, through the
   onboarding flow, on the local stack first.
7. Only then: apply 027 to production, deploy, and have the GM build one week
   in parallel with the WhatsApp image for a fortnight before dropping it.

**Reversal:** the module is additive. Dropping the eight tables and the two
middleware lines removes it completely; nothing existing depends on it.

---

## 9. Acceptance criteria

- [ ] A GM who is not OP can reach `/owner/schedule`; a bartender cannot draft.
- [ ] A delegated shift manager can; revoking the grant takes it away.
- [ ] Draft edits are invisible at `/staff/schedule` until Publish.
- [ ] Re-publishing bumps the version; staff see the new one.
- [ ] Every rule in §4 fires and is clickable through to its shift.
- [ ] Publishing with errors asks first, then proceeds.
- [ ] Hebrew RTL, English LTR, Arabic RTL all render; day columns start Sunday
      on the correct side in each.
- [ ] 375 px and 1280 px both work; no horizontal page scroll.
- [ ] The printed sheet is legible in greyscale and fits one A4 landscape page.
- [ ] Every mutation appears in the log with actor, time and a diff.
- [ ] `prefers-reduced-motion` disables the transitions.

### Edge cases already handled

Overnight shifts · a shift crossing the week boundary · two shifts in one day
counting as one day worked · a removed employee still on a published week ·
deleting a shift that has an open swap (cancels it) · approving a swap nobody
accepted (refused) · copy-week onto a half-built week (replaces, not merges) ·
a blank day note (removes the key) · re-saving an unchanged value (no audit
line) · a corrupt `localStorage` blob (reseeds rather than crashing).

### Still open

- What happens to a published week when the owner deletes a staff member —
  the snapshot keeps the name, but should the manager be told? Currently the
  live draft warns (`inactive_staff`); the published snapshot does not.
- Should a delegate be able to publish, or only draft? Currently: publish.
- Availability horizon: one week ahead is arbitrary. Ask the GM.

---

## 10. Verification performed (2026-08-13)

- `node scripts/check-shift-rules.mjs` → **90/90**. Runs the real TypeScript
  sources through the compiler already in `node_modules`; no copied logic.
- `npm run build` → clean, and reports **`ƒ Middleware`**.
- Clicked through on the local stack signed in as `gm@local.test` (a general
  manager, **not** OP — which is the access decision under test): onboarding →
  builder → publish-with-errors → `/staff/schedule` → print.
- Hebrew RTL and English LTR both checked; `dir` flips, day columns and
  chevrons mirror, no horizontal page scroll in either.
- 375 px and desktop both checked. The tab strip scrolls on a phone rather than
  truncating — the ellipsis was eating the warning count.
- Browser console: no errors.
- **Not verified:** the print stylesheet at pixel level (no print emulation
  available here) — structure and rules reviewed, but print one page before
  trusting it.

---
---

# Part II — from prototype to live (planned 2026-08-20)

**Status: plan approved in outline, not yet built.** Part I above describes the
localStorage prototype as shipped 2026-08-13. This part is the design record
for taking it to real data, making it fully configurable by the owner, and
making it a module that can be sold and deployed to a second customer.

Four forks were settled with the owner before planning (2026-08-20):

| Fork | Decision |
|---|---|
| Where "schedulable" lives | A new scheduler-owned `schedule_members` table. `public.staff` is not touched. |
| "A part of the shift for prep / for closing" | Named, renameable **shift types** (what Part I calls presets) — not sub-segments inside one shift. |
| Zero schedulable staff | Warn loudly, never block. Consistent with D7. |
| Migration rollout | Local stack first, then production with separate explicit approval. |

---

## 11. What is actually wrong today

Five concrete gaps between the prototype and what the owner asked for. Each
maps to a phase in section 18.

1. **Shift types cannot be renamed or added.** `OnboardingFlow`'s preset step
   only lets you *delete* a preset and edit its start/end; `ManagerPanel` shows
   presets read-only with the line "to change preset times, re-run setup".
   Roles are a fixed toggle list off `DEFAULT_ROLES` — no rename, no add, no
   custom role. Stations can be added but only with a single-language name.
   A bar that wants "פתיחה", "צהריים" and "סגירה" cannot express that.
2. **The scheduler sees every staff row.** `/api/shifts/staff` returns the
   whole of `public.staff` and marks all of it `active: true`. There is no way
   to say "this person is on the payroll but is not someone I roster".
3. **Nothing is written to a server.** `MockShiftsSource` is hard-wired into
   `ShiftsProvider`; migration 027 has never been applied; no `/api/shifts/*`
   route exists beyond the roster read.
4. **Warnings are a flat list.** `WarningsPanel` renders every `Warning` as its
   own row, including the `info` tier. A half-built week produces dozens.
   There is no grouping, no dismissal, and no way for a venue to say "I do not
   care about `outside_hours`".
5. **Ayeka-specific values are compiled in.** `AYEKA_VENUE` is a constant in
   `config.ts` and `DEFAULT_ROLES` names one bar's jobs. Fine for one venue,
   wrong for a product.

---

## 12. Decisions added in Part II

### D8 — `schedule_members` is the scheduler's own projection of the roster

```sql
create table public.schedule_members (
  venue_id         uuid not null references public.venues(id) on delete cascade,
  staff_id         uuid not null references public.staff(id)  on delete cascade,
  schedulable      boolean not null default true,
  default_role_id  text,        -- key into settings.roles; pre-selects the picker
  max_weekly_hours integer,     -- null = use the venue-wide safety cap
  employment_type  text not null default 'regular',
  sort_order       integer,
  note             text not null default '',
  added_at         timestamptz not null default now(),
  added_by         uuid references auth.users(id) on delete set null,
  primary key (venue_id, staff_id)
);
```

**No row means not schedulable.** That is what makes "it starts at zero" true
without a data migration, and it is why the toggle is an upsert rather than an
update. Toggling someone *off* sets `schedulable = false` rather than deleting
the row, so their per-person configuration survives a seasonal absence.

Why a table and not `public.staff.schedulable`: `public.staff` is read by
middleware with an explicit column list, by both guards, by `is_staff_client()`
and by `waiter_staff_directory` in the other application (see `STAFF_APP.md`).
The same reasoning that put `schedule_managers` in `shift_settings` (D2) puts
this here. It also keeps the module a **drop-in**: installing the scheduler in
another project requires no change to that project's staff table.

Why a table and not a `uuid[]` in `shift_settings`: an array carries exactly one
bit per person. `default_role_id` and `max_weekly_hours` are the next two things
any venue running this for a month will ask for, and the assignment picker wants
the first one immediately.

### D9 — the roster is read through a view, not a service-role route

`schedule_roster` — a view joining `public.staff` to `schedule_members`,
exposing only display-safe columns. Exactly the construction migration 025
used for `waiter_staff_directory`, and for the same reason: RLS on
`public.staff` lets a user read only their own row, so nobody else can
otherwise see the team at all.

**Revised during phase 2** (2026-08-20): gated by `is_staff_client()` — any
signed-in staff member — not `is_schedule_manager()` as first written above.
Building `/api/shifts/state` surfaced a real need this decision hadn't
accounted for: a plain staff member's own client needs a colleague's name and
colour to render a published shift or a swap offer, which `is_staff_client()`
already gates identically for `venues_read`/`shift_settings_read` — "who's on
the team" is ordinary staff-visible information, the same class as the public
`/team` page. The privileged surface stays the WRITE
(`schedule_members_manage`, still manager-only) and the columns stop at
name/colour/badge/schedulability — no email, no `auth_user_id`.

This retires the service-role read in the live path. `/api/shifts/staff` stays,
unchanged, serving the mock/demo source only, and is marked as such.

### D10 — two API routes, not eighteen

`ACTION_ROUTES` in `adapter.ts` names a REST surface per action. Building
eighteen route files to serve an interface with exactly two methods (`load` and
`dispatch`) is ceremony. Instead:

```
GET  /api/shifts/state      -> the whole ShiftsDB the manager needs
POST /api/shifts/dispatch   -> one ScheduleAction, returns the new ShiftsDB
```

`dispatch` switches on `action.type`: the five atomic operations call their SQL
function (`publish_schedule_week`, `unpublish_schedule_week`,
`copy_schedule_week`, `clear_schedule_week`, `decide_shift_swap` — unchanged
from 027, and still the reason those functions exist), everything else is a
guarded table write plus an audit line.

`ACTION_ROUTES` is **kept** and retargeted: it stops naming a path per action
and starts naming, per action, which RPC carries it and whether it is
manager-only. The compiler-checked exhaustiveness — the actual value of that
table — is preserved. Adding an action still cannot be done quietly.

`state` returns the current week ±1, the published-week index, settings, the
roster and the most recent 100 audit rows. Not all history: audit paginates
separately once it matters.

### D11 — the rules engine gains a per-venue severity map, and dismissals

The owner's constraint was "warnings are fine but we can't spam the manager".
Three mechanisms, in order of bluntness:

1. **`settings.ruleSeverity: Partial<Record<WarningCode, Severity | 'off'>>`** —
   a venue-level override applied as the last step of `evaluate()`. A venue that
   legitimately runs outside its advertised hours sets `outside_hours: 'off'`
   and never sees it again. Pure, testable, and it is the real lever: it is
   configuration, not a UI trick.
2. **Grouping in the panel.** `WarningsPanel` groups by `code`. Errors expand by
   default; `warn` collapses to a counted header; `info` sits behind a "show
   all" disclosure. The week grid marks only errors on the shift chip.
3. **Per-warning dismissal.** `schedule_weeks.dismissed_warnings jsonb` — an
   array of `Warning.id`. Ids are already stable across recomputes, which is
   what makes this safe: a dismissal evaporates on its own the moment the
   underlying problem changes shape, and it is shared between co-managers
   rather than living in one browser.

Publishing continues to ask for confirmation, but the confirmation lists
**errors individually and warnings as a count**. That is the difference between
a dialog that is read and one that is dismissed.

### D12 — deleting a catalog entry never breaks a week

`shift_assignments.role_id` and `shifts.preset_id` / `station_id` are free-text
keys into JSONB arrays, so deleting a role can orphan them. Rather than
cascade-deleting people off shifts:

- `evaluate()` gains **`unknown_role`** (severity `warn`): an assignment
  referencing a role the venue no longer defines.
- The UI renders an orphaned id as a neutral grey "תפקיד שהוסר" chip — legible,
  not a crash and not a blank.
- The delete `ConfirmSheet` states exactly how many shifts and assignments
  reference the thing being deleted, before it is deleted.

The same trade `shift_assignments.staff_id`'s nullability already makes (Part I
section 3): history is preserved, the tool warns, nothing errors.

### D13 — the venue comes from the database

`AYEKA_VENUE` in `config.ts` stops being the source of truth and becomes what
`defaultSettings()` already is: a seed used once when a venue row is created.
The live source reads `venues` and threads the row through, which is what every
type in the module already expects (`venueId` is on every interface). This is
the last compiled-in Ayeka fact and it is the one that blocks resale.

### D14 — the "view as" picker on /staff/schedule dies with the mock

Part I section 7 item 6 flagged it as a prototype affordance. Once the source is
real the signed-in account **is** on the roster, and a picker letting any staff
member view the schedule as a colleague is a privacy defect rather than a
convenience. Removed, not hidden behind a flag.

---

## 13. Schema — revising 027 rather than adding 041

Migration 027 has **never been applied to any database**. Adding a second
migration to patch an unapplied one produces a history describing a state that
never existed. So 027 is revised in place, with a dated header note, and applied
once.

Added to 027:

| Object | Purpose |
|---|---|
| `schedule_members` (table) | D8 — who is schedulable, plus per-person scheduling config |
| `schedule_roster` (view) | D9 — staff read of staff x membership (revised phase 2: any staff, not manager-only — see D9) |
| `schedule_weeks.dismissed_warnings` (column) | D11 — shared warning dismissals |
| `shift_settings.rule_severity` (column, jsonb) | D11 — per-venue severity overrides |
| `published_schedule.id`, `.published_by` (columns, added) | phase 2 — needed to reconstruct a `PublishedWeek`'s `weekId` from a snapshot row |
| `set_schedule_member()` (function) | phase 3 — the sixth atomic RPC: upserts one `schedule_members` row and logs it, the same check+write+audit shape as the original five (§4 below), added because `shift_audit` has no INSERT policy for a plain authenticated write |
| RLS on `schedule_members` | managers full; a person may read their own row |

Unchanged from the reviewed 027: every existing table, both access functions,
all five original RPCs, `shift_intervals`,
`schedule_access_levels`. Nothing in `public.staff` is altered — still the
contract `STAFF_APP.md` sets.

---

## 14. The catalog editors (the "comprehensive management tool")

One new component, `CatalogEditor.tsx`, mounted in `ManagerPanel` and reused by
`OnboardingFlow` so setup and permanent editing are literally the same control —
the divergence between them is the bug being fixed.

Three catalogs, one interaction model each:

**Shift types** (`settings.presets`) — add, rename, delete, reorder. Per type:
trilingual name, start/end via the existing `TimeWheel`, colour from `ACCENTS`,
optional default station, and a **requirements editor** (role, min, optional
max) which today is only reachable per-shift. A "closing" type is a shift type
running 02:00-04:00; a "prep" type is one running 10:00-12:00. Nothing in the
model needs to know which is which.

**Roles** (`settings.roles`) — add, rename, delete, reorder, emoji, colour, and
an optional link to an existing `BadgeKey` so assigning someone can suggest the
job title they already hold. The fixed `DEFAULT_ROLES` toggle list becomes a
"start from these" affordance during onboarding only.

**Stations** (`settings.stations`) — add, rename (trilingual, replacing today's
single-language text field), delete, reorder, emoji, and the role restriction
that already exists in the type but has no UI.

Supporting piece: **`TriField.tsx`** — one labelled input per language, Hebrew
required and en/ar optional, showing the `he -> en -> ar` fallback inline so an
owner who fills in only Hebrew can see exactly what an English reader will get.
This is the control that makes "each owner will want to call it differently"
real, and it is reusable anywhere the app edits a `Tri`.

Reordering is up/down buttons rather than drag-and-drop: the floor builder
already owns the drag interaction on a `touch-action: none` canvas, and a list
inside a scrolling settings panel on a phone is the worst possible place for a
second one.

---

## 15. Roster and schedulability

**In `/owner/schedule` -> settings tab**, the current delegation section is
replaced by a `RosterPanel` with two distinct switches per person:

| Switch | Question it answers | Who may flip it |
|---|---|---|
| **בסידור** (schedulable) | Does this person appear in the scheduler at all? | any schedule manager |
| **מנהל/ת סידור** (delegate) | May this person draft and publish? | OP or GM only (`canDelegateSchedule`) |

The list is the **whole** of `public.staff`, read live through `schedule_roster`,
including pending invites — someone authorized by email who has not signed in
yet is exactly who you want to roster before their first shift. OP and the
general manager show the delegate switch on-and-locked, so the list answers "who
can do this?" completely rather than listing only the exceptions; that is
behaviour the current panel already gets right and it is kept.

**Auto-updating**, as asked: the roster re-fetches on window focus and on a
30-second interval while the settings tab is open — the same polling shape
`MenuView` already uses for the publish stamp, one house pattern rather than a
new one. A staff member added at `/owner/dashboard` in another tab appears here
without a reload.

**In `/owner/dashboard` -> StaffManager**, each member row gains one switch,
"זמין/ה לסידור עבודה", writing through the same dispatch action. It is
deliberately a *scheduler* write and not a `staff` PATCH — which is what keeps
the audit line in `shift_audit`, where the rest of the scheduling history lives.

**With zero schedulable staff** (the state this launches in): the week grid
renders an empty state naming the problem and linking to the roster panel; the
assignment picker says so rather than opening empty; the warnings panel raises
one `unassigned_shift` per shift as it already does; and the publish
confirmation says how many shifts have nobody on them. Nothing is blocked
(D7, reaffirmed).

---

## 16. Portability — what "deploy it for another customer" requires

The module is already venue-scoped and self-contained: its own stylesheet, its
own i18n, and no imports from outside `src/lib/shifts` + `src/components/shifts`
except `@/lib/menu/types`, `@/lib/staff/access`, `@/lib/staff/badges` and four
shared UI primitives. Part II closes the remaining gaps:

1. **D13** removes the last compiled-in venue.
2. The catalog editors mean a new customer configures their own shift types,
   roles and stations through the UI — no code edit, no seed script.
3. `settings.ruleSeverity` means a new customer tunes the warning tier to their
   own tolerance without a deploy.
4. **`SCHEDULER.md`** — a new document written at the end of this work, and the
   actual deliverable for resale:
   - What the module is, and what it deliberately does not do (no notifications,
     no payroll export, no clock-in — that is the OMS's shift session).
   - The exact file list to copy, and the five integration points: a staff
     identity table, an auth guard, a design-token set, an i18n language list,
     and where the two routes mount.
   - The DB objects it creates, and the one assumption it makes about the host
     schema: `public.staff(id, auth_user_id, role, badge, ...)`.
   - A configuration reference: every field of `ShiftSettings`, what it does,
     what it defaults to, and which UI control edits it.
   - An install checklist and a rebranding checklist.
   - The reversal procedure (drop the tables, remove two middleware lines).

`PLAN_SHIFTS.md` stays the *decision* record — why things are the way they are.
`SCHEDULER.md` is the *operating manual* — how to install and run it elsewhere.
Two documents because they have two audiences and two lifespans.

---

## 17. Files

**New — built in phase 2 (2026-08-20), see §22**

```
src/app/api/shifts/state/route.ts        GET  - windowed ShiftsDB, RLS narrows per caller
src/app/api/shifts/dispatch/route.ts     POST - one ScheduleAction, re-reads after writing
src/lib/shifts/supabase-source.ts        SupabaseShiftsSource — thin browser fetch wrapper
src/lib/shifts/state-query.ts            server-only: the actual Supabase reads (loadShiftsState)
src/lib/shifts/dispatch-write.ts         server-only: the actual Supabase writes (performDispatch)
src/lib/shifts/serialize.ts              row <-> domain, one place, both directions
```
Split three ways rather than the two files originally sketched here: the
browser never talks to Supabase directly for this module (D9/D6's whole point
is that the security model lives in Postgres, reached only through routes
this repo controls), so the fetch wrapper (`supabase-source.ts`, bundled to
the client) and the actual querying (`state-query.ts`/`dispatch-write.ts`,
server-only, imported by the two route files) had to be different files.

**New — built in phase 3 (2026-08-20), see §23**

```
src/components/shifts/RosterPanel.tsx    schedulable + delegate switches, live-polling
src/app/api/shifts/roster/route.ts       GET  - lightweight unwindowed roster read
src/app/api/shifts/member/route.ts       POST - one member.update, for callers with no ShiftsDB
```
Two extra routes beyond D10's original two, both narrowly scoped: `roster`
exists because `StaffManager.tsx` (on `/owner/dashboard`) has no
`<ShiftsProvider>` and needs a schedulable read that isn't windowed by week;
`member` exists for the same component's write, for the same reason —
`/api/shifts/dispatch` always re-reads a 3-week window afterward, which a
component with no week in view has nowhere to put. Both call the exact same
`performDispatch()`/`schedule_roster` code the main routes use — no second
write or read path, just a different entry point for a caller outside the
schedule surfaces.

**New — built in phase 4 (2026-08-20), see §24**

```
src/components/shifts/TriField.tsx       trilingual name input, he required, en/ar optional,
                                          commits on blur (not per keystroke), fallback preview
src/components/shifts/CatalogEditor.tsx  PresetCatalog / RoleCatalog / StationCatalog — three
                                          named exports, one `{settings, onChange}` contract,
                                          mounted in both ManagerPanel and OnboardingFlow
```

**Still to build**

```
SCHEDULER.md                             the portable-module manual
```

**Modified**

```
supabase/migrations/027_shift_scheduling.sql   revised in place (section 13) — DONE, phase 1-3
src/lib/shifts/types.ts       ScheduleMember, ruleSeverity, dismissedWarnings — DONE
src/lib/shifts/config.ts      defaultSettings() carries ruleSeverity — DONE; venue-from-DB
                               done in guard.ts/state-query.ts, AYEKA_VENUE itself not yet removed
src/lib/shifts/adapter.ts     ACTION_ROUTES retargeted (D10) — DONE; member.update + refresh() added
src/lib/shifts/guard.ts       requireScheduleManager() + requireScheduleApi() — DONE
src/lib/shifts/mock.ts        load(weekStart?) signature parity — DONE; refresh() added
src/lib/shifts/store.ts       member.update action + reducer case — DONE; catalog fields go
                               through the existing settings.update action, no new action
                               type needed for catalogs; warning.dismiss action added — DONE
src/lib/shifts/serialize.ts   rowToRosterStaff/rowToScheduleMember — DONE (phase 2)
src/lib/shifts/dispatch-write.ts  member.update (set_schedule_member RPC) — DONE (phase 3);
                                   warning.dismiss (plain read-modify-write, same shape as
                                   note.day) — DONE
src/lib/shifts/rules.ts       unknown_role — DONE (phase 4); ruleSeverity override, applied
                               once as the last step of evaluate() — DONE. "schedulable
                               filter" needed no change — the existing inactive_staff check
                               already reads person.active, which already means schedulable
                               (D8) — see section 23's note
src/components/shifts/ShiftsProvider.tsx  real source wired, ?demo=1 fallback, refresh() — DONE
src/components/shifts/ManagerPanel.tsx    delegation section replaced by <RosterPanel/>,
                                           read-only presets replaced by the three catalog
                                           editors (phase 3/4) — DONE; new "warning
                                           sensitivity" section, one switch per WarningCode,
                                           writing settings.ruleSeverity — DONE
src/components/shifts/OnboardingFlow.tsx  presets/team steps reuse the same three catalog
                                           editors, role quick-toggle kept above RoleCatalog
                                           as the "start from these" affordance — DONE
src/components/shifts/ShiftSheet.tsx      orphaned-role fallback in the requirements section —
                                           DONE (a real gap found while building D12: an
                                           assignment referencing a deleted role was rendering
                                           nowhere at all, not as a "removed" chip)
src/components/StaffManager.tsx           one schedulable switch per row — DONE
src/app/owner/schedule/page.tsx           requireScheduleManager() — DONE
src/app/api/shifts/staff/route.ts         marked demo-only (D9) — DONE
src/lib/shifts/i18n.ts        roster + catalog-editor strings — DONE; WARNING_LABELS (one
                               generic Tri per WarningCode, for group headers and the
                               severity panel) + warnings-panel/dismiss/publish-gate
                               strings + AUDIT_LABELS['member.update'/'warning.dismiss'] —
                               DONE
scripts/check-shift-rules.mjs "Roster (member.update)" (8), unknown_role (3, phase 4),
                               "Severity overrides" (5) + "Warning dismissal" (6) — DONE
src/components/shifts/WarningsPanel.tsx      rewritten: grouped by code (errors expanded,
                                              warn collapsed to a counted header, info behind
                                              one more disclosure), per-warning dismiss/restore,
                                              a "show dismissed" reveal — DONE
src/components/shifts/ScheduleWorkspace.tsx  publish confirmation now lists errors
                                              individually (capped, "+N more") and warn/info
                                              as counts, instead of one static sentence — DONE;
                                              the "empty states" item from the original file
                                              list turned out to already be handled gracefully
                                              by ShiftSheet.tsx's existing t('noStaff') branch
src/components/shifts/StaffWorkspace.tsx     view-as picker removed (D14) — not yet done
```

---

## 18. Phasing

Each phase ends in a state that builds and can be looked at. Phases 1 and 7 need
explicit owner approval at their gates.

| # | Phase | Gate |
|---|---|---|
| 1 | ✅ **Schema.** Revise 027 (section 13). Apply to the **local** stack. Verify RLS as a plain staff member; run `check-isolation.mjs`. | Docker running. Owner approves the revised SQL before production. |
| 2 | ✅ **Server.** `requireScheduleManager()`, `/api/shifts/state`, `/api/shifts/dispatch`, `serialize.ts`, `SupabaseShiftsSource`, provider swap (mock retained behind `?demo=1`). | — |
| 3 | ✅ **Roster.** `schedule_members` actions, `RosterPanel`, the StaffManager switch, empty states, `schedule_roster` read, polling. | — |
| 4 | ✅ **Catalogs.** `TriField`, `CatalogEditor`, requirements editor, reorder, delete-safety (D12), onboarding reuses the same controls. | — |
| 5 | ✅ **Warnings.** Severity map, grouping, dismissals, publish-confirmation rewrite. | — |
| 6 | **Verification.** `check-shift-rules.mjs` extended; `npm run build`; live click-through at 390 px and 1280 px in he/en/ar; print sheet. | — |
| 7 | **Production + docs.** Apply 027 to production (separate approval), deploy, write `SCHEDULER.md`, rewrite this file's status, update `CLAUDE.md` / `HANDOFF.md` / `STAFF_APP.md`. | Owner approves the production migration. |

Phases 3, 4 and 5 are independent of each other and all depend on 2.

---

## 19. Verification

Extending `scripts/check-shift-rules.mjs` (currently 93/93, pure logic, no DB):

- a `ruleSeverity` override downgrades, upgrades and silences a code
- `'off'` removes the warning entirely rather than hiding it at severity `info`
- a non-schedulable member is excluded from the roster the engine sees, and an
  assignment referencing one raises `inactive_staff`
- `unknown_role` fires for an assignment whose `roleId` is no longer defined,
  and does not fire when it is
- a per-person `max_weekly_hours` overrides the venue cap in both directions
- dismissal is a UI concern: `evaluate()` output is unchanged by it
- the existing 93 still pass unchanged

Plus, on the local stack, the verification block already at the foot of 027, run
as an ordinary staff member — `shifts` and `schedule_weeks` must return zero
rows, `published_schedule` must return the published week — extended with:
`schedule_members` returns only the caller's own row, and `schedule_roster`
returns nothing at all.

Manual, on the local stack, signed in as `gm@local.test` (a general manager who
is **not** OP — the access decision under test): mark two people schedulable ->
build a week -> publish -> read it at `/staff/schedule` as a third account ->
revoke one person's schedulable flag -> confirm the published week still names
them and the draft warns.

---

## 20. Risks

1. **027 is 774 reviewed lines and is being edited.** The additions are additive
   (one table, one view, two columns, one policy block) but the file is
   re-reviewed end to end before it is applied anywhere.
2. **`/api/shifts/state` returns the whole roster to any schedule manager.**
   That is the intent — it is the same data `schedule_roster` exposes — but it
   means a delegated shift manager can see every colleague's name and badge.
   Not their email. Called out here because it is a deliberate widening of what
   a non-OP can see, and that should be a decision rather than a side effect.
3. **Docker is not currently running locally**, so phase 1 cannot start until it
   is. The alternative rehearsal surface is a Supabase branch — a real isolated
   Postgres, no Docker needed — which is a paid feature and therefore the
   owner's call, not a default.
4. **The audit log will get noisier**, since catalog edits and schedulable
   toggles are now audited actions. `settings.update` already collapses no-op
   writes; the catalog editors must not fire one action per keystroke —
   `TriField` commits on blur, the way `DisplayNameField` in `StaffManager`
   already does.
5. **Warning dismissal is shared state.** Two managers, one dismissal. That is
   the intent (D11), but it means "I dismissed that" and "someone dismissed
   that" look identical. The audit line carries who.

---

## 21. Phase 1 verification performed (2026-08-20)

**Migration 027 revised in place** (D8–D11: `schedule_members`,
`schedule_roster`, `shift_settings.rule_severity`,
`schedule_weeks.dismissed_warnings`) and applied to the **local** stack only —
`npx supabase db reset` (fresh containers, all 41 migration files including the
revised 027, seed.sql). Production untouched; no MCP `apply_migration` call was
made against it. `node scripts/seed-local.mjs` re-created the seven synthetic
`*@local.test` accounts (no real staff PII touched).

RLS verified live over PostgREST — real JWTs from `/auth/v1/token`, not a
superuser session, so this exercises exactly what the app's own client will get:

- **`ofir@local.test`** (plain waiter, never rostered): `schedule_members`,
  `schedule_roster`, `shifts`, `schedule_weeks` all return `[]`. Confirms D8
  ("no row = not schedulable") and Part I D6 ("draft invisible until
  published") both hold with the new tables in place.
- **`gm@local.test`** (general manager, **not** OP — the access decision under
  test): `is_schedule_manager()` → `true`; `schedule_roster` returns all 7
  staff, every one `schedulable: false` before any write — the exact launch
  state D8 promises. `shift_settings.rule_severity` reads `{}` and accepts a
  write (`{"outside_hours":"off"}`).
- **Write test:** GM `POST`s a `schedule_members` row for ofir (schedulable:
  true) → succeeds. Ofir then attempting the identical insert **for himself**
  → `403`, `42501` (RLS-blocked, not merely filtered — the isolation probe's
  own distinction). Ofir reading `schedule_members` afterward sees exactly the
  one row GM created for him (the self-read policy), nothing else.
  `schedule_roster` immediately reflects `schedulable: true` for him — no
  caching layer to invalidate.
- **Full publish round-trip:** GM creates a draft `schedule_weeks` row with a
  `dismissed_warnings` value, publishes it via the unmodified
  `publish_schedule_week()` RPC, and ofir reads it back through
  `published_schedule` — proves the new column doesn't interfere with the
  existing atomic-publish path.
- **`node scripts/check-isolation.mjs`** → 16/18. The 2 failures
  (`waiter_tables` empty, "no active shift" on order-open) are pre-existing
  local-seed gaps in the unrelated waiter/floor domain — `seed-local.mjs`'s own
  output logs skipping `waiter_tables` (FK 409) — not a regression from this
  change. Nothing in `schedule_*`/`shift_*` touched either failing check.
- **`node scripts/check-shift-rules.mjs`** → 93/93 (unchanged; the pure-logic
  engine doesn't read the new columns yet — that's phase 4/5).
- **`npm run build`** → clean, `ƒ Middleware` present, `/owner/schedule` and
  `/staff/schedule` both compile.

**Not yet done:** phases 2–7 (server, roster UI, catalog editors, warnings UI,
full click-through, production apply). The revised 027 is reviewed and proven
correct against a real Postgres + PostgREST + GoTrue stack, but it has not been
shown to anyone outside this session — production application still needs its
own explicit approval per the gate in §18.

---

## 22. Phase 2 verification performed (2026-08-20)

**Two more migration gaps found and fixed while building the server, both
re-applied to local before anything downstream was written against them:**
`schedule_roster`'s gate widened from manager-only to any-staff (D9, revised —
see that section) and `published_schedule` gained `id`/`published_by` columns
(needed to reconstruct a `PublishedWeek`'s `weekId` from a snapshot row). Both
are edits to the still-unapplied-anywhere 027, not new migrations.

**A real authorization gap in 027's own RLS was found and closed at the
application layer, not just noted:** `shift_swaps_respond`'s `WITH CHECK`
constrains the resulting `status` but not the resulting `to_staff_id` — RLS
alone would let any staff member's `swap.peer_accept` claim an open offer *on
behalf of* a colleague, not only for themselves. `performDispatch()` now
checks `action.staffId === ` the caller's own resolved `staffId` before that
write (and, for symmetry, before `swap.request` and `availability.submit`,
where RLS's own `WITH CHECK` already covered it — added anyway for a clean
error instead of a raw Postgres one). `ENABLE_SHIFT_SWAPS` has been off for
every venue this has ever run against, so this was never reachable with real
data — but it is a real hole, worth a fuller RLS pass before that flag is ever
turned on. Not yet done: closing it in Postgres itself (the JS check is
defense in depth on top of a real gap, not a replacement for fixing the
policy).

**Known, documented, not fixed this phase:**
- `Assignment.staffId` is `string`, but `shift_assignments.staff_id` is
  nullable (`on delete set null`). `serialize.ts`'s `rowToAssignment` coerces
  a null to `''`, which is safe (never matches a real id, reads as
  `inactive_staff` like any other unrecognised one) but is a stand-in for
  properly widening the domain type — bundled with D12's "orphaned reference"
  work in phase 4 rather than done as a one-off here. This is Part I §9's
  first "still open" item, now with a concrete interim behaviour.
- `swap.request` does not yet flip its assignment to `swap_pending` — the
  mock's reducer does this as one atomic in-memory step; the live write
  needs either a new `security definer` RPC (a staff member cannot update
  `shift_assignments` directly, RLS is manager-only there) or an accepted UX
  gap. Flagged in `dispatch-write.ts`'s `swap.request` case rather than
  silently shipped. Also gated by `ENABLE_SHIFT_SWAPS` being off everywhere.
- `note.day`'s day-notes write is read-modify-write in JS, not an atomic
  `jsonb_set` — two managers editing two different days' notes in the same
  instant could clobber one. Rare, manual, flagged in code rather than fixed
  with a dedicated RPC this pass.

**Verified end-to-end against the local stack, exercising the ACTUAL
application code** (`loadShiftsState()` / `performDispatch()`, transpiled
on the fly the same way `check-shift-rules.mjs` runs the real reducer —
not a hand-rolled REST probe standing in for it) — real GoTrue JWTs for
`gm@local.test` and `ofir@local.test`, no service role:

- `gm` (manager): venue/settings/roster all resolve; `ruleSeverity` and a
  `schedule_members` write both round-trip; a published week is visible.
- `ofir` (plain staff): roster is now visible to him too (the D9 revision);
  `weeks` and `audit` both come back empty — RLS narrowing confirmed through
  the real query code, not just raw PostgREST.
- Full write path as `gm`: `week.ensure` → `shift.create` → read back the
  real row → `shift.delete` → confirmed gone. All through `performDispatch()`
  and `loadShiftsState()` exactly as the API routes call them.
- The same `shift.create` attempted as `ofir` through `performDispatch()`
  directly: rejected (RLS 42501), proving the write path has no
  JS-side "is this a manager" shortcut standing in for the database's own
  enforcement — the whole point of D9/D6's design.
- 13/13 checks passed. Scratch script, not committed (deleted after the run).

**Also verified through the real Next.js app, not just the DB layer:**
- `GET /api/shifts/state` unauthenticated → `401 {"error":"Unauthorized"}`
  through the actual route, proving `requireScheduleApi()` runs and gates.
- `GET /owner/schedule` unauthenticated → redirected to `/login`, proving
  `requireScheduleManager()` runs and gates.
- A full authenticated **browser** session (not just a bearer token) was
  attempted via an admin-generated magic link, to exercise the Next.js
  cookie/session layer itself end-to-end. It does not work for this app as
  configured: `@supabase/ssr`'s PKCE flow requires a `code_verifier` cookie
  set by the *browser* client at sign-in time, which an admin-minted link
  never goes through, so `exchangeCodeForSession()` in `/auth/callback`
  fails every time regardless of the link being valid. Confirmed the
  redirect-allowlist fix needed to even reach `/auth/callback` locally
  (`supabase/config.toml`'s `additional_redirect_urls` gained a
  `http://127.0.0.1:3000/**` entry, **local file only** — production's
  allowlist is separate, in the Dashboard, untouched) before hitting this
  wall. Not pursued further — the transpiled-real-code approach above tests
  the same application logic without needing a browser-driven OAuth/OTP flow
  that this app doesn't otherwise offer for synthetic accounts. A true
  click-through as a signed-in manager remains open for phase 3, once there
  is UI to click through.
- `npm run build` → clean. `node scripts/check-shift-rules.mjs` → 93/93,
  unchanged. `node scripts/seed-local.mjs` re-run cleanly after two
  `supabase db reset`s this phase required.

**Not yet done:** phases 3–7 unchanged from §21's note. `viewer.canManage`
in `ScheduleWorkspace`/`ManagerPanel` is now always `true` on `/owner/schedule`
(the page-level guard already filtered out non-managers) — harmless
redundancy, not a bug, left as-is rather than stripped out mid-phase.

---

## 23. Phase 3 verification performed (2026-08-20)

**A sixth RPC, `set_schedule_member()`, added to 027** rather than a plain
table write for `member.update` — see §13's table. The reason surfaced while
building the write path, not before: `shift_audit`
has no INSERT policy for a plain authenticated write (only the five original
SECURITY DEFINER functions can write it), and `log_shift_audit()` itself is
deliberately not RPC-callable directly — it never checks who's allowed to
write for which venue, so exposing it would let anyone fabricate an audit
line. Re-applied locally (third `db reset` this feature has needed) before
anything downstream was written against it.

**Empty states turned out to need nothing built.** The plan assumed
`ScheduleWorkspace`/`ShiftSheet`'s assignment picker would need new UI for
"nobody is schedulable yet." Reading the actual code first: the picker
already renders `t('noStaff')` when its candidate list is empty — built in
Part I, presumably for a small real roster rather than a zero-schedulable
one, but the two cases are indistinguishable to that code. `RosterPanel`
adds one thing on top: a named warning banner ("nobody is marked schedulable
yet") in the settings tab itself, so the *reason* the picker is empty is
visible where a manager would actually go to fix it, not just at the point
where they discover it's empty.

**A real modelling bug caught before it shipped:** the original delegation
section filtered its person list to `db.staff.filter(s => s.active)`. Under
Part I's mock, `active` was always `true` (no soft-delete concept), so the
filter was a no-op. Once `active` was redefined to mean "schedulable" (D8),
that same filter would have hidden every non-schedulable person from the
roster panel — the exact people the panel exists to opt in. `RosterPanel`
does not filter `db.staff` at all.

**Verified end-to-end against the local stack**, same method as §22 —
transpiling and running the actual `state-query.ts`/`dispatch-write.ts`,
real GoTrue JWTs, no service role, 10/10 checks:

- Fresh roster: every person starts `active: false` (D8's zero-start,
  reconfirmed after the third reset).
- `member.update` as GM: `ofir` flips to schedulable; a real audit row lands
  with `action = 'member.update'`, a summary that names him, and a real
  actor name (not a bare UUID) — proving `set_schedule_member()`'s
  check+write+audit all actually ran, not just the write.
- A second `member.update` patching only `note` leaves `schedulable`
  untouched — the RPC's "absent key = unchanged" contract holds under a
  real `on conflict do update` upsert, not just in the reducer's mock.
  Toggling back off works too.
- The same action attempted by `ofir` (non-manager) through
  `performDispatch()` directly: rejected with `insufficient_privilege`, and
  a follow-up read confirms the rejected attempt changed nothing — the
  write is atomic, not partially applied before the check fails.
- `ofir` can still read `schedule_roster` directly (the D9 revision,
  reconfirmed).

**Also verified:**
- `node scripts/check-shift-rules.mjs` → **101/101** (was 93; 8 new cases
  under "Roster (member.update)" exercising the mock's own reducer path —
  flip on, flip off, no-op on unchanged value, no-op on an unrelated field,
  no-op on an unknown staffId, audit line written). All pre-existing 93
  still pass unchanged.
- `npm run build` → clean; `/api/shifts/roster`, `/api/shifts/member` both
  present in the route table; `/owner/schedule`'s bundle grew by ~0.4 kB
  (RosterPanel replacing the old inline delegation JSX — roughly a wash).
- Dev server smoke check: `GET /api/shifts/roster` unauthenticated → 401;
  `/owner/dashboard` and `/owner/schedule` unauthenticated → redirect to
  `/login` with no server error; browser console clean apart from the
  expected 401. This proves the routes are wired and the pages don't crash
  building their server component — it does **not** exercise
  `RosterPanel`/`StaffManager`'s actual rendered output, since that needs an
  authenticated **browser** session, and phase 2's §22 already found that
  path doesn't work for this app's synthetic test accounts (PKCE requires a
  browser-initiated sign-in). Carried forward, not newly discovered: a real
  click-through as a signed-in manager is still open, and now there is
  actual UI to click through once it's unblocked.

**Not yet done:** phases 4–7 unchanged from §21/§22's notes. `StaffWorkspace`'s
view-as picker (D14) has not been removed yet — still a prototype affordance,
now slightly more of a liability than before since a real signed-in staff
member's own identity is genuinely available.

---

## 24. Phase 4 verification performed (2026-08-20)

**Two real gaps found and fixed while building, neither purely cosmetic:**

1. **An assignment referencing a deleted role was rendering nowhere at all.**
   `ShiftSheet.tsx`'s requirements section is built by iterating
   `settings.roles` and, per role, filtering assignments that match it — an
   assignment whose `roleId` no longer exists in `settings.roles` matched no
   iteration at all, so it simply vanished from the editor's view. Not a
   crash, not data loss (the row is still there, still in `published_schedule`
   if published) — just invisible to the one screen a manager would use to
   notice and fix it. D12 explicitly asked for "a neutral grey chip," not
   silence. Fixed with an "orphaned assignments" block that lists exactly
   these, styled distinctly, still removable.
2. **The old delegation filter would have resurfaced.** Already fixed in
   phase 3 (§23), but worth re-noting here: `RoleCatalog`'s delete-impact
   count and the new `unknown_role` warning are the two mechanisms that make
   deleting a role *safe* now — before this phase, a role could not be
   deleted at all (the old UI had no delete affordance for roles), so this
   is genuinely new surface area, not a fix to something that already worked.

**One planned rules.ts change turned out to be unnecessary.** The file list
carried "schedulable filter" as an open item for `rules.ts`. Reading the
existing `inactive_staff` check before touching it: it already reads
`!person || !person.active`, and `active` has meant "schedulable" since D8
(phase 2). The check was already correct — an assignment to someone just
toggled off schedulable already fires `inactive_staff`, with no code change
needed. Recorded here rather than silently dropped from the file list, so a
future reader doesn't wonder whether it was missed.

**Verified end-to-end against the local stack**, same method as §22/§23 —
transpiling and running the actual `state-query.ts`/`dispatch-write.ts`
against real Postgres, no service role. This phase's writes are all plain
`settings.update` (the catalogs live in `shift_settings`'s existing JSONB
columns — no new table, no new RPC), so the interesting risk was JSONB
round-trip fidelity through `settingsPatchToRow`'s pass-through, not RLS
(already proven in phase 2). 10/10 checks:

- A new role with a trilingual name, emoji, colour, and a `badge` link
  round-trips exactly.
- **Clearing the badge link (`badge: undefined`) actually removes the key**,
  rather than writing the string `"undefined"` into the JSONB or leaving the
  old value in place — `JSON.stringify` drops `undefined` properties before
  the value ever reaches Postgres, and `ShiftRole.badge?` reads the absence
  correctly on the way back. Worth checking explicitly rather than assuming:
  JSONB + `undefined` is exactly the kind of interaction that surprises.
- A `TriField`-shaped commit with Arabic left blank round-trips as an empty
  string (a real, present key), not a missing one — matters because
  `tri()`'s fallback chain (`he → en → ar`) treats an empty string and a
  missing key identically for display, but `TriField`'s own "will show as"
  preview and a future translator both need `ar: ''` to mean "not translated
  yet," not "field doesn't exist."
- Reordering an array via the up/down buttons' swap round-trips the new
  order.
- Deleting a role removes it from `settings.roles` with no cascade — the
  whole point of D12.
- A station and a preset (with a `requirements` array and a `stationId`
  link) both round-trip, including the preset → station cross-reference.

**Also verified:**
- `node scripts/check-shift-rules.mjs` → **104/104** (was 101). Three new
  cases: an assignment + a requirement both referencing the same deleted
  role fire exactly one `unknown_role` warning per shift (not two — the
  code de-duplicates by role id within a shift), a real role never fires it,
  and the existing per-shift suite is otherwise unchanged.
- `npm run build` → clean. `/owner/schedule`'s bundle grew from 12.4 kB to
  14.4 kB (`CatalogEditor.tsx` + `TriField.tsx` now part of it) — reasonable
  for three full CRUD editors replacing what used to be a read-only list.
- Dev server smoke check: same as §22/§23 — unauthenticated paths gate
  correctly, browser console clean apart from the expected 401. Same
  carried-forward limitation as before: this does not exercise
  `CatalogEditor`/`TriField`'s actual rendered output, since that needs an
  authenticated **browser** session, which phase 2's §22 found doesn't work
  for this app's synthetic accounts.

**Not yet done at the time this note was written:** phase 5, phase 6, phase 7,
`D14`. Phase 5 is now done — see §25.

---

## 25. Phase 5 verification performed (2026-08-20)

**A real bug in the reducer's own control flow found while wiring
`warning.dismiss`, before it ever shipped:** `reduce()`'s final lines are
`if (summary === null) return { db, entry: null }` — using the ORIGINAL
`db` parameter, not the mutated `next`. Every existing case relies on this
correctly, because every existing case that changes state also calls
`log(...)`, which sets `summary`. A case that changed state WITHOUT calling
`log(...)` would compute a real `next`, then have that `next` silently
discarded — the action would appear to succeed (no error) while doing
nothing. The original plan for `warning.dismiss` (§12, decision D11 draft)
assumed dismissal wouldn't need an audit line, since it's UI noise-control,
not a real mutation worth logging. Given the reducer's actual shape, "no
audit line" and "the state change persists" are mutually exclusive for any
case written the way the other seventeen are — so `warning.dismiss` DOES
call `log()` now, accepting a modest amount of audit-log volume as the
honest trade rather than silently shipping a dismiss button that appears to
work in the UI (React state updates locally either way) but never survives
a reload. Recorded here because it is exactly the kind of gap that is easy
to miss by reading the individual case in isolation rather than the
function's actual return path.

**Verified end-to-end against the local stack**, same method as §22-24 —
transpiling and running the actual `dispatch-write.ts`/`state-query.ts`
against real Postgres, no service role. 6/6 checks:

- `settings.ruleSeverity` round-trips the exact `{code: 'off'}` shape the
  new severity panel writes, and clearing it (the `undefined`-drops-the-key
  mechanism already verified in phase 4) removes the override.
- `warning.dismiss` writes the id into `schedule_weeks.dismissed_warnings`
  through the real read-modify-write path; dismissing an already-dismissed
  id does not duplicate it; un-dismissing removes it.
- The same action attempted by a non-manager through `performDispatch()`
  directly: rejected by RLS (`schedule_weeks` is manager-only for every
  operation, same policy every other draft write already depends on — no
  new policy needed for this feature).

**Also verified:**
- `node scripts/check-shift-rules.mjs` → **115/115** (was 104). Eleven new
  cases: five for `ruleSeverity` (`'off'` removes the warning entirely
  rather than merely hiding it at a lower tier; re-tiering to a different
  severity changes severity, not presence; silencing one code leaves an
  unrelated code's warnings — including a real error — completely
  unaffected) and six for `warning.dismiss` (add/no-op-on-repeat/remove, the
  action is audited, and — the one worth calling out — `evaluate()`'s
  output is byte-identical whether or not a warning's id appears in
  `week.dismissedWarnings`, proving dismissal is genuinely UI-only and
  cannot itself hide a real problem from the engine).
- `npm run build` → clean. `/owner/schedule`'s bundle grew from 14.4 kB to
  15.5 kB (the rewritten `WarningsPanel` plus the new severity section in
  `ManagerPanel`).
- Dev server smoke check: same as every prior phase — unauthenticated paths
  gate correctly, browser console clean apart from the expected 401. Same
  carried-forward limitation: does not exercise the rendered
  `WarningsPanel`/severity-panel output, which needs an authenticated
  **browser** session — still blocked on §22's PKCE finding.

**A design call worth stating plainly, not just implying:** dismissal
filters `WarningsPanel`'s LIST view only. The publish-confirmation gate and
`counts.errors`/`counts.warns` (used to decide whether publishing needs
confirmation at all) read the FULL, undismissed-unaware warning list. A
manager who dismissed a warning because "I've seen this, don't keep
showing it to me" gets exactly that — it stops appearing in the list — but
publishing still tells the whole truth about what is about to go out to the
team. Muting a notification and erasing a fact are different actions, and
this module only ever does the first one.

**Not yet done:** phase 6 (full click-through verification, in he/en/ar, at
390 px and 1280 px — still blocked on the browser-auth limitation §22
found; the underlying application logic for everything built in phases 2-5
has been verified against real Postgres, but nobody has looked at the
actual rendered pixels yet), phase 7 (production apply + `SCHEDULER.md`,
each needing separate explicit approval per §18's gates), `D14` (the
view-as picker on `/staff/schedule` — still not removed).
