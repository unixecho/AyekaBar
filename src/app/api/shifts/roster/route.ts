import { NextResponse } from 'next/server'
import { requireScheduleApi } from '@/lib/shifts/guard'
import { rowToRosterStaff } from '@/lib/shifts/serialize'

// A lightweight, unwindowed roster read — no `?week=` needed, since
// `schedule_roster` is venue-wide and small. Two things need exactly this,
// neither of which wants the full `/api/shifts/state` payload:
//
//   1. StaffManager.tsx on /owner/dashboard — outside <ShiftsProvider>
//      entirely, so it has no `db.staff` to read. This is its only way to
//      know who's currently schedulable.
//   2. The roster panel's own live-updating poll (`?week=` schedule
//      surfaces use `refresh()` — a full reload — for this instead, since
//      they already pay that cost; this route exists for the caller that
//      doesn't).
//
// Any signed-in staff member may call this — `schedule_roster` is not
// manager-gated (see migration 027's comment on that view, and
// PLAN_SHIFTS.md Part II decision D9).

export async function GET() {
  const auth = await requireScheduleApi()
  if (!auth.ok) return auth.res

  const { data, error } = await auth.auth.supabase
    .from('schedule_roster')
    .select('staff_id, name, initial, colour, badge, role, pending, schedulable, default_role_id, max_weekly_hours, employment_type, sort_order, note')
    .eq('venue_id', auth.auth.venueId)
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ staff: (data ?? []).map(rowToRosterStaff) })
}
