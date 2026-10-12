# Staff scheduling (סידור עבודה)

AyekaBar's scheduler runs on the same model as Sarcafe's, scoped to a **venue** (`venues` row, `venue_id`)
instead of a branch. The oracle for behaviour is this document plus migrations `052`–`055`.
Hebrew only (RTL) — this is a staff/owner tool; the customer catalogs stay trilingual.

## Surfaces

| Route | Who | What |
|---|---|---|
| `/owner/schedule` | OP, general manager, delegated schedule managers | The board (draft), requests inbox, warnings, settings draft, planning, roster, audit, poster/PDF share |
| `/owner/schedule/print` | same | Printable week |
| `/staff/schedule` | any active staff | My next shift, the week, swaps, "I want this shift" requests, unavailability, notifications, poster |

Middleware only requires a staff row for both prefixes (`SCHEDULE_PREFIXES` in `lib/shifts/access.ts`); the
real manage/view decision is made server-side in `lib/shifts/guard.ts` and by the `sched_*` SQL functions.

## Data flow

* **One write path.** The browser sends a strict zod action (`lib/shifts/schema.ts`) to
  `POST /api/shifts/dispatch`. The route resolves the actor, then calls one `sched_*` Postgres function with an
  explicit `p_actor`. Functions return `{ok, reason, details}`; `lib/shifts/messages.ts` turns every reason into a
  plain-Hebrew sentence. `sched_*` functions are `service_role` only.
* **One read path.** `GET /api/shifts/state?week=YYYY-MM-DD` returns a `ShiftsDB`. Managers get the live draft;
  employees get only the published snapshot, their own requests/swaps/notifications, and a roster without private
  notes (`lib/shifts/serialize.ts`).
* **Draft vs published.** A week is edited as a draft; *publish* freezes a snapshot employees see.
* **Settings draft.** Everything under "הגדרות" (hours, templates, roles, stations, safety rules, switches,
  who may be scheduled, delegation) is edited locally (`lib/shifts/draft.ts`, `SettingsDraft.tsx`) and written
  in one `saveDraft` action when the manager presses Save. Nothing is sent while a control is being turned.
* **Overlap safety.** A deferred constraint trigger plus advisory locks keep one person off two overlapping shifts,
  including past-midnight shifts. `sched_range()` (SQL) and `intervalOf()` (TS) are checked against each other.

## Features

* Board: shifts per day from templates, per-role headcount needs, coverage, warnings (rest, daily/weekly hours,
  consecutive days, unavailability), per-day notes, copy/clear week, publish/unpublish.
* Swaps: **give** (hand over or exchange), **take** (ask the holder for their shift). Colleague answers, manager
  approves; everything is re-validated on approval.
* Requests: per-shift `requests_open`; employees ask, managers approve or reject.
* Weekly planning: employees submit unavailability until **end of Tuesday (Jerusalem time)** before the week;
  the manager then runs the fair fill (balances Saturdays over the preceding 12 weeks).
* Roster: nobody is schedulable until the owner switches them on (**off by default** here, unlike Sarcafe).
  `StaffManager`'s existing "schedulable" switch drives the same flag.
* Notifications: in-app inbox (`schedule_notifications`) that also acts as the push outbox — see `STAFF_PUSH.md`.
* Poster: shareable PNG/PDF of the week (mine / everyone).

## Differences from Sarcafe

* `venue_id` everywhere; one venue today (`ayeka-bar`).
* `sched_can_view` = any active staff; `sched_can_manage` = owner, `general_manager`, or listed in
  `shift_settings.schedule_managers` (no branch scoping, no event branches, no published-browse of other venues).
* Hebrew only.
* Migration `052` bridges the production 027 shape (live `shift_*` rows are converted in place, idempotently)
  and drops the old 027-era functions that were never exposed to a UI.
* Next 14: `waitUntil` from `@vercel/functions` via `lib/server/after.ts` instead of `after()`.
* Migrations here are numbered (`052_…`), following this repo's own history; Sarcafe uses timestamped names.

## Verification

```
npm run check:schedule         # pure TS modules + TS==SQL parity (PGlite)
npm run verify:schedule-sql    # SQL behaviour: bridge, rules, swaps, requests, planning, push, grants
npm run check:staff-push       # push rules + wiring guards
npm run typecheck
```

## Rollout order

1. Apply `052` → `053` → `054` → `055` **before** deploying the app (the new routes call the new functions).
2. Set the VAPID variables and the Vault URL (see `STAFF_PUSH.md`).
3. Deploy. Existing staff stay *off* the roster until switched on in the staff manager or the roster panel.
