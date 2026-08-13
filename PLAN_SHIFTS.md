# PLAN_SHIFTS.md — shift scheduling (prototype + decision record)

**Status: prototype and plan only, 2026-08-13.** Nothing is committed, nothing
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
