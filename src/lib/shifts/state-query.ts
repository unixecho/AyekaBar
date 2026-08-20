// Server-only. Assembles one `ShiftsDB` window from Supabase, using the
// CALLER'S OWN session client — never service-role (see guard.ts's header for
// why that matters here specifically). Shared by both `/api/shifts/state`
// (GET) and `/api/shifts/dispatch` (POST, which re-runs this after a write so
// the response is always a fresh read of what actually landed, not an
// optimistic guess).
//
// THE WINDOW. `db.weeks`/`db.shifts`/`db.assignments`/`db.availability` cover
// exactly three weeks — the one requested, and the ones immediately before
// and after it. That is precisely what `neighbouringOf()` in store.ts ever
// reads (cross-week rest checks look one week either side, never two), and
// it is what every existing pure function in this module already expects —
// nothing above this file needed to change to accept a windowed `ShiftsDB`
// instead of the mock's everything-in-memory one. `db.published` is fetched
// for the same three weeks. `db.staff` (the roster) and `db.settings` are
// venue-wide and unwindowed — they are small, single rows/short lists, read
// in full every time. `db.audit` and `db.swaps` are capped rather than
// windowed by date, matching PLAN_SHIFTS.md Part II decision D10 ("not all
// history").

import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays } from './time'
import {
  rowToAssignment, rowToAudit, rowToAvailability, rowToPublishedWeek,
  rowToRosterStaff, rowToSettings, rowToShift, rowToSwap, rowToVenue, rowToWeek,
} from './serialize'
import type { ShiftsDB } from './store'
import type { ISODate } from './types'

const AUDIT_LIMIT = 100
const SWAP_LIMIT = 200

function unwrap<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`shifts state: ${what}: ${res.error.message}`)
  return res.data as T
}

export async function loadShiftsState(
  supabase: SupabaseClient, venueId: string, weekStart: ISODate,
): Promise<ShiftsDB> {
  const weekStarts = [addDays(weekStart, -7), weekStart, addDays(weekStart, 7)]

  const [venueRes, settingsRes, rosterRes, weeksRes, publishedRes, availabilityRes, swapsRes, auditRes] =
    await Promise.all([
      supabase.from('venues')
        .select('id, slug, name, timezone, week_starts_on')
        .eq('id', venueId).single(),
      supabase.from('shift_settings')
        .select('venue_id, working_days, open_time, close_time, day_hours, presets, roles, stations, safety, features, schedule_managers, rule_severity, onboarded_at')
        .eq('venue_id', venueId).single(),
      // Any signed-in staff member may read this (schedule_roster is not
      // manager-gated — see migration 027's comment on it); RLS on the
      // underlying tables is unaffected either way.
      supabase.from('schedule_roster')
        .select('staff_id, name, initial, colour, badge, role, pending, schedulable, default_role_id, max_weekly_hours, employment_type, sort_order, note')
        .eq('venue_id', venueId).order('name'),
      // Manager-only at the row level: a non-manager's session gets [] here,
      // not an error — that IS the "draft invisible until published"
      // guarantee (Part I decision D6), enforced by Postgres, not this file.
      supabase.from('schedule_weeks')
        .select('id, venue_id, week_start, status, version, published_at, published_by, day_notes, dismissed_warnings')
        .eq('venue_id', venueId).in('week_start', weekStarts),
      // Readable by anyone on staff — this is the ONLY schedule surface a
      // non-manager sees populated.
      supabase.from('published_schedule')
        .select('id, venue_id, week_start, version, published_at, published_by, day_notes, published_snapshot')
        .eq('venue_id', venueId).in('week_start', weekStarts),
      // Each person's own rows, or every row for a manager (shift_availability
      // policies) — RLS narrows this per caller.
      supabase.from('shift_availability')
        .select('id, venue_id, staff_id, week_start, entries, note, status, submitted_at')
        .eq('venue_id', venueId).in('week_start', weekStarts),
      // Not windowed by week — an open offer is addressed to the whole team
      // regardless of which week is on screen, and any staff member may read
      // the venue's swaps (shift_swaps_read policy). Capped, not unbounded.
      supabase.from('shift_swaps')
        .select('id, venue_id, assignment_id, from_staff_id, to_staff_id, status, reason, created_at, peer_responded_at, decided_at, decided_by, decision_note')
        .eq('venue_id', venueId).order('created_at', { ascending: false }).limit(SWAP_LIMIT),
      // Manager-only (shift_audit_read); [] for anyone else. Newest first,
      // capped — full history paginates separately once that matters.
      supabase.from('shift_audit')
        .select('id, venue_id, at, actor_id, actor_name, action, summary, diff')
        .eq('venue_id', venueId).order('at', { ascending: false }).limit(AUDIT_LIMIT),
    ])

  const venue = unwrap(venueRes, 'venue')
  const settings = unwrap(settingsRes, 'settings')
  const roster = unwrap(rosterRes, 'roster')
  const weeks = unwrap(weeksRes, 'weeks')
  const published = unwrap(publishedRes, 'published')
  const availability = unwrap(availabilityRes, 'availability')
  const swaps = unwrap(swapsRes, 'swaps')
  const audit = unwrap(auditRes, 'audit')

  // Shifts/assignments depend on which weeks actually came back (empty for a
  // non-manager — see above), so they run as a second round-trip rather than
  // in the Promise.all above.
  const weekIds = weeks.map((w) => w.id as string)
  const shiftsRes = weekIds.length
    ? await supabase.from('shifts')
        .select('id, venue_id, week_id, shift_date, start_time, end_time, preset_id, station_id, requirements, note')
        .in('week_id', weekIds)
    : { data: [], error: null }
  const shifts = unwrap(shiftsRes, 'shifts')

  const shiftIds = shifts.map((s) => s.id as string)
  const assignmentsRes = shiftIds.length
    ? await supabase.from('shift_assignments')
        .select('id, venue_id, shift_id, staff_id, staff_name, role_id, status')
        .in('shift_id', shiftIds)
    : { data: [], error: null }
  const assignments = unwrap(assignmentsRes, 'assignments')

  const publishedMap: ShiftsDB['published'] = {}
  for (const row of published) {
    const pw = rowToPublishedWeek(row)
    publishedMap[pw.week.weekStart] = pw
  }

  return {
    venue: rowToVenue(venue),
    settings: rowToSettings(settings),
    staff: roster.map(rowToRosterStaff),
    weeks: weeks.map(rowToWeek),
    shifts: shifts.map(rowToShift),
    assignments: assignments.map(rowToAssignment),
    published: publishedMap,
    availability: availability.map(rowToAvailability),
    swaps: swaps.map(rowToSwap),
    audit: audit.map(rowToAudit),
  }
}
