// Wall-clock week maths. Pure, no Date-with-timezone anywhere in the hot path.
//
// WHY MINUTES AND NOT Date
// Every quantity the schedule cares about — "does Dana's Friday overlap her
// Thursday", "is there 8h between these two", "how many hours this week" — is
// arithmetic on wall-clock minutes. Doing it with Date objects drags in the
// host timezone and DST, and produces a 3-hour night once a year. An absolute
// minute counter (days since the epoch × 1440 + minutes into the day) gives
// exact, comparable, timezone-free values, and the two DST nights read the way
// a human reads them off the printed sheet.

import type { HM, ISODate, Lang } from './types'

export const MINUTES_PER_DAY = 1440

/** `"17:30"` → 1050. Tolerates `"7:5"`; returns 0 for junk. */
export function parseHM(hm: HM): number {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(hm?.trim() ?? '')
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

/** Whole days since 1970-01-01, from a `YYYY-MM-DD` string. Parsed by hand
 *  rather than via `new Date(s)` — that constructor reads a bare date as UTC
 *  and then renders it in the host zone, which is how a schedule ends up one
 *  day off for anyone west of Greenwich. */
export function dayIndex(date: ISODate): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return 0
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000)
}

/** Inverse of `dayIndex`. */
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

/** The first day of the week `date` falls in, for a venue that starts its week
 *  on `weekStartsOn` (0 = Sunday). */
export function weekStartOf(date: ISODate, weekStartsOn = 0): ISODate {
  const back = (weekdayOf(date) - weekStartsOn + 7) % 7
  return addDays(date, -back)
}

/** The seven dates of a week, in order. */
export function weekDates(weekStart: ISODate): ISODate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

/** Today, in the venue's zone. The one place a real clock is consulted. */
export function todayIn(timezone: string): ISODate {
  try {
    // en-CA formats as YYYY-MM-DD, which is exactly the shape we store.
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(new Date())
  }
}

/** Minutes into the current day, in the venue's zone — pairs with todayIn()
 *  to place "right now" on the same absolute-minutes line intervalOf() uses
 *  (dayIndex(todayIn(tz)) * MINUTES_PER_DAY + nowMinutesIn(tz)). The other
 *  place (besides todayIn) that consults a real clock — used for "is it time
 *  to open the shift yet", never for anything that gets stored. */
export function nowMinutesIn(timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date())
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
    return h * 60 + m
  } catch {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  }
}

export interface Interval {
  /** Absolute minutes since the epoch. */
  start: number
  end: number
}

/** A shift's absolute interval. An end at or before the start means the shift
 *  runs past midnight — the normal case for a bar — and lands on the next day. */
export function intervalOf(date: ISODate, start: HM, end: HM): Interval {
  const base = dayIndex(date) * MINUTES_PER_DAY
  const s = parseHM(start)
  let e = parseHM(end)
  if (e <= s) e += MINUTES_PER_DAY
  return { start: base + s, end: base + e }
}

export const crossesMidnight = (start: HM, end: HM): boolean => parseHM(end) <= parseHM(start)

export const durationMinutes = (start: HM, end: HM): number => {
  const s = parseHM(start)
  const e = parseHM(end)
  return e <= s ? e + MINUTES_PER_DAY - s : e - s
}

export const overlaps = (a: Interval, b: Interval): boolean => a.start < b.end && b.start < a.end

/** Minutes of rest between two intervals; negative when they overlap. */
export const gapBetween = (a: Interval, b: Interval): number =>
  a.end <= b.start ? b.start - a.end : b.end <= a.start ? a.start - b.end : -1

/** `330` → `"5:30"`. Hours are what a manager counts in, so a bare decimal
 *  ("5.5 ש׳") reads worse than the clock form they already use. */
export function fmtDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : ''
  const abs = Math.abs(minutes)
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`
}

const DAY_NAMES: Record<Lang, string[]> = {
  he: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ar: ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
}

const DAY_SHORT: Record<Lang, string[]> = {
  he: ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ar: ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'],
}

export const dayName = (weekday: number, lang: Lang): string => DAY_NAMES[lang][weekday] ?? ''
export const dayShort = (weekday: number, lang: Lang): string => DAY_SHORT[lang][weekday] ?? ''

/** `"2026-08-16"` → `"16.8"`. Numeric and compact, so it fits a column head on
 *  a phone in any of the three languages. */
export function dayNumeric(date: ISODate): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date)
  return m ? `${Number(m[2])}.${Number(m[1])}` : date
}

/** "16.8 – 22.8" for a week header. Written in the same numeric form for all
 *  three languages so the direction of the range never has to flip. */
export function weekLabel(weekStart: ISODate): string {
  return `${dayNumeric(weekStart)} – ${dayNumeric(addDays(weekStart, 6))}`
}
