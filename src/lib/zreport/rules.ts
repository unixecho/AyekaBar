// The Z-report's rules — PURE (no React, no Supabase, no Next), so the clock
// gate and the eligibility logic can be checked to exhaustion in milliseconds
// by scripts/check-zreport.mjs. Same discipline as lib/cart, lib/feedback and
// lib/shifts.
//
// WHAT A Z REPORT IS HERE. The till's end-of-day closing slip: a printout that
// zeroes the register's daily totals. The shift manager (or the general
// manager) photographs or scans it and uploads it; the owner reads the
// archive. The file is the record — the optional total typed beside it is a
// convenience for the owner's list, not a ledger.
//
// ── THE CLOCK RULE (owner, 2026-10-13) ───────────────────────────────────
//   "the Z report submission should only be allowed and should only show
//    after 23:00 Israeli time."
//
// Read literally ("23:00–23:59") that would lock out a manager who closes at
// 01:30 and uploads at 02:00 — the NORMAL case at a bar whose evening shift
// runs 18:00–01:00. So the rule is applied to the BUSINESS DAY, not the
// calendar day:
//
//   • a business day D opens for its Z report at 23:00 on D, and
//   • stays open until BUSINESS_DAY_ROLLOVER_HOUR (06:00) the next morning,
//     still filed under D.
//
// Between 06:00 and 22:59 there is no open window: the form is neither shown
// nor accepted. Nothing can ever be filed for day D before 23:00 on D. Both
// numbers are constants below — if the owner meant the strict reading
// (23:00–23:59 and no later), set BUSINESS_DAY_ROLLOVER_HOUR to 0.
//
// THE SERVER IS THE GATE. The browser's clock is the user's to change and the
// UI is only courtesy; /api/zreport re-derives the window from the server's
// own clock with `zWindow()` and refuses a submission outside it.

import { addDays, dayName, dayNumeric, weekdayOf } from '../shifts/time'
import { isAssignedTo, zonedNow, type PresenceShift, type ZonedNow } from '../shifts/presence'
import type { ISODate } from '../shifts/types'

export const Z_TIMEZONE = 'Asia/Jerusalem'
/** The window opens at this local hour on the business day itself. */
export const Z_OPEN_HOUR = 23
/** A night's trading belongs to the previous date until this local hour. */
export const BUSINESS_DAY_ROLLOVER_HOUR = 6

export const Z_MAX_BYTES = 8 * 1024 * 1024
export const Z_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
export type ZMime = (typeof Z_ALLOWED_MIME)[number]
export const Z_NOTE_MAX = 500
/** ₪ 1,000,000 — a till total above this is a typo, not a night. */
export const Z_TOTAL_MAX_AGOROT = 100_000_000

export interface ZWindow {
  open: boolean
  /** The business day a submission now would be filed under — or, while
   *  closed, the one the next window will belong to. */
  businessDate: ISODate
  /** While closed: minutes until it opens. */
  opensInMinutes: number | null
  /** While open: minutes until the rollover closes it. */
  closesInMinutes: number | null
  now: ZonedNow
}

/** Is a Z report allowed right now, and for which business day? `at` is the
 *  instant (defaults to the real clock; the harness passes fixed ones). */
export function zWindow(at: Date = new Date()): ZWindow {
  const now = zonedNow(Z_TIMEZONE, at)
  const open0 = Z_OPEN_HOUR * 60
  const close = BUSINESS_DAY_ROLLOVER_HOUR * 60
  if (now.minutes >= open0) {
    return {
      open: true, businessDate: now.date, opensInMinutes: null,
      closesInMinutes: 1440 - now.minutes + close, now,
    }
  }
  if (now.minutes < close) {
    return {
      open: true, businessDate: addDays(now.date, -1), opensInMinutes: null,
      closesInMinutes: close - now.minutes, now,
    }
  }
  return {
    open: false, businessDate: now.date, opensInMinutes: open0 - now.minutes,
    closesInMinutes: null, now,
  }
}

// ── Who may submit ────────────────────────────────────────────────────────

/** The people who may file a Z report at all: the shift manager and the
 *  general manager by JOB TITLE, plus OP (the owner and the dev can always
 *  step in). A waiter is never eligible, scheduled or not. Mirrors nothing in
 *  SQL — the write goes through the service role behind the API route, so
 *  there is no RLS twin to keep in step. */
export function hasZReportTitle(row: { role?: string | null; badge?: string | null } | null | undefined): boolean {
  if (!row) return false
  if (row.role === 'owner' || row.badge === 'owner') return true
  const b = (row.badge ?? '').trim().toLowerCase()
  return b === 'general_manager' || b === 'manager' || b === 'dev'
}

export type ZEligibilityReason =
  | 'override'             // OP / dev — always may
  | 'scheduled'            // a manager assigned to that night's shift
  | 'schedule_not_in_use'  // nothing published yet → any manager (fallback)
  | 'not_scheduled'        // a manager who is NOT on that night's shift
  | 'no_title'             // not a manager at all

export interface ZEligibility { allowed: boolean; reason: ZEligibilityReason }

/** "The Shift Manager or General manager that is set for the shift."
 *
 *  `shifts` = the published shifts for the venue (any that touch the business
 *  date; the function filters). `isOverride` is OP-or-dev, computed by the
 *  caller from lib/staff/access.ts so this file need not import it.
 *
 *  FALLBACK, stated plainly because it is a judgement call: while the venue
 *  has published NO shifts for the business day (the bar is not using the
 *  scheduler yet — true today), every manager/GM may file. Requiring a
 *  schedule that does not exist would make the feature unusable; the moment
 *  the first shift for that day is published, the strict rule takes over. */
export function zEligibility(args: {
  titleOk: boolean
  isOverride: boolean
  staffId: string | null | undefined
  shifts: PresenceShift[]
  businessDate: ISODate
}): ZEligibility {
  if (args.isOverride) return { allowed: true, reason: 'override' }
  if (!args.titleOk) return { allowed: false, reason: 'no_title' }

  const ofTheNight = args.shifts.filter((s) => s.date === args.businessDate)
  if (ofTheNight.length === 0) return { allowed: true, reason: 'schedule_not_in_use' }
  const mine = ofTheNight.some((s) => isAssignedTo(s, args.staffId))
  return mine ? { allowed: true, reason: 'scheduled' } : { allowed: false, reason: 'not_scheduled' }
}

// ── The file ──────────────────────────────────────────────────────────────

/** Identify a file by its first bytes, never by the name or the MIME the
 *  browser claims — both are the uploader's to choose. */
export function sniffMime(b: Uint8Array): ZMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (
    b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) return 'image/png'
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50   // WEBP
  ) return 'image/webp'
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) {
    return 'application/pdf'
  }
  return null
}

export const Z_EXTENSION: Record<ZMime, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
}

/** "1,234.50" / "1234,5" / "₪ 980" → agorot, or null if it is not a plain
 *  amount. Deliberately strict: a till total that parses to something odd is
 *  refused, not guessed at. */
export function parseShekelsToAgorot(input: string | null | undefined): number | null {
  if (input == null) return null
  const cleaned = String(input).replace(/[\s₪]/g, '').replace(/,(?=\d{3}(\D|$))/g, '')
  if (!cleaned) return null
  const normalised = cleaned.replace(',', '.')
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(normalised)) return null
  const agorot = Math.round(Number(normalised) * 100)
  return Number.isFinite(agorot) ? agorot : null
}

export type ZSubmissionError =
  | 'no_file' | 'too_big' | 'empty' | 'bad_type' | 'bad_total' | 'note_too_long'

export function validateZSubmission(args: {
  size: number
  sniffed: ZMime | null
  totalInput?: string | null
  note?: string | null
}): { ok: true; totalAgorot: number | null; note: string } | { ok: false; error: ZSubmissionError } {
  if (!args.size) return { ok: false, error: 'empty' }
  if (args.size > Z_MAX_BYTES) return { ok: false, error: 'too_big' }
  if (!args.sniffed) return { ok: false, error: 'bad_type' }
  let totalAgorot: number | null = null
  if (args.totalInput != null && String(args.totalInput).trim() !== '') {
    totalAgorot = parseShekelsToAgorot(args.totalInput)
    if (totalAgorot == null || totalAgorot > Z_TOTAL_MAX_AGOROT) return { ok: false, error: 'bad_total' }
  }
  const note = (args.note ?? '').trim()
  if (note.length > Z_NOTE_MAX) return { ok: false, error: 'note_too_long' }
  return { ok: true, totalAgorot, note }
}

/** The storage path of an upload: the business date plus a random id, so a
 *  replacement never overwrites the file it replaces (the old one is kept —
 *  a correction is a new file, same rule as the audit tables). */
export const zStoragePath = (businessDate: ISODate, id: string, mime: ZMime): string =>
  `${businessDate}/${id}.${Z_EXTENSION[mime]}`

/** "יום שלישי, 13.10" — how a business date reads on the form and in the
 *  archive. Hebrew only (a staff/owner surface). */
export const businessDateLabel = (date: ISODate): string =>
  `יום ${dayName(weekdayOf(date), 'he')}, ${dayNumeric(date)}`

/** "₪12,345.50" from integer agorot. */
export function fmtShekels(agorot: number | null | undefined): string | null {
  if (agorot == null) return null
  const whole = Math.floor(agorot / 100)
  const frac = agorot % 100
  const int = whole.toLocaleString('en-US')
  return frac === 0 ? `₪${int}` : `₪${int}.${String(frac).padStart(2, '0')}`
}
