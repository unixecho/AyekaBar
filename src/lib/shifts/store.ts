// The whole mutable surface of the module, as one action union and one pure
// reducer.
//
// WHY A SINGLE ACTION UNION
// Three things have to agree forever: what the UI can do, what the audit log
// records, and what the eventual API exposes. Spreading those across a dozen
// ad-hoc functions is how they drift. Here, adding a capability means adding
// one variant — the compiler then demands a reducer case, an audit action and
// a label, and `adapter.ts` demands a transport for it. Nothing can be added
// quietly.
//
// The reducer is pure and takes its clock and its id generator from the
// caller, so `scripts/check-shift-rules.mjs` can run the exact code the browser
// runs and get identical output.

import { addDays, weekDates, weekStartOf } from './time'
import type {
  Assignment, AuditEntry, AvailabilitySubmission, ISODate, RoleRequirement,
  ScheduleStaff, ScheduleWeek, Shift, ShiftSettings, SwapRequest, Venue,
} from './types'

/** A published week is a frozen COPY, not a filter over the live rows. Staff
 *  read this and only this — which is what makes "invisible until published"
 *  a property of the data model rather than a rule the UI has to remember.
 *  Same shape of guarantee as `menus.published` / the `public_menus` view. */
export interface PublishedWeek {
  week: ScheduleWeek
  shifts: Shift[]
  assignments: Assignment[]
}

export interface ShiftsDB {
  venue: Venue
  settings: ShiftSettings
  staff: ScheduleStaff[]
  weeks: ScheduleWeek[]
  shifts: Shift[]
  assignments: Assignment[]
  published: Record<ISODate, PublishedWeek>
  availability: AvailabilitySubmission[]
  swaps: SwapRequest[]
  audit: AuditEntry[]
}

export interface ActionContext {
  actorId: string | null
  actorName: string | null
  /** ISO timestamp. Injected so the reducer stays pure. */
  now: string
  /** Fresh id. Injected for the same reason. */
  id: () => string
}

export type ScheduleAction =
  | { type: 'settings.update'; patch: Partial<ShiftSettings> }
  | { type: 'onboarding.complete'; patch: Partial<ShiftSettings> }
  | { type: 'week.ensure'; weekStart: ISODate }
  | { type: 'week.publish'; weekStart: ISODate }
  | { type: 'week.unpublish'; weekStart: ISODate }
  | { type: 'week.copy'; from: ISODate; to: ISODate }
  | { type: 'week.clear'; weekStart: ISODate }
  | { type: 'shift.create'; weekStart: ISODate; date: ISODate; presetId: string | null; start: string; end: string; stationId: string | null; requirements: RoleRequirement[] }
  | { type: 'shift.update'; shiftId: string; patch: Partial<Omit<Shift, 'id' | 'venueId' | 'weekId'>> }
  | { type: 'shift.delete'; shiftId: string }
  | { type: 'assignment.create'; shiftId: string; staffId: string; roleId: string }
  | { type: 'assignment.delete'; assignmentId: string }
  | { type: 'note.day'; weekStart: ISODate; date: ISODate; note: string }
  | { type: 'availability.submit'; staffId: string; weekStart: ISODate; entries: AvailabilitySubmission['entries']; note: string }
  | { type: 'swap.request'; assignmentId: string; fromStaffId: string; toStaffId: string | null; reason: string }
  | { type: 'swap.peer_accept'; swapId: string; staffId: string }
  | { type: 'swap.decide'; swapId: string; approve: boolean; note: string }
  | { type: 'swap.cancel'; swapId: string }

export interface ReduceResult {
  db: ShiftsDB
  /** Null when the action was a no-op — an audit line for "nothing happened"
   *  is noise, and noise is how a log stops being read. */
  entry: AuditEntry | null
}

export function reduce(db: ShiftsDB, action: ScheduleAction, ctx: ActionContext): ReduceResult {
  const venueId = db.venue.id
  let next: ShiftsDB = db
  let summary: string | null = null
  let diff: Record<string, unknown> = {}
  let auditAction: AuditEntry['action'] = 'settings.update'

  const log = (a: AuditEntry['action'], s: string, d: Record<string, unknown> = {}) => {
    auditAction = a; summary = s; diff = d
  }

  switch (action.type) {
    case 'settings.update':
    case 'onboarding.complete': {
      const before = pickChanged(db.settings, action.patch)
      next = { ...db, settings: { ...db.settings, ...action.patch } }
      if (action.type === 'onboarding.complete') {
        next.settings.onboardedAt = ctx.now
        log('onboarding.complete', 'הקמת הסידור הושלמה', { after: action.patch })
      } else {
        if (!Object.keys(before).length) return { db, entry: null }
        log('settings.update', `עודכנו: ${Object.keys(action.patch).join(', ')}`, { before, after: action.patch })
      }
      break
    }

    case 'week.ensure': {
      if (findWeek(db, action.weekStart)) return { db, entry: null }
      const week: ScheduleWeek = {
        id: ctx.id(), venueId, weekStart: action.weekStart,
        status: 'draft', version: 0, publishedAt: null, publishedBy: null, dayNotes: {},
      }
      next = { ...db, weeks: [...db.weeks, week] }
      log('week.create', `נפתח שבוע ${action.weekStart}`, { weekStart: action.weekStart })
      break
    }

    case 'week.publish': {
      const week = findWeek(db, action.weekStart)
      if (!week) return { db, entry: null }
      const shifts = db.shifts.filter((s) => s.weekId === week.id)
      const ids = new Set(shifts.map((s) => s.id))
      const assignments = db.assignments.filter((a) => ids.has(a.shiftId))
      const publishedWeek: ScheduleWeek = {
        ...week, status: 'published', version: week.version + 1,
        publishedAt: ctx.now, publishedBy: ctx.actorId,
      }
      next = {
        ...db,
        weeks: db.weeks.map((w) => (w.id === week.id ? publishedWeek : w)),
        published: {
          ...db.published,
          [week.weekStart]: {
            week: publishedWeek,
            // Deep copies: a later draft edit must not reach through and
            // change what the team was shown.
            shifts: shifts.map((s) => ({ ...s, requirements: s.requirements.map((r) => ({ ...r })) })),
            assignments: assignments.map((a) => ({ ...a })),
          },
        },
      }
      log('week.publish', `פורסם סידור לשבוע ${week.weekStart} (גרסה ${publishedWeek.version})`, {
        weekStart: week.weekStart, version: publishedWeek.version,
        shifts: shifts.length, assignments: assignments.length,
      })
      break
    }

    case 'week.unpublish': {
      const week = findWeek(db, action.weekStart)
      if (!week || week.status !== 'published') return { db, entry: null }
      const published = { ...db.published }
      delete published[week.weekStart]
      next = {
        ...db,
        weeks: db.weeks.map((w) => (w.id === week.id ? { ...w, status: 'draft', publishedAt: null, publishedBy: null } : w)),
        published,
      }
      log('week.unpublish', `השבוע ${week.weekStart} הוחזר לטיוטה`, { weekStart: week.weekStart })
      break
    }

    case 'week.copy': {
      const from = findWeek(db, action.from)
      if (!from) return { db, entry: null }
      const cleared = clearWeek(db, action.to)
      const target = findWeek(cleared, action.to)
      const week: ScheduleWeek = target ?? {
        id: ctx.id(), venueId, weekStart: action.to,
        status: 'draft', version: 0, publishedAt: null, publishedBy: null, dayNotes: {},
      }
      const offset = weekDates(action.to)
      const sourceDates = weekDates(action.from)
      const dateMap = new Map(sourceDates.map((d, i) => [d, offset[i]]))

      const newShifts: Shift[] = []
      const newAssignments: Assignment[] = []
      for (const s of cleared.shifts.filter((s) => s.weekId === from.id)) {
        const id = ctx.id()
        newShifts.push({
          ...s, id, weekId: week.id,
          date: dateMap.get(s.date) ?? s.date,
          requirements: s.requirements.map((r) => ({ ...r })),
        })
        for (const a of cleared.assignments.filter((a) => a.shiftId === s.id)) {
          newAssignments.push({ ...a, id: ctx.id(), shiftId: id, status: 'assigned' })
        }
      }
      next = {
        ...cleared,
        weeks: target ? cleared.weeks : [...cleared.weeks, week],
        shifts: [...cleared.shifts, ...newShifts],
        assignments: [...cleared.assignments, ...newAssignments],
      }
      log('week.create', `הועתק סידור מ-${action.from} ל-${action.to}`, {
        from: action.from, to: action.to, shifts: newShifts.length,
      })
      break
    }

    case 'week.clear': {
      const week = findWeek(db, action.weekStart)
      if (!week) return { db, entry: null }
      const removed = db.shifts.filter((s) => s.weekId === week.id).length
      if (!removed) return { db, entry: null }
      next = clearWeek(db, action.weekStart)
      log('shift.delete', `נוקו ${removed} משמרות מהשבוע ${action.weekStart}`, { weekStart: action.weekStart, removed })
      break
    }

    case 'shift.create': {
      const week = findWeek(db, action.weekStart)
      if (!week) return { db, entry: null }
      const shift: Shift = {
        id: ctx.id(), venueId, weekId: week.id, date: action.date,
        presetId: action.presetId, start: action.start, end: action.end,
        stationId: action.stationId,
        requirements: action.requirements.map((r) => ({ ...r })),
        note: '',
      }
      next = { ...db, shifts: [...db.shifts, shift] }
      log('shift.create', `נוספה משמרת ${action.start}–${action.end} ב-${action.date}`, { after: shift })
      break
    }

    case 'shift.update': {
      const shift = db.shifts.find((s) => s.id === action.shiftId)
      if (!shift) return { db, entry: null }
      const before = pickChanged(shift, action.patch)
      if (!Object.keys(before).length) return { db, entry: null }
      next = { ...db, shifts: db.shifts.map((s) => (s.id === shift.id ? { ...s, ...action.patch } : s)) }
      log('shift.update', `עודכנה משמרת ב-${shift.date}`, { shiftId: shift.id, before, after: action.patch })
      break
    }

    case 'shift.delete': {
      const shift = db.shifts.find((s) => s.id === action.shiftId)
      if (!shift) return { db, entry: null }
      next = {
        ...db,
        shifts: db.shifts.filter((s) => s.id !== shift.id),
        assignments: db.assignments.filter((a) => a.shiftId !== shift.id),
        // An offer to swap a shift that no longer exists is dead, not pending.
        swaps: db.swaps.map((sw) =>
          db.assignments.some((a) => a.id === sw.assignmentId && a.shiftId === shift.id) && isOpenSwap(sw)
            ? { ...sw, status: 'cancelled' as const, decidedAt: ctx.now, decisionNote: 'המשמרת נמחקה' }
            : sw),
      }
      log('shift.delete', `נמחקה משמרת ${shift.start}–${shift.end} ב-${shift.date}`, { before: shift })
      break
    }

    case 'assignment.create': {
      const shift = db.shifts.find((s) => s.id === action.shiftId)
      if (!shift) return { db, entry: null }
      const exists = db.assignments.some(
        (a) => a.shiftId === action.shiftId && a.staffId === action.staffId && a.roleId === action.roleId)
      if (exists) return { db, entry: null }
      const assignment: Assignment = {
        id: ctx.id(), venueId, shiftId: action.shiftId,
        staffId: action.staffId, roleId: action.roleId, status: 'assigned',
      }
      next = { ...db, assignments: [...db.assignments, assignment] }
      log('assignment.create', `${nameOf(db, action.staffId)} שובץ/ה ל-${shift.date} ${shift.start}`, { after: assignment })
      break
    }

    case 'assignment.delete': {
      const assignment = db.assignments.find((a) => a.id === action.assignmentId)
      if (!assignment) return { db, entry: null }
      const shift = db.shifts.find((s) => s.id === assignment.shiftId)
      next = {
        ...db,
        assignments: db.assignments.filter((a) => a.id !== assignment.id),
        swaps: db.swaps.map((sw) =>
          sw.assignmentId === assignment.id && isOpenSwap(sw)
            ? { ...sw, status: 'cancelled' as const, decidedAt: ctx.now, decisionNote: 'השיבוץ בוטל' }
            : sw),
      }
      log('assignment.delete', `בוטל שיבוץ של ${nameOf(db, assignment.staffId)}${shift ? ` ב-${shift.date}` : ''}`, { before: assignment })
      break
    }

    case 'note.day': {
      const week = findWeek(db, action.weekStart)
      if (!week) return { db, entry: null }
      const before = week.dayNotes[action.date] ?? ''
      if (before === action.note) return { db, entry: null }
      const dayNotes = { ...week.dayNotes }
      if (action.note.trim()) dayNotes[action.date] = action.note
      else delete dayNotes[action.date]
      next = { ...db, weeks: db.weeks.map((w) => (w.id === week.id ? { ...w, dayNotes } : w)) }
      log('note.update', `הערה ליום ${action.date}`, { date: action.date, before, after: action.note })
      break
    }

    case 'availability.submit': {
      const existing = db.availability.find(
        (a) => a.staffId === action.staffId && a.weekStart === action.weekStart)
      const submission: AvailabilitySubmission = {
        id: existing?.id ?? ctx.id(), venueId,
        staffId: action.staffId, weekStart: action.weekStart,
        entries: action.entries.map((e) => ({ ...e })), note: action.note,
        status: 'submitted', submittedAt: ctx.now,
      }
      next = {
        ...db,
        availability: existing
          ? db.availability.map((a) => (a.id === existing.id ? submission : a))
          : [...db.availability, submission],
      }
      log('availability.submit', `${nameOf(db, action.staffId)} הגיש/ה זמינות לשבוע ${action.weekStart}`, {
        weekStart: action.weekStart, entries: submission.entries.length,
      })
      break
    }

    case 'swap.request': {
      const assignment = db.assignments.find((a) => a.id === action.assignmentId)
      if (!assignment) return { db, entry: null }
      const swap: SwapRequest = {
        id: ctx.id(), venueId, assignmentId: action.assignmentId,
        fromStaffId: action.fromStaffId, toStaffId: action.toStaffId,
        status: 'open', reason: action.reason, createdAt: ctx.now,
        peerRespondedAt: null, decidedAt: null, decidedBy: null, decisionNote: '',
      }
      next = {
        ...db,
        swaps: [...db.swaps, swap],
        assignments: db.assignments.map((a) => (a.id === assignment.id ? { ...a, status: 'swap_pending' as const } : a)),
      }
      log('swap.request', `${nameOf(db, action.fromStaffId)} ביקש/ה החלפה`, { after: swap })
      break
    }

    case 'swap.peer_accept': {
      const swap = db.swaps.find((s) => s.id === action.swapId)
      if (!swap || swap.status !== 'open') return { db, entry: null }
      next = {
        ...db,
        swaps: db.swaps.map((s) => (s.id === swap.id
          ? { ...s, status: 'peer_accepted' as const, toStaffId: action.staffId, peerRespondedAt: ctx.now }
          : s)),
      }
      log('swap.peer_accept', `${nameOf(db, action.staffId)} לקח/ה את המשמרת — ממתין לאישור`, { swapId: swap.id })
      break
    }

    case 'swap.decide': {
      const swap = db.swaps.find((s) => s.id === action.swapId)
      if (!swap || swap.status !== 'peer_accepted' || !swap.toStaffId) return { db, entry: null }
      const decided: SwapRequest = {
        ...swap,
        status: action.approve ? 'approved' : 'rejected',
        decidedAt: ctx.now, decidedBy: ctx.actorId, decisionNote: action.note,
      }
      next = {
        ...db,
        swaps: db.swaps.map((s) => (s.id === swap.id ? decided : s)),
        // Approval is the ONLY thing that moves the shift. Until a manager
        // says yes, the original person is still on the hook — which is the
        // entire reason the approval step exists.
        assignments: db.assignments.map((a) => {
          if (a.id !== swap.assignmentId) return a
          return action.approve
            ? { ...a, staffId: swap.toStaffId!, status: 'assigned' as const }
            : { ...a, status: 'assigned' as const }
        }),
      }
      log(action.approve ? 'swap.approve' : 'swap.reject',
        action.approve
          ? `ההחלפה אושרה: ${nameOf(db, swap.fromStaffId)} → ${nameOf(db, swap.toStaffId)}`
          : `ההחלפה נדחתה: ${nameOf(db, swap.fromStaffId)}`,
        { swapId: swap.id, note: action.note })
      break
    }

    case 'swap.cancel': {
      const swap = db.swaps.find((s) => s.id === action.swapId)
      if (!swap || !isOpenSwap(swap)) return { db, entry: null }
      next = {
        ...db,
        swaps: db.swaps.map((s) => (s.id === swap.id ? { ...s, status: 'cancelled' as const, decidedAt: ctx.now } : s)),
        assignments: db.assignments.map((a) => (a.id === swap.assignmentId ? { ...a, status: 'assigned' as const } : a)),
      }
      log('swap.cancel', `בקשת ההחלפה בוטלה`, { swapId: swap.id })
      break
    }
  }

  if (summary === null) return { db, entry: null }

  const entry: AuditEntry = {
    id: ctx.id(), venueId, at: ctx.now,
    actorId: ctx.actorId, actorName: ctx.actorName,
    action: auditAction, summary, diff,
  }
  return { db: { ...next, audit: [entry, ...next.audit] }, entry }
}

// ── helpers ────────────────────────────────────────────────────────────

const isOpenSwap = (s: SwapRequest) => s.status === 'open' || s.status === 'peer_accepted'

export const findWeek = (db: ShiftsDB, weekStart: ISODate): ScheduleWeek | undefined =>
  db.weeks.find((w) => w.weekStart === weekStart)

const nameOf = (db: ShiftsDB, staffId: string): string =>
  db.staff.find((s) => s.id === staffId)?.name ?? '—'

function clearWeek(db: ShiftsDB, weekStart: ISODate): ShiftsDB {
  const week = findWeek(db, weekStart)
  if (!week) return db
  const ids = new Set(db.shifts.filter((s) => s.weekId === week.id).map((s) => s.id))
  return {
    ...db,
    shifts: db.shifts.filter((s) => !ids.has(s.id)),
    assignments: db.assignments.filter((a) => !ids.has(a.shiftId)),
  }
}

/** The `before` half of a diff: only the keys the patch actually changes. */
function pickChanged<T extends object>(source: T, patch: Partial<T>): Record<string, unknown> {
  const before: Record<string, unknown> = {}
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (JSON.stringify(source[key]) !== JSON.stringify(patch[key])) {
      before[key as string] = source[key]
    }
  }
  return before
}

// ── week selectors ─────────────────────────────────────────────────────

export function draftWeek(db: ShiftsDB, weekStart: ISODate): PublishedWeek | null {
  const week = findWeek(db, weekStart)
  if (!week) return null
  const shifts = db.shifts.filter((s) => s.weekId === week.id)
  const ids = new Set(shifts.map((s) => s.id))
  return { week, shifts, assignments: db.assignments.filter((a) => ids.has(a.shiftId)) }
}

/** What a staff member is allowed to see. Reads the snapshot map, never the
 *  live rows — see the comment on `PublishedWeek`. */
export function publishedWeek(db: ShiftsDB, weekStart: ISODate): PublishedWeek | null {
  return db.published[weekStart] ?? null
}

/** Read-only shifts from the weeks either side, so the rest engine can see a
 *  Saturday-close → Sunday-open clopening across the week boundary. */
export function neighbouringOf(db: ShiftsDB, weekStart: ISODate) {
  const prev = draftWeek(db, addDays(weekStart, -7))
  const nextW = draftWeek(db, addDays(weekStart, 7))
  return {
    shifts: [...(prev?.shifts ?? []), ...(nextW?.shifts ?? [])],
    assignments: [...(prev?.assignments ?? []), ...(nextW?.assignments ?? [])],
  }
}

/** Cheap content fingerprint, used to answer "does the draft differ from what
 *  the team was shown?" without diffing two object graphs on every render. */
export function weekSignature(bundle: PublishedWeek | null): string {
  if (!bundle) return ''
  const shifts = bundle.shifts
    .map((s) => [s.date, s.start, s.end, s.stationId, s.note,
      s.requirements.map((r) => `${r.roleId}:${r.min}:${r.max ?? ''}`).sort().join(','),
      bundle.assignments.filter((a) => a.shiftId === s.id)
        .map((a) => `${a.staffId}/${a.roleId}`).sort().join('+'),
    ].join('|'))
    .sort()
  const notes = Object.entries(bundle.week.dayNotes).sort().map(([k, v]) => `${k}=${v}`)
  return [...shifts, ...notes].join('\n')
}

export const weekStartFor = (date: ISODate, venue: Venue): ISODate =>
  weekStartOf(date, venue.weekStartsOn)
