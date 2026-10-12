import { NextResponse, type NextRequest } from 'next/server'
import { apiRoute, BadRequest, NotFound } from '@/lib/http/errors'
import { getActiveVenue, requirePublishedScheduleViewer } from '@/lib/shifts/guard'
import { createServiceClient } from '@/lib/supabase/server'
import { canDelegateSchedule, canManageSchedule } from '@/lib/shifts/access'
import { loadShiftsState } from '@/lib/shifts/state-query'

const WEEK_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// The single read endpoint for both the manager and the staff views — the narrowing that RLS would
// otherwise do happens inside loadShiftsState() based on isManager, not by having two routes.
// Never cached: a schedule is only useful if it is current.
export const dynamic = 'force-dynamic'

export const GET = apiRoute(async (request: NextRequest) => {
  const week = request.nextUrl.searchParams.get('week')
  if (!week || !WEEK_PATTERN.test(week)) throw BadRequest('Invalid or missing week.')

  const venue = await getActiveVenue()
  if (!venue) throw NotFound('Venue not found.')
  const viewer = await requirePublishedScheduleViewer(venue.id)

  const { data: settings } = await createServiceClient().from('shift_settings').select('schedule_managers').eq('venue_id', venue.id).maybeSingle()
  const scheduleManagers = (settings?.schedule_managers as string[]) ?? []
  const isManager = canManageSchedule(viewer, scheduleManagers)
  const canDelegate = canDelegateSchedule(viewer)

  const db = await loadShiftsState(venue.id, week, viewer, isManager, canDelegate)
  return NextResponse.json({ db }, { headers: { 'Cache-Control': 'no-store' } })
})
