// The prototype's data source: a seeded week in browser memory, persisted to
// localStorage so a reload doesn't throw away what you just built.
//
// NOTHING HERE TOUCHES SUPABASE. The names below are demo names, not the
// roster — the real implementation projects `public.staff` through the same
// `ScheduleStaff` shape, which is why the rest of the module cannot tell the
// difference.
//
// The seed deliberately contains a few realistic mistakes (an overlap, a
// missing shift leader, a short rest, an unstaffed shift). A scheduling tool
// whose demo is perfectly clean tells you nothing about the part that matters.

import { AYEKA_VENUE, defaultSettings } from './config'
import { reduce, type ActionContext, type ScheduleAction, type ShiftsDB } from './store'
import { addDays, todayIn, weekStartOf } from './time'
import type { Assignment, ISODate, ScheduleStaff, ScheduleWeek, Shift } from './types'
import type { ShiftsDataSource } from './adapter'

const STORAGE_KEY = 'ayeka.shifts.prototype.v1'

// ── demo roster ────────────────────────────────────────────────────────
// Badges and colours mirror what `public.staff` already stores (migration 021),
// so the floor-map identity and the schedule show the same person the same way.

const DEMO_STAFF: ScheduleStaff[] = [
  { id: 'st-ofir',  name: 'אופיר',  initial: 'א', colour: '#34d399', badge: 'general_manager', role: 'staff', active: true },
  { id: 'st-dana',  name: 'דנה',    initial: 'ד', colour: '#f472b6', badge: 'manager',         role: 'staff', active: true },
  { id: 'st-yuval', name: 'יובל',   initial: 'י', colour: '#c084fc', badge: 'bartender',       role: 'staff', active: true },
  { id: 'st-noam',  name: 'נועם',   initial: 'נ', colour: '#60a5fa', badge: 'bartender',       role: 'staff', active: true },
  { id: 'st-shir',  name: 'שיר',    initial: 'ש', colour: '#38e1ff', badge: 'waiter',          role: 'staff', active: true },
  { id: 'st-itay',  name: 'איתי',   initial: 'ת', colour: '#fbbf24', badge: 'waiter',          role: 'staff', active: true },
  { id: 'st-rotem', name: 'רותם',   initial: 'ר', colour: '#fb7185', badge: 'cook',            role: 'staff', active: true },
  { id: 'st-lior',  name: 'ליאור',  initial: 'ל', colour: '#2dd4bf', badge: 'receptionist',    role: 'staff', active: true },
]

/** Deterministic ids, so a reseed produces the same demo twice and a diff of
 *  two runs is readable. */
function makeIdFactory(prefix: string) {
  let n = 0
  return () => `${prefix}${++n}`
}

export function seed(today: ISODate = todayIn(AYEKA_VENUE.timezone)): ShiftsDB {
  const id = makeIdFactory('seed-')
  const thisWeek = weekStartOf(today, AYEKA_VENUE.weekStartsOn)
  const lastWeek = addDays(thisWeek, -7)
  const settings = defaultSettings(AYEKA_VENUE.id)

  const weeks: ScheduleWeek[] = [thisWeek, lastWeek].map((weekStart) => ({
    id: `week-${weekStart}`, venueId: AYEKA_VENUE.id, weekStart,
    status: 'draft', version: 0, publishedAt: null, publishedBy: null,
    dayNotes: weekStart === thisWeek ? { [addDays(thisWeek, 5)]: 'אספקת בירה ב-19:00 — מישהו צריך לקבל את המשלוח.' } : {},
  }))

  const shifts: Shift[] = []
  const assignments: Assignment[] = []

  const preset = (key: string) => settings.presets.find((p) => p.id === key)!
  const addShift = (weekStart: ISODate, dayOffset: number, presetId: string, staff: [string, string][], overrides: Partial<Shift> = {}) => {
    const p = preset(presetId)
    const shift: Shift = {
      id: id(), venueId: AYEKA_VENUE.id, weekId: `week-${weekStart}`,
      date: addDays(weekStart, dayOffset), presetId, start: p.start, end: p.end,
      stationId: p.stationId ?? null,
      requirements: p.requirements.map((r) => ({ ...r })),
      note: '', ...overrides,
    }
    shifts.push(shift)
    for (const [staffId, roleId] of staff) {
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
  addShift(thisWeek, 1, 'evening', [['st-dana', 'shift_leader'], ['st-yuval', 'bartender'], ['st-noam', 'bartender'], ['st-shir', 'waiter'], ['st-itay', 'waiter']])
  addShift(thisWeek, 2, 'evening', [['st-dana', 'shift_leader'], ['st-yuval', 'bartender'], ['st-noam', 'bartender'], ['st-shir', 'waiter'], ['st-itay', 'waiter']])
  addShift(thisWeek, 3, 'evening', [['st-dana', 'shift_leader'], ['st-yuval', 'bartender'], ['st-lior', 'bartender'], ['st-shir', 'waiter'], ['st-rotem', 'waiter']])

  // ① Thursday evening: nobody was ever put down as shift leader.
  addShift(thisWeek, 4, 'evening', [['st-yuval', 'bartender'], ['st-noam', 'bartender'], ['st-shir', 'waiter'], ['st-itay', 'waiter']])
  // ② …and Yuval is on the late shift the same night, which overlaps it.
  addShift(thisWeek, 4, 'night', [['st-ofir', 'shift_leader'], ['st-lior', 'bartender'], ['st-rotem', 'bartender'], ['st-yuval', 'waiter']])

  addShift(thisWeek, 5, 'evening', [['st-dana', 'shift_leader'], ['st-yuval', 'bartender'], ['st-itay', 'bartender'], ['st-shir', 'waiter'], ['st-lior', 'waiter']],
    { note: 'ערב שישי — לפתוח את הפטיו.' })
  // ③ Friday night is a waiter short.
  addShift(thisWeek, 5, 'night', [['st-ofir', 'shift_leader'], ['st-noam', 'bartender'], ['st-rotem', 'bartender']])

  // ④ Noam closes Friday at 03:00 and is back at 09:00 — six hours' rest
  //    against a configured minimum of eight. The classic clopening.
  addShift(thisWeek, 6, 'prep', [['st-noam', 'bartender']], { start: '09:00', end: '13:00', stationId: 'closing' })
  addShift(thisWeek, 6, 'evening', [['st-dana', 'shift_leader'], ['st-yuval', 'bartender'], ['st-lior', 'bartender'], ['st-shir', 'waiter'], ['st-itay', 'waiter']])
  // ⑤ Nobody at all on the Saturday kitchen block.
  addShift(thisWeek, 6, 'prep', [], { start: '16:00', end: '20:00', stationId: 'kitchen', requirements: [{ roleId: 'kitchen', min: 1 }] })
  // ⑥ Yuval lands on 48 hours across all of the above, over the 42-hour cap.

  // ── last week, published, so the staff view and "copy last week" both have
  // something real to work with ──
  addShift(lastWeek, 3, 'evening', [['st-dana', 'shift_leader'], ['st-yuval', 'bartender'], ['st-shir', 'waiter']])
  addShift(lastWeek, 4, 'evening', [['st-dana', 'shift_leader'], ['st-noam', 'bartender'], ['st-itay', 'waiter']])
  addShift(lastWeek, 5, 'evening', [['st-dana', 'shift_leader'], ['st-yuval', 'bartender'], ['st-noam', 'bartender'], ['st-shir', 'waiter'], ['st-itay', 'waiter']])
  addShift(lastWeek, 5, 'night',   [['st-dana', 'shift_leader'], ['st-lior', 'bartender'], ['st-noam', 'bartender'], ['st-shir', 'waiter']])
  addShift(lastWeek, 6, 'evening', [['st-dana', 'shift_leader'], ['st-yuval', 'bartender'], ['st-itay', 'waiter'], ['st-rotem', 'kitchen']])

  const db: ShiftsDB = {
    venue: AYEKA_VENUE,
    settings,
    staff: DEMO_STAFF,
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
  private db: ShiftsDB
  private counter = 0
  /** Mixed into generated ids so a session that restored a persisted db can
   *  never mint an id that already exists in it. */
  private mountKey = Math.random().toString(36).slice(2, 7)

  constructor(private actor: { id: string | null; name: string | null }) {
    this.db = restore() ?? seed()
  }

  async load(): Promise<ShiftsDB> {
    return this.db
  }

  async dispatch(action: ScheduleAction): Promise<ShiftsDB> {
    const { db } = reduce(this.db, action, this.context())
    this.db = db
    persist(db)
    return db
  }

  /** Prototype-only escape hatch, wired to the "reset demo data" button. */
  async reset(): Promise<ShiftsDB> {
    this.db = seed()
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
