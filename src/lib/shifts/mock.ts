// The prototype's data source: a seeded week in browser memory, persisted to
// localStorage so a reload doesn't throw away what you just built.
//
// SHIFTS AND ASSIGNMENTS ARE MOCK. NOBODY'S ROSTER IS. `db.staff` is fetched
// live from `/api/shifts/staff` — a service-role read of the real
// `public.staff` (see that route for why a plain client read can't do this:
// RLS only lets a signed-in user read their own row). Only the week itself
// — the shifts, who is on which one, the illustrative conflicts — is
// invented and lives in this browser only, which is what "prototype" means
// here. If the live fetch fails (offline, signed out, dev without a
// session) a small fallback cast keeps the builder demonstrable rather than
// blank.
//
// The seed deliberately contains a few realistic mistakes (an overlap, a
// missing shift leader, a short rest, an unstaffed shift). A scheduling tool
// whose demo is perfectly clean tells you nothing about the part that matters.

import { AYEKA_VENUE, defaultSettings } from './config'
import { reduce, type ActionContext, type ScheduleAction, type ShiftsDB } from './store'
import { addDays, todayIn, weekStartOf } from './time'
import type { Assignment, ISODate, ScheduleStaff, ScheduleWeek, Shift } from './types'
import type { ShiftsDataSource } from './adapter'

// v2: shifts now seed against the REAL roster (see fetchRealStaff below). A
// v1 blob's assignments reference the old fictional 'st-*' ids, which would
// read as a wave of "removed from roster" warnings once real names replaced
// them — bumping the key means everyone gets one clean reseed instead.
const STORAGE_KEY = 'ayeka.shifts.prototype.v2'

// ── fallback roster ────────────────────────────────────────────────────
// Used ONLY when the live `/api/shifts/staff` read fails. Eight seats so the
// seeded week below (which was designed against eight people) degrades
// gracefully rather than being rewritten around whatever the real roster
// happens to be sized today.

const FALLBACK_STAFF: ScheduleStaff[] = [
  { id: 'st-ofir',  name: 'אופיר',  initial: 'א', colour: '#34d399', badge: 'general_manager', role: 'staff', active: true },
  { id: 'st-dana',  name: 'דנה',    initial: 'ד', colour: '#f472b6', badge: 'manager',         role: 'staff', active: true },
  { id: 'st-yuval', name: 'יובל',   initial: 'י', colour: '#c084fc', badge: 'bartender',       role: 'staff', active: true },
  { id: 'st-noam',  name: 'נועם',   initial: 'נ', colour: '#60a5fa', badge: 'bartender',       role: 'staff', active: true },
  { id: 'st-shir',  name: 'שיר',    initial: 'ש', colour: '#38e1ff', badge: 'waiter',          role: 'staff', active: true },
  { id: 'st-itay',  name: 'איתי',   initial: 'ת', colour: '#fbbf24', badge: 'waiter',          role: 'staff', active: true },
  { id: 'st-rotem', name: 'רותם',   initial: 'ר', colour: '#fb7185', badge: 'cook',            role: 'staff', active: true },
  { id: 'st-lior',  name: 'ליאור',  initial: 'ל', colour: '#2dd4bf', badge: 'receptionist',    role: 'staff', active: true },
]

/** Live read of `public.staff`, service-role-gated. Never throws — a failed
 *  fetch degrades to the fallback roster rather than blanking the builder. */
async function fetchRealStaff(): Promise<ScheduleStaff[] | null> {
  try {
    const res = await fetch('/api/shifts/staff', { cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as { staff?: ScheduleStaff[] }
    return Array.isArray(body.staff) && body.staff.length ? body.staff : null
  } catch {
    return null
  }
}

/** Deterministic ids, so a reseed produces the same demo twice and a diff of
 *  two runs is readable. */
function makeIdFactory(prefix: string) {
  let n = 0
  return () => `${prefix}${++n}`
}

/**
 * @param roster The people the seeded week is built against. Real staff when
 *   available, `FALLBACK_STAFF` otherwise. Referenced by POSITION (`p(0)`…
 *   `p(7)`, see below) rather than by name, so this reads correctly against
 *   any roster size — a real team of three still gets a coherent, if
 *   smaller, illustrative week instead of a pile of "removed from roster"
 *   warnings for the six people who don't exist.
 */
export function seed(
  today: ISODate = todayIn(AYEKA_VENUE.timezone),
  roster: ScheduleStaff[] = FALLBACK_STAFF,
): ShiftsDB {
  const id = makeIdFactory('seed-')
  const thisWeek = weekStartOf(today, AYEKA_VENUE.weekStartsOn)
  const lastWeek = addDays(thisWeek, -7)
  const settings = defaultSettings(AYEKA_VENUE.id)
  const staff = roster.length ? roster : FALLBACK_STAFF
  // Seat 0 = the general-manager-shaped seat (shift leader duty leans here
  // when only one or two real people exist), 1 = a second lead, 2–5 = the
  // floor, 6–7 = kitchen/host. Wraps with modulo, so three real people still
  // produce a full — if repetitive — week rather than an error.
  const p = (seat: number) => staff[seat % staff.length].id

  const weeks: ScheduleWeek[] = [thisWeek, lastWeek].map((weekStart) => ({
    id: `week-${weekStart}`, venueId: AYEKA_VENUE.id, weekStart,
    status: 'draft', version: 0, publishedAt: null, publishedBy: null,
    dayNotes: weekStart === thisWeek ? { [addDays(thisWeek, 5)]: 'אספקת בירה ב-19:00 — מישהו צריך לקבל את המשלוח.' } : {},
  }))

  const shifts: Shift[] = []
  const assignments: Assignment[] = []

  const preset = (key: string) => settings.presets.find((p) => p.id === key)!
  const addShift = (weekStart: ISODate, dayOffset: number, presetId: string, entries: [string, string][], overrides: Partial<Shift> = {}) => {
    const p = preset(presetId)
    const shift: Shift = {
      id: id(), venueId: AYEKA_VENUE.id, weekId: `week-${weekStart}`,
      date: addDays(weekStart, dayOffset), presetId, start: p.start, end: p.end,
      stationId: p.stationId ?? null,
      requirements: p.requirements.map((r) => ({ ...r })),
      note: '', ...overrides,
    }
    shifts.push(shift)
    // The seat numbers behind `entries` were written for eight distinct
    // people; a smaller real roster wraps some of them onto the same person.
    // That is fine ACROSS shifts (a small team pulls double duty, and that is
    // exactly what the cross-shift overlap/hours violations below are
    // supposed to demonstrate) — but the SAME person twice on ONE shift is
    // never an intended lesson, just seat-collision noise. Walk the roster
    // forward from wherever a collision lands until this shift has someone
    // it has not already placed.
    const onThisShift = new Set<string>()
    for (const [wanted, roleId] of entries) {
      let staffId = wanted
      if (onThisShift.has(staffId)) {
        const start = staff.findIndex((s) => s.id === staffId)
        for (let k = 1; k <= staff.length; k++) {
          const candidate = staff[(start + k) % staff.length].id
          if (!onThisShift.has(candidate)) { staffId = candidate; break }
        }
      }
      onThisShift.add(staffId)
      assignments.push({ id: id(), venueId: AYEKA_VENUE.id, shiftId: shift.id, staffId, roleId, status: 'assigned' })
    }
    return shift
  }

  // ── this week ──
  // Mon–Sat, evenings with a late crew coming in on Thursday and Friday. The
  // late shift is a DIFFERENT crew, not the same people staying on — a bar
  // staggers its staffing, it does not double-book it. Every violation below
  // is deliberate and marked; the rest of the week is deliberately clean, so
  // the warnings tab reads as "here are six things to fix" rather than noise.
  addShift(thisWeek, 1, 'evening', [[p(1), 'shift_leader'], [p(2), 'bartender'], [p(3), 'bartender'], [p(4), 'waiter'], [p(5), 'waiter']])
  addShift(thisWeek, 2, 'evening', [[p(1), 'shift_leader'], [p(2), 'bartender'], [p(3), 'bartender'], [p(4), 'waiter'], [p(5), 'waiter']])
  addShift(thisWeek, 3, 'evening', [[p(1), 'shift_leader'], [p(2), 'bartender'], [p(7), 'bartender'], [p(4), 'waiter'], [p(6), 'waiter']])

  // ① Thursday evening: nobody was ever put down as shift leader.
  addShift(thisWeek, 4, 'evening', [[p(2), 'bartender'], [p(3), 'bartender'], [p(4), 'waiter'], [p(5), 'waiter']])
  // ② …and seat 2 is on the late shift the same night, which overlaps it.
  addShift(thisWeek, 4, 'night', [[p(0), 'shift_leader'], [p(7), 'bartender'], [p(6), 'bartender'], [p(2), 'waiter']])

  addShift(thisWeek, 5, 'evening', [[p(1), 'shift_leader'], [p(2), 'bartender'], [p(5), 'bartender'], [p(4), 'waiter'], [p(7), 'waiter']],
    { note: 'ערב שישי — לפתוח את הפטיו.' })
  // ③ Friday night is a waiter short.
  addShift(thisWeek, 5, 'night', [[p(0), 'shift_leader'], [p(3), 'bartender'], [p(6), 'bartender']])

  // ④ Seat 3 closes Friday at 03:00 and is back at 09:00 — six hours' rest
  //    against a configured minimum of eight. The classic clopening.
  addShift(thisWeek, 6, 'prep', [[p(3), 'bartender']], { start: '09:00', end: '13:00', stationId: 'closing' })
  addShift(thisWeek, 6, 'evening', [[p(1), 'shift_leader'], [p(2), 'bartender'], [p(7), 'bartender'], [p(4), 'waiter'], [p(5), 'waiter']])
  // ⑤ Nobody at all on the Saturday kitchen block.
  addShift(thisWeek, 6, 'prep', [], { start: '16:00', end: '20:00', stationId: 'kitchen', requirements: [{ roleId: 'kitchen', min: 1 }] })
  // ⑥ Seat 2 lands on 48 hours across all of the above, over the 42-hour cap.

  // ── last week, published, so the staff view and "copy last week" both have
  // something real to work with ──
  addShift(lastWeek, 3, 'evening', [[p(1), 'shift_leader'], [p(2), 'bartender'], [p(4), 'waiter']])
  addShift(lastWeek, 4, 'evening', [[p(1), 'shift_leader'], [p(3), 'bartender'], [p(5), 'waiter']])
  addShift(lastWeek, 5, 'evening', [[p(1), 'shift_leader'], [p(2), 'bartender'], [p(3), 'bartender'], [p(4), 'waiter'], [p(5), 'waiter']])
  addShift(lastWeek, 5, 'night',   [[p(1), 'shift_leader'], [p(7), 'bartender'], [p(3), 'bartender'], [p(4), 'waiter']])
  addShift(lastWeek, 6, 'evening', [[p(1), 'shift_leader'], [p(2), 'bartender'], [p(5), 'waiter'], [p(6), 'kitchen']])

  const db: ShiftsDB = {
    venue: AYEKA_VENUE,
    settings,
    staff,
    weeks,
    shifts,
    assignments,
    published: {},
    availability: [],
    swaps: [],
    audit: [],
  }

  // Publish last week through the real reducer rather than hand-writing the
  // snapshot — the demo must exercise the same path the manager will.
  const published = reduce(db, { type: 'week.publish', weekStart: lastWeek }, {
    actorId: null, actorName: 'הקמה', now: `${lastWeek}T12:00:00.000Z`, id: makeIdFactory('seed-pub-'),
  })
  return published.db
}

// ── the source ─────────────────────────────────────────────────────────

export class MockShiftsSource implements ShiftsDataSource {
  readonly isMock = true
  /** Undefined until `load()` resolves — the constructor cannot await the
   *  roster fetch, so there is nothing meaningful to build a db from yet. */
  private db: ShiftsDB | null = null
  private counter = 0
  /** Mixed into generated ids so a session that restored a persisted db can
   *  never mint an id that already exists in it. */
  private mountKey = Math.random().toString(36).slice(2, 7)

  constructor(private actor: { id: string | null; name: string | null }) {}

  async load(): Promise<ShiftsDB> {
    const real = await fetchRealStaff()
    const restored = this.db ?? restore()

    if (restored) {
      // The week is real (or already seeded); only the roster needs to stay
      // current. A real fetch refreshes names/badges/colours in place — a
      // manager renamed or re-badged since the last load must not keep
      // showing stale ones — while shifts/assignments, keyed by id, are
      // untouched either way.
      this.db = real ? { ...restored, staff: real } : restored
    } else {
      this.db = seed(undefined, real ?? undefined)
    }

    persist(this.db)
    return this.db
  }

  async dispatch(action: ScheduleAction): Promise<ShiftsDB> {
    if (!this.db) throw new Error('MockShiftsSource.dispatch() called before load()')
    const { db } = reduce(this.db, action, this.context())
    this.db = db
    persist(db)
    return db
  }

  /** Prototype-only escape hatch, wired to the "reset demo data" button. */
  async reset(): Promise<ShiftsDB> {
    const real = await fetchRealStaff()
    this.db = seed(undefined, real ?? undefined)
    persist(this.db)
    return this.db
  }

  private context(): ActionContext {
    return {
      actorId: this.actor.id,
      actorName: this.actor.name,
      now: new Date().toISOString(),
      // Prefixed with the mount time so ids stay unique across a reload that
      // restored a persisted db with `id-1` already in it.
      id: () => `id-${this.mountKey}-${++this.counter}`,
    }
  }
}

function persist(db: ShiftsDB) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch {
    // Private mode, quota, disabled storage — the prototype still works, it
    // just forgets. Never let a storage failure break the UI.
  }
}

function restore(): ShiftsDB | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ShiftsDB
    // A stored db from an older shape would crash the builder in a way that
    // looks like a bug in the builder. Cheap shape check, then give up.
    if (!parsed?.venue?.id || !Array.isArray(parsed.shifts) || !parsed.settings?.safety) return null
    // A field ADDED to settings since this was saved (dayHours, 2026-08-14)
    // is missing entirely rather than empty — that is not disqualifying the
    // way a missing `safety` block is, just something to backfill so every
    // reader downstream can assume the key exists.
    if (!parsed.settings.dayHours) parsed.settings.dayHours = {}
    return parsed
  } catch {
    return null
  }
}

export function clearPersisted() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* see persist() */
  }
}
