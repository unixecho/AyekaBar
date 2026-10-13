// What the staff dashboard's shift quick-view is fed — a person's OWN upcoming
// published shifts, and nothing about anyone else's.
//
// The rows reach a client component (so the countdown can tick without a page
// refresh), which is why the colleagues are stripped HERE, on the server: the
// published snapshot carries every assignment of every shift, and a quick-view
// that shipped the whole roster to each phone would be a roster leak dressed up
// as a convenience. Each shift that comes back lists exactly one assignment —
// the viewer's own.

import { createServiceClient } from '@/lib/supabase/server'
import { AYEKA_VENUE, DEFAULT_ROLES } from '@/lib/shifts/config'
import { addDays } from '@/lib/shifts/time'
import { zonedNow, type PresenceShift } from '@/lib/shifts/presence'
import { readPublishedShifts } from '@/lib/shifts/published'

/** How far ahead the quick-view looks. Two weeks is "what do I work soon"; the
 *  full calendar is one tap away at /staff/schedule. */
export const MY_SHIFTS_HORIZON_DAYS = 14

export interface MyShiftsData {
  /** False when the schedule could not be read (shown as "unavailable", never
   *  as "you have no shifts"). */
  known: boolean
  timezone: string
  shifts: PresenceShift[]
  /** roleId → label, for the roles that appear in `shifts`. */
  roleLabels: Record<string, string>
}

export async function readMyShifts(staffId: string): Promise<MyShiftsData> {
  const timezone = AYEKA_VENUE.timezone
  const unknown: MyShiftsData = { known: false, timezone, shifts: [], roleLabels: {} }
  try {
    const service = createServiceClient()
    const now = zonedNow(timezone)
    const read = await readPublishedShifts(
      service, addDays(now.date, -1), addDays(now.date, MY_SHIFTS_HORIZON_DAYS),
    )
    if (!read.known) return unknown

    const shifts: PresenceShift[] = []
    const roleLabels: Record<string, string> = {}
    for (const s of read.shifts) {
      const mine = (s.assignments ?? []).filter((a) => a.staffId === staffId)
      if (mine.length === 0) continue
      for (const a of mine) {
        if (!a.roleId) continue
        roleLabels[a.roleId] = read.roleNames[a.roleId]
          ?? DEFAULT_ROLES.find((r) => r.id === a.roleId)?.name.he
          ?? a.roleId
      }
      shifts.push({
        id: s.id, date: s.date, start: s.start, end: s.end,
        // Only the viewer's own assignment crosses to the client.
        assignments: mine.map((a) => ({ staffId: a.staffId, roleId: a.roleId })),
      })
    }
    return { known: true, timezone, shifts, roleLabels }
  } catch {
    return unknown
  }
}
