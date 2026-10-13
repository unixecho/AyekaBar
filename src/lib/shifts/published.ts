// Server-only reader for the PUBLISHED schedule, shaped for presence.ts.
//
// WHY ANOTHER READER, when signals.ts already has readTodayShifts(): that one
// answers "what is on today and tomorrow" for the owner's counts and is
// deliberately narrow. Everything the 2026-10-13 work needs — a staff member's
// own upcoming shifts, tonight's roster for the Z-report gate, the OMS's
// "schedule in use" question — wants a configurable date range and the shape
// presence.ts consumes. It is the same data source (the frozen
// `schedule_weeks.published_snapshot`, never the draft tables — see the long
// note on readSchedule() in lib/owner/signals.ts for why that distinction is
// the whole point) and it follows the same posture: it never throws, and a
// failed read is "unknown", never a confident zero.
//
// SERVICE ROLE: published snapshots are readable by staff under RLS, but the
// callers here are server components and API routes that have already decided
// who the viewer is and what they may see; they pass a service client so one
// read serves the page.

import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays } from './time'
import type { PresenceShift } from './presence'
import type { ISODate } from './types'

type Service = SupabaseClient

interface RawSnapshotShift {
  id?: string
  date?: string
  start?: string
  end?: string
  assignments?: { roleId?: string; staffId?: string | null; staffName?: string }[]
}

export interface PublishedRead {
  /** False only when the read itself failed — "nothing published" is
   *  `known: true, shifts: []`. */
  known: boolean
  venueId: string | null
  shifts: PresenceShift[]
  /** roleId → display name, from the venue's LIVE catalog (shift_settings),
   *  so a renamed role reads correctly. Empty if the read failed; callers
   *  fall back to the id, which is visibly raw rather than confidently wrong. */
  roleNames: Record<string, string>
}

const EMPTY_UNKNOWN: PublishedRead = { known: false, venueId: null, shifts: [], roleNames: {} }

/** Every published shift dated within [from, to] (inclusive, ISO dates). */
export async function readPublishedShifts(service: Service, from: ISODate, to: ISODate): Promise<PublishedRead> {
  try {
    const { data: venue, error: venueError } = await service
      .from('venues').select('id').eq('active', true)
      .order('created_at', { ascending: true }).limit(1).maybeSingle()
    if (venueError || !venue) return EMPTY_UNKNOWN

    // A week's snapshot holds seven dates; widen by a week each side so the
    // week_start filter can never clip a shift whose date is inside the range.
    const { data: weeks, error } = await service
      .from('schedule_weeks')
      .select('published_snapshot')
      .eq('venue_id', venue.id).eq('status', 'published')
      .gte('week_start', addDays(from, -7)).lte('week_start', to)
    if (error) return EMPTY_UNKNOWN

    const shifts: PresenceShift[] = []
    for (const w of weeks ?? []) {
      const snap = w.published_snapshot as { shifts?: RawSnapshotShift[] } | null
      for (const s of snap?.shifts ?? []) {
        if (!s.date || !s.start || !s.end) continue
        if (s.date < from || s.date > to) continue
        shifts.push({
          id: s.id, date: s.date, start: s.start.slice(0, 5), end: s.end.slice(0, 5),
          assignments: s.assignments ?? [],
        })
      }
    }

    const roleNames: Record<string, string> = {}
    const { data: settings } = await service
      .from('shift_settings').select('roles').eq('venue_id', venue.id).maybeSingle()
    for (const r of (settings?.roles as { id?: string; name?: { he?: string } }[] | null) ?? []) {
      if (r.id && r.name?.he) roleNames[r.id] = r.name.he
    }

    return { known: true, venueId: venue.id, shifts, roleNames }
  } catch {
    return EMPTY_UNKNOWN
  }
}
