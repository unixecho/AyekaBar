// Who is on shift, when — the PURE half of "the POS is synced with the
// schedule" (2026-10-13). No React, no Supabase, no Next.
//
// Three consumers read the same answers from here, so they cannot disagree:
//   • the staff dashboard's shift quick-view (src/lib/staff/my-shifts.ts),
//   • the Z-report gate (src/lib/zreport/rules.ts — "who is set for tonight"),
//   • the waiter-call recipient rule, whose SQL twin is
//     `waiter_is_call_recipient()` in migration 056. THE TWO ARE ONE RULE
//     SPELLED TWICE: change one, change the other (the lib/staff/access.ts ↔
//     is_op() precedent, and the same reason `scripts/check-presence.mjs`
//     pins the numbers below).
//
// WALL-CLOCK, like the rest of the module (types.ts header): a shift is
// `date + start + end` in the venue's local time and "now" is placed on the
// same absolute-minutes line intervalOf() uses. The one thing this file adds
// to time.ts is `zonedNow()`, which reads date AND minutes from a SINGLE
// formatter call — todayIn() + nowMinutesIn() are two separate clock reads,
// and at 23:59:59.9 they can straddle midnight and answer "yesterday, 00:00".

import { MINUTES_PER_DAY, dayIndex, intervalOf, parseHM, fmtHM, addDays } from './time'
import type { HM, ISODate } from './types'

/** Staff keep working after the planned end — chairs up, tills counted. The
 *  waiter-call rule treats someone as still "on shift" for this long after
 *  their shift's end, so a call at 01:10 after a 01:00 close still reaches the
 *  person who is still in the room. SQL twin: `v_grace` in 056. */
export const SHIFT_END_GRACE_MINUTES = 30

/** A shift counts as "starting soon" this long before it begins (the OMS
 *  announcement and the quick-view badge). */
export const SHIFT_SOON_MINUTES = 30
/** …and as "ending soon" this long before it ends. */
export const SHIFT_ENDING_MINUTES = 15

export interface PresenceAssignment {
  roleId?: string
  staffId?: string | null
  staffName?: string
}

/** The slice of a published-snapshot shift this module needs. */
export interface PresenceShift {
  id?: string
  date: ISODate
  start: HM
  end: HM
  assignments?: PresenceAssignment[]
}

export interface ZonedNow {
  date: ISODate
  /** Minutes into the local day. */
  minutes: number
  /** Absolute minutes — the same line intervalOf() puts shifts on. */
  abs: number
}

/** "Now" in a venue's zone, from one clock read. `at` exists so the harness
 *  can pin the instant instead of racing the real clock. */
export function zonedNow(timezone: string, at: Date = new Date()): ZonedNow {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(at)
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(at)
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0'
  // Some engines render midnight as "24" under hour12:false; fold it to 0.
  const hour = Number(get('hour')) % 24
  const minutes = hour * 60 + Number(get('minute'))
  const date = `${get('year')}-${get('month')}-${get('day')}`
  return { date, minutes, abs: dayIndex(date) * MINUTES_PER_DAY + minutes }
}

export const shiftInterval = (s: PresenceShift) => intervalOf(s.date, s.start, s.end)

export const isAssignedTo = (s: PresenceShift, staffId: string | null | undefined): boolean =>
  !!staffId && (s.assignments ?? []).some((a) => a.staffId === staffId)

/** Is `abs` inside the shift, with an optional tail after the end. */
export function shiftCovers(s: PresenceShift, abs: number, graceMinutes = 0): boolean {
  const { start, end } = shiftInterval(s)
  return abs >= start && abs < end + graceMinutes
}

/** Every shift covering `abs`. */
export const shiftsRunningAt = (shifts: PresenceShift[], abs: number, graceMinutes = 0): PresenceShift[] =>
  shifts.filter((s) => shiftCovers(s, abs, graceMinutes))

export interface MyShiftState {
  /** The shift this person is working RIGHT NOW (if more than one overlaps,
   *  the one that started first). */
  current: PresenceShift | null
  /** Minutes until `current` ends. */
  endsInMinutes: number | null
  /** The next shift they are assigned to that has not started. */
  next: PresenceShift | null
  startsInMinutes: number | null
  /** The next few, soonest first — `next` is the first of them. */
  upcoming: PresenceShift[]
  /** Planned minutes across `current` + `upcoming` falling on `today`'s
   *  calendar date — "tonight's hours". */
  todayMinutes: number
}

/** A person's shift state. Pure over its inputs. `limit` bounds `upcoming`. */
export function myShiftState(
  shifts: PresenceShift[], staffId: string | null | undefined, now: ZonedNow, limit = 3,
): MyShiftState {
  const mine = shifts
    .filter((s) => isAssignedTo(s, staffId))
    .map((s) => ({ s, iv: shiftInterval(s) }))
    .sort((a, b) => a.iv.start - b.iv.start)

  const cur = mine.find(({ iv }) => now.abs >= iv.start && now.abs < iv.end) ?? null
  const future = mine.filter(({ iv }) => iv.start > now.abs)

  const todayMinutes = mine
    .filter(({ s, iv }) => s.date === now.date && iv.end > now.abs)
    .reduce((sum, { iv }) => sum + (iv.end - Math.max(iv.start, now.abs)), 0)

  return {
    current: cur?.s ?? null,
    endsInMinutes: cur ? cur.iv.end - now.abs : null,
    next: future[0]?.s ?? null,
    startsInMinutes: future[0] ? future[0].iv.start - now.abs : null,
    upcoming: future.slice(0, limit).map((f) => f.s),
    todayMinutes,
  }
}

/** Has the venue published ANY shift touching today? When it hasn't, the
 *  schedule is "not in use yet" and nothing may be conditioned on it —
 *  otherwise a bar that has not started using the scheduler could never
 *  receive a call, upload a Z report, or open a shift. Mirrors the SQL twin's
 *  `v_in_use`. "Touching today" = a shift dated yesterday (it may run past
 *  midnight into today), today, or tomorrow (an early look-ahead is not "in
 *  use" for the purposes of tonight — it is excluded on purpose). */
export function scheduleInUse(shifts: PresenceShift[], now: ZonedNow): boolean {
  const y = addDays(now.date, -1)
  return shifts.some((s) => s.date === now.date || s.date === y)
}

/** Who may receive a customer's waiter call right now — the TS twin of
 *  `waiter_is_call_recipient()`. The caller supplies the facts it has already
 *  read (the badge test, the active manual shift); this function only owns the
 *  SCHEDULE half of the rule:
 *
 *    schedule not in use       → everyone the badge test lets through
 *    schedule in use           → only people assigned to a shift covering
 *                                 now, plus SHIFT_END_GRACE_MINUTES after it
 */
export function onShiftForCalls(
  shifts: PresenceShift[], staffId: string | null | undefined, now: ZonedNow,
): { eligible: boolean; reason: 'schedule_not_in_use' | 'scheduled' | 'not_scheduled' } {
  if (!scheduleInUse(shifts, now)) return { eligible: true, reason: 'schedule_not_in_use' }
  const mine = shiftsRunningAt(shifts, now.abs, SHIFT_END_GRACE_MINUTES).some((s) => isAssignedTo(s, staffId))
  return mine ? { eligible: true, reason: 'scheduled' } : { eligible: false, reason: 'not_scheduled' }
}

// ── Announcements (the OMS reads these; the dashboard quick-view too) ─────

export type ShiftAnnouncementKind = 'starting_soon' | 'started' | 'ending_soon' | 'ended'

export interface ShiftAnnouncement {
  /** Stable per (shift, kind) — the same moment gives the same id on every
   *  device, which is what lets a client dedupe "already shown" locally. */
  id: string
  kind: ShiftAnnouncementKind
  shiftKey: string
  date: ISODate
  start: HM
  end: HM
  /** Absolute minute the announcement belongs to. */
  atAbs: number
}

/** The announcements that are "live" at `now`: for each shift, at most the
 *  ONE latest moment that has already happened, and only while it is still
 *  fresh (`freshMinutes`). A client that loads at 19:40 therefore sees "the
 *  shift started 40 min ago"-class news only if it is within the window, and
 *  never a backlog of four stale lines for one shift.
 *
 *  Moments, per shift: start − SHIFT_SOON_MINUTES (starting_soon), start
 *  (started), end − SHIFT_ENDING_MINUTES (ending_soon), end (ended). */
export function liveShiftAnnouncements(
  shifts: PresenceShift[], now: ZonedNow, freshMinutes = 10,
): ShiftAnnouncement[] {
  const out: ShiftAnnouncement[] = []
  for (const s of shifts) {
    const { start, end } = shiftInterval(s)
    const key = s.id ?? `${s.date}T${s.start}-${s.end}`
    const moments: [ShiftAnnouncementKind, number][] = [
      ['starting_soon', start - SHIFT_SOON_MINUTES],
      ['started', start],
      ['ending_soon', end - SHIFT_ENDING_MINUTES],
      ['ended', end],
    ]
    let latest: [ShiftAnnouncementKind, number] | null = null
    for (const m of moments) if (m[1] <= now.abs) latest = m
    if (!latest) continue
    if (now.abs - latest[1] > freshMinutes) continue
    out.push({
      id: `${key}:${latest[0]}`, kind: latest[0], shiftKey: key,
      date: s.date, start: s.start, end: s.end, atAbs: latest[1],
    })
  }
  return out.sort((a, b) => b.atAbs - a.atAbs)
}

/** `HH:MM–HH:MM` for display. */
export const fmtShiftRange = (s: Pick<PresenceShift, 'start' | 'end'>): string =>
  `${fmtHM(parseHM(s.start))}–${fmtHM(parseHM(s.end))}`
