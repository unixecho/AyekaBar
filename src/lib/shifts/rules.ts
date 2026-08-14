// The warnings engine.
//
// One pure function over a plain snapshot: same input, same output, no clock,
// no network, no React. That is what makes it runnable from
// `scripts/check-shift-rules.mjs`, from the builder on every keystroke, and
// from the publish RPC — three callers that must never disagree about whether
// a week is safe.
//
// It reports, it does not forbid. A manager sometimes has to schedule a night
// that breaks a rule, and a tool that refuses gets replaced by a WhatsApp
// image again. Errors are loud and publishing asks for confirmation; nothing
// is blocked.

import { hoursForDay } from './config'
import {
  dayIndex, durationMinutes, gapBetween, intervalOf, parseHM, type Interval,
} from './time'
import type {
  Assignment, ISODate, ScheduleSnapshot, Shift, Tri,
} from './types'

export type Severity = 'error' | 'warn' | 'info'

export type WarningCode =
  | 'overlap'
  | 'duplicate'
  | 'min_rest'
  | 'max_weekly_hours'
  | 'max_daily_hours'
  | 'max_consecutive_days'
  | 'missing_role'
  | 'over_role_max'
  | 'unassigned_shift'
  | 'unavailable'
  | 'partial_conflict'
  | 'non_working_day'
  | 'outside_hours'
  | 'inactive_staff'

export interface Warning {
  /** Stable across recomputes so React keys and "dismissed" state survive. */
  id: string
  code: WarningCode
  severity: Severity
  message: Tri
  staffId?: string
  shiftIds: string[]
  date?: ISODate
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 }

interface Placed {
  assignment: Assignment
  shift: Shift
  interval: Interval
  /** Shifts from the weeks either side are read-only context: they can create
   *  a rest violation but never a hours-per-week one. */
  context: boolean
}

/**
 * Evaluate a week. Returns every warning, most severe first, then by date.
 */
export function evaluate(snapshot: ScheduleSnapshot): Warning[] {
  const { settings, shifts, assignments, staff } = snapshot
  const { safety } = settings
  const out: Warning[] = []

  const staffById = new Map(staff.map((s) => [s.id, s]))
  const roleById = new Map(settings.roles.map((r) => [r.id, r]))
  const shiftById = new Map<string, Shift>()
  for (const s of shifts) shiftById.set(s.id, s)
  for (const s of snapshot.neighbouring?.shifts ?? []) shiftById.set(s.id, s)

  const name = (id: string) => staffById.get(id)?.name ?? '—'
  const roleName = (id: string): Tri =>
    roleById.get(id)?.name ?? { he: id, en: id, ar: id }

  // ── per-shift checks ─────────────────────────────────────────────────
  for (const shift of shifts) {
    const mine = assignments.filter((a) => a.shiftId === shift.id)
    const hours = durationMinutes(shift.start, shift.end)
    const when = `${shift.start}–${shift.end}`

    if (!mine.length) {
      out.push({
        id: `unassigned:${shift.id}`,
        code: 'unassigned_shift', severity: 'warn', shiftIds: [shift.id], date: shift.date,
        message: {
          he: `משמרת ${when} ללא אף עובד/ת`,
          en: `Shift ${when} has nobody assigned`,
          ar: `الوردية ${when} بدون أي موظف`,
        },
      })
    }

    // Role coverage. `min` is what the shift cannot run without; `max` is the
    // manager's own ceiling and only warns.
    const byRole = new Map<string, number>()
    for (const a of mine) byRole.set(a.roleId, (byRole.get(a.roleId) ?? 0) + 1)

    for (const req of shift.requirements) {
      const have = byRole.get(req.roleId) ?? 0
      if (have < req.min) {
        const missing = req.min - have
        const r = roleName(req.roleId)
        out.push({
          id: `missing:${shift.id}:${req.roleId}`,
          code: 'missing_role', severity: 'error', shiftIds: [shift.id], date: shift.date,
          message: {
            he: `חסר/ים ${missing} · ${r.he} במשמרת ${when}`,
            en: `${missing} × ${r.en} missing on the ${when} shift`,
            ar: `ينقص ${missing} · ${r.ar} في وردية ${when}`,
          },
        })
      } else if (req.max != null && have > req.max) {
        const r = roleName(req.roleId)
        out.push({
          id: `overmax:${shift.id}:${req.roleId}`,
          code: 'over_role_max', severity: 'warn', shiftIds: [shift.id], date: shift.date,
          message: {
            he: `${have} · ${r.he} במשמרת ${when} — התקן הוא ${req.max}`,
            en: `${have} × ${r.en} on the ${when} shift — the cap is ${req.max}`,
            ar: `${have} · ${r.ar} في وردية ${when} — الحد ${req.max}`,
          },
        })
      }
    }

    if (hours > safety.maxDailyHours * 60) {
      out.push({
        id: `daily:${shift.id}`,
        code: 'max_daily_hours', severity: 'warn', shiftIds: [shift.id], date: shift.date,
        message: {
          he: `משמרת של ${(hours / 60).toFixed(1)} שעות — המקסימום שהוגדר הוא ${safety.maxDailyHours}`,
          en: `A ${(hours / 60).toFixed(1)}-hour shift — the configured maximum is ${safety.maxDailyHours}`,
          ar: `وردية ${(hours / 60).toFixed(1)} ساعة — الحد المضبوط ${safety.maxDailyHours}`,
        },
      })
    }

    const weekday = (((dayIndex(shift.date) + 4) % 7) + 7) % 7
    if (!settings.workingDays.includes(weekday)) {
      out.push({
        id: `closed:${shift.id}`,
        code: 'non_working_day', severity: 'warn', shiftIds: [shift.id], date: shift.date,
        message: {
          he: 'משמרת ביום שהוגדר כסגור',
          en: 'Shift on a day the venue is set to be closed',
          ar: 'وردية في يوم مغلق حسب الإعدادات',
        },
      })
    } else {
      // Friday/Saturday running shorter hours than the rest of the week is
      // the case this exists for, but hoursForDay resolves whichever
      // weekday this shift actually falls on — not always the venue default.
      const { open, close } = hoursForDay(settings, weekday)
      if (outsideOpeningHours(shift, open, close)) {
        out.push({
          id: `hours:${shift.id}`,
          code: 'outside_hours', severity: 'info', shiftIds: [shift.id], date: shift.date,
          message: {
            he: `המשמרת חורגת משעות הפעילות (${open}–${close})`,
            en: `Shift falls outside operating hours (${open}–${close})`,
            ar: `الوردية خارج ساعات العمل (${open}–${close})`,
          },
        })
      }
    }

    // The same person twice on one shift is always a mistake, even in two
    // different roles — they cannot pour and cook at the same time.
    const seen = new Map<string, number>()
    for (const a of mine) seen.set(a.staffId, (seen.get(a.staffId) ?? 0) + 1)
    // `Array.from(map.entries())` rather than `for…of map` throughout this
    // file: the project's tsconfig sets no `target`, so it compiles as ES5 and
    // iterating a Map directly needs --downlevelIteration.
    for (const [staffId, count] of Array.from(seen.entries())) {
      if (count > 1) {
        out.push({
          id: `dupe:${shift.id}:${staffId}`,
          code: 'duplicate', severity: 'error', staffId, shiftIds: [shift.id], date: shift.date,
          message: {
            he: `${name(staffId)} משובץ/ת פעמיים לאותה משמרת`,
            en: `${name(staffId)} is assigned twice to the same shift`,
            ar: `${name(staffId)} مُسند مرتين لنفس الوردية`,
          },
        })
      }
    }
  }

  // ── per-person timeline ──────────────────────────────────────────────
  const timeline = new Map<string, Placed[]>()
  const place = (list: Assignment[], context: boolean) => {
    for (const a of list) {
      const shift = shiftById.get(a.shiftId)
      if (!shift) continue
      const entry: Placed = {
        assignment: a, shift, context,
        interval: intervalOf(shift.date, shift.start, shift.end),
      }
      const bucket = timeline.get(a.staffId)
      if (bucket) bucket.push(entry)
      else timeline.set(a.staffId, [entry])
    }
  }
  place(assignments, false)
  place(snapshot.neighbouring?.assignments ?? [], true)

  const availability = new Map<string, ScheduleSnapshot['availability'][number]>()
  if (settings.features.ENABLE_AVAILABILITY_SUBMISSIONS) {
    for (const sub of snapshot.availability) {
      if (sub.status === 'submitted' && sub.weekStart === snapshot.week.weekStart) {
        availability.set(sub.staffId, sub)
      }
    }
  }

  for (const [staffId, entriesRaw] of Array.from(timeline.entries())) {
    const person = staffById.get(staffId)
    const entries = entriesRaw.slice().sort((a, b) => a.interval.start - b.interval.start)
    const own = entries.filter((e) => !e.context)
    if (!own.length) continue

    if (!person || !person.active) {
      out.push({
        id: `inactive:${staffId}`,
        code: 'inactive_staff', severity: 'error', staffId,
        shiftIds: own.map((e) => e.shift.id),
        message: {
          he: `${person?.name ?? 'עובד/ת שהוסר/ה'} כבר לא פעיל/ה ברשימת הצוות אבל משובץ/ת`,
          en: `${person?.name ?? 'A removed employee'} is no longer on the active roster but is still assigned`,
          ar: `${person?.name ?? 'موظف مُزال'} لم يعد ضمن الطاقم الفعال لكنه مُسند`,
        },
      })
    }

    // Overlaps and rest, walking the sorted timeline once.
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1]
      const cur = entries[i]
      if (prev.context && cur.context) continue // neither belongs to this week

      const gap = gapBetween(prev.interval, cur.interval)
      if (gap < 0) {
        out.push({
          id: `overlap:${staffId}:${prev.shift.id}:${cur.shift.id}`,
          code: 'overlap', severity: 'error', staffId,
          shiftIds: [prev.shift.id, cur.shift.id], date: cur.shift.date,
          message: {
            he: `${name(staffId)} משובץ/ת לשתי משמרות חופפות`,
            en: `${name(staffId)} is booked on two overlapping shifts`,
            ar: `${name(staffId)} مُسند لوردتين متداخلتين`,
          },
        })
      } else if (gap < safety.minRestHours * 60) {
        const restHours = (gap / 60).toFixed(1)
        out.push({
          id: `rest:${staffId}:${prev.shift.id}:${cur.shift.id}`,
          code: 'min_rest', severity: 'error', staffId,
          shiftIds: [prev.shift.id, cur.shift.id], date: cur.shift.date,
          message: {
            he: `ל${name(staffId)} יש ${restHours} שעות מנוחה בלבד בין המשמרות (המינימום ${safety.minRestHours})`,
            en: `${name(staffId)} gets only ${restHours}h rest between shifts (minimum ${safety.minRestHours})`,
            ar: `${name(staffId)} لديه ${restHours} ساعة راحة فقط بين الورديتين (الحد الأدنى ${safety.minRestHours})`,
          },
        })
      }
    }

    // Hours and consecutive days count THIS week only — context shifts inform
    // rest, not quota, or a Sunday would inherit last week's totals.
    const minutes = own.reduce((sum, e) => sum + durationMinutes(e.shift.start, e.shift.end), 0)
    if (minutes > safety.maxWeeklyHours * 60) {
      out.push({
        id: `weekly:${staffId}`,
        code: 'max_weekly_hours', severity: 'error', staffId,
        shiftIds: own.map((e) => e.shift.id),
        message: {
          he: `${name(staffId)} מגיע/ה ל-${(minutes / 60).toFixed(1)} שעות השבוע (המקסימום ${safety.maxWeeklyHours})`,
          en: `${name(staffId)} reaches ${(minutes / 60).toFixed(1)}h this week (maximum ${safety.maxWeeklyHours})`,
          ar: `${name(staffId)} يصل إلى ${(minutes / 60).toFixed(1)} ساعة هذا الأسبوع (الحد ${safety.maxWeeklyHours})`,
        },
      })
    }

    const run = longestRun(own.map((e) => dayIndex(e.shift.date)))
    if (run > safety.maxConsecutiveDays) {
      out.push({
        id: `consecutive:${staffId}`,
        code: 'max_consecutive_days', severity: 'warn', staffId,
        shiftIds: own.map((e) => e.shift.id),
        message: {
          he: `${name(staffId)} עובד/ת ${run} ימים ברצף (המקסימום ${safety.maxConsecutiveDays})`,
          en: `${name(staffId)} works ${run} days in a row (maximum ${safety.maxConsecutiveDays})`,
          ar: `${name(staffId)} يعمل ${run} أيام متتالية (الحد ${safety.maxConsecutiveDays})`,
        },
      })
    }

    // Declared availability, only when the venue has that feature switched on.
    const sub = availability.get(staffId)
    if (sub) {
      for (const e of own) {
        const entry = sub.entries.find((x) => x.date === e.shift.date)
        if (!entry) continue
        if (entry.kind === 'unavailable') {
          out.push({
            id: `unavail:${staffId}:${e.shift.id}`,
            code: 'unavailable', severity: 'warn', staffId,
            shiftIds: [e.shift.id], date: e.shift.date,
            message: {
              he: `${name(staffId)} סימן/ה שאינו/ה זמין/ה ביום הזה`,
              en: `${name(staffId)} marked this day as unavailable`,
              ar: `${name(staffId)} أشار إلى عدم توفره في هذا اليوم`,
            },
          })
        } else if (entry.kind === 'partial' && entry.from && entry.to) {
          const window = intervalOf(e.shift.date, entry.from, entry.to)
          if (e.interval.start < window.start || e.interval.end > window.end) {
            out.push({
              id: `partial:${staffId}:${e.shift.id}`,
              code: 'partial_conflict', severity: 'warn', staffId,
              shiftIds: [e.shift.id], date: e.shift.date,
              message: {
                he: `${name(staffId)} זמין/ה רק ${entry.from}–${entry.to} ביום הזה`,
                en: `${name(staffId)} is only available ${entry.from}–${entry.to} that day`,
                ar: `${name(staffId)} متاح فقط ${entry.from}–${entry.to} في ذلك اليوم`,
              },
            })
          }
        }
      }
    }
  }

  return out.sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || (a.date ?? '').localeCompare(b.date ?? '')
    || a.id.localeCompare(b.id))
}

/** Longest streak of consecutive day numbers. Duplicates (two shifts in one
 *  day) count once — a double is one day worked, not two. */
function longestRun(days: number[]): number {
  const uniq = Array.from(new Set(days)).sort((a, b) => a - b)
  let best = 0
  let run = 0
  for (let i = 0; i < uniq.length; i++) {
    run = i > 0 && uniq[i] === uniq[i - 1] + 1 ? run + 1 : 1
    if (run > best) best = run
  }
  return best
}

/** Does the shift stick out of the venue's advertised operating window?
 *  Both the window and the shift may cross midnight, so everything is
 *  normalised into minutes-from-opening before comparing. */
function outsideOpeningHours(shift: Shift, openTime: string, closeTime: string): boolean {
  const open = parseHM(openTime)
  let close = parseHM(closeTime)
  if (close <= open) close += 1440
  const windowLength = close - open

  let start = parseHM(shift.start) - open
  if (start < 0) start += 1440
  const length = durationMinutes(shift.start, shift.end)
  return start + length > windowLength
}

/** Convenience for the publish gate and the badge counts. */
export function summarize(warnings: Warning[]) {
  return {
    errors: warnings.filter((w) => w.severity === 'error').length,
    warns: warnings.filter((w) => w.severity === 'warn').length,
    infos: warnings.filter((w) => w.severity === 'info').length,
  }
}

/** Warnings that touch a given shift — used to tint a card in the grid. */
export function forShift(warnings: Warning[], shiftId: string): Warning[] {
  return warnings.filter((w) => w.shiftIds.includes(shiftId))
}

/** Worst severity in a list, or null when it is empty. */
export function worst(warnings: Warning[]): Severity | null {
  if (!warnings.length) return null
  return warnings.reduce<Severity>((acc, w) =>
    SEVERITY_ORDER[w.severity] < SEVERITY_ORDER[acc] ? w.severity : acc, 'info')
}
