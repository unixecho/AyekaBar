// Wall-clock minutes — the handful of calendar helpers the "who is on shift,
// when" code needs, kept in a module of their own (2026-10-13).
//
// WHY NOT `./time`. These started life as imports from the scheduler's own
// `time.ts`. The scheduler was rebuilt the day before this was merged (PR #6,
// migrations 052–055) and `time.ts` was rewritten around its new `Shift` type
// (`startTime`/`endTime`, `intervalOf(weekStart, shift)`, no `dayIndex`). The
// presence rules, the Z-report gate and the dashboards' quick view are PURE
// functions over plain `{ date, start, end }` — they must not depend on the
// scheduler's UI model, and the offline harnesses (scripts/check-presence.mjs)
// load them one file at a time. So the arithmetic they need lives here, with no
// imports at all.
//
// THE SAME IDEA AS THE SCHEDULER'S, deliberately: a shift is `date + start +
// end` in the venue's local wall-clock; an end at or before the start means
// "past midnight"; and instants are placed on one absolute-minutes line (days
// since 1970-01-01 × 1440 + minutes into the day) so every question is an
// integer comparison that behaves identically in the browser and in the SQL
// twin (migration 057), including on the two clock-change nights. This
// matches `sched_range()` / `intervalOf()` in the scheduler, which is the point.

export type HM = string
export type ISODate = string

export const MINUTES_PER_DAY = 1440

/** `"17:30"` → 1050. Tolerates `"7:5"` and `"17:30:00"`; returns 0 for junk. */
export function parseHM(hm: HM): number {
  const m = /^(\d{1,2}):(\d{1,2})/.exec(hm?.trim() ?? '')
  if (!m) return 0
  const h = Math.min(23, Math.max(0, Number(m[1])))
  const min = Math.min(59, Math.max(0, Number(m[2])))
  return h * 60 + min
}

/** 1050 → `"17:30"`. Wraps past midnight so 1500 renders as `"01:00"`. */
export function fmtHM(minutes: number): string {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Whole days since 1970-01-01, from a `YYYY-MM-DD` string. Parsed by hand rather
 *  than via `new Date(s)`, which reads a bare date as UTC and renders it in the
 *  host zone — how a schedule ends up a day off. */
export function dayIndex(date: ISODate): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return 0
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000)
}

export function fromDayIndex(index: number): ISODate {
  const d = new Date(index * 86_400_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayIndex(dayIndex(date) + days)
}

/** 0 = Sunday. 1970-01-01 was a Thursday (4). */
export function weekdayOf(date: ISODate): number {
  return (((dayIndex(date) + 4) % 7) + 7) % 7
}

export interface Interval {
  /** Absolute minutes since the epoch. */
  start: number
  end: number
}

/** A shift's absolute interval. An end at or before the start runs past midnight
 *  and lands on the next day — the normal case for a bar. */
export function intervalOf(date: ISODate, start: HM, end: HM): Interval {
  const base = dayIndex(date) * MINUTES_PER_DAY
  const s = parseHM(start)
  let e = parseHM(end)
  if (e <= s) e += MINUTES_PER_DAY
  return { start: base + s, end: base + e }
}

const DAY_NAMES_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

/** "שלישי" for weekday 2. Hebrew only: every caller is a staff/owner surface. */
export const dayNameHe = (weekday: number): string => DAY_NAMES_HE[weekday] ?? ''

/** `"2026-08-16"` → `"16.8"`. */
export function dayNumeric(date: ISODate): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date)
  return m ? `${Number(m[2])}.${Number(m[1])}` : date
}
