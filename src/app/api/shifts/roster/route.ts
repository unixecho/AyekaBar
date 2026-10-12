import { NextResponse } from 'next/server'
import { apiRoute, NotFound } from '@/lib/http/errors'
import { getActiveVenue, requireScheduleManager } from '@/lib/shifts/guard'
import { createServiceClient } from '@/lib/supabase/server'

// Who is switched on for scheduling, for the staff list on /owner/dashboard (StaffManager) — its
// switches read this, and write through /api/shifts/member. Manager-gated: it exposes the
// scheduling flag of every person. `active` is kept as the field name the staff list already reads.
export const dynamic = 'force-dynamic'

export const GET = apiRoute(async () => {
  const venue = await getActiveVenue()
  if (!venue) throw NotFound('Venue not found.')
  await requireScheduleManager(venue.id)
  const { data } = await createServiceClient().from('schedule_members').select('staff_id, schedulable').eq('venue_id', venue.id)
  const staff = (data ?? []).map((m) => ({ id: m.staff_id as string, active: m.schedulable === true }))
  return NextResponse.json({ staff }, { headers: { 'Cache-Control': 'no-store' } })
})
