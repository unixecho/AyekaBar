// The shift-scheduling domain model — the same model Sarcafe's scheduler runs on,
// scoped to a venue (venueId), with plain Hebrew strings for role/station/template
// vocabulary: none of it is ever customer-facing, matching every other
// staff/owner-only screen in this app.

export type HM = string // "HH:MM"
export type ISODate = string // "YYYY-MM-DD"

export type ShiftRole = {
  id: string
  name: string
  color: string
  /** Kept from the venue's earlier configuration; shown beside the role where there is room. */
  emoji?: string
  /** The staff job-title badge this role corresponds to, so adding someone can suggest the role they hold. */
  badge?: string
}
export type Station = {
  id: string
  name: string
  emoji: string
  /** A station may be limited to certain roles — "Main Bar" wants bartenders. */
  roleIds?: string[]
}
export type RoleRequirement = { roleId: string; min: number; max?: number }
/** A shift TEMPLATE: the times offered by default when a shift is created.
 *  A shift copies its times from it and remembers which one;
 *  a shift that still names its template follows it (preset-sync.ts). It may also carry the
 *  staffing a shift made from it starts with (`requirements`) and a display colour. */
export type ShiftPreset = {
  id: string
  name: string
  startTime: HM
  endTime: HM
  roleId?: string
  stationId?: string
  color?: string
  requirements?: RoleRequirement[]
}

export type SafetyRules = {
  maxWeeklyHours: number
  minRestHours: number
  maxDailyHours: number
  maxConsecutiveDays: number
}

/** `maxDaysOff` (2026-10-15): how many days a week an employee may mark unavailable. Optional because venues written
 *  before it existed have no such key — read it through `maxDaysOffOf()` (lib/shifts/days-off.ts), never directly. */
export type FeatureFlags = { availability: boolean; swaps: boolean; maxDaysOff?: number }

export type RuleSeverity = 'error' | 'warning' | 'off'

export type ShiftSettings = {
  venueId: string
  workingDays: number[] // 0=Sun..6=Sat (JS getDay())
  openTime: HM
  closeTime: HM
  dayHours: Record<number, { open: HM; close: HM }>
  roles: ShiftRole[]
  stations: Station[]
  presets: ShiftPreset[]
  safety: SafetyRules
  ruleSeverity: Record<string, RuleSeverity>
  features: FeatureFlags
  scheduleManagers: string[] // staff.id[]  (managers only — empty for everyone else)
  onboardedAt: string | null
}

/** One roster row — a person as the scheduler sees them. `displayName` is ALWAYS
 *  a real name (lib/shifts/names.ts), never blank, whether or not the person has
 *  an email. The scheduling fields after `active` are the manager's private
 *  bookkeeping: they are null/false for any non-manager viewer. */
export type ScheduleStaffRow = {
  staffId: string
  displayName: string
  /** Self-selected lightweight avatar until profile photos are introduced. */
  avatarEmoji: string | null
  /** The person's own colour from the staff directory (hex), when they have one. */
  colour?: string | null
  badge: string | null
  active: boolean
  /** On the roster only when the owner has switched them on (no row = off in this app). */
  schedulable: boolean
  defaultRoleId: string | null
  maxWeeklyHours: number | null
  employmentType: string | null
  sortOrder: number | null
  note: string | null
  /** Has a linked sign-in — i.e. can open the app, see their schedule and answer a swap. */
  hasLogin: boolean
}

export type PublishedSnapshot = { shifts: Shift[]; assignments: Assignment[] }

export type ScheduleWeek = {
  id: string
  venueId: string
  weekStart: ISODate
  status: 'draft' | 'published'
  version: number
  publishedAt: string | null
  dayNotes: Record<string, string>
  dismissedWarnings: string[]
  publishedSnapshot: PublishedSnapshot | null
}

export type Shift = {
  id: string
  venueId: string
  weekId: string
  date: ISODate
  startTime: HM
  endTime: HM
  presetId: string | null
  stationId: string | null
  requirements: RoleRequirement[]
  /** The manager explicitly allows employees to ask for this shift. */
  requestsOpen: boolean
  note: string | null
  /** Raw timestamp string, echoed back on save so a concurrent edit is detected. */
  updatedAt: string | null
}

/** `swap_pending` is legacy (migration 024 stopped writing it): a pending swap is
 *  derived from the swaps list and never alters the assignment itself. */
export type AssignmentStatus = 'assigned' | 'swap_pending'

export type Assignment = {
  id: string
  shiftId: string
  staffId: string | null
  staffName: string | null
  roleId: string | null
  status: AssignmentStatus
}

export type AvailabilityKind = 'unavailable' | 'partial' | 'prefer'
export type AvailabilityEntry = { date: ISODate; kind: AvailabilityKind; from?: HM; to?: HM }

export type AvailabilitySubmission = {
  id: string
  staffId: string
  weekStart: ISODate
  entries: AvailabilityEntry[]
  note: string | null
  status: 'draft' | 'submitted'
}

// ---- Swaps ------------------------------------------------------------------
//   open ──(colleague accepts)──> peer_accepted ──(manager approves)──> approved
//     │  \──(named colleague declines)──> declined   └─(manager rejects)──> rejected
//     └──(requester / manager / a schedule change)──> cancelled
export type SwapStatus = 'open' | 'peer_accepted' | 'approved' | 'rejected' | 'declined' | 'cancelled'

/** Who started it. 'give': the person giving `assignmentId` away (hand-over or exchange),
 *  answered by `toStaffId` (or any colleague for an open offer). 'take': the person who
 *  WANTS that shift (`toStaffId`), answered by the person holding it (`fromStaffId`).
 *  Either way `fromStaffId` holds `assignmentId` now and `toStaffId` gets it on approval. */
export type SwapDirection = 'give' | 'take'

/** What one side of a swap looked like when it was agreed. Kept on the swap
 *  itself so the record stays readable after the shifts are edited or deleted. */
export type SwapSide = {
  assignmentId: string
  shiftId: string
  weekId: string
  date: ISODate
  start: HM
  end: HM
  presetId: string | null
  roleId: string | null
  staffId: string | null
  staffName: string | null
  label: string
}

export type SwapRequest = {
  id: string
  direction: SwapDirection
  /** null once the underlying assignment is gone (history survives). */
  assignmentId: string | null
  /** The shift the other person gives in return (an exchange); null = a hand-over. */
  returnAssignmentId: string | null
  fromStaffId: string
  fromStaffName: string | null
  toStaffId: string | null
  toStaffName: string | null
  status: SwapStatus
  reason: string | null
  cancelReason: string | null
  decidedAt: string | null
  decisionNote: string | null
  createdAt: string
  terms: { from?: SwapSide; to?: SwapSide | null }
}

// ---- "I would like to work this shift" ----------------------------------------
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export type ShiftRequest = {
  id: string
  shiftId: string | null
  staffId: string
  staffName: string | null
  status: RequestStatus
  note: string | null
  decisionNote: string | null
  cancelReason: string | null
  decidedAt: string | null
  createdAt: string
  terms: { shiftId?: string; weekId?: string; date?: ISODate; start?: HM; end?: HM; label?: string }
}

// ---- In-app notifications (nothing here depends on email) ----------------------
export type NotificationLink = { tab?: 'schedule' | 'requests'; weekStart?: ISODate; shiftId?: string }

export type ScheduleNotification = {
  id: string
  kind: string
  title: string
  body: string | null
  link: NotificationLink
  createdAt: string
  readAt: string | null
}

export type ShiftAuditEntry = {
  id: string
  actorName: string | null
  action: string
  summary: string | null
  detail: Record<string, unknown> | null
  createdAt: string
}

export type WarningSeverity = 'error' | 'warning'

export type Warning = {
  code: string
  severity: WarningSeverity
  message: string
  shiftId?: string
  staffId?: string
}

/** The venue's own wall clock right now — the one thing "has this shift
 *  already started?" is decided by, on the server and (from this) the client. */
export type WallClock = { date: ISODate; time: HM }

/** Shift choices offered before publishing, deliberately without names, notes or assignments. */
export type PlanningShift = Pick<Shift, 'id' | 'weekId' | 'date' | 'startTime' | 'endTime' | 'presetId' | 'requestsOpen'>
export type SaturdayBalance = { staffId: string; minutes: number; shifts: number }

/** The full window the provider holds: the requested week, ± 1 — enough
 *  for cross-week rest/consecutive-day checks at the boundary. Manager
 *  view reads shifts/assignments live; staff view is built from each
 *  week's publishedSnapshot instead (see serialize.ts). */
export type ShiftsDB = {
  venueId: string
  settings: ShiftSettings
  roster: ScheduleStaffRow[]
  weeks: ScheduleWeek[]
  shifts: Shift[]
  assignments: Assignment[]
  availability: AvailabilitySubmission[]
  swaps: SwapRequest[]
  requests: ShiftRequest[]
  planningShifts: PlanningShift[]
  /** Manager-only count of scheduled Saturday opportunities in the preceding 12 weeks. */
  saturdayBalance: SaturdayBalance[]
  notifications: ScheduleNotification[]
  unreadCount: number
  audit: ShiftAuditEntry[]
  now: WallClock
  viewerStaffId: string | null
  viewerCanManage: boolean
  viewerCanDelegate: boolean
}
