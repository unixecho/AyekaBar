// What the dashboard's shift container shows — "the dashboard should have a
// container for shift that gives stats on last shift and notifies you when
// the new shift will start," 2026-08-30.
//
// Ties together two systems that otherwise don't know about each other:
//   - waiter_shift_sessions (this repo's /api/owner/shifts) — the actual
//     on/off switch a human flips with פתיחת/סיום משמרת. No idea what hours
//     anyone planned.
//   - the published shift SCHEDULE (src/lib/shifts/, readTodayShifts in
//     signals.ts) — the planned hours. No idea whether anyone actually
//     opened for business.
//
// This module reads both and answers "so what do I tell the owner right
// now" — same server-only, service-role, swallow-your-own-errors posture as
// signals.ts and signal-details.ts. Deliberately still not a real
// integration: opening a shift stays a human clicking פתיחת משמרת
// (requireOwner-gated) no matter what the schedule says — this only reads
// the schedule to decide what to SAY, never to act on its own.

import { createServiceClient } from '@/lib/supabase/server'
import { AYEKA_VENUE } from '@/lib/shifts/config'
import { dayIndex, fmtDuration, intervalOf, nowMinutesIn } from '@/lib/shifts/time'
import { readTodayShifts } from './signals'

type Service = ReturnType<typeof createServiceClient>

export interface ActiveShiftStatus {
  startedAt: string
  startedByName: string | null
  minutesActive: number
}

export interface LastShiftStatus {
  startedAt: string
  endedAt: string
  durationLabel: string
}

export interface NextShiftStatus {
  /** "today" or "tomorrow" — the card names the day, not just a clock time,
   *  since "מתחילה ב-19:00" means something different the night before. */
  when: 'today' | 'tomorrow'
  start: string
  startsInMinutes: number
}

export interface ShiftStatusData {
  known: boolean
  active: ActiveShiftStatus | null
  lastShift: LastShiftStatus | null
  nextShift: NextShiftStatus | null
}

const UNKNOWN: ShiftStatusData = { known: false, active: null, lastShift: null, nextShift: null }

function staffFullName(s: { display_name: string | null; first_name: string | null; last_name: string | null; email: string | null } | undefined | null): string | null {
  if (!s) return null
  return s.display_name?.trim()
    || [s.first_name, s.last_name].filter(Boolean).join(' ').trim()
    || s.email || null
}

/** The earliest shift start today (or tomorrow, if today's are all done) —
 *  "the day's opening time," the one moment that decides whether a
 *  reminder or a "not started" alert is warranted. A day can carry several
 *  shift rows (one per role/station) sharing or straddling a start time;
 *  this takes the single earliest one, since that's the moment the bar is
 *  meant to actually open. */
async function earliestUpcomingShift(service: Service): Promise<NextShiftStatus | null> {
  const { today, shifts, known } = await readTodayShifts(service)
  if (!known) return null

  const tz = AYEKA_VENUE.timezone
  const nowAbs = dayIndex(today) * 1440 + nowMinutesIn(tz)

  let best: { when: 'today' | 'tomorrow'; start: string; startAbs: number } | null = null
  for (const s of shifts) {
    if (!s.start || !s.date) continue
    const end = s.end || s.start
    const interval = intervalOf(s.date, s.start, end)
    // Skip a shift whose whole window is already behind us — "today's
    // shift" that ended hours ago isn't the next one, whatever's left today
    // (or tomorrow) is.
    if (interval.end <= nowAbs) continue
    if (best && interval.start >= best.startAbs) continue
    best = { when: s.date === today ? 'today' : 'tomorrow', start: s.start, startAbs: interval.start }
  }
  if (!best) return null
  return { when: best.when, start: best.start, startsInMinutes: best.startAbs - nowAbs }
}

export async function readShiftStatus(): Promise<ShiftStatusData> {
  let service: Service
  try {
    service = createServiceClient()
  } catch {
    return UNKNOWN
  }

  try {
    const [{ data: active }, { data: lastClosed }, nextShift] = await Promise.all([
      service.from('waiter_shift_sessions').select('started_at, started_by').eq('status', 'active').maybeSingle(),
      service.from('waiter_shift_sessions').select('started_at, ended_at').eq('status', 'closed')
        .order('ended_at', { ascending: false }).limit(1).maybeSingle(),
      earliestUpcomingShift(service),
    ])

    const staffIds = [active?.started_by].filter((id): id is string => !!id)
    const { data: staffRows } = staffIds.length
      ? await service.from('staff').select('id, display_name, first_name, last_name, email').in('id', staffIds)
      : { data: [] as { id: string; display_name: string | null; first_name: string | null; last_name: string | null; email: string | null }[] }
    const staffById = new Map((staffRows ?? []).map((s) => [s.id, s]))

    const activeStatus: ActiveShiftStatus | null = active ? {
      startedAt: active.started_at,
      startedByName: staffFullName(staffById.get(active.started_by ?? '')),
      minutesActive: Math.max(0, Math.round((Date.now() - Date.parse(active.started_at)) / 60_000)),
    } : null

    const lastShiftStatus: LastShiftStatus | null = (lastClosed?.started_at && lastClosed?.ended_at) ? {
      startedAt: lastClosed.started_at,
      endedAt: lastClosed.ended_at,
      durationLabel: fmtDuration(Math.round((Date.parse(lastClosed.ended_at) - Date.parse(lastClosed.started_at)) / 60_000)),
    } : null

    return { known: true, active: activeStatus, lastShift: lastShiftStatus, nextShift }
  } catch {
    return UNKNOWN
  }
}

/** Exported for signals.ts's own shift-reminder signal, so both read the
 *  exact same "earliest upcoming shift" rather than two slightly different
 *  ideas of it. */
export { earliestUpcomingShift }
