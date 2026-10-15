// What an EMPLOYEE may tell the scheduler about a week (2026-10-15) — PURE, no React, no Supabase.
// scripts/check-schedule.mjs runs this file.
//
// Owner, 2026-10-15 (the second statement, which supersedes the first): "employees can only submit two days a week for
// vacation", and "leave the private remark to the manager" meant a PRIVATE MESSAGE from the employee to the manager
// about constraints (אילוצים). The bar runs one evening shift a day, so a request is a full day; there is no point
// blocking part of a day. If a day ever has two shifts, blocking one of them is the natural extension.
//
// So the employee's submission is a set of days marked `unavailable` (shown to them as "יום חופש"), capped at
// `maxDaysOff` a week, plus one private note:
//   • the cap is a per-venue number in `shift_settings.features.maxDaysOff` (default 2; the manager can change it in
//     the Manager Panel; no migration — `features` is a jsonb column and a missing key means the default),
//   • the 'prefer' / 'partial' kinds stay in the data model (old submissions still carry them) but the employee
//     screen no longer offers them and the server drops them from an employee's write,
//   • the cap is enforced on the server (dispatch-write.ts) as well as on the screen.

import type { AvailabilityEntry, ISODate } from './types'

/** Default days off a week when the manager has not chosen (owner: "default is 2"). */
export const DEFAULT_MAX_DAYS_OFF = 2
/** A week has seven days; 7 would mean "no limit". */
export const MAX_DAYS_OFF_CEILING = 7

/** The cap for a venue, from its `features` blob. Anything that is not a whole number 0..7 is the default. */
export function maxDaysOffOf(features: { maxDaysOff?: unknown } | null | undefined): number {
  const v = features?.maxDaysOff
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_DAYS_OFF_CEILING ? v : DEFAULT_MAX_DAYS_OFF
}

export const countDaysOff = (entries: readonly AvailabilityEntry[]): number => new Set(entries.filter((e) => e.kind === 'unavailable').map((e) => e.date)).size

/** An employee's write, reduced to what employees may send: one `unavailable` entry per date, no times. Order kept. */
export function employeeEntries(entries: readonly { date: ISODate; kind: string }[]): AvailabilityEntry[] {
  const seen = new Set<string>()
  const out: AvailabilityEntry[] = []
  for (const e of entries) {
    if (e.kind !== 'unavailable' || seen.has(e.date)) continue
    seen.add(e.date)
    out.push({ date: e.date, kind: 'unavailable' })
  }
  return out
}

/** The days still free to mark, never negative. */
export const daysOffLeft = (entries: readonly AvailabilityEntry[], cap: number): number => Math.max(0, cap - countDaysOff(entries))

/** Would marking one more day break the cap? (The screen asks before it sets the chip.) */
export const canAddDayOff = (entries: readonly AvailabilityEntry[], cap: number): boolean => countDaysOff(entries) < cap

/** "2 מתוך 2" style label for the manager's board and the employee's counter. */
export const daysOffLabel = (used: number, cap: number): string => `${used} מתוך ${cap} ימי חופש`
