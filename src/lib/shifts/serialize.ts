// Row ↔ domain, in one place, both directions.
//
// Every table in migration 027 stores its JSONB payloads (requirements,
// presets, roles, stations, safety, features, day_hours, entries, diff)
// already shaped exactly like the TS types they carry — that was a deliberate
// choice when the migration was written, so JSONB content needs no
// conversion at all here. What DOES need converting is column names
// (snake_case ↔ camelCase) and a few representational differences Postgres
// insists on: `time` columns round-trip as `"17:00:00"` and this module's
// `HM` type is `"17:00"`; a nullable `staff_id` (migration 027's `on delete
// set null`, so a removed staff member doesn't break history) meets a
// domain type that is not yet nullable — see the comment on `rowToAssignment`
// for the one place that gap is bridged rather than fixed.
//
// This file has exactly one job — SQL row shapes on one side, the types in
// `./types` on the other — so a schema change or a domain-type change is a
// one-file diff, never a hunt through the data source.

import type { PublishedWeek } from './store'
import type {
  Assignment, AssignmentStatus, AuditAction, AuditEntry, AvailabilityEntry,
  AvailabilitySubmission, RoleRequirement, ScheduleMember, ScheduleStaff,
  ScheduleWeek, Shift, ShiftSettings, SubmissionStatus, SwapRequest, SwapStatus,
  Tri, Venue, WeekStatus,
} from './types'

/** `"17:00:00"` (or already `"17:00"`) → `"17:00"`. Postgres `time` columns
 *  come back through PostgREST with seconds; every other reader in this
 *  module (TimeWheel, the rules engine, the print sheet) expects `HM`. */
const trimHM = (t: string | null | undefined): string => (t ?? '00:00').slice(0, 5)

// ── reads: row → domain ─────────────────────────────────────────────────

export function rowToVenue(row: Record<string, unknown>): Venue {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as Tri,
    timezone: row.timezone as string,
    weekStartsOn: row.week_starts_on as number,
  }
}

export function rowToSettings(row: Record<string, unknown>): ShiftSettings {
  return {
    venueId: row.venue_id as string,
    workingDays: (row.working_days as number[] | null) ?? [],
    openTime: trimHM(row.open_time as string),
    closeTime: trimHM(row.close_time as string),
    dayHours: (row.day_hours as ShiftSettings['dayHours'] | null) ?? {},
    presets: (row.presets as ShiftSettings['presets'] | null) ?? [],
    roles: (row.roles as ShiftSettings['roles'] | null) ?? [],
    stations: (row.stations as ShiftSettings['stations'] | null) ?? [],
    safety: row.safety as ShiftSettings['safety'],
    features: row.features as ShiftSettings['features'],
    scheduleManagers: (row.schedule_managers as string[] | null) ?? [],
    ruleSeverity: (row.rule_severity as ShiftSettings['ruleSeverity'] | null) ?? {},
    onboardedAt: (row.onboarded_at as string | null) ?? null,
  }
}

/** `schedule_roster` row → the flattened projection the rest of the UI reads.
 *  `active` = `schedulable`: no `schedule_members` row means false, which is
 *  what makes an empty roster show nobody assignable rather than erroring
 *  (D7/D8 — see the field comment on `ScheduleStaff.active`). */
export function rowToRosterStaff(row: Record<string, unknown>): ScheduleStaff {
  return {
    id: row.staff_id as string,
    name: row.name as string,
    initial: (row.initial as string | null) ?? null,
    colour: (row.colour as string | null) ?? null,
    badge: (row.badge as string | null) ?? null,
    role: row.role as string,
    active: !!row.schedulable,
    pending: !!row.pending,
  }
}

/** The same `schedule_roster` row, read as the roster panel's own edit
 *  target rather than the flattened projection above. Only meaningful for
 *  rows a schedule manager can see (the roster panel is manager-only UI);
 *  a plain staff member's session can still call this on their own row, it
 *  is just rarely useful to. */
export function rowToScheduleMember(row: Record<string, unknown>): ScheduleMember {
  return {
    staffId: row.staff_id as string,
    schedulable: !!row.schedulable,
    defaultRoleId: (row.default_role_id as string | null) ?? null,
    maxWeeklyHours: (row.max_weekly_hours as number | null) ?? null,
    employmentType: (row.employment_type as string) ?? 'regular',
    sortOrder: (row.sort_order as number | null) ?? null,
    note: (row.note as string) ?? '',
  }
}

export function rowToWeek(row: Record<string, unknown>): ScheduleWeek {
  return {
    id: row.id as string,
    venueId: row.venue_id as string,
    weekStart: row.week_start as string,
    status: row.status as WeekStatus,
    version: row.version as number,
    publishedAt: (row.published_at as string | null) ?? null,
    publishedBy: (row.published_by as string | null) ?? null,
    dayNotes: (row.day_notes as Record<string, string> | null) ?? {},
    dismissedWarnings: (row.dismissed_warnings as string[] | null) ?? [],
  }
}

export function rowToShift(row: Record<string, unknown>): Shift {
  return {
    id: row.id as string,
    venueId: row.venue_id as string,
    weekId: row.week_id as string,
    date: row.shift_date as string,
    presetId: (row.preset_id as string | null) ?? null,
    start: trimHM(row.start_time as string),
    end: trimHM(row.end_time as string),
    stationId: (row.station_id as string | null) ?? null,
    requirements: (row.requirements as RoleRequirement[] | null) ?? [],
    note: (row.note as string) ?? '',
  }
}

/** `shift_assignments.staff_id` is nullable (`on delete set null`, so
 *  removing someone from the roster does not break a published week's
 *  history — see migration 027's comment on that column). `Assignment.staffId`
 *  is not yet nullable in `./types` — widening it ripples through every
 *  `db.staff.find(s => s.id === a.staffId)` call in the UI, which is real
 *  work and belongs with D12's "orphaned reference" pass (phase 4), not
 *  bundled into the server phase. Until then a null lands as `''`, which
 *  never matches a real `staff.id` and is treated exactly like any other
 *  unrecognised id — the existing `inactive_staff` warning already fires for
 *  that case. Tracked: Part I §9 "still open", first item. */
export function rowToAssignment(row: Record<string, unknown>): Assignment {
  return {
    id: row.id as string,
    venueId: row.venue_id as string,
    shiftId: row.shift_id as string,
    staffId: (row.staff_id as string | null) ?? '',
    roleId: row.role_id as string,
    status: row.status as AssignmentStatus,
  }
}

export function rowToAvailability(row: Record<string, unknown>): AvailabilitySubmission {
  return {
    id: row.id as string,
    venueId: row.venue_id as string,
    staffId: row.staff_id as string,
    weekStart: row.week_start as string,
    entries: (row.entries as AvailabilityEntry[] | null) ?? [],
    note: (row.note as string) ?? '',
    status: row.status as SubmissionStatus,
    submittedAt: (row.submitted_at as string | null) ?? null,
  }
}

export function rowToSwap(row: Record<string, unknown>): SwapRequest {
  return {
    id: row.id as string,
    venueId: row.venue_id as string,
    assignmentId: row.assignment_id as string,
    fromStaffId: row.from_staff_id as string,
    toStaffId: (row.to_staff_id as string | null) ?? null,
    status: row.status as SwapStatus,
    reason: (row.reason as string) ?? '',
    createdAt: row.created_at as string,
    peerRespondedAt: (row.peer_responded_at as string | null) ?? null,
    decidedAt: (row.decided_at as string | null) ?? null,
    decidedBy: (row.decided_by as string | null) ?? null,
    decisionNote: (row.decision_note as string) ?? '',
  }
}

export function rowToAudit(row: Record<string, unknown>): AuditEntry {
  return {
    // bigserial over PostgREST comes back as a number; the domain type is a
    // string id like every other id in this module (ids are opaque here).
    id: String(row.id),
    venueId: row.venue_id as string,
    at: row.at as string,
    actorId: (row.actor_id as string | null) ?? null,
    actorName: (row.actor_name as string | null) ?? null,
    action: row.action as AuditAction,
    summary: row.summary as string,
    diff: (row.diff as Record<string, unknown> | null) ?? {},
  }
}

/** `published_schedule` row → the same `PublishedWeek` shape a draft's
 *  `draftWeek()` produces (see store.ts), so `weekSignature()` and every
 *  staff-side component can read a published week without caring which
 *  shape it came from. The snapshot's shifts/assignments were already
 *  written in this exact camelCase shape by `publish_schedule_week()` — see
 *  that function's `jsonb_build_object` calls — so only the wrapper
 *  (`weekId`/`venueId`, absent from the flat snapshot) needs filling in. */
export function rowToPublishedWeek(row: Record<string, unknown>): PublishedWeek {
  const weekId = row.id as string
  const venueId = row.venue_id as string
  const snapshot = (row.published_snapshot as { shifts?: RawSnapshotShift[] } | null) ?? { shifts: [] }
  const week: ScheduleWeek = {
    id: weekId, venueId, weekStart: row.week_start as string,
    status: 'published', version: row.version as number,
    publishedAt: (row.published_at as string | null) ?? null,
    publishedBy: (row.published_by as string | null) ?? null,
    dayNotes: (row.day_notes as Record<string, string> | null) ?? {},
    dismissedWarnings: [],
  }
  const shifts: Shift[] = []
  const assignments: Assignment[] = []
  for (const s of snapshot.shifts ?? []) {
    shifts.push({
      id: s.id, venueId, weekId, date: s.date, presetId: s.presetId ?? null,
      start: s.start, end: s.end, stationId: s.stationId ?? null,
      requirements: s.requirements ?? [], note: s.note ?? '',
    })
    for (const a of s.assignments ?? []) {
      assignments.push({
        id: a.id, venueId, shiftId: s.id, staffId: a.staffId ?? '',
        roleId: a.roleId, status: a.status,
      })
    }
  }
  return { week, shifts, assignments }
}

interface RawSnapshotShift {
  id: string; date: string; start: string; end: string
  presetId: string | null; stationId: string | null
  requirements: RoleRequirement[]; note: string
  assignments: {
    id: string; staffId: string | null; staffName: string
    roleId: string; status: AssignmentStatus
  }[]
}

// ── writes: patch → row ───────────────────────────────────────────────
//
// Only the keys actually present in the patch are translated — `'x' in
// patch` rather than `patch.x !== undefined`, so an explicit `undefined`
// (rare, but `Partial<T>` allows it) still becomes a real column write
// rather than being silently dropped.

export function settingsPatchToRow(patch: Partial<ShiftSettings>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if ('workingDays' in patch) row.working_days = patch.workingDays
  if ('openTime' in patch) row.open_time = patch.openTime
  if ('closeTime' in patch) row.close_time = patch.closeTime
  if ('dayHours' in patch) row.day_hours = patch.dayHours
  if ('presets' in patch) row.presets = patch.presets
  if ('roles' in patch) row.roles = patch.roles
  if ('stations' in patch) row.stations = patch.stations
  if ('safety' in patch) row.safety = patch.safety
  if ('features' in patch) row.features = patch.features
  if ('scheduleManagers' in patch) row.schedule_managers = patch.scheduleManagers
  if ('ruleSeverity' in patch) row.rule_severity = patch.ruleSeverity
  if ('onboardedAt' in patch) row.onboarded_at = patch.onboardedAt
  return row
}

export function shiftPatchToRow(patch: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if ('date' in patch) row.shift_date = patch.date
  if ('presetId' in patch) row.preset_id = patch.presetId
  if ('start' in patch) row.start_time = patch.start
  if ('end' in patch) row.end_time = patch.end
  if ('stationId' in patch) row.station_id = patch.stationId
  if ('requirements' in patch) row.requirements = patch.requirements
  if ('note' in patch) row.note = patch.note
  return row
}

