// The shift-scheduling domain. Deliberately free of React, Supabase and Next —
// everything here is plain data, so the same types serve the mock prototype,
// the eventual Supabase adapter, the print view and the rules engine.
//
// MULTI-VENUE FROM DAY ONE
// Every row carries `venueId`. Ayeka Bar is one seeded venue; cloning the
// module for a second bar is a new `venues` row, not a schema change. Nothing
// in this module ever reads a venue from a global — it is threaded through
// explicitly so a single deployment could serve two venues if that day comes.
//
// WALL-CLOCK, NOT INSTANTS
// A shift is `date + start + end` in local wall-clock time, never a timestamp.
// A bar's "22:00–02:00" is four hours to everyone who reads the schedule,
// including on the two nights a year Israel changes its clocks — storing
// instants would make one of those nights three hours and the other five, and
// the rest-hours engine would flag a violation nobody committed.

import type { Lang } from '@/lib/menu/types'
import type { BadgeKey } from '@/lib/staff/badges'

export type { Lang }

/** Every user-facing string in this app carries all three languages. */
export interface Tri { he: string; en: string; ar: string }

export const tri = (t: Tri, lang: Lang): string => t[lang] || t.he || t.en

/** `HH:MM`, 24h, local wall-clock. */
export type HM = string
/** `YYYY-MM-DD`, local calendar date. */
export type ISODate = string

// ── Venue ──────────────────────────────────────────────────────────────

export interface Venue {
  id: string
  /** Stable, human-readable key — the menus table already addresses by slug. */
  slug: string
  name: Tri
  /** IANA zone. Only used for "what is today"; shift maths stays wall-clock. */
  timezone: string
  /** 0 = Sunday. Israel starts its week on Sunday; kept configurable anyway. */
  weekStartsOn: number
}

// ── Configuration (the Manager Panel writes all of this) ───────────────

export interface ShiftRole {
  id: string
  name: Tri
  emoji: string
  color: string
  /** Links a schedule role to the existing staff job-title badge, so assigning
   *  someone can suggest the role they actually hold. Optional: a venue may
   *  invent a role that has no badge (e.g. "Security"). */
  badge?: BadgeKey
}

export interface Station {
  id: string
  name: Tri
  emoji: string
  /** A station may be limited to certain roles — "Main Bar" wants bartenders. */
  roleIds?: string[]
}

/** How many people of a role a shift needs. `min` drives the missing-role
 *  warning; `max` is advisory and only warns when exceeded. */
export interface RoleRequirement {
  roleId: string
  min: number
  max?: number
}

export interface ShiftPreset {
  id: string
  name: Tri
  start: HM
  end: HM
  color: string
  /** Default staffing this preset creates a shift with. Editable per shift. */
  requirements: RoleRequirement[]
  /** Default station, if the preset always runs somewhere specific. */
  stationId?: string | null
}

/** The configurable safety rules. Every one of these is a slider in the panel;
 *  none of them is hard-coded in the rules engine. */
export interface SafetyRules {
  /** Hours per employee per schedule week. */
  maxWeeklyHours: number
  /** Mandatory rest between the end of one shift and the start of the next —
   *  the "clopening" guard. */
  minRestHours: number
  /** Hours in any single shift. */
  maxDailyHours: number
  /** Consecutive calendar days worked. */
  maxConsecutiveDays: number
}

export const FEATURE_KEYS = ['ENABLE_AVAILABILITY_SUBMISSIONS', 'ENABLE_SHIFT_SWAPS'] as const
export type FeatureKey = (typeof FEATURE_KEYS)[number]
export type FeatureFlags = Record<FeatureKey, boolean>

export interface ShiftSettings {
  venueId: string
  /** Day numbers the venue operates, 0 = Sunday. */
  workingDays: number[]
  /** Advisory opening window; shifts outside it warn but are allowed. */
  openTime: HM
  closeTime: HM
  presets: ShiftPreset[]
  roles: ShiftRole[]
  stations: Station[]
  safety: SafetyRules
  features: FeatureFlags
  /** Staff ids explicitly delegated schedule-management rights by an OP or the
   *  general manager. Stored HERE rather than as a public.staff column on
   *  purpose: the grant is per-venue, and public.staff is a shared table the
   *  waiter app and every auth guard already depend on. */
  scheduleManagers: string[]
  /** Null until the onboarding flow is completed; the panel edits the same
   *  fields forever after. */
  onboardedAt: string | null
}

// ── Roster projection ──────────────────────────────────────────────────

/** A read-only projection of `public.staff`. This module never defines a
 *  worker identity — it references one. `id` is `staff.id` (the surrogate key
 *  since migration 006; `auth_user_id` is null for a pending invite, so it is
 *  the wrong thing to key an assignment on). */
export interface ScheduleStaff {
  id: string
  name: string
  initial: string | null
  colour: string | null
  badge: string | null
  role: string
  /** False for someone kept for history but no longer schedulable. */
  active: boolean
  /** True for a staff row the owner authorized by email but who has not yet
   *  signed in (`auth_user_id` still null — see migration 006). Schedulable
   *  now so a new hire's first week can be built before their first shift;
   *  surfaced so the UI can say why someone has no colour/initial yet. */
  pending?: boolean
}

// ── The schedule itself ────────────────────────────────────────────────

export type WeekStatus = 'draft' | 'published'

export interface ScheduleWeek {
  id: string
  venueId: string
  /** The week's first day (venue's weekStartsOn), `YYYY-MM-DD`. */
  weekStart: ISODate
  status: WeekStatus
  /** Bumped on every publish. Staff see the snapshot of the latest version. */
  version: number
  publishedAt: string | null
  publishedBy: string | null
  /** Free-text notes pinned to a whole day, keyed by date. */
  dayNotes: Record<ISODate, string>
}

export interface Shift {
  id: string
  venueId: string
  weekId: string
  date: ISODate
  /** Which preset it came from, for display grouping. Null = ad-hoc. */
  presetId: string | null
  start: HM
  end: HM
  stationId: string | null
  requirements: RoleRequirement[]
  note: string
}

export type AssignmentStatus = 'assigned' | 'swap_pending'

export interface Assignment {
  id: string
  venueId: string
  shiftId: string
  staffId: string
  roleId: string
  status: AssignmentStatus
}

// ── Availability (feature-flagged) ─────────────────────────────────────

export type AvailabilityKind = 'unavailable' | 'prefer' | 'partial'

export interface AvailabilityEntry {
  date: ISODate
  kind: AvailabilityKind
  /** Only for `partial`: the window the person CAN work. */
  from?: HM
  to?: HM
}

export type SubmissionStatus = 'draft' | 'submitted'

export interface AvailabilitySubmission {
  id: string
  venueId: string
  staffId: string
  weekStart: ISODate
  entries: AvailabilityEntry[]
  note: string
  status: SubmissionStatus
  submittedAt: string | null
}

// ── Swaps (feature-flagged) ────────────────────────────────────────────

export type SwapStatus =
  | 'open'          // offered, no peer has taken it
  | 'peer_accepted' // a peer said yes; waiting on the manager
  | 'approved'
  | 'rejected'
  | 'cancelled'

export interface SwapRequest {
  id: string
  venueId: string
  assignmentId: string
  fromStaffId: string
  /** Null while the offer is open to the whole team. */
  toStaffId: string | null
  status: SwapStatus
  reason: string
  createdAt: string
  peerRespondedAt: string | null
  decidedAt: string | null
  decidedBy: string | null
  decisionNote: string
}

// ── Audit ──────────────────────────────────────────────────────────────

export type AuditAction =
  | 'settings.update'
  | 'onboarding.complete'
  | 'week.create'
  | 'week.publish'
  | 'week.unpublish'
  | 'shift.create'
  | 'shift.update'
  | 'shift.delete'
  | 'assignment.create'
  | 'assignment.delete'
  | 'note.update'
  | 'availability.submit'
  | 'swap.request'
  | 'swap.peer_accept'
  | 'swap.approve'
  | 'swap.reject'
  | 'swap.cancel'

export interface AuditEntry {
  id: string
  venueId: string
  at: string
  actorId: string | null
  /** Snapshotted, like menu_audit does — removing someone later must not erase
   *  what they did. */
  actorName: string | null
  action: AuditAction
  summary: string
  /** Payload diff: `{ before, after }` for updates, the row for creates. */
  diff: Record<string, unknown>
}

// ── What the rules engine reads ────────────────────────────────────────

export interface ScheduleSnapshot {
  venue: Venue
  settings: ShiftSettings
  week: ScheduleWeek
  shifts: Shift[]
  assignments: Assignment[]
  staff: ScheduleStaff[]
  availability: AvailabilitySubmission[]
  /** Read-only shifts from the weeks either side. A Saturday-night close
   *  followed by a Sunday-evening open is the classic clopening, and it is
   *  invisible to an engine that can only see one week at a time. These
   *  contribute to overlap and rest checks and to nothing else — counting them
   *  in the weekly hours quota would bill Sunday for last week's Saturday. */
  neighbouring?: { shifts: Shift[]; assignments: Assignment[] }
}
