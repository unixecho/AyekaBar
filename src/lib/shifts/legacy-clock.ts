// Wall-clock helpers the rest of the app (the dashboard signals, the shift status
// card) use to ask "what is the date / how many minutes into the day is it in the
// venue's zone". They predate the scheduler rewrite and are deliberately kept
// apart from time.ts, whose intervalOf() answers a different question (minutes
// within a schedule week, from a Shift).

export type HM = string
export type ISODate = string

export const MINUTES_PER_DAY = 1440

export function parseHM(hm: HM): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(hm)
  if (!m) return 0
  return Number(m[1]) * 60 + Number(m[2])
}

/** Whole days since the epoch for a YYYY-MM-DD date. */
export function dayIndex(date: ISODate): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return 0
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000)
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = new Date(Date.UTC(1970, 0, 1) + (dayIndex(date) + days) * 86_400_000)
  return d.toISOString().slice(0, 10)
}

export function todayIn(timezone: string): ISODate {
  try {
    // en-CA formats as YYYY-MM-DD, which is exactly the shape we store.
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(new Date())
  }
}

export function nowMinutesIn(timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
    return h * 60 + m
  } catch {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  }
}

export type Interval = { start: number; end: number }

/** A shift as absolute minutes since the epoch; an end at or before the start runs past midnight. */
export function absoluteInterval(date: ISODate, start: HM, end: HM): Interval {
  const base = dayIndex(date) * MINUTES_PER_DAY
  const s = parseHM(start)
  let e = parseHM(end)
  if (e <= s) e += MINUTES_PER_DAY
  return { start: base + s, end: base + e }
}

/** "7:05" — hours:minutes, for a duration in minutes. */
export function fmtDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : ''
  const abs = Math.abs(minutes)
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`
}
